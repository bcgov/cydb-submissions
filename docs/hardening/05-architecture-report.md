# CYDB Submissions — Architecture & Security Posture

**Audience:** External cybersecurity auditor / BC Gov security review.
**Scope:** The `cydb-submissions` SvelteKit application as deployed on the BC Gov OpenShift Gold cluster.
**Status at writing:** Hardening Parts 1–4 complete; this document is the Part 5 deliverable.

This is a standalone summary. Detailed evidence lives in:
- `docs/hardening/01-checklist.md` — OWASP WSTG-derived inspection checklist
- `docs/hardening/02-inspection.md` — per-item verdicts and MoSCoW analysis
- `docs/hardening/03-test-plan.md` — regression test plan
- `docs/hardening/04-fix-summary.md` — per-finding before/after with line refs

---

## 1. System overview

The application implements the **Children & Youth Disability Benefit (CYDB)** intake form, originally prototyped on BC Gov's CHEFS platform. Phase 1 ships a public anonymous submission path; subsequent phases add staff review tooling, OCR enrichment, and clinician workflow.

**Deployment posture (current):** the public anonymous form route is archived; submissions flow into the system via the CHEFS pollers (BC Gov's hosted form service). Staff sign in via BC Gov SSO; admins also have access via local email/password as a clinician fallback channel.

**Repo:** `cydb-submissions/` is the SvelteKit application. The `archive/` directory holds the deprecated public form (preserved for re-enablement under a future phase but not reachable today).

## 2. Core components

| Component | Purpose | Implementation |
|---|---|---|
| **HTTP edge** | TLS, hostname canonicalisation, header injection | OpenShift Route (TLS termination), adapter-node (`PROTOCOL_HEADER` / `HOST_HEADER` set in container env) |
| **SvelteKit application** | Form views, role-gated staff routes, admin actions | SvelteKit 2 + Svelte 5 (runes), TypeScript strict, `adapter-node` |
| **Authentication** | Identity, sessions, OIDC | `better-auth@~1.4.21` with `genericOAuth` plugin (`keycloak` helper, `pkce: true`); local `userRoles` table is authoritative for routing |
| **SSO provider** | Workforce identity | BC Gov Common Hosted Single Sign-On (Keycloak 26.2.x, `realm: standard`) — per-environment client IDs from the issued installation JSON |
| **Role guard** | RBAC | SvelteKit handle `handleRoleGuard` in `src/hooks.server.ts`; `ROUTE_RULES` is the single source of prefix→roles |
| **Persistence** | Application data + auth tables | SQLite via `better-sqlite3` + Drizzle ORM. PVC-backed at `/data/db/local.db` (+ `-shm`, `-wal`); migrations under `src/lib/server/db/migrations/` |
| **Attachments** | File uploads (PDF / image / DOC / DOCX), max 25 MiB | `src/lib/server/storage.ts` writes to the attachments PVC; CHEFS ingest path mirrors the same store |
| **CHEFS ingestion** | Pull submissions from BC Gov CHEFS form | `src/lib/server/chefs/{poller,client,ingest,config}.ts`; baseUrl restricted to `*.gov.bc.ca` |
| **OCR worker** | Async document recognition | In-process worker with single-flight lease loop, breaker, halt sentinel; provider plugins for stub, Kong→Azure DI, and BC Gov AI Adoption DI |
| **Mailer** | Halted-queue and operational alerts | BC Gov Common Hosted Email Service (CHES) — OAuth2 → REST; log-only and SMTP-stub fallbacks |
| **Logger** | Structured logging with PII redaction | `pino` with a custom `redactPII` allowlist; emitted to stdout, captured by OpenShift's log aggregator |
| **Security middleware** | Response headers, CSRF, throttle, URL allowlists | `src/lib/server/security/*` (new in Part 4) — `headers`, `url-safety`, `login-throttle`, `attachment-scope` |

## 3. Data flows

### 3.1 Anonymous submission (current: CHEFS-only)

```
CHEFS form (public, BC Gov-hosted)
   ↓  (CHEFS export API, periodic poll, admin-rotated bearer token)
CHEFS poller  →  saveAttachments()  →  attachments PVC
   ↓                              ↓
submissions table (Drizzle)       submission_attachments table
   ↓
OCR queue (ocr_jobs)
   ↓
OCR worker → provider (bcgov-di / kong-ms-di / stub) → ocr_analyses
   ↓
keyword evaluator → keyword_hits
   ↓
status transitions: submitted → OCR queued → OCR processed → ready for review → reviewed
```

### 3.2 Staff sign-in (SSO path)

```
User → /login → POST /api/auth/sign-in/oauth2 (providerId=keycloak)
                ↓
                better-auth issues PKCE challenge, redirects to
                https://<env>.loginproxy.gov.bc.ca/.../authorize
                ↓
                User authenticates at the IdP (IDIR/BCeID per CSS app config)
                ↓
                Callback at /api/auth/oauth2/callback/keycloak
                ↓
                better-auth validates issuer + PKCE, stores access_token in `account`
                ↓
                databaseHooks.account.create.after:
                    - decode access_token (no signature verify; better-auth
                      already validated the discovery doc)
                    - extract `client_roles` + resource_access.<client>.roles
                    - filter against local Role allowlist
                    - upsert into userRoles (replace; empty-set is a no-op)
                ↓
                databaseHooks.session.create.after emits sso_login_succeeded
                ↓
                User redirected to safeNextUrl(form.next) or role-matched landing
```

### 3.3 Attachment download (post-Part 4)

```
GET /attachments/[id]
   → handleRoleGuard: requires admin | cfd_worker | clinician
   → +server.ts: join attachments + submissions, fetch status
   → canAccessAttachmentByStatus(roles, status):
       admin     → true for every status
       cfd_worker → intake/processing/invalid statuses
       clinician → 'ready for clinician' only
   → mismatched → audit role_denied + 403
   → matched   → streamed with explicit Content-Type, nosniff, no-store,
                 Content-Disposition (inline | attachment)
```

## 4. Data management

### 4.1 Stored data classes

| Class | Where | Sensitivity | Notes |
|---|---|---|---|
| Submission form fields | `submissions` table | **High (PII)** — DOB, diagnosis, services, free-text notes | Indexed for staff workflow (status, surname); `rawPayload` retained for forensic / replay use |
| Submission attachments | attachments PVC | **High (PII)** — clinical documents, IEPs, assessments | One subdirectory per submission UUID; basename-sanitised filenames; sha256 fingerprint persisted alongside |
| User identities | `user`, `account`, `session` (better-auth) | Moderate — email, display name | Passwords stored as better-auth scrypt hashes for the clinician fallback channel; SSO accounts have no local password |
| Role assignments | `userRoles` | Low | Authoritative for routing; SSO JIT-syncs from access-token claim |
| Audit records | pino stdout (captured by OpenShift log aggregator) | Moderate — action correlation incl. user IDs and route paths | Append-only by transport; no in-app retention policy is set (delegated to log aggregator) |
| OCR analysis text | `ocr_analyses` | **High** — full document text | Linked to attachment; subject to keyword evaluator |

### 4.2 Backup & retention

- **DB PVC** (`cydb-submissions-db`, 1 GiB RWO): SQLite WAL is checkpointed on shutdown; snapshot-based backup happens at the OpenShift PVC layer (platform team is the owner). RPO/RTO not currently specified in the app docs.
- **Attachments PVC** (`cydb-submissions-attachments`, 10 GiB RWO): same backup mechanism.
- **Audit log retention:** delegated to the OpenShift log pipeline. No retention enforcement in the app.
- **Backup-related residual gap:** RPO/RTO targets and retention policies are not documented in-repo. Recommended next step: a one-page operations runbook owned jointly with the BC Gov Platform team.

## 5. Security controls implemented

### 5.1 Identity & access

- **Primary authentication:** BC Gov SSO (Keycloak), OIDC authorization-code flow with **PKCE**, scopes `openid profile email`. Implemented via `better-auth`'s `genericOAuth` plugin.
- **Fallback authentication:** local email/password with `minPasswordLength: 12`, scrypt hashing, `disableResetPassword: true` (no in-band password-reset surface).
- **Dev impersonation channel:** `DEV_AUTH_BYPASS` env shim. Hard-refused when `NODE_ENV=production`. Used for local development and Playwright; not deployed.
- **Role authority:** local `userRoles` table. SSO JIT sync upserts from the access-token `client_roles` claim (with `resource_access.<client>.roles` as a fallback) on every sign-in; empty-set is a no-op to survive transient IdP-mapper outages.
- **Route guard:** SvelteKit handle in `src/hooks.server.ts` enforces a static `ROUTE_RULES` prefix table. Defence in depth: every form action additionally calls `requireRole(...)`.

### 5.2 Authorisation scope

- **Submission scope by status:** new in Part 4. `canAccessAttachmentByStatus(roles, status)` enforces a per-status matrix so clinicians only see `'ready for clinician'`, etc.
- **Per-submission scoping** is currently coarse (all `cfd_worker`s see all in-flight submissions; this matches the product intent for Phase 2). Flagged as a residual risk for future phases.

### 5.3 Session management

- **Cookie inventory** (all `httpOnly`):
  - `cydb_csrf` — random 32-char nanoid, `sameSite: strict`, `secure` in production. Carries the CSRF echo token for admin actions.
  - `cydb_bypass` — dev-only; the shim refuses to populate it in production.
  - `better-auth.session_token` — managed by better-auth; rotated on sign-in, deleted on logout.
- **Session lifetime:** 8 h expires-in, 1 h sliding refresh (`updateAge`).
- **CSRF protection:**
  - SvelteKit's built-in `csrf.checkOrigin` (not disabled) defends every POST/PUT/PATCH/DELETE against cross-origin submission.
  - A custom `csrfOk` echo-token check additionally protects every `/admin/*` action.

### 5.4 Input validation & URL trust

- **Form bodies:** Zod schemas at every form action; `safeParse` returns user-facing `fail(400)` without leaking validation internals.
- **File uploads (`storage.ts`):**
  - `path.basename(f.name)` strips embedded path components.
  - Per-MIME magic-byte sniff (PDF / JPEG / PNG / HEIC / DOC / DOCX) rejects content that doesn't match the claimed Content-Type.
  - Filename extension must match the MIME's allowed extensions; double-extensions like `evil.pdf.exe` are rejected.
  - `BODY_SIZE_LIMIT=27000000` (≈ 25 MiB + headroom) enforced by adapter-node upstream of any application code.
- **URL allowlists:** `safeNextUrl` and `isAllowedChefsBaseUrl` (new in Part 4):
  - `?next=` redirect parameter is normalised to same-origin only; rejects pseudo-schemes, protocol-relative, cross-origin, suffix-spoofs.
  - Admin-set CHEFS `baseUrl` must be HTTPS on the `gov.bc.ca` apex/subdomain; blocks RFC1918, loopback, link-local, metadata IP, `kubernetes.default[.svc]`, suffix-spoofs.

### 5.5 Output safety

- **Auto-escaping:** all user-controlled data rendered via Svelte's default interpolation. Audit grep confirms no `{@html}` usage in `src/`.
- **Response headers** (new in Part 4, applied by `handleSecurityHeaders` in `hooks.server.ts`):
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: same-origin`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only)
  - **Content-Security-Policy (moderate):** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. `unsafe-inline` is allowed for **style only** (shadcn-svelte components emit inline `style=`); no `unsafe-eval`, no `unsafe-inline` on `script-src`.
  - `Cache-Control: private, no-store` on `/admin*`, `/submissions*`, `/clinician*` (deliberately omitted on `/` and `/login` — no PII on either).

### 5.6 Cryptography

- **Passwords:** scrypt hashes via better-auth.
- **`BETTER_AUTH_SECRET`:** boot-time check refuses to construct the Auth instance if the secret is missing or < 32 chars.
- **Session cookie integrity:** signed by better-auth using `BETTER_AUTH_SECRET`.
- **OAuth flow:** PKCE on the SSO config; state cookie is signed/encrypted by better-auth.
- **Transport:** TLS terminated at the OpenShift Route; HSTS asserted by the app in production responses.
- **Outbound HTTP:** SSO discovery, CHES OAuth2 token endpoint, CHEFS API, OCR providers — all HTTPS, all using bearer/OAuth2 client credentials provisioned via the `cydb-submissions-secrets` Secret.

### 5.7 Anti-abuse

- **Login throttle** (new in Part 4): 5 failures per `(ip, email)` in 15 min ⇒ 15-min lockout; 20 failures per IP regardless of email ⇒ same lockout (distributed credential-stuffing defence). Successful auth clears the per-key bucket; per-IP bucket persists.
- **OCR breaker:** consecutive terminal OCR failures above threshold flip a halt sentinel; admin-only resume action; halt also fires a CHES email alert.
- **CHEFS poller breaker:** same pattern (halt sentinel + admin-only resume).

### 5.8 Auditability

- 33 declared `AuditEvent` names in `auth-types.ts`; `auditLog()` is a strict allowlisted wrapper that throws on unknown names — preventing silent log-event drift.
- Every state-changing admin action emits an audit event on success. Authentication failures emit `login_failed` with a reason (never the attempted password). Role-guard rejections emit `role_denied`.
- Audit payload schema requires `route` + `requestId`; `actorUserId` is populated whenever a user is present.
- All audit records flow through pino → stdout → OpenShift log aggregator. Append-only by transport — no in-app UPDATE/DELETE sites against an audit table.

## 6. Testing infrastructure

| Layer | Tool | Scope | Count today |
|---|---|---|---|
| Unit | `vitest@4` | Server-side libs, form schema, OCR logic, mailer, auth wiring | 52 files, **292 tests** (incl. 7 hardening files / 54 tests) |
| Static types | `svelte-check` | TypeScript strict over `src/` | Clean (the 11 pre-existing errors are in `archive/` and out of the live build) |
| Static lint | `eslint`, `prettier`, `prettier-plugin-svelte` | Project style | CI gate |
| Integration | Playwright `@playwright/test` | Browser-driven E2E against the built app | 11 specs covering admin, queues, attachments, login bypass, etc. |
| Vulnerability scan | `npm audit --omit=dev` | Production dep advisories | 0 high, 0 critical after Part 4; asserted by `tests/unit/security-npm-audit.test.ts` |

The hardening test suite (`tests/unit/security-*.test.ts`) is structured so it can be re-asserted in CI to prevent regression of every Must / Should fix.

## 7. Configuration & secrets management

- **Secrets (in `cydb-submissions-secrets` Secret):** `BETTER_AUTH_SECRET`, `ADMIN_BOOTSTRAP_*`, SSO client id/secret, CHES OAuth client id/secret, OCR provider API keys, CHEFS API token (DB-stored, env-rotatable).
- **Non-secret env (in `cydb-submissions-config` ConfigMap, per environment):** issuer URLs, base URLs, worker tuning, log level, `BODY_SIZE_LIMIT`. The three ConfigMaps (`configmap-{dev,test,prod}.yaml`) are **gitignored** so per-environment values aren't committed; operators maintain the file matching their cluster.
- **No secrets in source.** Audit grep across the tree returned zero hardcoded credentials.
- **No `--no-verify` / `--no-gpg-sign` / hook-skipping** anywhere in scripts or docs.

## 8. Residual risks (out of scope for this hardening pass)

Auditors should be aware of the following limitations:

1. **Containerfile review not in scope.** `Containerfile` runs as a non-root user per BC Gov standard, but a line-by-line review of base-image pinning, package-update story, and SCC compatibility was not performed in this pass. Recommended as a separate ops review.
2. **Per-submission attachment scoping.** Today's `cfd_worker` can see all in-flight submissions (matches the product intent for Phase 2 — only the status-based slice is enforced). When per-row scoping is added in a later phase, mirror the policy at `/attachments/[id]`.
3. **OCR + CHES + Kong outbound URLs are env-set, not allowlisted.** A platform-team-controlled env change is the only attack vector; we did not add a hostname allowlist for these (unlike CHEFS, which is admin-set at runtime). Acceptable today; revisit if an admin tier above platform-team appears.
4. **Audit allowlist enforced only via `auditLog()`.** Several events (most OCR/CHES events) emit via `logger.info({ event })` directly, which bypasses the allowlist. The events still reach the log aggregator; the only loss is the compile-time guarantee that the event name is recognised. Recommend unifying through `auditLog()` in a follow-up.
5. **Dev-only dependencies carry 3 high advisories.** These are in the `vitest` / `eslint` toolchain — not on the production execution path. Tracked but not patched in this pass.
6. **Backup / RPO / RTO documentation gap.** The data-plane backup story relies on the BC Gov Platform PVC snapshot infrastructure; the app does not assert RPO/RTO and there is no in-repo operations runbook. A one-page joint runbook with the Platform team is recommended.
7. **Constant-time CSRF token comparison.** The custom CSRF echo check uses plain `===` rather than a constant-time compare. Realistic timing-attack via remote HTTP against a 32-char nanoid is implausible, but a `crypto.timingSafeEqual` swap is a trivial future hardening.

## 9. Provenance

This report is the Part 5 deliverable of a structured five-part hardening pass driven by `hardening_instructions.md`:

| Part | Output | Where |
|---|---|---|
| 1 | OWASP WSTG-derived checklist | `docs/hardening/01-checklist.md` |
| 2 | Code-against-checklist inspection with MoSCoW | `docs/hardening/02-inspection.md` |
| 3 | Failing-tests test plan (cherry-picked into `hardening-fixes`) | `docs/hardening/03-test-plan.md` + `tests/unit/security-*.test.ts` |
| 4 | Fix implementation; red → green; `npm audit fix` | `docs/hardening/04-fix-summary.md` + commits `148708f` (tests) and `8bb1b95` (fixes) |
| 5 | This report | `docs/hardening/05-architecture-report.md` |

End of report.
