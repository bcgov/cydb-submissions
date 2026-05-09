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
| `OCR_PROVIDER` | `stub` (default) \| `stub-fail` \| `stub-flaky` \| `kong-ms-di`. Use a stub mode in dev/CI. |
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
| `MAIL_TRANSPORT` | `log` (default) \| `smtp`. Stay on `log` until the relay is wired. |
| `OCR_ALERT_RECIPIENTS` | Comma-separated email list for halted-queue alerts. Empty = log-only. |
| `OCR_ALERT_FROM` | Sender address for halted-queue alerts (default `cydb-noreply@gov.bc.ca`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Reserved for `MAIL_TRANSPORT=smtp` (Phase 3 ships log-only). |

### Local OCR development

`npm run dev` and the Playwright suite run with `OCR_PROVIDER=stub` so no
external service is hit. The stub returns canned text from
`tests/fixtures/ocr/<filename-stem>.txt`; drop your own `.txt` next to the
fixture filename to script specific keyword counts.

## Routes

Public:
- `/` — submission form
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
