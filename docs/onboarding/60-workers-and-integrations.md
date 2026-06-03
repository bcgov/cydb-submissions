# 60 · Workers & integrations

Four in-process workers + four outbound integrations. They share a small set of patterns (single-flight, breaker, halt sentinel) you'll see repeated across modules. Once you know the patterns, each new worker is just a different domain on top.

## What's running in the same process

```
node build/                              (one OS process, replicas: 1)
│
├── HTTP server (adapter-node)           — serves /, /admin, /login, etc.
│
├── OCR worker                           — setInterval, leases ocr_jobs rows
│   (started lazily by handlePhase1 when env.OCR_WORKER_ENABLED === '1')
│
├── CHEFS poller                         — setInterval, pulls from CHEFS API
│   (started lazily when the effective config has pollerEnabled=true)
│
├── Search reconciler                    — setInterval, re-indexes dirty submissions
│   (started lazily alongside the OCR worker via maybeStartSearch)
│
└── ChesTokenCache + KongTokenCache      — OAuth2 client_credentials caches
    (no timer; lazy refresh on demand)
```

`setInterval`-based workers + a single shared SQLite connection + in-process state (lease loop dedup, breaker counters) are all the reasons this app stays at `replicas: 1`. Read `30-architecture.md` for the rationale.

## The shared patterns

### Single-flight

Deduplicate concurrent requests for the same expensive thing:

```ts
let inflight: Promise<T> | null = null;
async function get() {
  if (cachedAndFresh()) return cached;
  if (inflight) return inflight;
  inflight = doExpensiveThing().finally(() => { inflight = null; });
  return inflight;
}
```

Used by:
- `ChesTokenCache.token()` and `KongTokenCache.token()` — OAuth2 token refresh
- (implicitly) the OCR lease loop, by virtue of `setInterval` not overlapping its own ticks if you await within the callback

Don't reach for promise libraries here — this is the whole pattern.

### Halt sentinel

Persistent halt state lives in the `system_state` table. Workers check before each tick:

```ts
if (getSystemState(db, 'ocr.halted')) return;  // skip this tick
```

Setting the halt:

```ts
setSystemState(db, 'ocr.halted', {
  trippedAt: new Date().toISOString(),
  threshold: opts.breakerThreshold,
  lastErrorClass: err.name
});
```

Clearing the halt (admin-only action):

```ts
clearSystemState(db, 'ocr.halted');
clearSystemState(db, 'ocr.failureCount');
```

Halt sentinels survive process restarts. A pod that restarts while halted comes back halted; that's deliberate. Only an admin pushing the Resume button in `/admin/queues` (or `/admin/ocr` / `/admin/chefs`) clears the state.

### Consecutive-failure breaker

Live counter (also in `system_state`):

```ts
// On each terminal failure:
const next = (getSystemState<number>(db, 'ocr.failureCount') ?? 0) + 1;
setSystemState(db, 'ocr.failureCount', next);
if (next >= opts.breakerThreshold) {
  setSystemState(db, 'ocr.halted', { ... });
  await opts.mailer.send({ ... });   // halt alert
}

// On any success:
setSystemState(db, 'ocr.failureCount', 0);
```

Threshold is configurable (`OCR_FAILURE_BREAKER`, default 4 for OCR; CHEFS uses the same idea). The breaker counts *terminal* failures (the job has exhausted its retries), not per-attempt failures.

### Lease loop

For workers that own a database queue:

```ts
async function tick() {
  if (halted()) return;
  const job = await acquireLease(db, now);   // UPDATE ... WHERE status='queued' RETURNING; transaction
  if (!job) return;                          // nothing to do
  try {
    await processJob(job, ...);
    recordSuccess(db, job.id);
  } catch (e) {
    recordFailure(db, job.id, e);            // increments attempts, sets next_attempt_at
    maybeTripBreaker(db, e);
  }
}
setInterval(tick, opts.pollIntervalMs);
```

`acquireLease` is the atomic bit. In `src/lib/server/ocr/lease.ts` it's a transaction that:
1. SELECTs the oldest `status='queued'` row where `next_attempt_at <= CURRENT_TIMESTAMP`.
2. UPDATEs it to `status='processing'`, `leased_at=now`, `leased_by=<worker id>`.
3. Returns the row (or `undefined` if none matched).

The transaction means a second hypothetical worker can't lease the same row. With `replicas: 1`, this is overkill — but it's a free guarantee from SQLite's transaction model, and it'd survive any future migration to multi-pod.

## The OCR worker

### Files
- `src/lib/server/ocr/worker.ts` — `startWorker()` returns a `WorkerHandle { stop() }`
- `src/lib/server/ocr/lease.ts` — `acquireLease`, `recordSuccess`, `recordFailure`
- `src/lib/server/ocr/process-job.ts` — the actual OCR call + status transitions + keyword evaluation
- `src/lib/server/ocr/breaker.ts` — counter + trip logic
- `src/lib/server/ocr/select-provider.ts` — env → provider instance
- `src/lib/server/ocr/types.ts` — `OcrProvider`, `OcrResult` interfaces

### What it does each tick

```
1. Check 'ocr.halted' sentinel → skip if set
2. acquireLease() → get one queued job
3. processJob(job):
   a. Read the attachment file from disk
   b. Call the configured OCR provider (stub | bcgov-di | kong-ms-di)
   c. Insert ocr_results row
   d. Run keyword evaluator over the text → upsert keyword_hits
   e. Update submissions.status: 'OCR queued' → 'OCR processed'
   f. recordSuccess() → ocr_jobs.status = 'succeeded'
   g. onIndexed hook → indexSubmission(db, searchClient, id)
      (best-effort real-time push to Manticore; see below)
4. On exception:
   a. recordFailure() → increment attempts, set next_attempt_at with back-off
   b. If attempts >= OCR_MAX_ATTEMPTS:
      - ocr_jobs.status = 'failed'
      - submissions.status = 'OCR Error'
      - increment failure counter; trip breaker if at threshold
```

### Real-time search push on OCR completion

After the OCR transaction commits (so `ocr_results` is visible in SQLite), `processJob` fires an `onIndexed` hook wired in `src/hooks.server.ts`:

```ts
onIndexed: (id) => indexSubmission(db, getSearchClient(), id)
```

This pushes the submission immediately to the Manticore sidecar so its OCR text is searchable without waiting for the next reconciler tick. The push is **best-effort**: a Manticore failure is caught, logged, and never rethrown — OCR processing is unaffected. Because `search_indexed_at` stays `NULL` on failure, the reconciler heals it on its next pass.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OCR_WORKER_ENABLED` | unset | Set to `'1'` to start the worker |
| `OCR_PROVIDER` | `stub` | One of `stub`, `stub-fail`, `stub-flaky`, `bcgov-di`, `kong-ms-di` |
| `OCR_MAX_CONCURRENCY` | `1` | In-flight jobs (capped at 4) |
| `OCR_MAX_ATTEMPTS` | `3` | Per-job retry budget |
| `OCR_FAILURE_BREAKER` | `4` | Terminal failures before halting |
| `OCR_POLL_INTERVAL_MS` | `1000` | Tick interval |
| `OCR_MODEL_ID` | `prebuilt-read` | Azure DI model id (passed through to providers) |
| `AZURE_DI_API_VERSION` | `2024-11-30` | Only used by `kong-ms-di` |
| `OCR_ALERT_FROM` | `cydb-noreply@gov.bc.ca` | From-address for halt alerts |
| `OCR_ALERT_RECIPIENTS` | empty | Comma-separated; empty = log-only (no mail attempt) |

Provider-specific env vars are documented in each provider section below.

### The three providers

#### `stub` (and `stub-fail`, `stub-flaky`)

In `src/lib/server/ocr/provider-stub.ts`. Reads canned text from `tests/fixtures/ocr/<basename>.txt` matching the attachment's basename. Returns the contents as the OCR result.

- `stub` — always succeeds (returns the fixture file content, or an empty string if the file doesn't exist)
- `stub-fail` — always throws
- `stub-flaky` — fails N times (`OCR_STUB_FLAKY_FAILURES`, default 1) then succeeds

This is what powers the Playwright OCR happy-path test and local-dev OCR.

#### `bcgov-di` (production)

In `src/lib/server/ocr/provider-bcgov-di.ts`. The BC Gov AI Adoption team hosts a "Document Intelligence backend" — a REST service that fronts Azure DI with a simplified workflow API.

Flow (three HTTP calls):
1. `POST {baseUrl}/api/upload` with the file as multipart, `workflow_slug` parameter. Returns `{ document_id }`.
2. Poll `GET {baseUrl}/api/documents/<id>` until `status === 'completed'`. Header: `x-api-key: <BCGOV_DI_API_KEY>`.
3. `GET {baseUrl}/api/documents/<id>/ocr` to fetch the extracted text.

Env vars:
- `BCGOV_DI_BASE_URL` — backend URL (test: `https://bcgov-di-test-backend-fd34fb-test.apps.silver.devops.gov.bc.ca`; prod URL TBD when issued)
- `BCGOV_DI_API_KEY` — group-scoped key from the AI Adoption team; secret
- `BCGOV_DI_WORKFLOW_SLUG` — `ocr-only-minimal` by default; check with the team if you need others

The `x-api-key` header is added to the pino redactor's allowlist so it never leaks into logs.

#### `kong-ms-di` (fallback)

In `src/lib/server/ocr/provider-kong-msdi.ts`. Uses the BC Gov Kong API gateway → Azure Document Intelligence directly. OAuth2 client_credentials for auth (`KongTokenCache` in `src/lib/server/ocr/kong-token.ts`).

Flow (two HTTP calls):
1. `POST {KONG_BASE_URL}/formrecognizer/documentModels/<modelId>:analyze` with the file bytes. Returns 202 + `operation-location` header.
2. Poll the `operation-location` URL until `status === 'succeeded'`. Pulls the result from the response body.

Env vars:
- `KONG_BASE_URL` — e.g. `https://api.gov.bc.ca/document-intelligence`
- `KONG_TOKEN_URL` — OAuth2 token endpoint
- `KONG_CLIENT_ID` / `KONG_CLIENT_SECRET` — secret
- `OCR_MODEL_ID` — `prebuilt-read`
- `AZURE_DI_API_VERSION` — passed as query param

Use this provider when AI Adoption hasn't provisioned a workflow for your environment, or for fallback testing.

### Halt-alert mailer

When the breaker trips, the worker calls `opts.mailer.send({ to: opts.alertRecipients, ... })`. Plain-text body, generic subject ("OCR queue halted"). The mailer is whichever instance `selectMailer(env, logger)` returned at worker start (see CHES section below).

If `OCR_ALERT_RECIPIENTS` is empty, the mail call is skipped entirely — the halt is still logged, but no message is sent. This lets you test the halt path in local dev without spamming a real inbox.

## The CHEFS poller

### Files
- `src/lib/server/chefs/poller.ts` — `startPoller()` returns a `PollerHandle`
- `src/lib/server/chefs/config.ts` — `getEffectiveConfig` resolves env > DB
- `src/lib/server/chefs/client.ts` — `listSubmissions`, `downloadFile` against CHEFS export API
- `src/lib/server/chefs/sync.ts` — `runOneSync` (admin-triggered one-shot)
- `src/lib/server/chefs/ingest.ts` — per-submission write logic
- `src/lib/server/chefs/mapper.ts` — CHEFS JSON → submissions row shape

### What it does

CHEFS (Common Hosted Forms Service) is BC Gov's form-hosting platform. Our public form is hosted there. CHEFS exposes an export API (`GET /forms/{formId}/submissions`) that returns recently-submitted forms in JSON. The poller pulls this, downloads any file references, and writes everything into our database.

Each tick:
1. Check `chefs.halted`. Skip if set.
2. Resolve effective config: env vars override DB-stored config row-by-row (see `getEffectiveConfig`).
3. `listSubmissions(cfg)` → array of new submission IDs.
4. For each new submission:
   - Fetch the submission JSON.
   - `mapCHEFSToSubmission(json)` → our typed shape.
   - `downloadAndPersist(refs)` → write each file to disk under `attachments/<uuid>/`.
   - `writeValidSubmission(db, ...)` → insert `submissions` + `submission_attachments` + `submission_metadata`.
   - `enqueueAttachmentForOcr(db, ...)` for each attachment.
   - Emit `chefs_submission_ingested` audit event.
5. Update `system_state.chefs.lastSync` with a summary.
6. On consecutive failures, halt and alert.

### Configuration

CHEFS config is stored in **two places**: the `system_state` row (`chefs.config`) and environment variables. **Env vars win at read time** (`getEffectiveConfig` resolves field-by-field). This means:

- Operators can rotate the CHEFS API token by changing the Secret without touching the DB.
- Admins can save changes via `/admin/chefs` without touching env.
- The two diverging shouldn't surprise you — the admin UI shows which fields are env-overridden.

Env vars:

| Env var | Purpose |
|---|---|
| `CHEFS_FORM_ID` | UUID of the form on CHEFS |
| `CHEFS_API_TOKEN` | Bearer token for the CHEFS API; secret |
| `CHEFS_VERSION` | `0` for "all versions" (CHEFS default) |
| `CHEFS_BASE_URL` | Default `https://submit.digital.gov.bc.ca`; validated by `isAllowedChefsBaseUrl` on admin save |
| `CHEFS_FILE_COMPONENTS` | Comma-separated form-component keys that hold file uploads (default `simplefile`) |
| `CHEFS_API_PARAMS` | JSON object of extra export filter params (e.g. `{"status":"COMPLETED"}`) |
| `CHEFS_POLLER_ENABLED` | `1` to start the poller |
| `CHEFS_POLL_INTERVAL_MS` | Poll cadence in ms (default 60000) |
| `CHEFS_INGEST_ONLY` | (Legacy) when `1`, blocks the public form route — kept only for the dormant archive code path |

### baseUrl SSRF allowlist

`/admin/chefs ?/save` validates the baseUrl with `isAllowedChefsBaseUrl(...)` before writing it to the DB. Allowed:
- `https://` only (no HTTP)
- Hostname must be `gov.bc.ca` or a `*.gov.bc.ca` subdomain
- Rejected: RFC1918 ranges, loopback, link-local, AWS metadata IP, `kubernetes.default[.svc]`, suffix-spoofs

This means an admin can't accidentally (or maliciously) point the poller at an internal service. The OCR provider URLs and CHES URLs are env-set only, so they bypass this check — they're trusted at deploy time.

### Admin actions

`/admin/chefs` exposes:
- `save` — write a new config to `system_state.chefs.config`
- `rotateToken` — rotate the stored API token (the admin pastes a fresh one)
- `test` — `listSubmissions(cfg)` once to verify connectivity
- `syncNow` — `runOneSync(...)` (synchronous, in the request thread; used for spot-checking)
- `resume` — clear `chefs.halted` and `chefs.failureCount`

`/admin/queues` has the same `chefsSyncNow` and `chefsResume` actions exposed alongside the OCR equivalents, in a unified UI.

## The search reconciler

### Files
- `src/lib/server/search/reconciler.ts` — `startReconciler()` returns a `ReconcilerHandle { stop() }`
- `src/lib/server/search/indexer.ts` — `indexSubmission(db, client, id)` — single-row push to Manticore
- `src/lib/server/search/instance.ts` — `getSearchClient()` — shared Manticore client
- `src/lib/server/search/manticore.ts` — HTTP transport to the Manticore sidecar (`localhost:9308`)

### What it does each tick

The reconciler follows the same `setInterval + busy guard` pattern as the OCR worker. Each tick:

```
1. If a tick is already in progress (busy flag set), skip.
2. Query SQLite for up to SEARCH_RECONCILE_BATCH submissions where:
     submissions.search_indexed_at IS NULL
     OR search_indexed_at < updated_at        ← row was updated after last index
3. For each dirty row, call indexSubmission(db, client, id).
4. On Manticore failure: log and continue — SQLite is never affected.
```

A row is "dirty" if it has never been indexed (`search_indexed_at IS NULL`) or if SQLite was updated after the last index push. This catches every write path: public-form submissions, CHEFS ingests, admin status changes, and any real-time push that silently failed.

The reconciler is also the mechanism that **builds a cold or empty index from scratch** — on first deploy, every existing submission has `search_indexed_at IS NULL` and will be indexed in batches at startup.

### Boot and shutdown wiring

`src/hooks.server.ts` boots the reconciler via `maybeStartSearch`:

```
maybeStartSearch():
  1. ensureIndex()          — idempotent CREATE TABLE IF NOT EXISTS submissions_idx
  2. startReconciler(...)   — starts the setInterval loop
```

`maybeStartSearch` is called alongside `maybeStartOcrWorker`; both are gated on the first HTTP request. The reconciler handle is stopped on SIGINT/SIGTERM alongside the OCR worker and CHEFS poller (same `.stop()` / `await` pattern in the shutdown handler).

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SEARCH_RECONCILE_INTERVAL_MS` | `2000` | Tick cadence |
| `SEARCH_RECONCILE_BATCH` | `50` | Max rows indexed per tick |

The Manticore sidecar address (`localhost:9308`) is currently compiled in. See `80-deployment.md` for sidecar provisioning and `30-architecture.md` for the full-text index design.

### Failure behaviour

Manticore failures are logged and swallowed — they never affect SQLite or OCR processing, and they never trip a breaker. The `search_indexed_at` timestamp not advancing is the self-healing signal: the reconciler retries the row on the next tick. If the sidecar is down for an extended period, the reconciler backlog drains automatically once it recovers.

## The CHES mailer

CHES (Common Hosted Email Service) is BC Gov's REST API wrapping `nodemailer`, behind Keycloak OAuth2 for auth. We use it to send halt alerts.

### Files
- `src/lib/server/mail/ches-token.ts` — `ChesTokenCache` (OAuth2 client_credentials with skew)
- `src/lib/server/mail/mailer-ches.ts` — `ChesMailer` (POST `{baseUrl}/email`)
- `src/lib/server/mail/select-mailer.ts` — `selectMailer(env, logger)` → `Mailer`
- `src/lib/server/mail/mailer-log.ts` — fallback that writes the message to pino (no send)
- `src/lib/server/mail/mailer-smtp.ts` — stub; throws on send

### Token flow

`ChesTokenCache.token()`:
1. If cached and not within `skewSeconds` (default 30) of expiry, return cached value.
2. If a refresh is in-flight, await the same promise.
3. Otherwise, POST `client_credentials` to `CHES_TOKEN_URL`, parse `{ access_token, expires_in }`, cache, return.

The form is URL-encoded:
```
grant_type=client_credentials&client_id=<CHES_CLIENT_ID>&client_secret=<CHES_CLIENT_SECRET>
```

### Send flow

`ChesMailer.send(msg)`:
1. `token = await tokenCache.token()`
2. `POST ${baseUrl}/email` with `Authorization: Bearer ${token}`, content-type JSON, body:
```json
{
  "from": "cydb-noreply@gov.bc.ca",
  "to": ["ops@gov.bc.ca"],
  "subject": "OCR queue halted",
  "bodyType": "text",
  "body": "..."
}
```
3. Non-2xx → throw with the response body included (truncated to 200 chars).

`bodyType: 'text'` is deliberate. CHES docs warn that HTML triggers BC Gov-internal spam filters; plain text bypasses them.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MAIL_TRANSPORT` | `log` | `log` (no send), `ches`, or `smtp` (stub) |
| `CHES_BASE_URL` | `https://ches.api.gov.bc.ca/api/v1` | The REST endpoint |
| `CHES_TOKEN_URL` | unset | Keycloak token endpoint (typically `https://loginproxy.gov.bc.ca/auth/realms/comsvcauth/protocol/openid-connect/token`) |
| `CHES_CLIENT_ID` | unset | Service-account client id; secret |
| `CHES_CLIENT_SECRET` | unset | Service-account secret; secret |

Note the realm difference: CHES service accounts are in `comsvcauth`, not `standard`. Sign-in users are in `standard`. Two different realms, two different sets of credentials.

### Switching transports per environment

- **Dev** → `MAIL_TRANSPORT=log`. Halt alerts land in pino stdout. No real recipients.
- **Test** → `MAIL_TRANSPORT=ches`, `OCR_ALERT_RECIPIENTS=` (empty) for a smoke test of the send path without spamming.
- **Prod** → `MAIL_TRANSPORT=ches`, `OCR_ALERT_RECIPIENTS=ops@gov.bc.ca,...`.

### Operational notes

- The CHES `from:` domain must be a BC Gov-hosted email domain (the SPF/DKIM machinery requires it). `cydb-noreply@gov.bc.ca` is the default; using a non-gov domain will result in mail being rejected or quarantined.
- CHES has rate limits — single-digit messages per minute is fine, hundreds per minute will start failing. Halt alerts are infrequent so this hasn't bitten us.
- The token cache survives across worker ticks; if all goes well, you'll see one token fetch per hour and many sends in between.

## Process lifecycle

```
process start
  ↓
better-sqlite3 connection opens (src/lib/server/db/index.ts)
  ↓
adapter-node HTTP server starts listening
  ↓
First request → handlePhase1
  ↓
maybeStartOcrWorker() (if OCR_WORKER_ENABLED=1)
  - selectProvider(env)
  - selectMailer(env, logger)
  - loadKeywords()
  - startWorker({db, provider, mailer, keywords, logger, ...})
  ↓
maybeStartChefsPoller() (if effective config has pollerEnabled=true)
  - getEffectiveConfig(db, env)
  - startPoller({db, getConfig, logger, list, download, attachmentsDir})
  ↓
maybeStartSearch()
  - ensureIndex()           — CREATE TABLE IF NOT EXISTS submissions_idx
  - startReconciler({db, client, logger, ...})
  ↓
... requests serve as normal; workers tick in background ...
  ↓
SIGINT or SIGTERM
  ↓
pollerHandle.stop()      — clears the setInterval, waits for in-flight tick
workerHandle.stop()      — same
reconcilerHandle.stop()  — same
  ↓
process.exit(0)
```

### Why lazy start?

`maybeStartOcrWorker`, `maybeStartChefsPoller`, and `maybeStartSearch` run **on the first HTTP request**, not at module load. Reasons:
- During test runs, `vitest` imports the module without starting workers. Workers only start when a request comes in (and tests don't make requests against the live hook chain).
- The startup is async and includes a `loadKeywords()` file-read; doing it on first request defers the work to when it's actually needed.
- The `workerStarted` / `pollerStarted` / `searchStarted` flags ensure exactly-once start despite the first-request race.

### What about graceful shutdown?

`process.once('SIGINT' / 'SIGTERM')` calls `poller.stop()` then `worker.stop()`. The `.stop()` methods clear their `setInterval` and `await` any in-flight tick. With `replicas: 1` and `strategy: Recreate`, OpenShift sends SIGTERM, waits up to `terminationGracePeriodSeconds` (30 by default), then SIGKILL.

If a tick is mid-OCR-call when SIGTERM lands, the next pod start will see the row still leased (or `processing`) and the lease loop will not pick it up until you manually clear it. **Practical recovery**: SQL like `UPDATE ocr_jobs SET status='queued', leased_by=NULL, leased_at=NULL WHERE status='processing' AND leased_at < datetime('now', '-10 minutes')` will unstick anything. This isn't automated; consider a stale-lease cleanup pass as a future hardening.

## Adding a new worker

If you add a new background job loop:

1. Write the lease + processor as **pure functions taking `db` and dependencies**. This is the test seam.
2. The worker module exports a `startX({...}): XHandle` factory that closes over a `setInterval`. It returns `{ stop(): Promise<void> }`.
3. Boot it lazily from `hooks.server.ts` under an env-gated `maybeStartX()`.
4. Persist any cross-restart state in `system_state` with a unique key prefix.
5. Implement a breaker. The OCR worker is the model — follow its shape closely so the operator runbook (`90-runbook.md`) covers your worker with the same idioms.
6. Add a `replicas: 1` warning if your worker can't run multi-pod. Today they all can't.

## Adding a new external integration

1. Make the HTTP client a class that accepts `{ fetch?: typeof fetch }` so tests can pass a fake.
2. If the integration uses OAuth2 client_credentials, copy the `ChesTokenCache` pattern (single-flight + skew). Don't share a token cache across integrations — they have different lifecycles and credentials.
3. Add the integration's URL allowlist to `src/lib/server/security/url-safety.ts` if any of the URL is admin-configurable. If only the operator (via env vars) can set the URL, no allowlist is needed.
4. Write tests against a stubbed fetch first; ship the real call last.
5. Add the new env vars to: `.env.example`, `openshift/secret.example.yaml`, `openshift/deployment.yaml` inline env block (with comments), and `openshift/configmap-*.yaml`.
