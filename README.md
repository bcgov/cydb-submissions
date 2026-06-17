# CYDB Submissions (Phases 1 + 2)

Public-facing CYDB application form (Phase 1) plus staff submissions table & viewer
(Phase 2). Renders the Form.io schema (`src/lib/form/cydb_form_schema.json`)
as native Svelte components on shadcn-svelte, validates submissions server-side, and
persists to SQLite + a PVC-backed attachments directory. Phase 2 adds email/password
staff auth (better-auth) with three roles (admin, cfd_worker, clinician), a
sortable/filterable submissions table, a friendly per-submission read-only viewer
with attachment preview, role-gated routes, audit-style logging, and OpenShift
readiness/liveness probes.

## Local development

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET to a 32+ character secret in .env
npm install
npm run db:migrate         # apply schema to local.db
npm run dev                # http://localhost:5173
```

To skip the password step locally, set `DEV_AUTH_BYPASS=email:role[,…]` in `.env`,
then visit `/?bypass=email` — the shim creates the user + role row in the DB and
sets a `cydb_bypass` cookie. The shim is hard-disabled when `NODE_ENV=production`.

## Tests

```bash
./node_modules/.bin/vitest run                   # full unit + browser suites
./node_modules/.bin/playwright install chromium  # one-time
npm run test:e2e                                 # builds + previews + runs Playwright
```

`vitest` must be invoked via the local binary or `npm run test:unit`. `npx vitest`
pulls a different version that does not honour the `--project server` filter.

## Build / container

```bash
npm run build
podman build -t cydb-submissions:dev .
podman run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_BOOTSTRAP_EMAIL=admin@local.test \
  -e ADMIN_BOOTSTRAP_PASSWORD=ChangeThisNow12345 \
  -e ORIGIN=http://localhost:3000 \
  cydb-submissions:dev
```

The container's CMD chains `migrate → seed-admin → server`. The admin is seeded
only once (when the user table is empty) using better-auth's password hashing.

`ORIGIN` must match the URL the browser actually uses, otherwise SvelteKit
rejects form POSTs (e.g. `/login`) with a 403 cross-site error. Two patterns:

- **Local podman dev:** pass `-e ORIGIN=http://localhost:3000` explicitly.
- **Behind a TLS-terminating proxy (OpenShift Route, nginx, ALB):** leave
  `ORIGIN` unset. The Containerfile sets `PROTOCOL_HEADER=x-forwarded-proto`
  and `HOST_HEADER=x-forwarded-host` so adapter-node derives the origin from
  the proxy's forwarded headers automatically — no Secret entry needed for
  ORIGIN unless you want to pin it.

## OpenShift

`openshift/` ships templates only — not applied. See `openshift/README.md`.

## Environment

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | SQLite file path (relative paths resolve to the process CWD) |
| `ORIGIN` | Public origin used by SvelteKit's CSRF check (set to the deployed URL in production) |
| `ATTACHMENTS_DIR` | PVC mount path for uploaded files |
| `MAX_UPLOAD_BYTES` | Per-file size cap (default 25 MiB) |
| `ALLOWED_UPLOAD_MIME` | Comma-separated mime allowlist |
| `RATE_LIMIT_PER_IP` | Anonymous submissions per window per IP (default 3) |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window in milliseconds (default 900000 = 15 min) |
| `LOG_LEVEL` | pino log level (default info) |
| `BETTER_AUTH_SECRET` | **Required (Phase 2+).** 32+ characters. Auth is disabled when missing — the app boots but `/login` returns 503. |
| `DEV_AUTH_BYPASS` | Dev/CI shim. Format: `email:role[+role][,email:role…]`. Refused when `NODE_ENV=production`. |
| `ADMIN_BOOTSTRAP_EMAIL` | First-deploy admin email (only seeded when no users exist). |
| `ADMIN_BOOTSTRAP_PASSWORD` | First-deploy admin password (min 12 chars). Rotate immediately after first login. |
| `OCR_WORKER_ENABLED` | Phase 3. Set to `1` to start the in-process OCR worker. Default off. |
| `OCR_PROVIDER` | `stub` (default) \| `stub-fail` \| `stub-flaky` \| `kong-ms-di` \| `bcgov-di`. Use a stub mode in dev/CI. |
| `OCR_MAX_CONCURRENCY` | In-flight requests (1–4, default 1). |
| `OCR_MAX_ATTEMPTS` | Per-job retry budget (default 3). |
| `OCR_FAILURE_BREAKER` | Consecutive terminal failures before the queue halts (default 4). |
| `OCR_POLL_INTERVAL_MS` | Worker tick interval (default 1000). |
| `OCR_STUB_FIXTURES` | Path to fixture .txt files used by the stub provider (default `tests/fixtures/ocr`). |
| `OCR_STUB_FLAKY_FAILURES` | How many times the `stub-flaky` mode fails before it succeeds (default 1). |
| `OCR_MODEL_ID` | MS DI model id (default `prebuilt-read`). |
| `AZURE_DI_API_VERSION` | MS DI API version (default `2024-11-30`). |
| `KONG_BASE_URL` | Required when `OCR_PROVIDER=kong-ms-di`. e.g. `https://api.gov.bc.ca/document-intelligence` |
| `KONG_TOKEN_URL` | OAuth client-credentials token endpoint. |
| `KONG_CLIENT_ID` / `KONG_CLIENT_SECRET` | OAuth credentials provisioned by the BC Gov API platform team. |
| `BCGOV_DI_BASE_URL` | Required when `OCR_PROVIDER=bcgov-di`. Test backend: `https://bcgov-di-test-backend-fd34fb-test.apps.silver.devops.gov.bc.ca`. |
| `BCGOV_DI_API_KEY` | Required when `OCR_PROVIDER=bcgov-di`. Group-scoped key issued by the AI Adoption team. Never logged. |
| `BCGOV_DI_WORKFLOW_SLUG` | Workflow id on the BC Gov DI backend (default `ocr-only-minimal`). |
| `MAIL_TRANSPORT` | `log` (default) \| `ches` \| `smtp`. `ches` posts halt alerts to the BC Gov Common Hosted Email Service; `smtp` is a stub. |
| `OCR_ALERT_RECIPIENTS` | Comma-separated email list for halted-queue alerts. Empty = log-only. |
| `OCR_ALERT_FROM` | Sender address for halted-queue alerts (default `cydb-noreply@gov.bc.ca`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Reserved for `MAIL_TRANSPORT=smtp` (currently a stub — prefer `ches`). |
| `CHES_BASE_URL` | CHES web service base URL. Default `https://ches.api.gov.bc.ca/api/v1`. |
| `CHES_TOKEN_URL` | Keycloak OAuth2 token endpoint (realm-scoped). Required when `MAIL_TRANSPORT=ches`. |
| `CHES_CLIENT_ID` / `CHES_CLIENT_SECRET` | Keycloak service-account credentials. Required when `MAIL_TRANSPORT=ches`. Never logged. |
| `SSO_ISSUER_URL` | BC Gov SSO (Keycloak) issuer URL, e.g. `https://dev.loginproxy.gov.bc.ca/auth/realms/standard`. Empty = SSO disabled. |
| `SSO_CLIENT_ID` | OAuth client id from `SSO/CYDB Submissions-installation-*.json` (`resource` field). Required when `SSO_ISSUER_URL` is set. |
| `SSO_CLIENT_SECRET` | OAuth client secret (`credentials.secret`). Required when `SSO_ISSUER_URL` is set. Never logged. |
| `CHEFS_FORM_ID` | CHEFS form UUID — overrides DB config when set. |
| `CHEFS_API_TOKEN` | CHEFS API token — overrides DB config when set. Never logged. |
| `CHEFS_VERSION` | Form version (`0` = all versions for JSON export, the CHEFS default). |
| `CHEFS_BASE_URL` | CHEFS API base URL. Default `https://submit.digital.gov.bc.ca`. |
| `CHEFS_FILE_COMPONENTS` | Comma-separated file-upload component keys to download. Default `simplefile`. |
| `CHEFS_API_PARAMS` | JSON object of CHEFS export filter params (e.g. `{"status":"COMPLETED"}`). |
| `CHEFS_POLLER_ENABLED` | Set to `1` to run the in-process CHEFS poller. |
| `CHEFS_POLL_INTERVAL_MS` | Poll cadence in ms (default 60000). |
| `KEYWORD_JSON` | Keywords used for categories display. |

### Local OCR development

`npm run dev` and the Playwright suite run with `OCR_PROVIDER=stub` so no
external service is hit. The stub returns canned text from
`tests/fixtures/ocr/<filename-stem>.txt`; drop your own `.txt` next to the
fixture filename to script specific keyword counts.

### Signing in

In deployed environments (`SSO_ISSUER_URL` set), `/login` shows **Sign in with BC Gov SSO** as the primary action. Click-through redirects to the BC Gov Keycloak realm; on return the user's session is established and roles are synced from the access token's `client_roles` claim (BC Gov SSO IdP mapper) — plus the standard `resource_access.<client>.roles` claim as a defensive fallback. Roles must be created and assigned in the CSS app (per `openshift/README.md`); users without one of `admin`, `cfd_worker`, or `clinician` will land on `/` with no role-gated access.

Locally, leave `SSO_ISSUER_URL` empty and use `DEV_AUTH_BYPASS=email:role[+role]` for fast access. The bypass shim refuses to operate when `NODE_ENV=production`, so it's safe to leave set in `.env`. The clinician email/password form is still available under "Sign in with a clinician password instead" in both modes.

**Dev impersonation panel.** When `DEV_AUTH_BYPASS` is set, `/login` renders a "Dev impersonation" section listing each configured persona as a one-click button — pick the role you need to exercise and the shim signs you in. Once authenticated via bypass, the layout header shows a yellow **dev** chip next to your email plus a **Switch** link that returns to `/login` so you can hop personas without touching the URL. Example covering every role:

```
DEV_AUTH_BYPASS=admin@test:admin,worker@test:cfd_worker,clinician@test:clinician,super@test:admin+cfd_worker
```

The shim still honours the legacy `?bypass=<email>` query param (used by the Playwright suite), so adding the UI doesn't break existing E2E tests.

## CHEFS ingestion

The application can pull form submissions from BC Gov [CHEFS](https://developer.gov.bc.ca/docs/default/component/chefs-techdocs/Capabilities/Integrations/Downloading-Submission-Files/) via the export API. Configure from `/admin/chefs` (admins only) or via environment variables — env always wins so secrets can rotate without DB access.

**Workflow:**

1. Create the form in CHEFS, generate an API token, note the form UUID.
2. In `/admin/chefs`, paste form ID + token, save. Optionally tick "Enable background poller".
3. Click **Test connection** to verify auth. Click **Sync now** to pull immediately.
4. Submissions land in the regular table; attachments are downloaded to `ATTACHMENTS_DIR/{submissionUuid}/` and OCR-enqueued through the existing pipeline.

**Single-pod assumption.** The poller is per-pod, like the OCR worker. Multi-pod scaling would have every pod poll CHEFS concurrently — correctness is preserved by the `submissions.submission_uuid` unique constraint, but each extra pod multiplies API quota usage.

**In-app form is archived.** The Svelte form previously served at `/` has been moved to `archive/public-form/` (route files + form-specific E2E specs). `/` is now a staff-portal landing page. To restore the in-app form, see `archive/public-form/README.md`.

## Search (Manticore)

Search is backed by a self-hosted **Manticore** sidecar running in the same pod as the app container in OpenShift (`localhost:9308`). It is self-contained — no external search service is required.

### Local dev

Start Manticore alongside the app:

```bash
podman compose -f compose.search.yaml up -d
# or
docker compose -f compose.search.yaml up -d
```

Add to `.env`:

```
MANTICORE_URL=http://localhost:9308
```

### Index lifecycle

The index `submissions_idx` is auto-created on app start via `ensureIndex`. A background **reconciler** re-indexes any submission whose `search_indexed_at` column is null or stale, covering:

- New in-app submissions
- CHEFS ingests
- OCR completion (full-text of `ocr_text` fields becomes searchable)
- Any submission missed by a real-time push (e.g. after a pod restart)

The reconciler runs every `SEARCH_RECONCILE_INTERVAL_MS` milliseconds and processes up to `SEARCH_RECONCILE_BATCH` rows per tick, so the index self-heals without manual intervention.

### Query syntax

The search UI supports the full Manticore extended query syntax:

| Pattern | Example | Effect |
|---------|---------|--------|
| Wildcard prefix/infix | `aut*` / `*ism*` | Matches any term starting/containing the fragment |
| Phrase | `"speech delay"` | Terms must appear adjacent |
| Field scope | `@ocr_text vineland` | Restricts match to a named field |
| Proximity | `"speech delay" NEAR/3` | Terms within 3 words of each other |
| Quorum | `"adhd anxiety seizures"/2` | At least 2 of the listed terms must match |
| Exclusion | `diagnosis -provisional` | Excludes documents containing `provisional` |
| Lemmas | `running` | Matches inflected forms: run, ran, running |

Fuzzy/typo tolerance is on by default — minor misspellings are corrected automatically.

### Mission-critical behaviour

`/readyz` returns **503** when Manticore is unreachable, taking the pod out of rotation in OpenShift until connectivity is restored. Manticore must be running before the app is considered ready.

### Env vars

| Var | Purpose |
|-----|---------|
| `MANTICORE_URL` | Manticore HTTP endpoint (default `http://localhost:9308`) |
| `SEARCH_RECONCILE_INTERVAL_MS` | Reconciler tick interval in ms (default 2000) |
| `SEARCH_RECONCILE_BATCH` | Max rows re-indexed per tick (default 50) |

## Routes

Public:
- `/` — staff portal landing page (links to `/login`)
- `/login`, `/logout` — staff sign-in
- `/healthz`, `/readyz` — process / dependency probes

Role-gated (`admin` | `cfd_worker`):
- `/submissions` — sortable, paginated table
- `/submissions/[uuid]` — read-only detail view with inline PDF/image preview
- `/attachments/[id]` — streamed file (inline preview by default; `?download=1` forces attachment disposition)

Role-gated (`admin`):
- `/admin` — seed/clear database tooling
- `/admin/ocr` — OCR queue: status counts, halt banner, requeue/abandon failed jobs, resume halted queue

Role-gated (`clinician`):
- `/clinician` — Phase 2 stub; assignment workflows land in Phase 4

## Notes

- The Phase-1 rate limiter is in-process. The Phase-2 bypass shim also assumes a
  single pod (its synthesised user/role rows are persisted in the DB but the
  cookie association is per-pod). The Phase-3 worker uses row-level leasing
  (multi-pod-safe) but the consecutive-failure breaker counter is in-memory
  per pod, so multi-pod operation would let each pod trip the breaker
  independently. Multi-pod horizontal scaling needs all three rethought.
- OIDC integration (BC Gov SSO) is **deferred** to a later phase. It will slot
  into `src/lib/server/auth.ts` as a `genericOAuth` plugin alongside the existing
  `emailAndPassword` config.
- The `submissions.submitter_surname` column is **reserved** for a future
  BCeID/BC Services Card identity capture on the public-form submitter side;
  Phase 2 displays it when present, never populates it.
- Demo notice on the home page makes it clear that Phase 1 is non-production data.
