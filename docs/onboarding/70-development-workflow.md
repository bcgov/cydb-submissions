# 70 · Development workflow

This file is your day-to-day cycle: clone, set up, develop with TDD, commit, ship. The patterns here mirror what's already in the git history.

## Prerequisites

You need:
- Node.js ≥ 22 (see `.nvmrc` if present, or `package.json` `engines`)
- npm ≥ 10
- git
- A POSIX-y shell (the project does shell out occasionally in scripts)
- `sqlite3` CLI (for poking at the DB; optional but useful)
- `pandoc` (only if you'll regenerate the .docx versions of audit docs; optional)

Editor recommendation: VS Code with the official Svelte extension and the Tailwind CSS IntelliSense extension. Other editors work; you'll lose Svelte template diagnostics and tailwind auto-complete.

## First-time setup

```bash
git clone <repo-url>
cd cydb-submissions
npm install
cp .env.example .env
```

Edit `.env`. The minimum you need to make `npm run dev` work:

```bash
# 32+ chars of random
BETTER_AUTH_SECRET="put-something-random-here-at-least-32-chars-long"

# Local impersonation — pick whoever you want to be by default
DEV_AUTH_BYPASS=admin@test:admin,worker@test:cfd_worker,clinician@test:clinician
```

Then apply migrations:

```bash
node scripts/migrate.mjs
```

This creates `local.db` with all the tables. Re-running it is idempotent.

Start the dev server:

```bash
npm run dev
```

It runs on `http://localhost:5173` (or 5174 if 5173 is taken). With `DEV_AUTH_BYPASS` set, you're auto-signed in as the first persona (`admin@test`). Visit `/admin`, click around, confirm pages render.

## The dev loop

Hot reload covers most things:
- Edit a `.svelte` file → page rerenders in-place
- Edit a `+page.server.ts` → load function re-runs on next nav
- Edit `hooks.server.ts` → Vite restarts the server (you'll lose worker state briefly)
- Edit a `tests/unit/*.test.ts` → if `npm run test:unit` is running, it re-runs the file

What requires a manual restart:
- Adding a new env var to `.env`
- Changing migrations (you need to `rm local.db && node scripts/migrate.mjs`)
- Anything in `src/lib/server/db/index.ts` (DB connection init)

## Test-driven workflow

The project's commit history is mostly **one task = one branch = one commit pair (test + fix) = one PR**. Every shipped feature was preceded by a failing test. You should keep this.

The cadence for a new feature:

```
1. Pick the smallest valuable behaviour change.
2. Write a failing test that asserts the new behaviour.
3. Run the test → confirm it FAILS (red).
4. Write the smallest code that makes it pass.
5. Run the test → confirm it PASSES (green).
6. Run the FULL suite → confirm nothing else broke.
7. Commit.
8. Repeat until the feature is done.
9. PR.
```

The commit message style we use is conventional commits with a scope:

```
feat(auth): add dev impersonation panel for local testing
fix(security): close hardening Must+Should findings (Part 4)
test(hardening): failing tests for Must+Should items (Part 3)
docs(onboarding): write 30-architecture
chore(deploy): gitignore per-env ConfigMaps + document the pattern
```

The body should explain *why*, not what — the diff already shows the what.

For example, here's a commit shaped like what we ship:

```
feat(auth): integrate BC Gov SSO (Keycloak OIDC) with JIT role sync

Adds the genericOAuth({ keycloak }) plugin from better-auth, plus a
sso-roles module that decodes the access token and upserts local
roles from the BC Gov SSO `client_roles` claim (with a defensive
fallback to standard `resource_access.<client>.roles`).

`SSO_ISSUER_URL`/`SSO_CLIENT_ID`/`SSO_CLIENT_SECRET` map directly to
the `SSO/CYDB Submissions-installation-*.json` files issued by the
BC Gov SSO team — same realm `standard` across dev/test/prod, only
the loginproxy host varies. ...
```

Subject ≤ 70 chars. Body wrapped at ~75. No emoji. No "Co-Authored-By" line unless you're pairing with another human.

## Running tests

```bash
# Just the unit suite, once
./node_modules/.bin/vitest run

# Watch mode (rerun on file change)
npm run test:unit

# A single file (or pattern)
./node_modules/.bin/vitest run tests/unit/security-*.test.ts
./node_modules/.bin/vitest run tests/unit/auth-bypass.test.ts

# A single test by name
./node_modules/.bin/vitest run -t "rejects suffix-spoof"

# E2E suite (slower — builds + boots the app on port 4173)
npm run test:e2e

# Everything (unit then e2e)
npm test
```

A few notes:

- **Use `./node_modules/.bin/vitest` not `npx vitest`.** `npx vitest` will sometimes pull in a different version. The local binary is what `package.json` pinned.
- **Vitest is multi-project**. Look at `vitest.config.ts` (or `vite.config.ts` if config is inlined) to see the projects. Server tests run in Node. The component test (`StatusBadge.svelte.test.ts`) runs in a browser context via `@vitest/browser-playwright`.
- **Playwright needs browsers**. The first `npm run test:e2e` invokes `playwright install` to fetch Chromium. Plan for a few minutes.

### Watching only what you care about

When you're working on a single area, run a watch on just that file:

```bash
./node_modules/.bin/vitest tests/unit/security-url-safety.test.ts
```

Vitest re-runs that file every time you save. Once you've widened the test scope (the fix you're making touches multiple modules), expand the pattern.

## Search (Manticore) in local dev

The submissions search feature is backed by [Manticore Search](https://manticoresearch.com). It is **mission-critical**: the app's `/readyz` health endpoint returns 503 when `MANTICORE_URL` is unreachable, so for most day-to-day dev work you want Manticore running alongside the app.

### Starting Manticore

A compose file is committed at the repo root:

```bash
podman compose -f compose.search.yaml up -d
# or
docker compose -f compose.search.yaml up -d
```

This exposes Manticore on `localhost:9308` (HTTP) and `localhost:9306` (MySQL binary). Add to `.env` (it's also in `.env.example`):

```bash
MANTICORE_URL=http://localhost:9308
```

On app start, `ensureIndex` auto-creates the `submissions_idx` index if it doesn't exist. The reconciler (`SEARCH_RECONCILE_INTERVAL_MS`, default 2000 ms) indexes any seeded or submitted rows within a couple of seconds — you don't need to do anything manually.

Module layout: `src/lib/server/search/` (client, indexer, query, reconciler, …). Architecture detail is in `30-architecture.md`; deployment config is in `80-deployment.md`.

### Search tests

**Unit tests** (`tests/unit/search-*.test.ts`) use an `InMemorySearchClient` stub and a `vi`-mocked `fetch` for the HTTP client. They always run — no live Manticore needed:

```bash
./node_modules/.bin/vitest --project server --run
```

**Integration test** (`tests/unit/search-manticore-integration.test.ts`) and **E2E spec** (`tests/e2e/submissions-search.spec.ts`) are env-gated: they skip automatically unless `MANTICORE_URL` is set and a real Manticore instance is reachable. They validate the actual wire format (the JSON `/search` DSL, fuzzy option, highlight, `/sql` DDL/DML). Run them with:

```bash
podman compose -f compose.search.yaml up -d
MANTICORE_URL=http://localhost:9308 ./node_modules/.bin/vitest --project server --run search-manticore-integration
```

The integration test is the authoritative check that `ManticoreClient` request shapes are accepted by the real engine. Run it after any change to `src/lib/server/search/manticore.ts`.

### Query syntax

In the UI search box on `/submissions` you can try:

| Syntax | What it does |
|---|---|
| `aut*` | Prefix wildcard |
| `"speech delay"` | Exact phrase |
| `@ocr_text vineland` | Field-scoped search |
| `"speech delay" NEAR/3` | Proximity |
| `"adhd anxiety seizures"/2` | Quorum (2-of-3 match) |
| `diagnosis -provisional` | Exclusion |
| `running` | Lemma (matches run, ran, …) |

Typos are tolerated automatically via Manticore's built-in fuzzy matching.

## Type checking + lint

```bash
# TypeScript + Svelte strict check across src/
./node_modules/.bin/svelte-check --no-tsconfig --workspace .

# eslint + prettier (read-only check)
npm run lint

# Auto-format on save (recommended); or one-shot:
npm run format
```

`svelte-check` will currently report 11 errors in `archive/public-form/`. Those are pre-existing and not your concern unless you're explicitly reviving the archived form. Everything outside `archive/` should be clean.

ESLint is configured for both `.ts` and `.svelte` files. Prettier handles formatting; tailwindcss plugin keeps class lists tidy. If you turn on format-on-save in your editor, you won't have to think about it.

### What if `svelte-check` reports new errors?

You probably introduced a TypeScript regression. Don't push past it. Even if the tests still pass, type errors mean the next dev (or future you) will see them in red.

## Debugging

### Tailing logs

The dev server writes JSON-per-line via pino. Pipe it through a pretty-printer:

```bash
npm run dev | npx pino-pretty
```

Or just read the raw JSON; it's structured. Each line has `level`, `time`, `requestId`, `route`, `event`, and an `msg` text.

### Inspecting the local DB

```bash
sqlite3 local.db
.tables
.schema submissions
SELECT id, submission_uuid, status FROM submissions ORDER BY id DESC LIMIT 10;
SELECT key, value FROM system_state;
```

To wipe and restart from scratch:

```bash
rm local.db local.db-shm local.db-wal
node scripts/migrate.mjs
```

### Inspecting the local attachments PVC

```bash
ls -la ./attachments/
ls -la ./attachments/sub_*/
```

### Stepping through code

VS Code: hit F5 with a `launch.json` that runs `node --inspect-brk node_modules/vite/bin/vite.js dev`. Set breakpoints in `+page.server.ts` files. Or use `console.log` — Svelte/Vite hot-reloads it instantly.

For server-side code in tests:

```bash
node --inspect-brk ./node_modules/.bin/vitest run tests/unit/foo.test.ts
```

Chrome → `chrome://inspect` to attach.

### When the OCR worker won't start

`OCR_WORKER_ENABLED` is not set, or set to something other than `'1'`. Check `.env`. After fixing, restart the dev server.

If it's set but the worker still doesn't run, hit any URL (`/`, `/admin`, etc.) — the worker boots on first request, not at module load.

### When SSO doesn't work in dev

It can't. The IdPs (`dev.loginproxy.gov.bc.ca`) only allow redirect URIs registered with the BC Gov SSO team, and `http://localhost:5173/api/auth/callback/keycloak` isn't one of them.

Use `DEV_AUTH_BYPASS` for local dev. SSO works in deployed environments (dev/test/prod clusters) only.

If you really want to test the SSO callback locally, you can register `http://localhost:5173/...` with the SSO team for the dev realm — but the round-trip on the request is long and other developers may need the same URI.

## Where tests live

```
tests/
├── unit/                 # Vitest server tests (run in Node)
│   ├── auth-bypass.test.ts
│   ├── chefs-*.test.ts
│   ├── ocr-*.test.ts
│   ├── security-*.test.ts
│   ├── sso-*.test.ts
│   ├── mail-*.test.ts
│   └── (~50 files total)
├── e2e/                  # Playwright specs (run against a built app)
│   ├── global-setup.ts
│   ├── auth-bypass-login.spec.ts
│   ├── admin-*.spec.ts
│   ├── submissions-table.spec.ts
│   └── (~11 files total)
└── fixtures/
    └── ocr/              # Canned OCR text by attachment basename
```

The component test lives next to its component: `src/lib/components/StatusBadge.svelte.test.ts`. That's the project's only component-level test today.

### Naming convention

- `<module>.test.ts` for the test of a single module
- `security-<topic>.test.ts` for the security suite (`tests/unit/security-*.test.ts` is what the `npm-audit` test in that file expects to find)
- Use `describe(...)` once per public API of the module under test
- Test names are imperative ("rejects suffix-spoof") not interrogative ("does it reject suffix-spoof")

## Common dependency patterns

This codebase leans heavily on the **dependency-injection-via-options-object** pattern. Look at any `startWorker({ db, provider, mailer, ... })` or `new ChesMailer({ baseUrl, tokenCache, fetch })` — the entire dependency set is a single options object, fully typed, with `fetch?: typeof fetch` as the test seam.

When you write new code in this style:

```ts
export interface FooOpts {
  db: DrizzleDb;
  http?: typeof fetch;
  logger: Logger;
  // ...
}

export class Foo {
  private http: typeof fetch;
  constructor(private opts: FooOpts) {
    this.http = opts.http ?? fetch;
  }
}
```

Then in tests:

```ts
const fakeFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ... }) }));
const foo = new Foo({ db, logger, http: fakeFetch as unknown as typeof fetch });
```

The `as unknown as typeof fetch` cast is necessary because Vitest's `vi.fn()` returns a `Mock<...>` whose call signature doesn't perfectly line up with `typeof fetch`'s overloads. Don't fight it.

## When you need to add a dependency

```bash
npm install --save <runtime-dep>
npm install --save-dev <dev-dep>
```

Then:
1. **Confirm the license.** This is BC Gov code; only MIT/Apache/BSD/ISC. No GPL.
2. **Check the bundle size impact.** Run `npm run build` and compare the output.
3. **Run `npm audit --omit=dev`.** If it adds a high-severity advisory, find another package.
4. **Update `package-lock.json` and commit both.**

Don't reach for a library before checking whether one of these is in the toolbox:

| If you want | Use |
|---|---|
| Date math | Native `Date` or `@internationalized/date` (already in devDeps) |
| Validation | `zod` (already in deps) |
| Classes for Tailwind | `cn()` in `$lib/utils.ts` |
| Random IDs | `nanoid` (already in deps) |
| Hashing | `node:crypto` |
| HTTP client | `fetch` |
| Logging | `pino` (already in deps) via `$lib/server/log` |
| Iconography | `@lucide/svelte` |

## CI expectation

There's no committed CI YAML today. The recommended workflow shape (you might be setting this up):

```yaml
- run: npm ci
- run: ./node_modules/.bin/svelte-check --no-tsconfig --workspace .
- run: npm run lint
- run: ./node_modules/.bin/vitest run
- run: npm run test:e2e
```

The `vitest run` step already includes the `security-npm-audit` test, so you don't need a separate `npm audit` step — the test will fail CI if a high-severity production advisory appears.

## Commit checklist

Before you commit:

1. ✅ `./node_modules/.bin/vitest run` — all green
2. ✅ `./node_modules/.bin/svelte-check --no-tsconfig --workspace .` — only pre-existing `archive/` errors
3. ✅ `npm run lint` — no errors
4. ✅ `git status` — only files you meant to change
5. ✅ Commit message follows conventional-commits format
6. ✅ If you added env vars, they're in `.env.example`, `openshift/secret.example.yaml`, the inline env in `openshift/deployment.yaml`, and all three configmaps

The configmaps are gitignored — you won't see them in `git status`. But the operator on the other side needs them updated too. There's a checklist for this in `80-deployment.md`.

## When you need to ship a hotfix

The repo's branching model is light:
- `main` is the live branch
- Feature work happens on `feature/<name>` or `<purpose>` branches
- Fast-forward merge to main; no merge commits unless conflicts force one

For a hotfix:
1. Branch off main: `git checkout -b hotfix-<thing>`
2. Write the failing test first
3. Make it pass
4. Run the full suite
5. PR with a clear "Hotfix: …" subject and a "Test plan" section in the description
6. Get review, fast-forward, deploy

The "test plan" section is important — the next person reviewing the PR (which might be your future self) needs to know what manual or automated check confirms the fix.

## Things to never do

- **Don't commit `.env`.** It's gitignored, but `git add -A` could trip you up. Always `git status` before commit.
- **Don't commit the configmaps.** `openshift/configmap-*.yaml` is gitignored. Same caveat.
- **Don't commit `local.db` or attachments.** Both gitignored.
- **Don't push directly to main without review.** Even for trivial fixes; the repo discipline matters.
- **Don't use `--no-verify` to skip hooks.** If a hook fails, it's telling you something.
- **Don't disable an eslint or svelte-check warning instead of fixing it.** The warnings exist for reasons earlier you forgot.
- **Don't bump `better-auth` or `@sveltejs/kit` minor versions casually.** Both have meaningful behaviour changes between versions. Read release notes; run the full suite; deploy to dev first.
