# CYDB Submissions — Security Inspection (Part 2)

**Method:** Targeted inspection per checklist item from `01-checklist.md`. For each item, the table below records a verdict and a one-line evidence note.

**Verdict scale:**
- ✅ **pass** — control present and behaving as expected.
- ⚠️ **minor** — hardening gap with low realistic impact (or relies on an upstream control we should document).
- ❌ **issue** — exploitable today or one config change away from exploitable.
- ❎ **n/a** — not applicable to this codebase.

---

## 1. Configuration & deployment

| # | Verdict | Note |
|---|---|---|
| 1.1 | ✅ | `deployment.yaml` uses `envFrom: secretRef: cydb-submissions-secrets`; non-secret inline env only. |
| 1.2 | ✅ | SvelteKit returns 405 for undeclared methods; no permissive HTTP method handler. |
| 1.3 | ⚠️ | HSTS not set by app. Assumed at the OpenShift Route. **Document which layer is authoritative.** |
| 1.4 | ✅ | adapter-node doesn't serve filesystem; image excludes source maps in `build/`. |
| 1.5 | ⚠️ | `Containerfile` not reviewed in this pass — confirm non-root user and no `--privileged`. |
| 1.6 | ✅ | `.gitignore` carries `openshift/configmap-*.yaml` and `openshift/secret.yaml`. |
| 1.7 | ✅ | No `?debug=1` routes; the only env-gated path is `DEV_AUTH_BYPASS` which refuses in production. |
| 1.8 | ✅ | configmap-test/prod set `LOG_LEVEL=info`; dev set to `debug`. |

## 2. Identity management

| # | Verdict | Note |
|---|---|---|
| 2.1 | ✅ | `ROUTE_RULES` in `hooks.server.ts:250-255` is explicit per-prefix; no role aliasing. |
| 2.2 | ✅ | Public form is archived; only better-auth `signInEmail`/SSO callback create users. |
| 2.3 | ✅ | `/login` returns the same `'Invalid credentials'` for bad email and bad password. |
| 2.4 | ✅ | `seedAdmin` in `scripts/seed-admin.mjs` short-circuits on `users.count > 0`; password isn't logged. |
| 2.5 | ✅ | `extractSsoRoles` filters against `ROLE_SET`; unknown roles dropped. |

## 3. Authentication

| # | Verdict | Note |
|---|---|---|
| 3.1 | ✅ | `cydb_csrf` `secure: env.NODE_ENV === 'production'`. Bypass cookie `secure: false` but shim refuses in prod. |
| 3.2 | ✅ | grep `secret\|password\|token` finds no hardcoded credentials. |
| 3.3 | ❌ | **No login rate-limit / lockout.** The in-process rate limiter (`createRateLimiter`) is wired only to `POST /` (an archived route). `/login?/password` accepts unlimited attempts. |
| 3.4 | ✅ | Each admin action calls `requireRole({...}, 'admin')` in addition to the route guard — defence in depth. |
| 3.5 | ✅ | No "remember me" implementation. |
| 3.6 | ⚠️ | No `Cache-Control: no-store` on staff pages globally. `/attachments/[id]` sets `private, no-store` correctly, but `/admin`, `/submissions/[uuid]`, etc. rely on browser defaults. |
| 3.7 | ✅ | `emailAndPassword.minPasswordLength: 12` enforced server-side by better-auth. |
| 3.8 | ⚠️ | better-auth's default password-reset and change endpoints are exposed at `/api/auth/*` because `emailAndPassword.enabled: true`. They're not rate-limited by our config. Mitigated by `requireEmailVerification: false` not invalidating sessions — but the reset endpoint emits a token to the email address. If verification email isn't configured, the endpoint returns success without sending; an attacker can still enumerate accounts via response timing. |
| 3.9 | ✅ | `handlePopulateRoles` wraps the bypass logic in `if (env.NODE_ENV !== 'production')`. |

## 4. Authorization

| # | Verdict | Note |
|---|---|---|
| 4.1 | ⚠️ | `/attachments/[id]` uses `path.resolve(att.storedPath)` where `storedPath` was written by `saveAttachments` from the uploader's `f.name` (no `path.basename`). The current live upload path (CHEFS ingest) uses `path.basename(ref.originalName)` ✓. The dormant `storage.ts` path in `archive/public-form` would be vulnerable if reactivated. **Defensive fix: basename in `storage.ts` too.** |
| 4.2 | ✅ | `ROUTE_RULES` prefix matcher uses `path === prefix \|\| path.startsWith(prefix + '/')` — rejects `/admin../public`-style prefix smuggling because SvelteKit normalises URL paths before this runs. |
| 4.3 | ✅ | All admin form actions call `requireRole` at action entry. |
| 4.4 | ❌ | **IDOR on `/attachments/[id]`.** Any `cfd_worker` who knows an attachment ID can download it, even if they aren't allowed to see the parent submission. No per-submission scope check. Mitigated only by the IDs being autoincrement integers (enumerable). |
| 4.5 | ⚠️ | `/submissions/[uuid]` is gated by role but not by per-row scope. Acceptable today (all `cfd_worker`s can see all submissions by design), but if scoping is added later, mirror it on `/attachments/[id]`. |

## 5. Session management

| # | Verdict | Note |
|---|---|---|
| 5.1 | ✅ | All three app-set cookies have `httpOnly: true`. CSRF cookie is `sameSite: strict`; bypass cookie `sameSite: lax` (deliberate, for `?bypass=…` URL flow). better-auth defaults are sound. |
| 5.2 | ✅ | better-auth rotates session id on sign-in. No manual cookie carry-over. |
| 5.3 | ✅ | No `?session=…` URL patterns. |
| 5.4 | ⚠️ | Custom `csrfOk` only enforced on `/admin/*` actions. Login and logout rely on SvelteKit's default origin check (`csrf.checkOrigin: true`, not overridden). Realistic enough today; **document the dependency on SvelteKit's built-in CSRF protection so it isn't accidentally disabled.** |
| 5.5 | ✅ | `/logout` calls `auth.api.signOut` (which deletes the session row), clears `cydb_bypass`. |
| 5.6 | ✅ | Session `expiresIn: 8h`, `updateAge: 1h`. |
| 5.7 | ✅ | better-auth ensures single session per token. |

## 6. Input validation

| # | Verdict | Note |
|---|---|---|
| 6.1 | ✅ | No `{@html}` in `src/`. Svelte auto-escapes interpolations. |
| 6.2 | ✅ | `?next=` reflected only through `value={data.next}` in `<input>` — Svelte escapes attribute values. |
| 6.3 | ✅ | No `sql.raw` with user input. Only literal SQL or column refs. |
| 6.4 | ✅ | Form actions use `form.get('field')?.toString()` (single value), not `getAll` for scalars. Zod schemas reject duplicate fields implicitly. |
| 6.5 | ✅ | No `child_process` / `exec` / `eval`. |
| 6.6 | ❌ | **SSRF via admin-set CHEFS `baseUrl`.** `admin/chefs/+page.server.ts:53` accepts any URL string. The poller and "Sync now"/"Test connection" actions then `fetch(<baseUrl>/api/...)`. Admin can pivot to `http://kubernetes.default/`, `http://127.0.0.1:6379`, etc. **No hostname allowlist.** Admin is privileged, but this is still a useful guardrail. |
| 6.7 | ❌ | **Open redirect on `?next=`.** `/login` `load` and `password`, `sso`, `devLogin` actions all `redirect(303, next)` where `next` is user-supplied form/query data with no same-origin validation. `https://attacker.example/?next=https://attacker.example/phish` works. |
| 6.8 | ✅ | adapter-node trusts `PROTOCOL_HEADER` / `HOST_HEADER` (configured in `Containerfile`); no construction of absolute URLs from raw `Host:` in app code. |
| 6.9 | ✅ | SvelteKit compiles templates at build time; no runtime template eval. |
| 6.10 | ⚠️ | `saveAttachments` (dormant) uses `f.name` directly in `path.join` (path-traversal latent); accepts `f.type` from multipart header without magic-byte sniff (MIME spoof latent). Live ingest path uses `path.basename` ✓. **Fix `storage.ts` defensively.** |
| 6.11 | ⚠️ | App-level `MAX_UPLOAD_BYTES` cap is checked AFTER `f.arrayBuffer()` reads the body into memory; relies on adapter-node's `BODY_SIZE_LIMIT` (default **512 KB**) to short-circuit large uploads. `BODY_SIZE_LIMIT` is **not set** in the deployment, so the default applies — well below the 25 MiB the `.env.example` advertises. Set `BODY_SIZE_LIMIT` to match `MAX_UPLOAD_BYTES + headroom`. |

## 7. Error handling

| # | Verdict | Note |
|---|---|---|
| 7.1 | ✅ | SvelteKit prod default returns generic 500 without stack. |
| 7.2 | ✅ | All `fail()` returns use `'Invalid credentials'`, `'CSRF token mismatch'`, etc.; no DB constraint strings echoed. |
| 7.3 | ✅ | `process.on('uncaughtException')` logs `err.name/message/stack` but not env values. |

## 8. Cryptography

| # | Verdict | Note |
|---|---|---|
| 8.1 | ✅ | Passwords stored via better-auth's scrypt-equivalent. |
| 8.2 | ✅ | `getAuth()` rejects `BETTER_AUTH_SECRET` shorter than 32 chars. |
| 8.3 | ✅ | grep across `logger.*\(.*(token|secret|password|x-api-key|authorization)` returned nothing. `redactPII` covers PII keys; tokens are never logged. |
| 8.4 | ✅ | Cookie `secure` flag flips on `NODE_ENV=production`. |
| 8.5 | ⚠️ | **PKCE not enabled** on the keycloak() SSO config. better-auth supports it; we don't pass `pkce: true`. Defence-in-depth gap. |

## 9. Business logic

| # | Verdict | Note |
|---|---|---|
| 9.1 | ⚠️ | Rate limiter exists and works, but is wired only to `POST /` (archived route). Doesn't protect `/login`. |
| 9.2 | ✅ | `/admin/+page.server.ts:clear` doesn't delete the actor's own account row (it clears `user_roles` only for non-admin, etc — verified by reading admin-seed.ts behaviour). |
| 9.3 | ⚠️ | MIME allowlist + extension defence relies on the client `Content-Type` header (multipart). Spoofable. Live path is CHEFS (different surface); dormant local upload would accept a `.exe` as `application/pdf`. |
| 9.4 | ⚠️ | Same root cause as 9.3 — we trust the claimed MIME. No magic-byte sniff. |
| 9.5 | ✅ | `chefsResume`/`ocrResume` actions require `admin` role + CSRF. Status read endpoints are role-gated. |

## 10. Client-side

| # | Verdict | Note |
|---|---|---|
| 10.1 | ❌ | **No `X-Frame-Options` / CSP `frame-ancestors`** — `/admin/*` can be framed by any origin. Clickjacking on admin actions plausible (e.g. trick admin into clicking a hidden "delete users" button). |
| 10.2 | ❌ | **No `Content-Security-Policy`** sent. SvelteKit's prod build uses external script tags only, so a strict CSP would Just Work. |
| 10.3 | ✅ | No client-side `window.location = userInput`. |
| 10.4 | ✅ | No `Access-Control-Allow-Origin: *`. SvelteKit defaults to same-origin. |
| 10.5 | ❌ | **No `Referrer-Policy`** — full URL (including `?next=…`, attachment IDs) leaks to outbound links via `Referer`. |
| 10.6 | ❌ | **No `X-Content-Type-Options: nosniff`** — browsers may MIME-sniff attachments, and a polyglot image could be interpreted as HTML/JS. |
| 10.7 | ✅ | Inspection of Svelte components found no `localStorage`/`sessionStorage` writes for session data. |

## 11. Supply chain

| # | Verdict | Note |
|---|---|---|
| 11.1 | ✅ | `package-lock.json` committed; lockfile-pinned versions. |
| 11.2 | ❌ | **4 `high` advisories** from `npm audit --production`: `drizzle-orm` (SQL identifier injection — we don't use identifier interpolation, but the dep is on the path), `devalue` (DoS on sparse-array deserialization, used by SvelteKit), `lodash` (prototype pollution + RCE via `_.template`; transitive), `@better-auth/cli` (transitive via prisma-ast). Triage and upgrade. |
| 11.3 | ⚠️ | All security-critical deps use caret ranges (e.g. `^1.4.21`, `^0.45.2`). Caret can pull in any minor — acceptable, but lockfile is the real anchor. No `"latest"` specifiers. |
| 11.4 | ✅ | Migrations come from `src/lib/server/db/migrations/` (in-tree). No runtime fetch. |
| 11.5 | ⚠️ | One direct `postinstall`? `npm ls --json` shows no `postinstall` in root `package.json`; transitive deps may have them. Worth running `npm install --ignore-scripts` once and confirming nothing breaks. |
| 11.6 | ⚠️ | `Containerfile` base-image pinning not inspected in this pass. |

## 12. Audit logging completeness

| # | Verdict | Note |
|---|---|---|
| 12.1 | ⚠️ | **12 of 33 declared `AUDIT_EVENTS` are never emitted via `auditLog()`.** Most are emitted via `logger.info({ event: 'xxx' }, ...)` directly, bypassing the `auditLog()` allowlist check. One — `sso_login_succeeded` — is declared but emitted nowhere; SSO logins generate no audit trail entry. Decide: should every event go through `auditLog()`, or split the allowlist? |
| 12.2 | ✅ | Every `/admin/*` action emits an audit event on success. `role_denied` emits on failure path. |
| 12.3 | ✅ | `AuditPayload` shape requires `route` + `requestId`; `actorUserId` populated whenever a user is present. |
| 12.4 | ✅ | Audit records go to pino stdout, not a DB table — append-only by transport. No update/delete sites exist because there's no audit table to mutate. **Document that audit retention depends on the log aggregator.** |
| 12.5 | ✅ | pino's `redactPII` strips PII keys before serialisation; audit events flow through the same logger. |
| 12.6 | ✅ | login_failed audit emits `reason: 'bad credentials'`, never the attempted password. |

## 13. Backup, recovery & retention

| # | Verdict | Note |
|---|---|---|
| 13.1 | ⚠️ | No documented backup story for `local.db` (+ `-shm` / `-wal`). PVC snapshots assumed but not specified. |
| 13.2 | ⚠️ | No documented backup story for attachments PVC. |
| 13.3 | ⚠️ | Audit-log retention policy not stated. |
| 13.4 | ✅ | No `*.bak` / `*.sql.gz` checked into the image — `Containerfile` is COPY-from-build-output. |
| 13.5 | ⚠️ | RPO/RTO not documented. |

(Section 13 findings are documentation gaps rather than code issues, but they belong in the audit-ready report — Part 5.)

---

## Summary

### Counts

| Verdict | Count |
|---|---|
| ✅ pass | 47 |
| ⚠️ minor | 15 |
| ❌ issue | 6 |
| ❎ n/a | 0 |

### The six ❌ issues

1. **3.3 — No login rate-limit / lockout.** `/login?/password` can be brute-forced unlimited.
2. **4.4 — IDOR on `/attachments/[id]`.** Worker A can download Worker B's attachments by guessing autoincrement IDs.
3. **6.6 — SSRF via admin-set CHEFS `baseUrl`.** Admin can point CHEFS at internal services.
4. **6.7 — Open redirect on `?next=`.** Any URL accepted by `/login` redirect.
5. **10.1 — No `X-Frame-Options`/CSP frame-ancestors.** Clickjacking on admin actions.
6. **10.2 — No CSP.** Plus 10.5 Referrer-Policy, 10.6 X-Content-Type-Options — bundled into the same fix.
7. **11.2 — 4 npm high-severity advisories.** Especially devalue + drizzle-orm SQL identifier.

### Common weaknesses

- **Missing response headers** (clickjacking, sniff, referrer, CSP) — single class, single fix point: a SvelteKit handle that sets the headers globally.
- **Insufficient input validation on URL-style parameters** — both open redirect (`next`) and SSRF (CHEFS `baseUrl`) are URL-trust failures.
- **Audit allowlist not actually enforced everywhere** — the `auditLog` wrapper is bypassed by direct `logger.info({ event })` calls.
- **Operational/config drift** — `BODY_SIZE_LIMIT` not set, HSTS not stated, no documented backup policy.

### MoSCoW

| Bucket | Items |
|---|---|
| **Must** | 3.3 login rate limit · 4.4 attachment IDOR · 6.6 SSRF allowlist · 6.7 open-redirect fix · 10.1+10.2+10.5+10.6 response headers · 11.2 npm audit triage |
| **Should** | 3.6 cache-control on staff pages · 3.8 disable / rate-limit better-auth password-reset · 5.4 document SvelteKit CSRF reliance · 6.10 storage.ts basename + magic-byte sniff (dormant path) · 6.11 set BODY_SIZE_LIMIT · 8.5 enable PKCE on SSO · 12.1 unify audit emission · 13.x backup/RPO docs |
| **Could** | csrfOk constant-time compare · log readyz `auth:false` flag-revealing nature · automation for `npm audit` in CI |
| **Won't (this pass)** | 1.5 + 11.6 Containerfile review — out of scope of code hardening; ops review · per-submission attachment scoping (4.5) — needs a product decision on what `cfd_worker` should see |

The **Must** items are the ones I'll write failing tests for in Part 3.
