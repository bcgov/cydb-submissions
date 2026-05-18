# CYDB Submissions — Test Plan (Part 3)

Failing tests written on branch **`hardening-tests`**. Every test fails today; Part 4 makes them pass.

| Issue | Test file | What it asserts | Failure mode today |
|---|---|---|---|
| 6.7 Open redirect | `tests/unit/security-url-safety.test.ts` (9 cases) | `safeNextUrl(input, origin, fallback)` returns the input only when it's same-origin or a leading-slash path; falls back otherwise. Includes `javascript:`, `data:`, protocol-relative, suffix-spoof. | `Cannot find module '$lib/server/security/url-safety'`. |
| 6.6 SSRF (CHEFS baseUrl) | `tests/unit/security-url-safety.test.ts` (12 cases) | `isAllowedChefsBaseUrl(url)` accepts `*.gov.bc.ca` + apex over HTTPS only; rejects RFC1918, loopback, AWS metadata, kubernetes.default, suffix-spoofs. | Same module not found. |
| 3.3 Login rate-limit | `tests/unit/security-login-rate-limit.test.ts` (7 cases) | `createLoginThrottle({ maxFailuresPerKey, windowMs, lockoutMs })` blocks after 5 failures per (ip,email), clears on success, expires after window, plus a coarser IP-only threshold (20) for distributed credential stuffing. | `Cannot find module '$lib/server/security/login-throttle'`. |
| 4.4 Attachment IDOR | `tests/unit/security-attachment-scope.test.ts` (5 cases) | `canAccessAttachmentByStatus(roles, submissionStatus)` — admin: all; cfd_worker: intake + processing, **not** clinician-status or reviewed; clinician: ONLY `ready for clinician`; multi-role unions; empty set denies. | `Cannot find module '$lib/server/security/attachment-scope'`. |
| 10.1, 10.2, 10.5, 10.6, 1.3, 3.6 Response headers | `tests/unit/security-headers.test.ts` (11 cases) | `buildSecurityHeaders({ pathname, isProduction })` returns `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` strict, `Content-Security-Policy` with `frame-ancestors 'none'` and `default-src 'self'` and no `unsafe-eval`, HSTS in prod only, `Cache-Control: no-store` on `/admin`, `/submissions`, `/clinician` but not `/` or `/login`. | `Cannot find module '$lib/server/security/headers'`. |
| 6.10, 9.3, 9.4 Storage safety | `tests/unit/security-storage-safety.test.ts` (4 cases) | `saveAttachments` strips `f.name` path components (basename), rejects MIME spoofs via magic-byte sniff, rejects double-extension filenames; preserves existing size + allowlist rejection. | First three cases run against existing `storage.ts` and ASSERT errors that aren't thrown today; the fourth case passes (existing size/mime allowlist still works — the contract I'm preserving). |
| 8.5 PKCE on SSO · 3.8 password-reset disabled · 12.1 sso_login_succeeded hook | `tests/unit/security-auth-config.test.ts` (4 cases) | Asserts `buildAuthOptions(env)` returns a config with `genericOAuth` ↦ `keycloak({ pkce: true })`, `emailAndPassword.disableResetPassword: true`, a `databaseHooks.session.create.after` hook, and no SSO plugin when issuer is empty. | `Cannot find module '$lib/server/auth-options'`. Today's `auth.ts` builds the options inline; the fix factors them out and adds the three controls. |
| 11.2 npm audit | `tests/unit/security-npm-audit.test.ts` (3 cases) | Runs `npm audit --omit=dev --json`; asserts zero critical AND zero high advisories. JSON parseability is a third assertion guarding the test itself. | 4 high advisories today (`drizzle-orm`, `devalue`, `lodash`, `@better-auth/cli` transitive). |

## Verification

```
./node_modules/.bin/vitest run tests/unit/security-*.test.ts
```

Result on this branch:
- **7 test files, all failing.** 5 fail at module load (helpers don't exist yet); 2 fail at assertion against existing code (`storage-safety`, `npm-audit`).
- **3 incidental passes** inside `storage-safety` and `npm-audit` — these are existing-behaviour contracts I deliberately preserve (size + mime allowlist still rejects; zero **critical** advisories today).

## Mapping back to MoSCoW

| Item | Must / Should | Covered by |
|---|---|---|
| 3.3 login rate-limit | Must | login-rate-limit |
| 4.4 attachment IDOR | Must | attachment-scope |
| 6.6 SSRF | Must | url-safety |
| 6.7 open redirect | Must | url-safety |
| 10.1+10.2+10.5+10.6 headers | Must | headers |
| 11.2 npm audit | Must | npm-audit |
| 3.6 cache-control staff pages | Should | headers (the Cache-Control assertions) |
| 3.8 password-reset disabled | Should | auth-config |
| 6.10 storage basename + magic-byte | Should | storage-safety |
| 8.5 PKCE | Should | auth-config |
| 12.1 sso_login_succeeded | Should | auth-config |

Doc-only items (5.4 SvelteKit CSRF dependency, 6.11 BODY_SIZE_LIMIT, 13.x backup/RPO) are handled in Part 4 by deploy-config and docs changes — no failing tests to author.
