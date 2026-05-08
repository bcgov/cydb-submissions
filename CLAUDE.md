## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, drizzle, better-auth, mcp

## Auth & roles (Phase 2)

- All staff sign in via `better-auth` email+password at `/login`. Sessions are 8 hours, sliding refresh hourly.
- Roles (`admin | cfd_worker | clinician`) live in the `user_roles` table; one user may hold multiple roles.
- Routes are gated by `handleRoleGuard` in `src/hooks.server.ts` against `ROUTE_RULES`.
- `DEV_AUTH_BYPASS=email:role[+role][,…]` short-circuits the password step in dev/CI; the shim refuses to operate when `NODE_ENV=production`. The shim creates a `cydb_bypass` cookie scoped to a single pod — multi-pod scaling needs a rethink (already documented in README).
- OIDC (BC Gov SSO) is **deferred** — when added, it slots into `src/lib/server/auth.ts` as a `genericOAuth` plugin. JIT role provisioning will need to be designed at that point.
- The `submissions.submitter_surname` column is **reserved** for a future BCeID/BC Services Card identity capture on the public-form submitter side; Phase 2 displays it when present, never populates it.
- All audit events go to stdout via pino with the strict allow-list in `src/lib/server/auth-types.ts` (`AUDIT_EVENTS`). Use `auditLog(event, payload, logger)` — passing an unknown event throws.

## Test conventions

- Unit / integration: `./node_modules/.bin/vitest run` (covers both `client` and `server` projects).
- E2E: `npm run test:e2e`. The `globalSetup` (`tests/e2e/global-setup.ts`) wipes `local.db` and the attachments dir, then runs `scripts/migrate.mjs`. Spec files seed their own data with **unique submission UUIDs** (no per-spec resets) so they can run in any order without colliding.
- E2E webserver injects `DEV_AUTH_BYPASS=admin@test:admin,worker@test:cfd_worker,clinic@test:clinician` so tests pick a role via `?bypass=…`.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
