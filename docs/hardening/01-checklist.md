# CYDB Submissions — Security Hardening Checklist

**Frame:** OWASP Web Security Testing Guide (WSTG) v4.2, stable. Items below cite the WSTG category that motivated them. Items irrelevant to this app (GraphQL, LDAP, XPath, IMAP/SMTP injection, RIA cross-domain, Flash, WebSockets, web messaging, subdomain takeover) are deliberately omitted.

**Surface area covered:**
- Anonymous public POST `/` (rate-limited form submission)
- Attachment upload + download (`/attachments/[id]`)
- Staff routes (`/admin/*`, `/submissions/*`, `/clinician/*`) gated by `userRoles`
- Auth: better-auth email/password, BC Gov SSO (Keycloak OIDC), dev-bypass shim
- Outbound HTTP: CHEFS poller, OCR providers (Kong / bcgov-di), CHES mailer, SSO discovery
- In-process workers (CHEFS poller, OCR worker)
- Custom CSRF (`cydb_csrf` cookie + form token, checked in admin actions)
- SQLite (better-sqlite3) via Drizzle ORM
- pino logger with custom `redactPII` allowlist
- OpenShift deployment: ConfigMap + Secret + Route, PVCs

---

## 1. Configuration & deployment (WSTG-CONF)

- [ ] **1.1** Inline `env:` in `deployment.yaml` doesn't leak secrets (everything sensitive is in `secretRef`).
- [ ] **1.2** HTTP method allowlist — public endpoints reject methods they don't implement (no accidental PUT/DELETE/TRACE).
- [ ] **1.3** HSTS / Strict-Transport-Security header is set (either app or Route layer); document which layer is authoritative.
- [ ] **1.4** Backup, dotfile, `.git`, `node_modules`, and source-map exposure on the public Route.
- [ ] **1.5** Container image runs as non-root, read-only root FS, `securityContext` set appropriately.
- [ ] **1.6** ConfigMap/Secret gitignore is enforced (`openshift/configmap-*.yaml`, `secret.yaml`).
- [ ] **1.7** No debug or dev endpoints reachable in prod (`/__data.json` is fine by design; check for any non-prod-only route that lacks an env guard).
- [ ] **1.8** Log level not `debug` in prod ConfigMap.

## 2. Identity management (WSTG-IDENT)

- [ ] **2.1** Role definitions: every protected route's allowed-role set is correct; no role aliasing.
- [ ] **2.2** User registration: public submission must NOT create a user account; only better-auth email/password sign-up + SSO callback create users.
- [ ] **2.3** Account enumeration: login failure messages are timing/content-uniform between "user doesn't exist" and "wrong password."
- [ ] **2.4** Admin bootstrap (`ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD`) is idempotent and skipped when users already exist; doesn't log the password.
- [ ] **2.5** SSO JIT role sync filters unknown roles and never grants a role outside the `ROLES` allowlist.

## 3. Authentication (WSTG-AUTHN)

- [ ] **3.1** Credentials only over TLS — app sets `secure: true` on cookies in prod and refuses bypass shim in prod.
- [ ] **3.2** No hardcoded credentials anywhere in source.
- [ ] **3.3** Login rate-limit / lockout exists separately from the public-form rate limit (or at minimum, login endpoint is rate-limited).
- [ ] **3.4** Auth bypass via SvelteKit form actions — every non-public route enforces `event.locals.user` before doing work, not just at the layout level.
- [ ] **3.5** No "remember me" implementation lingering with weak storage.
- [ ] **3.6** Browser cache: post-login responses on staff pages set `Cache-Control: no-store` for sensitive content.
- [ ] **3.7** Weak password policy: `minPasswordLength: 12` is enforced server-side AND client-side; rejects common passwords would be nice-to-have, must-have is the length.
- [ ] **3.8** Password reset / change: better-auth ships these — confirm they're disabled (we don't intend to expose them) OR rate-limited if enabled.
- [ ] **3.9** Alternative-channel auth — the `DEV_AUTH_BYPASS` shim must be impossible to activate in `NODE_ENV=production`.

## 4. Authorization (WSTG-AUTHZ)

- [ ] **4.1** Directory traversal in attachments: `/attachments/[id]` resolves only by primary key, not by path; path-join uses the canonical attachment file path and rejects ones outside the configured directory.
- [ ] **4.2** Authorization schema bypass: `handleRoleGuard` route prefix match doesn't allow `/admin../public` or similar; check prefix matcher logic.
- [ ] **4.3** Privilege escalation: form actions on `/admin/*` re-check role on the action handler, not just `load`.
- [ ] **4.4** IDOR on attachment download: a `cfd_worker` who downloads attachment id X must be permitted only for submissions in their visible set.
- [ ] **4.5** IDOR on `/submissions/[uuid]`: clinicians vs cfd_workers vs admin see the right subset (Phase 4 hasn't ship full clinician scoping, but verify the current state).

## 5. Session management (WSTG-SESS)

- [ ] **5.1** Cookie attributes: `cydb_csrf` httpOnly + sameSite=strict + secure-in-prod ✓; `cydb_bypass` httpOnly + sameSite=lax (intentional for ?bypass redirect); better-auth session cookie ditto.
- [ ] **5.2** Session fixation: better-auth rotates session id on sign-in; check no manual cookie carry-over.
- [ ] **5.3** Session vars not exposed in URLs.
- [ ] **5.4** CSRF: the custom `cydb_csrf` token is enforced on every state-changing admin POST action. The public submission POST has no auth context — confirm SvelteKit's built-in same-origin check is enabled (no `csrf: { checkOrigin: false }`).
- [ ] **5.5** Logout: better-auth `signOut` clears session; we also delete `cydb_bypass` cookie. Verify no other cookie persists (e.g. session can't be replayed from a stolen pre-logout cookie if the server-side row is deleted).
- [ ] **5.6** Session timeout: 8h `expiresIn`, 1h `updateAge` (sliding) — confirm settings still applied.
- [ ] **5.7** Session puzzling — single session table per user; better-auth handles it.

## 6. Input validation (WSTG-INPVAL)

- [ ] **6.1** Stored XSS: every user-input field rendered into the submission viewer / admin pages goes through Svelte's auto-escaping; no `{@html}` on attacker-controlled fields.
- [ ] **6.2** Reflected XSS: error messages and `?next=` etc. are escaped in the response.
- [ ] **6.3** SQL injection: all queries go through Drizzle parameterization; any `sql.raw` or string-concatenated SQL is reviewed.
- [ ] **6.4** HTTP parameter pollution: form actions use Zod with strict schemas, refusing duplicate fields with diverging values.
- [ ] **6.5** Command injection: no `child_process.exec`/`spawn` with user-tainted args.
- [ ] **6.6** SSRF in outbound HTTP — CHEFS base URL, OCR provider URLs, CHES URL, SSO issuer — all come from operator-set env or admin-saved config. Verify a non-admin can't influence them.
- [ ] **6.7** Open redirect: `?next=` on `/login` and `callbackURL` on SSO action must be normalized to same-origin before redirect.
- [ ] **6.8** Host header injection: app doesn't construct absolute URLs from `Host:` for redirects without validating against `ORIGIN`.
- [ ] **6.9** Server-side template injection: SvelteKit is compile-time; no runtime template eval. Confirm.
- [ ] **6.10** File upload validation: mime allowlist enforced server-side; size cap enforced before disk write; filename sanitization on save; mime sniff matches claimed type for the formats we accept.
- [ ] **6.11** JSON-payload size: `body.json()` and form parsing have a ceiling so a 1 GB payload doesn't OOM the worker.

## 7. Error handling (WSTG-ERR)

- [ ] **7.1** Production stack traces are not returned in 500 responses (SvelteKit default behaviour in prod).
- [ ] **7.2** No DB error strings (constraint names, column names) bubble up to the user in form-action `fail()` returns.
- [ ] **7.3** `uncaughtException` / `unhandledRejection` handlers do not leak env values.

## 8. Cryptography (WSTG-CRYPT)

- [ ] **8.1** Passwords stored using better-auth's bcrypt-equivalent hash; no plaintext or reversible encoding.
- [ ] **8.2** `BETTER_AUTH_SECRET` length check ≥ 32 enforced at boot.
- [ ] **8.3** No secrets logged: scan logger calls for `accessToken`, `apiKey`, `clientSecret`, `password`, `Authorization` header echo.
- [ ] **8.4** TLS termination at the Route — app cookies set `secure: true` only when `NODE_ENV=production`; confirm.
- [ ] **8.5** OAuth state / PKCE: better-auth's genericOAuth defaults — verify state cookie is signed/encrypted (it is by better-auth) and `pkce: true` is enabled for the SSO config.

## 9. Business logic (WSTG-BUSL)

- [ ] **9.1** Anonymous submission rate limit (`RATE_LIMIT_PER_IP`) actually rejects above the threshold — verify the in-memory limiter survives the same request being counted twice and isn't keyed by trustable IP only.
- [ ] **9.2** Workflow circumvention: a clinician can't approve a submission they shouldn't see; an admin clearing users doesn't accidentally clear the actor's own account.
- [ ] **9.3** Malicious file upload: ensure rejection of executable types (`.exe`, `.bat`, `.sh`) regardless of content; ensure double-extensions (`evil.pdf.exe`) are rejected.
- [ ] **9.4** Unexpected file type: a PDF that is actually a polyglot zip — at minimum we don't execute it; reject if the magic bytes don't match the claimed mime.
- [ ] **9.5** OCR job + CHEFS poller can be halted and resumed only by an admin; status is read-only to other roles.

## 10. Client-side (WSTG-CLNT)

- [ ] **10.1** Clickjacking: `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`.
- [ ] **10.2** Content Security Policy: no inline `<script>` unsafe-inline; styles tightly scoped.
- [ ] **10.3** Open redirect / client-side URL redirect: any `window.location = userInput` removed; the SSO redirect URL is server-issued.
- [ ] **10.4** CORS: `Access-Control-Allow-Origin: *` is NOT set; no cross-origin write endpoints.
- [ ] **10.5** Referrer-Policy set to `same-origin` or stricter.
- [ ] **10.6** X-Content-Type-Options: nosniff.
- [ ] **10.7** Browser storage: no sensitive data in `localStorage` / `sessionStorage` (we don't use them client-side; confirm).

## 11. Supply chain & dependencies

- [ ] **11.1** `package-lock.json` is committed and matches `package.json` (no lockfile drift).
- [ ] **11.2** Run `npm audit --production` and triage anything ≥ high.
- [ ] **11.3** No `"latest"` or wide-range (`*`, `^x`) version specifiers on security-critical deps (`better-auth`, `better-sqlite3`, `@sveltejs/kit`, `pino`, `zod`, `nanoid`).
- [ ] **11.4** Drizzle migration scripts in the image come from the committed migrations directory only; no runtime fetch of migrations.
- [ ] **11.5** No `postinstall` script in our `package.json` or in direct deps that fetches untrusted code (skim `npm install --ignore-scripts` viability).
- [ ] **11.6** Container base image (`Containerfile`) is a pinned tag, not `:latest`; security updates story documented.

## 12. Audit logging completeness

- [ ] **12.1** Every entry in the `AUDIT_EVENTS` allowlist (`auth-types.ts`) is actually emitted from at least one call site.
- [ ] **12.2** State-changing admin actions all emit an audit event (`role_denied` on failure, action-specific event on success). No silent admin mutations.
- [ ] **12.3** Audit payloads always include `actorUserId` (or explicit `actorUserId: null` for unauthenticated paths) plus the requestId.
- [ ] **12.4** Audit table / sink is append-only from the app's perspective — no UPDATE/DELETE call sites against the audit store.
- [ ] **12.5** Audit log redaction: events containing field names from PII_KEYS must redact those values before persistence.
- [ ] **12.6** Auth failures (login_failed) don't echo the attempted password into the log.

## 13. Backup, recovery & retention

- [ ] **13.1** SQLite WAL + checkpoint policy documented; backups capture `local.db`, `-shm`, `-wal` consistently.
- [ ] **13.2** Attachment PVC backup story documented; orphan attachments on disk vs. DB row mismatch is recoverable.
- [ ] **13.3** Audit-log retention policy stated (how long do we keep records; can rows be purged by admin?).
- [ ] **13.4** No backup files (`.bak`, `.sql.gz`, `local.db.copy`) accidentally checked into the image or the PVC root.
- [ ] **13.5** Disaster-recovery doc names the recovery point objective (RPO) and recovery time objective (RTO), even if as TODO with the platform team.

---

## Coverage I'm deliberately skipping

| Item | Reason |
|------|--------|
| WSTG-INFO (info gathering / recon) | Not an app-code property; falls to ops scanning. |
| WSTG-API (GraphQL) | We don't ship a GraphQL surface. |
| LDAP / XPath / IMAP / SMTP injection (WSTG-INPVAL subsets) | No LDAP / XPath / mail-protocol parsing in user-input path. |
| HTTP smuggling | Node + adapter-node + OpenShift Route — known-good combo. Not app-code. |
| Padding oracle (WSTG-CRYPT) | We don't do custom symmetric encryption. |
| Cross-site flashing, WebSockets, web messaging | Not used. |

If any of these turn out to be in play during Part 2, I'll add them back.
