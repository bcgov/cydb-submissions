# CYDB Submissions — Fix Summary (Part 4)

Branch: **`hardening-fixes`** (cherry-picked the failing-tests commit from `hardening-tests`, then committed the fixes on top so the red→green progression stays visible in history).

**Suite state:** 292 tests pass (45 pre-existing + 7 hardening = 52 files). svelte-check shows only the pre-existing `archive/public-form/` errors. `npm run build` succeeds.

---

## Fixes per Must item

### 3.3 — Login rate-limit (Must)

**Before:** `/login?/password` had no rate limiter; brute-force open.

**Fix:** new module `src/lib/server/security/login-throttle.ts` — sliding-window throttle with two thresholds (per `(ip, email)` and per `ip`) and a fixed lockout. Wired into `password` action in `src/routes/login/+page.server.ts`:
- 5 failures per (ip, email) in 15 min → 15-min lockout
- 20 failures per IP regardless of email → same lockout (defends distributed credential stuffing)
- success on a (ip, email) clears the per-key bucket; the per-IP bucket stays (single correct password doesn't legitimise the cluster)

**Test:** `tests/unit/security-login-rate-limit.test.ts` — 7 cases.

### 4.4 — Attachment IDOR (Must)

**Before:** Any signed-in `cfd_worker` could download any attachment by guessing the autoincrement integer ID.

**Fix:**
- New module `src/lib/server/security/attachment-scope.ts` with `canAccessAttachmentByStatus(roles, status)`.
- `/attachments/[id]/+server.ts` now joins to `submissions` and checks the submission's status against the user's roles before serving the file. Mismatches emit `role_denied` and 403.
- Clinicians can now reach `/attachments/*` for `'ready for clinician'` rows only (previously gated out entirely).
- `hooks.server.ts` route rule extended to include `clinician`.

**Status matrix enforced:**
| Role | Allowed statuses |
|---|---|
| admin | all 8 |
| cfd_worker | `submitted`, `OCR queued`, `OCR Error`, `OCR processed`, `ready for review`, `invalid` |
| clinician | `ready for clinician` only |

**Test:** `tests/unit/security-attachment-scope.test.ts` — 5 cases incl. multi-role union.

### 6.6 — CHEFS baseUrl SSRF (Must)

**Before:** `/admin/chefs` `save` action accepted any URL string as the CHEFS base; poller then `fetch`'d it. Internal-services pivot.

**Fix:**
- New `isAllowedChefsBaseUrl(url)` in `src/lib/server/security/url-safety.ts`.
- Allowlist: HTTPS only, hostname must be `gov.bc.ca` or a `*.gov.bc.ca` subdomain.
- Rejected: HTTP, RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, `localhost`), link-local (169.254/16), AWS metadata IP, kubernetes.default[.svc], suffix-spoofs (`gov.bc.ca.attacker.example`), malformed URLs.
- Wired into `admin/chefs/+page.server.ts:save` — returns `fail(400)` with operator-facing reason.

**Test:** part of `tests/unit/security-url-safety.test.ts` — 12 cases.

### 6.7 — Open redirect on `?next=` (Must)

**Before:** All four redirect points in `/login` (`load`, `password`, `sso`, `devLogin`) passed user-supplied `next` straight to `redirect(303, …)`.

**Fix:** new `safeNextUrl(input, origin, fallback)` in `src/lib/server/security/url-safety.ts`.
- Accepts: leading-slash paths, same-origin absolute URLs (normalised to `pathname + search + hash`).
- Rejects: `javascript:`, `data:`, all other schemes, protocol-relative `//attacker`, suffix-spoofs, non-string input, missing leading slash.

Wired into the load function and all three actions.

**Test:** part of `tests/unit/security-url-safety.test.ts` — 9 cases.

### 10.1 / 10.2 / 10.5 / 10.6 — Response-header bundle (Must)

**Before:** No app-set CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, or staff-page Cache-Control. SvelteKit emits only the default Content-Type.

**Fix:**
- New `src/lib/server/security/headers.ts` exporting `buildSecurityHeaders({ pathname, isProduction })`.
- New SvelteKit handle `handleSecurityHeaders` in `hooks.server.ts`, last in the `sequence`, applying the headers to every response.

**Headers set on every response (prod values):**
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only)
- `Content-Security-Policy:` `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
  - **Moderate** policy per direction: `unsafe-inline` allowed for **style only** (shadcn-svelte components emit inline `style=` attributes); explicitly **no** `unsafe-eval` and **no** `unsafe-inline` on `script-src`.
- `Cache-Control: private, no-store` on `/admin*`, `/submissions*`, `/clinician*` only (closes finding 3.6).

**Test:** `tests/unit/security-headers.test.ts` — 11 cases including the Cache-Control branch.

### 11.2 — npm audit (Must)

**Before:** `npm audit --omit=dev` reported **1 high** (drizzle-orm transitive); other deps showed advisories aggregating up to 4 high under the broader audit scope.

**Fix:** `npm audit fix` upgraded the affected transitives via the lockfile (no breaking `--force`). After:

```
high=0 critical=0 total=8 (down from total=10)
```

Remaining moderate/low advisories are all in dev-only deps; out of the production execution path.

**Test:** `tests/unit/security-npm-audit.test.ts` — 3 cases, executes `npm audit --omit=dev --json` and asserts zero high+critical.

---

## Fixes per Should item

### 3.6 — Cache-Control on staff pages
Bundled into `buildSecurityHeaders`. `/admin*`, `/submissions*`, `/clinician*` now respond with `Cache-Control: private, no-store`. `/login` and `/` are deliberately left unset (no PII on either).

### 3.8 — better-auth password-reset disabled
`buildAuthOptions` adds `emailAndPassword.disableResetPassword: true`. The default `sendResetPassword: undefined` already gates the endpoint, but this gives reviewers an explicit toggle to grep for.

### 6.10 — `storage.ts` defensive hardening
Updated `src/lib/server/storage.ts`:
- **Basename:** `sanitiseFilename(f.name)` strips any path components plus normalises whitespace and slashes.
- **Magic-byte sniff:** per-MIME `matchesMagic` check rejects PDF/JPEG/PNG/HEIC/DOC/DOCX content that doesn't match the claimed Content-Type.
- **Extension parity:** filename extension must match the MIME's allowed extensions.
- **Stacked-extension defence:** rejects `evil.pdf.exe` regardless of how the MIME header is set.

**Test:** `tests/unit/security-storage-safety.test.ts` — 4 cases (path-traversal, MIME spoof, double-extension, plus an existing-behaviour-preserved sanity case).

### 6.11 — `BODY_SIZE_LIMIT`
adapter-node's default 512K would silently truncate the documented 25 MiB upload cap. Set `BODY_SIZE_LIMIT=27000000` (≈ 25 MiB + headroom) in `openshift/deployment.yaml` and all three `configmap-{dev,test,prod}.yaml`.

### 8.5 — PKCE on SSO
`buildAuthOptions` wraps `keycloak({…})` with `pkce: true` before passing to `genericOAuth`. better-auth supports PKCE natively.

### 12.1 — `sso_login_succeeded` emission
`buildAuthOptions` now defines `databaseHooks.session.create.after` that emits `sso_login_succeeded` with the user id. This closes the gap where SSO sign-ins had no audit-trail event.

### 5.4 / 13.x — Doc-only items
- Added comments to `hooks.server.ts` explaining SvelteKit's `csrf.checkOrigin` default is the authority for login/logout (the custom `cydb_csrf` token is admin-action-only). *(Captured in inline code comments rather than a separate doc — see hooks.server.ts handlePhase1.)*
- Backup / RPO documentation moved to Part 5 (`05-architecture-report.md`) since the audit report is its natural home.

---

## Verification

```
./node_modules/.bin/vitest run            # 292 / 292 (52 files)
./node_modules/.bin/svelte-check          # 11 pre-existing errors in archive/; no new errors
npm run build                             # ✔ done
npm audit --omit=dev --json | jq .meta…   # high=0, critical=0
```

The seven security test files all transitioned **red → green** on this branch alone. Cherry-pick the test commit + this fix commit onto main as a pair to preserve the demonstration.
