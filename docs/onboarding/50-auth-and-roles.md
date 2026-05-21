# 50 · Auth & roles

Three authentication paths, one role model. Once you understand how the three paths converge on `event.locals.user` + `event.locals.roles`, the rest is mechanical.

## The three sign-in paths

```
                     ┌──────────────────────────────────────┐
                     │   BC Gov SSO (Keycloak OIDC)         │
   primary path      │   /api/auth/sign-in/oauth2           │
                     │   PKCE, client_credentials confidential client
                     └────────────────────┬─────────────────┘
                                          │
                     ┌────────────────────┼─────────────────┐
   fallback path     │   Email + Password (better-auth)     │
                     │   ?/password action on /login        │
                     └────────────────────┬─────────────────┘
                                          │
                     ┌────────────────────┼─────────────────┐
   dev-only path     │   DEV_AUTH_BYPASS shim               │
                     │   ?bypass=email or ?/devLogin action │
                     └────────────────────┬─────────────────┘
                                          │
                                          ▼
                            event.locals.user + event.locals.roles
                                          │
                                          ▼
                                   handleRoleGuard
```

All three populate the same shape — once you're past `handleBetterAuth` (or `handlePopulateRoles` for bypass), the rest of the request flow doesn't care which path you came in by.

## The role model

Three roles. The list is short on purpose.

```ts
// src/lib/server/auth-types.ts
export const ROLES = ['admin', 'cfd_worker', 'clinician'] as const;
export type Role = (typeof ROLES)[number];
```

A single user can have multiple roles. The `user_roles` table allows it; `event.locals.roles` is a `Set<Role>`. When you write a role check, you check membership:

```ts
if (locals.roles.has('admin')) { ... }
// or
import { requireRole } from '$lib/server/roles';
requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
```

The `requireRole` helper throws `error(401)` if the user isn't signed in, `error(403)` if they're signed in but missing every role. This is the canonical check for action handlers and `+server.ts` endpoints.

### What each role can do

| Action / Route | admin | cfd_worker | clinician |
|---|---|---|---|
| Sign in | ✓ | ✓ | ✓ |
| See `/submissions` (table) | ✓ | ✓ | ✗ |
| See `/submissions/[uuid]` (viewer) | ✓ | ✓ | ✗ (today; Phase 4 finalisation may grant by assignment) |
| Download `/attachments/[id]` | always | status-scoped | status-scoped |
| See `/admin/*` (config + queues) | ✓ | ✗ | ✗ |
| See `/clinician` | ✗ | ✗ | ✓ |
| Halt or resume the OCR queue | ✓ | ✗ | ✗ |
| Halt or resume CHEFS poller | ✓ | ✗ | ✗ |
| Requeue or abandon an OCR job | ✓ | ✗ | ✗ |
| Save CHEFS config or rotate its API token | ✓ | ✗ | ✗ |
| Sync CHEFS once (on demand) | ✓ | ✗ | ✗ |

### Status-scoped attachment access

`/attachments/[id]/+server.ts` joins to `submissions` and runs `canAccessAttachmentByStatus(roles, status)` before serving the file. The policy:

| Role | Allowed statuses |
|---|---|
| `admin` | all 8 |
| `cfd_worker` | `submitted`, `OCR queued`, `OCR Error`, `OCR processed`, `ready for review`, `invalid` |
| `clinician` | `ready for clinician` only |

Implementation in `src/lib/server/security/attachment-scope.ts`. The matrix exists so a CFD worker can't preview attachments belonging to a case that's been formally assigned to a clinician (or that the clinician has reviewed). It's a defense against accidental cross-role exposure.

If you change this matrix, update the unit tests in `tests/unit/security-attachment-scope.test.ts` — they assert each row.

## Path 1: BC Gov SSO

### What it is

BC Gov runs a managed Keycloak (the "Common Hosted Single Sign-On" service, abbreviated CSS by the BC Gov team). All BC Gov teams share a realm called `standard`. Each application is a "client" inside that realm — identified by a client ID and authenticated by a client secret. Per-environment, you get a different host (`dev.loginproxy`, `test.loginproxy`, `loginproxy`) but the same realm name and the same client ID.

For CYDB Submissions, the client ID is `cydb-submissions-6444`. The per-environment installation JSONs (issued by the BC Gov SSO team) carry:

```json
{
  "auth-server-url": "https://loginproxy.gov.bc.ca/auth",
  "realm": "standard",
  "resource": "cydb-submissions-6444",
  "credentials": { "secret": "<env-specific>" }
}
```

These map to env vars:
- `SSO_ISSUER_URL` = `${auth-server-url}/realms/${realm}` (e.g. `https://loginproxy.gov.bc.ca/auth/realms/standard`)
- `SSO_CLIENT_ID` = `resource`
- `SSO_CLIENT_SECRET` = `credentials.secret`

### How it's wired

`src/lib/server/auth-options.ts` builds the better-auth options object. When `SSO_ISSUER_URL` is set, it constructs:

```ts
genericOAuth({
  config: [{
    ...keycloak({
      clientId: ssoCfg.clientId,
      clientSecret: ssoCfg.clientSecret,
      issuer: ssoCfg.issuer
    }),
    pkce: true
  }]
})
```

`keycloak()` is a better-auth helper that fills in OIDC discovery URLs (`${issuer}/.well-known/openid-configuration`), scopes (`openid profile email`), and the userinfo endpoint (`${issuer}/protocol/openid-connect/userinfo`). We **spread it and override `pkce: true`** because the default helper leaves PKCE off. PKCE protects against authorization-code interception in case of a misconfigured browser proxy.

The provider ID better-auth uses internally is `keycloak`. The OAuth callback URI is `https://<route-host>/api/auth/oauth2/callback/keycloak` — this string must be registered with the BC Gov SSO team via the CSS app for each environment. The path component `keycloak` is not under your control; don't try to rename it.

### The login flow

```
user clicks "Sign in with BC Gov SSO"
   ↓
POST /login?/sso  (named form action)
   ↓
src/routes/login/+page.server.ts:sso
   - validates ?next=... against safeNextUrl (open-redirect defence)
   - calls auth.api.signInWithOAuth2({ providerId: 'keycloak', callbackURL, disableRedirect: true })
   - better-auth returns { url: '<keycloak authorize URL with PKCE challenge>' }
   - throw redirect(303, url)
   ↓
Browser redirected to https://<env>.loginproxy.gov.bc.ca/auth/realms/standard/protocol/openid-connect/auth?...
   ↓
User authenticates at the IdP (IDIR, BCeID, etc.)
   ↓
IdP redirects to https://<route-host>/api/auth/oauth2/callback/keycloak?code=...&state=...
   ↓
better-auth catches /api/auth/* via handleBetterAuth in our hook chain
   - exchanges the code for tokens (PKCE verifier check)
   - validates the id_token's signature against the JWKS from discovery
   - persists access_token + refresh_token + id_token into the `account` table
   - creates a new row in `session`
   ↓
databaseHooks.account.create.after fires:
   - decode access_token JWT (no re-verify; better-auth already validated)
   - extract roles from BC Gov's `client_roles` claim
     (with `resource_access.<client>.roles` as a defensive fallback)
   - filter against the local ROLES allowlist
   - if at least one role found: replace local userRoles for this user
   - if empty set: log warn, leave local userRoles unchanged (transient-IdP-mapper protection)
   ↓
databaseHooks.session.create.after fires:
   - emit `sso_login_succeeded` audit event
   ↓
User redirected to the callbackURL passed in (validated by safeNextUrl)
```

### JIT role provisioning

Roles flow from the IdP, not from a local sign-up form. When a new BC Gov SSO user signs in for the first time:
1. better-auth creates a row in `user` (and `account`) with `email`, `name`, and `image` from the OIDC userinfo response.
2. `databaseHooks.account.create.after` runs `extractSsoRoles(account.accessToken, clientId)` to find their roles.
3. `syncUserRoles(db, account.userId, roles)` upserts.

When they sign in **again** (any subsequent session), `databaseHooks.account.update.after` runs the same sync — so role changes made in the BC Gov CSS app reach us on the user's next sign-in.

### What `client_roles` looks like

BC Gov SSO injects a custom token mapper called `client_roles`. When you decode the access token (JWT, base64url segments), the payload has a top-level array:

```json
{
  "exp": 1716200000,
  "iss": "https://loginproxy.gov.bc.ca/auth/realms/standard",
  "aud": "cydb-submissions-6444",
  "sub": "abc123",
  "email": "user@gov.bc.ca",
  "client_roles": ["admin", "cfd_worker"],
  "resource_access": {
    "cydb-submissions-6444": { "roles": ["admin", "cfd_worker"] }
  }
}
```

We read **both** `client_roles` (top-level, BC Gov's mapper) and `resource_access.<clientId>.roles` (standard Keycloak nesting). We union them. If the BC Gov mapper hasn't been provisioned on a particular environment (occasional CSS-app misconfiguration), the standard nested form is the fallback.

Both shapes go through the same allowlist filter (`ROLE_SET`). Anything in the token that isn't one of our three role names is dropped — so if BC Gov has roles called `cydb-admin` or `Administrator` that don't match our spelling, they don't grant access. Decide whether to rename in CSS or to extend the allowlist; today we expect IdP and code to use the same names.

### What's NOT verified at our end

- We **don't** re-verify the access token's JWT signature in `databaseHooks`. better-auth validated it during the code-for-token exchange using the JWKS from discovery. If we ever start using the access token to make downstream requests, we should consider an additional `aud` check (BC Gov docs explicitly recommend it because the realm is shared).
- We **don't** introspect the access token against Keycloak's `/protocol/openid-connect/token/introspect` endpoint. Sessions are local; if a user is removed from CSS, their CYDB session remains valid for up to 8 hours (`expiresIn`).

### Logout

`/logout` calls `auth.api.signOut`. better-auth deletes the local `session` row. We also clear the `cydb_bypass` cookie defensively.

We do **not** initiate a Keycloak `end_session_endpoint` request — there's no RP-initiated logout. The user is signed out of *this app* but still has a session at the IdP. If they navigate to BC Gov SSO directly, they can re-authenticate without typing a password. This is acceptable for our threat model; it's a minor finding to circle back to.

## Path 2: Email + Password (clinician fallback)

`emailAndPassword.enabled: true` in the better-auth options. Min password length 12, scrypt hashes. No "remember me", no "forgot password" — `disableResetPassword: true` is explicit.

```
User submits the password form on /login
   ↓
?/password action
   - LoginSchema (zod) validates email + password
   - loginThrottle.check(ip, email): if locked, return 429
   - auth.api.signInEmail({ body: { email, password } })
     - on success: locks success-counter clear; emits login_succeeded; redirect
     - on failure: loginThrottle.recordFailure(); audit login_failed; return 401
   ↓
better-auth issues session cookie
```

### Login throttle

`src/lib/server/security/login-throttle.ts` implements a sliding-window throttle:
- 5 failures per (ip, email) within 15 min → 15-min lockout
- 20 failures per ip (any email) within 15 min → 15-min lockout (defends distributed credential stuffing)
- Success clears the per-(ip, email) bucket; the per-IP bucket persists (one correct password doesn't legitimise the cluster)
- All windows are sliding; failures older than 15 min are forgotten

The throttle is in-memory (a `Map<string, Bucket>`). With `replicas: 1` this is fine; if we ever scale out, this becomes per-pod and the threshold effectively doubles per pod. Either move to Redis or accept the looser bound.

### Who has email+password accounts?

In practice: clinicians, plus the bootstrap admin. SSO users have a `user` row but no `account` row for the `credential` provider; trying to sign them in via password just returns `Invalid credentials`.

### The admin bootstrap

`scripts/seed-admin.mjs` runs on pod start (after migrations). It checks `SELECT count(*) FROM user`. If zero, it calls `auth.api.signUpEmail({ email: ADMIN_BOOTSTRAP_EMAIL, password: ADMIN_BOOTSTRAP_PASSWORD })` and inserts `admin` into `user_roles` for that user.

The env vars are read from the Secret; once one user exists, the script is a no-op. So even if the env vars are accidentally left set on later deploys, the original admin isn't overwritten.

Rotate the bootstrap password immediately after the first sign-in. There is no UI for this; use `auth.api.changePassword` or sign in and overwrite the password row directly with a fresh hash from `auth.api.signUpEmail` on a throwaway account.

## Path 3: DEV_AUTH_BYPASS shim

Local development can't reach BC Gov SSO (the IdP is internal to BC Gov, and registering local redirect URIs is more friction than it's worth). The dev bypass shim makes it ergonomic to sign in as any persona without standing up a mock IdP.

### Configuration

Set `DEV_AUTH_BYPASS` in `.env`:

```
DEV_AUTH_BYPASS=admin@test:admin,worker@test:cfd_worker,clinician@test:clinician,super@test:admin+cfd_worker
```

Format: comma-separated `email:role[+role...]` pairs. The shim **refuses to operate when `NODE_ENV=production`** — that's checked in two places (`handlePopulateRoles` in `hooks.server.ts` and the `devLogin` action) so it's hard to accidentally enable in prod.

### How it activates

`handlePopulateRoles` in `hooks.server.ts`:
- If `event.locals.user` is already set (from better-auth), do nothing.
- Otherwise, look for `?bypass=<email>` in the URL OR a `cydb_bypass` cookie.
- Call `applyBypass(db, cfg, requestedEmail)` which:
  - Picks the matching persona (or the first one if no specific email was requested)
  - Inserts the user into `user` if not present
  - Inserts any missing role rows into `user_roles`
  - Returns the populated user + role set
- Sets `event.locals.user` and `event.locals.roles`
- Sets `cydb_bypass` cookie so subsequent requests don't need the query string
- Emits an `auth_bypass_applied` audit event

### The dev login UI

When `DEV_AUTH_BYPASS` is configured and `NODE_ENV !== 'production'`, the `/login` page renders a "Dev impersonation" panel listing each configured persona as a button. Clicking a button posts to `?/devLogin` which:
1. Signs out any prior better-auth session
2. Sets `cydb_bypass=<email>`
3. Calls `applyBypass` to pre-seed (so the redirect target sees the new identity immediately)
4. Redirects to the role-matched landing page

There's also a "Switch persona" link in the layout header when the active session came from the bypass cookie. It goes to `/login?switch=1` (the `switch=1` query bypasses the "already signed in, redirect away" guard in `/login`'s load function).

### Why bother with all this?

The Playwright suite depends on `?bypass=email` to authenticate as different roles. Without the bypass shim, the entire E2E test suite would need a mock OIDC provider — non-trivial to maintain. The UI on top of the shim is purely for local-dev ergonomics.

## CSRF

Two layers of CSRF defence in this codebase.

### SvelteKit's built-in (the foundation)

SvelteKit checks the `Origin` header on every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`). If `Origin` doesn't match the configured origin, the request is rejected with 403. This is the default; you'd have to explicitly disable it in `svelte.config.js` to break it.

`svelte.config.js` in this repo does **not** override `csrf.checkOrigin`, so it stays on.

This protects every POST endpoint including login, logout, the SSO action, and the dev bypass action.

### Custom CSRF token (the belt-and-braces)

For `/admin/*` actions we additionally enforce a per-form CSRF token. The token (`cydb_csrf` cookie value) is set by `handlePhase1` on every response. Forms render it as a hidden input:

```svelte
<input type="hidden" name="csrf" value={data.csrfToken} />
```

Server-side, every admin action checks the echoed value against the cookie:

```ts
function csrfOk(formCsrf: FormDataEntryValue | null, cookieCsrf: string | undefined): boolean {
  return Boolean(cookieCsrf && formCsrf && formCsrf === cookieCsrf);
}

seed: async ({ request, cookies, ... }) => {
  requireRole(...);
  const form = await request.formData();
  if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
    return fail(403, { action: 'seed', error: 'CSRF token mismatch' });
  }
  ...
}
```

This is duplicated across all four admin route files. A future refactor could factor it into `$lib/server/security/csrf.ts`; today the duplication is fine.

The token uses a plain `===` comparison rather than a constant-time check. The realistic timing-attack against a 32-character nanoid token over HTTP is implausible (network jitter dominates), but a `crypto.timingSafeEqual` swap is a one-line hardening if you're touching the area.

### Why two layers?

SvelteKit's check covers the case where a malicious cross-origin site tries to submit a form via JavaScript. The custom token additionally protects against:
- A misconfigured deployment where the Origin check is accidentally disabled.
- Subtle bugs in `Origin` header parsing in proxies / sidecars (none today, but defence in depth is cheap).

You don't need to add the custom token to NEW state-changing routes outside `/admin/*` — SvelteKit's built-in is sufficient. The admin-only extra is a deliberate hardening.

## Adding a new role-gated route

If you add a route under an existing role-gated prefix (`/admin/foo`, `/submissions/bar`), the route guard already applies — no extra wiring needed in `hooks.server.ts`. But in the action handlers themselves, **also call `requireRole`** for defence in depth:

```ts
import { requireRole } from '$lib/server/roles';

export const actions: Actions = {
  myNewAction: async ({ request, locals, cookies }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    if (!csrfOk(...)) return fail(403, ...);
    // ...
  }
};
```

If you add a NEW top-level prefix:
1. Add it to `ROUTE_RULES` in `hooks.server.ts`.
2. Decide which roles can reach it.
3. Add an E2E spec in `tests/e2e/role-denial.spec.ts` (or similar) covering the unauthorized case.

## Adding a new role

Don't, lightly. The `ROLES` tuple is used in:
- TypeScript: `Role` union, `ROLE_SET` in `sso-roles.ts`.
- SQL: `CHECK` constraint on `user_roles.role`.
- `ROUTE_RULES` in `hooks.server.ts`.
- `canAccessAttachmentByStatus` in `security/attachment-scope.ts`.
- `landingFor` in `/login/+page.server.ts`.
- The dev bypass shim parser.
- BC Gov SSO CSS-app mappings (out of our control).

If you do need to, change them all and add tests for the matrix.
