# 90 · Runbook

When the system misbehaves, work this file from the top down. Each section is a symptom → cause → fix triple. Skim it once on day one so you know it exists; come back to it when you have an incident.

## Quick reference

| You see | Look at | Section |
|---|---|---|
| Halt alert email about OCR | Workers running, breaker tripped | [OCR queue halted](#ocr-queue-halted) |
| Halt alert email about CHEFS | Workers running, breaker tripped | [CHEFS poller halted](#chefs-poller-halted) |
| `/readyz` returning 503, `checks.search: false` | Manticore sidecar unreachable | [Search down — `/readyz` 503](#search-down----readyz-503) |
| `/readyz` returning 503 | One of: db, attachments, auth missing | [Readiness failing](#readiness-failing) |
| Submission missing or stale in search | Not yet indexed by reconciler | [Submission not appearing in search](#submission-not-appearing-in-search) |
| Need to rebuild search index (schema change) | Drop and recreate `submissions_idx` | [Rebuilding the search index](#rebuilding-the-search-index) |
| Sign-in failing with "auth not configured" | `BETTER_AUTH_SECRET` missing or short | [Auth unavailable](#auth-unavailable) |
| Sign-in failing with "SSO unavailable" | SSO env missing or IdP unreachable | [SSO unavailable](#sso-unavailable) |
| Login form rejecting valid credentials | Login throttle tripped, or wrong password | [Login throttled / wrong creds](#login-throttled--wrong-credentials) |
| User has signed in but can't see anything | Missing role row in `user_roles` | [User has no roles](#user-has-no-roles) |
| 413 Payload Too Large on upload | `BODY_SIZE_LIMIT` not set | [Upload too large](#upload-too-large) |
| Submissions stuck in `OCR queued` | Worker not running or halted | [OCR queue not progressing](#ocr-queue-not-progressing) |
| `submissions.status='OCR Error'` | Per-job failure exhausted retries | [OCR job failed terminally](#ocr-job-failed-terminally) |
| Pod CrashLoopBackoff | migrate or seed-admin failing on boot | [Pod won't start](#pod-wont-start) |
| Tests passing locally but failing in CI | Env or DB state difference | [CI/local test divergence](#cilocal-test-divergence) |
| `oc logs` shows `Failed to run background task:` | Worker exception not caught | [Background task error](#background-task-error) |
| Disk full | PVC fills (attachments or DB+WAL) | [PVC full](#pvc-full) |

## OCR queue halted

**Symptoms:**
- Halt alert email with subject "OCR queue halted" (if MAIL_TRANSPORT=ches and recipients are set)
- `/admin/queues` shows OCR queue status = "halted"
- New submissions sit at `OCR queued` indefinitely
- `oc logs` contains a `queue_halted` event

**Cause:**
Consecutive OCR jobs failed terminally (each exhausted its retry budget). The breaker counter reached `OCR_FAILURE_BREAKER` (default 4) and set `system_state.ocr.halted`.

**Diagnosis:**

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT key, value, updated_at FROM system_state WHERE key LIKE 'ocr.%';"
```

Then look at the most-recent failed jobs:

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT id, attachment_id, attempts, last_error, updated_at
  FROM ocr_jobs
  WHERE status = 'failed'
  ORDER BY updated_at DESC
  LIMIT 5;"
```

`last_error` will usually point at the underlying cause:
- `Error: BC Gov DI upload failed: 401 ...` → `BCGOV_DI_API_KEY` is wrong, expired, or revoked
- `Error: BC Gov DI upload failed: 504 ...` → backend is down or overloaded; wait
- `fetch failed: ETIMEDOUT` → network issue between the pod and the backend; check `BCGOV_DI_BASE_URL` is reachable
- `Error: CHES token endpoint failed: 401 ...` (in alert-mailer code) → `CHES_CLIENT_ID`/`CHES_CLIENT_SECRET` wrong (this would only show during the alert send, not in the OCR job itself)
- Anything Drizzle / SQLite → the DB is corrupt or out of disk; see [PVC full](#pvc-full)

**Fix:**

1. **Address the underlying cause first.** Rotate a credential, wait for the upstream to recover, free up disk, etc. Don't resume into a known-broken state.
2. **Sign in as admin → `/admin/queues` → click "Resume OCR".** This clears `system_state.ocr.halted` AND `system_state.ocr.failureCount` and the worker resumes within `OCR_POLL_INTERVAL_MS`.
3. **Optionally requeue specific failed jobs.** `/admin/ocr` lists `status='failed'` jobs with a "Requeue" button per row. Requeue increments `requeue_count` so you can spot perpetually-failing items.

Manual fallback if the UI is itself broken:

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db <<'EOF'
DELETE FROM system_state WHERE key IN ('ocr.halted', 'ocr.failureCount');
UPDATE ocr_jobs SET status='queued', attempts=0, next_attempt_at=CURRENT_TIMESTAMP WHERE status='failed';
EOF
```

## CHEFS poller halted

**Symptoms:**
- Halt alert email with subject "CHEFS poller halted"
- `/admin/queues` shows CHEFS sync status = "halted"
- New submissions in CHEFS aren't appearing in our DB

**Cause:**
Consecutive CHEFS sync ticks failed. Same breaker pattern as OCR, with key `chefs.halted`.

**Diagnosis:**

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT key, value, updated_at FROM system_state WHERE key LIKE 'chefs.%';"
```

Then check the most-recent sync result:

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT value FROM system_state WHERE key='chefs.lastSync';" | jq
```

Common errors:
- `CHEFS API 401 / 403` — `CHEFS_API_TOKEN` is wrong, expired, or revoked
- `CHEFS API 404` — `CHEFS_FORM_ID` is wrong, or the form was deleted
- `CHEFS API timeout` — temporary network issue; the breaker may have tripped on a brief outage
- Anything DB-related → see [PVC full](#pvc-full)

**Fix:**

1. If the token is the issue, rotate it via `/admin/chefs ?/rotateToken` (writes the new token to the DB) or update the Secret with a new `CHEFS_API_TOKEN` and restart the pod.
2. Sign in as admin → `/admin/queues` → click "Resume CHEFS sync".
3. Optionally trigger a one-shot sync now: `/admin/queues` → "Sync now".

Manual fallback:

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db <<'EOF'
DELETE FROM system_state WHERE key IN ('chefs.halted', 'chefs.failureCount');
EOF
```

## Readiness failing

**Symptoms:**
- `/readyz` returns 503
- OpenShift reports the pod as not ready, traffic isn't being routed to it

**Cause:**
One of the three readiness checks failed:
- `db` — can't open or query the SQLite file
- `attachments` — can't list or write to `/data/attachments`
- `auth` — `BETTER_AUTH_SECRET` missing or shorter than 32 chars

**Diagnosis:**

```bash
oc exec deployment/cydb-submissions -- wget -O- http://localhost:3000/readyz
```

The JSON tells you exactly which check failed:

```json
{ "ok": false, "checks": { "db": false, "attachments": true, "auth": true }, "queue": "ok" }
```

**Fix per check:**

- `db: false` — the PVC isn't mounted or `local.db` is corrupt. Check `oc describe pod` for volume errors. As a last resort, recover from a PVC snapshot.
- `attachments: false` — same volume class of issue; check the attachments PVC mount.
- `auth: false` — the Secret doesn't have `BETTER_AUTH_SECRET`, or it's shorter than 32 chars. Update the Secret and restart.

Note: a halted OCR queue does **NOT** flip `/readyz` to 503. That was a deliberate choice — see `80-deployment.md`. If you want OpenShift to roll the pod on a halt, change the `/readyz` handler.

Note: `checks.search: false` means the Manticore sidecar is unreachable. This **does** return 503 — search is treated as mission-critical. See [Search down — `/readyz` 503](#search-down----readyz-503).

## Search down — `/readyz` 503

**Symptoms:**
- `/readyz` returns 503 with `"checks": { "search": false }`
- OpenShift marks the pod not-ready; it drops out of rotation

**Cause:**
The Manticore sidecar (runs in-pod on `localhost:9308`) is unreachable — either it hasn't finished starting up yet or it crashed. Because search is treated as mission-critical, a dead sidecar intentionally makes the whole pod not-ready.

**Diagnosis:**

```bash
oc logs deployment/cydb-submissions -c manticore --tail=50
oc get pod -l app=cydb-submissions -o jsonpath='{.status.containerStatuses[*].name}{"\n"}{.status.containerStatuses[*].ready}'
```

The second command shows both container names and their ready flags side by side. If `manticore` is `false`, that's the failing check.

**Fix:**
You don't need to do anything manually. OpenShift runs a `tcpSocket:9308` liveness probe on the sidecar and restarts it automatically on crash. Once `localhost:9308` answers, `checks.search` goes true and the pod returns to rotation.

**No data loss:** SQLite is untouched while the sidecar is down. Every submission that was indexed or updated while the sidecar was absent stays "dirty" (`submissions.search_indexed_at` is null or older than `updated_at`). The reconciler re-indexes those rows within `SEARCH_RECONCILE_INTERVAL_MS` (default 2000 ms) once the sidecar is back.

If the sidecar is crash-looping repeatedly rather than recovering, read its logs for the root cause (disk permissions on the Manticore data directory, OOM, etc.) and address that before the pod will stabilise.

See also: `80-deployment.md` (Search sidecar section) and `30-architecture.md`.

## Submission not appearing in search

**Symptoms:**
- A submission exists in the DB (`submissions` table) but doesn't appear in search results
- Search results look stale — a recently-updated submission still shows old values

**Cause:**
The submission hasn't been (re)indexed yet. Indexing is asynchronous: the reconciler wakes every `SEARCH_RECONCILE_INTERVAL_MS` (default 2000 ms) and processes up to `SEARCH_RECONCILE_BATCH` (default 50) dirty rows per tick. A row is "dirty" when `search_indexed_at` is null or `< updated_at`.

Under normal load, the lag is a few seconds. It's longer if the sidecar just restarted (see above) or if a large backlog accumulated.

**Diagnosis:**

```bash
# How many rows are waiting to be indexed?
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db \
  "SELECT COUNT(*) FROM submissions WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;"
```

If the count is draining over time, the reconciler is working and you just need to wait. If it's stuck, check whether the sidecar is healthy (see [Search down](#search-down----readyz-503)).

**Fix:**
Usually just wait — the reconciler catches up on its own. To force every row to re-index immediately:

```bash
# Mark all rows dirty; the reconciler refills in subsequent ticks:
oc exec deployment/cydb-submissions -- sh -c \
  "echo 'UPDATE submissions SET search_indexed_at = NULL;' | sqlite3 /data/db/local.db"
```

This is safe to run at any time. The index is a derived, rebuildable projection of SQLite — clearing the stamp loses nothing.

## Rebuilding the search index

**When you need this:**
- You changed the Manticore index schema (field list, morphology settings, etc.) and need to apply it
- The `submissions_idx` table is corrupt or inconsistent

**Cause:**
The index table is created by `ensureIndex` at app boot. If the table already exists with the old schema, the app won't alter it. You have to drop it and let the app recreate it.

**Procedure:**

```bash
# 1. Drop the index table via the Manticore HTTP API:
oc exec deployment/cydb-submissions -c manticore -- \
  curl -s 'http://localhost:9308/sql?mode=raw' --data-urlencode 'query=DROP TABLE IF EXISTS submissions_idx'

# 2. Restart the app — ensureIndex recreates the table on boot,
#    then the reconciler refills it from SQLite:
oc rollout restart deployment/cydb-submissions
```

The reconciler fills the new index within a few minutes for typical dataset sizes (batch size `SEARCH_RECONCILE_BATCH`, default 50, every `SEARCH_RECONCILE_INTERVAL_MS`, default 2000 ms). Search results will be sparse during the fill but the pod stays healthy.

**No backup needed:** `submissions_idx` is entirely derived from `submissions` in SQLite. If you lost the index table entirely, the above procedure recreates it with no data loss.

**Relevant env vars:** `MANTICORE_URL` (default `http://localhost:9308`), `SEARCH_RECONCILE_INTERVAL_MS`, `SEARCH_RECONCILE_BATCH`. See `80-deployment.md` for full env reference.

## Auth unavailable

**Symptoms:**
- `/login` shows "Auth is not configured on the server. Set BETTER_AUTH_SECRET (32+ chars) and redeploy."
- Logs contain `auth: BETTER_AUTH_SECRET is not set`

**Cause:**
`BETTER_AUTH_SECRET` env is missing or shorter than 32 characters.

**Fix:**
Update the Secret. Restart the pod. The check is at module-load — a hot reload of env vars isn't enough.

## SSO unavailable

**Symptoms:**
- Clicking "Sign in with BC Gov SSO" returns 503 with "SSO is currently unavailable."
- Logs contain `sso_login_failed` events

**Cause matrix:**

| `oc logs` shows | Cause |
|---|---|
| `discovery URL ... 404` | `SSO_ISSUER_URL` is wrong for this environment |
| `discovery URL ... ENOTFOUND` | Network can't reach the IdP host (DNS or egress) |
| `400 / invalid_client` | `SSO_CLIENT_ID` or `SSO_CLIENT_SECRET` is wrong |
| `400 / invalid_redirect_uri` | The callback URL isn't registered with the BC Gov SSO team for this client |
| `getAuth returns null` | `BETTER_AUTH_SECRET` is missing — see [Auth unavailable](#auth-unavailable) |

**Fix:**
1. Confirm the three SSO env vars match `SSO/CYDB Submissions-installation-<env>.json` for this cluster (in the operator's possession; not in this repo).
2. Confirm the redirect URI `https://<route-host>/api/auth/callback/keycloak` is registered with the BC Gov SSO CSS app for this client.
3. If the IdP host is unreachable, escalate to the BC Gov Platform team (the egress allowlist may have changed).

Mitigation while the SSO team responds: if you have local email/password fallback users (e.g. the bootstrap admin), they can still sign in via the "Sign in with a clinician password instead" disclosure on `/login`.

## Login throttled / wrong credentials

**Symptoms:**
- Password sign-in returns 401 "Invalid credentials" or 429 "Too many failed attempts."

**Cause:**

- **401** means the email isn't in `user` OR the password is wrong. The error message is uniform to avoid account enumeration.
- **429** means the login throttle tripped. Either 5 failures for that `(ip, email)` pair within 15 minutes, or 20 failures for that IP across any email.

**Fix for 401:**
- Confirm the user has an `account` row with `provider_id='credential'`:
  ```sql
  SELECT u.email, a.provider_id FROM user u JOIN account a ON a.user_id=u.id WHERE u.email='<addr>';
  ```
- If `provider_id='keycloak'`, this user came in via SSO and has no password — they have to sign in via SSO, not the password form.
- If no row at all: the user doesn't exist. (They'd need to sign in via SSO to create their `user` row, or you need to seed them manually.)

**Fix for 429:**
- Wait 15 minutes; the throttle clears automatically.
- Or restart the pod — the throttle state is in-process memory, not the DB.
- Don't add the user to an IP-exclusion list; we don't have one (and probably shouldn't).

## User has no roles

**Symptoms:**
- User signs in via SSO and lands on `/` (the staff landing) but can't reach `/admin`, `/submissions`, or `/clinician`. Every link returns 403 or redirects back to `/login`.

**Cause:**
SSO sign-in succeeded — the `user` row exists — but `user_roles` has no rows for this user. Either:
- The user isn't assigned a role in the BC Gov SSO CSS app
- The CSS-app role names don't match our allowlist (`admin`, `cfd_worker`, `clinician`)
- The `client_roles` token mapper isn't enabled on this client (unusual)

**Diagnosis:**

```bash
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT u.email, ur.role FROM user u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.email='<addr>';"
```

If `role` is NULL, no role was inserted. Look at the audit logs for an `sso_role_sync_failed` event with `reason: 'no_roles_in_token'`. That confirms the access token didn't carry recognised roles.

**Fix:**
1. Go to the BC Gov SSO CSS app for this environment's client.
2. Under "Role Management", confirm the three roles exist with EXACTLY the names `admin`, `cfd_worker`, `clinician`.
3. Under "Assign Users to Roles", assign the user to the role(s) they need.
4. Have the user sign out and sign in again. The `databaseHooks.account.update.after` hook on the next sign-in syncs the new roles into `user_roles`.

If the CSS app is unavailable and you need to grant the role *immediately*, you can insert directly:

```sql
INSERT INTO user_roles (user_id, role)
  SELECT id, 'cfd_worker' FROM user WHERE email='<addr>';
```

This works but the role will be **wiped on the next SSO sign-in** if the IdP doesn't have it either. Use only as a temporary unblock; the IdP is authoritative.

## Upload too large

**Symptoms:**
- Upload form rejects files larger than ~512 KB with HTTP 413
- `oc logs` contains `request body size exceeded BODY_SIZE_LIMIT of <n>`

**Cause:**
`BODY_SIZE_LIMIT` not set in the deployment env. adapter-node defaults to 512K, well below the documented 25 MiB cap.

**Fix:**
Confirm `BODY_SIZE_LIMIT=27000000` is in the ConfigMap for this env. The inline env block in `deployment.yaml` also has it as a fallback. If both are missing, add it:

```bash
oc set env deployment/cydb-submissions BODY_SIZE_LIMIT=27000000
oc rollout restart deployment/cydb-submissions
```

Or update the ConfigMap properly and reapply.

## OCR queue not progressing

**Symptoms:**
- Submissions land with `status='submitted'` (from CHEFS) but never transition to `OCR queued` or beyond.
- OR submissions show `OCR queued` for hours.

**Diagnosis:**

```bash
# Is the worker even started?
oc logs deployment/cydb-submissions | grep -E "OCR worker (started|disabled|failed)"
```

You should see `queue_resumed` (the event used when the worker boots) on first request. If you see `OCR_WORKER_ENABLED is not set; worker not started`, that's your answer.

```bash
# Is it halted?
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT value FROM system_state WHERE key='ocr.halted';"
```

```bash
# How many jobs are queued? And how many leased mid-flight?
oc exec deployment/cydb-submissions -- sqlite3 /data/db/local.db "
  SELECT status, COUNT(*) FROM ocr_jobs GROUP BY status;"
```

**Causes and fixes:**

| Diagnosis | Cause | Fix |
|---|---|---|
| `OCR_WORKER_ENABLED is not set` | Worker disabled in ConfigMap | Set `OCR_WORKER_ENABLED=1`, restart |
| `ocr.halted` row exists | Breaker tripped | See [OCR queue halted](#ocr-queue-halted) |
| `leased` count > 0 and not changing | A long-running OCR call hung | Restart the pod (will release the lease) |
| `queued` count > 0 but no `leased` | Worker isn't ticking | Check logs for exceptions; restart |

To unstick leases that survived a crash:

```sql
UPDATE ocr_jobs
SET status='queued', leased_by=NULL, leased_at=NULL
WHERE status='processing'
  AND leased_at < datetime('now', '-10 minutes');
```

## OCR job failed terminally

**Symptoms:**
- A specific submission shows `status='OCR Error'`
- Its `ocr_jobs` rows show `status='failed'` with `attempts=3` (or whatever `OCR_MAX_ATTEMPTS` is)

**Cause:**
The OCR provider returned a non-retryable error three times in a row, OR three retryable errors in a row exhausted the budget.

**Diagnosis:**

```sql
SELECT id, last_error, attempts, requeue_count, updated_at
FROM ocr_jobs WHERE attachment_id=<id>;
```

The `last_error` is the last exception message. Common patterns:
- `Filename extension does not match claimed mime ...` — the attachment failed the storage-time validation (this shouldn't actually reach OCR; if it does, something is wrong upstream)
- `unsupported file type` — the OCR provider can't handle this MIME (rare for PDF/image/DOCX)
- `unprocessable: ...` — the document is corrupt or password-protected
- `quota exceeded` — the BC Gov DI quota is exhausted; rate is the upstream issue

**Fix:**
- If the document is broken (password-protected PDF, etc.), there's no fix; the submission needs to be flagged for manual review.
- If the failure was transient (quota, brief outage), click "Requeue" in `/admin/ocr`. This sets `status='queued'`, resets `attempts=0`, increments `requeue_count`.
- If the failure pattern is systematic across multiple submissions, the breaker should have tripped — see [OCR queue halted](#ocr-queue-halted).

## Pod won't start

**Symptoms:**
- `oc get pods` shows `CrashLoopBackoff` or `Error`
- `oc logs <pod>` shows an error before "Listening on port 3000"

**Cause:**
The Containerfile CMD is `node scripts/migrate.mjs && node scripts/seed-admin.mjs && node build`. One of the three failed.

**Diagnosis:**

```bash
oc logs deployment/cydb-submissions --previous | head -30
```

| Message | Cause |
|---|---|
| `migrate: DATABASE_URL is not set; skipping migrations.` | DATABASE_URL not set — should be in ConfigMap |
| `Error: SQLITE_*` during migrate | DB file corrupt or PVC mount failed |
| `Cannot find module './migrations/...'` | The migrations directory wasn't copied into the image (Containerfile error) |
| `seed-admin: env not configured; skipping.` | Normal when bootstrap env not set; not a real failure |
| `seed-admin: ... error: user creation did not persist` | better-auth signUpEmail returned silently; check DB+auth schema |
| `Error: BETTER_AUTH_SECRET ...` | Missing or short secret |
| `EACCES: permission denied, open '/data/db/local.db'` | PVC mount permissions; check fsGroup |

**Fix per cause:**

- **DB env wrong** — verify ConfigMap is mounted in `envFrom`. `oc set env deployment/cydb-submissions --list | grep DATABASE`.
- **PVC mount permission** — confirm `securityContext.fsGroup: 0` is in deployment.yaml. Container runs as UID 1000, GID 0; the PVC mount needs group-writable.
- **`BETTER_AUTH_SECRET`** — see [Auth unavailable](#auth-unavailable).

## CI/local test divergence

**Symptoms:**
- `./node_modules/.bin/vitest run` passes locally
- The same command in CI fails

**Common causes:**

1. **`local.db` carries dev data.** If a test depends on a fresh DB but you've been clicking around in `npm run dev`, the dev DB has rows that confuse the test.
   - Fix: `rm local.db && node scripts/migrate.mjs` before running tests
   - Or write the test to be hermetic (in-memory SQLite via `new Database(':memory:')` — this is what most tests already do)

2. **Env vars leaking.** Your shell may export `OCR_PROVIDER` (or similar) that the CI environment doesn't have.
   - Fix: `env | grep -E "OCR|CHEFS|CHES|SSO"` — if anything is set you don't want, `unset` it
   - Or set the test up to override via `vi.stubEnv(...)`

3. **`npm install` vs `npm ci`.** `npm install` may update the lockfile; `npm ci` enforces the lockfile. If your local lockfile drifted, you'd see green locally but red in CI.
   - Fix: always `npm ci` in CI; locally use `npm ci` before pushing to verify

4. **Playwright browsers cached differently.** The browser version on disk may differ.
   - Fix: `npx playwright install` to get the version pinned in package.json

## Background task error

**Symptoms:**
- Logs contain `Failed to run background task:` followed by an error
- The OCR worker or CHEFS poller stops ticking (or never starts)

**Cause:**
An unhandled exception in a worker tick or in the lazy-start path. The hook's `runInBackground` wrapper catches it and logs but doesn't propagate.

**Diagnosis:**
Read the error message. It'll be one of the underlying causes already covered above. Common ones:
- A missing env var that the worker constructor required at startup
- A network error during the first lease attempt (transient — the worker will retry next tick)
- A schema mismatch (you forgot to apply migrations after pulling the latest code)

**Fix:**
Address the root cause; restart the pod. The worker boots on the first request after restart.

## PVC full

**Symptoms:**
- Writes to DB or attachments fail with `SQLITE_FULL` or `ENOSPC`
- `/readyz` may flip to 503 on the `db` or `attachments` check

**Diagnosis:**

```bash
oc exec deployment/cydb-submissions -- df -h /data/db /data/attachments
```

**Fix:**

- For the attachments PVC: increase `storage:` in `pvc-attachments.yaml`, reapply. OpenShift resizes online.
- For the DB PVC: same — bump `storage:` in `pvc-db.yaml`. SQLite + WAL doesn't grow fast, so a 1Gi default is plenty for years.

If you're at quota and can't expand:
- Old attachments could be archived to a separate bucket (manual project)
- WAL can be checkpointed: `PRAGMA wal_checkpoint(TRUNCATE);` reclaims space if the WAL grew large

## Secret rotation cheatsheet

| Credential | When | How | Effect |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Compromised, or scheduled | Replace, restart pod | All sessions invalidated |
| `SSO_CLIENT_SECRET` | BC Gov SSO team rotates, or compromised | Get new secret from CSS app, replace, restart | New sign-ins use new secret; existing sessions stay |
| `CHES_CLIENT_SECRET` | Compromised, or scheduled | Replace, restart | Next CHES token fetch uses new secret |
| `BCGOV_DI_API_KEY` | AI Adoption team rotates | Replace, restart | Next OCR job uses new key |
| `CHEFS_API_TOKEN` | Scheduled (every 90 days) | Either /admin/chefs ?/rotateToken or update Secret + restart | Next CHEFS sync uses new token |
| `ADMIN_BOOTSTRAP_PASSWORD` | After first sign-in | Sign in, change password via the UI (when it exists) or directly via auth.api | The env var is ignored after first run anyway |

## When all else fails

1. **Read `oc logs deployment/cydb-submissions --tail=200`.** Most incidents have a specific event in the log.
2. **Check `/readyz`.** It tells you which subsystem the pod thinks is unhealthy.
3. **Restart the pod.** `oc rollout restart deployment/cydb-submissions`. Won't fix data problems; will fix transient state.
4. **Roll back.** If a deploy introduced the problem, `oc rollout undo deployment/cydb-submissions`.
5. **Ask the BC Gov Platform team.** Anything about PVCs, certificates, cluster networking is theirs.

## What to write down after each incident

Keep a one-line ledger of any unusual fix you applied. The format that works:

```
2026-05-21  CHEFS poller halted — token rotated via /admin/chefs, resumed. No user impact.
2026-05-15  Pod restarted to clear OCR lease stuck mid-call. 12 jobs requeued, all succeeded.
```

This isn't an audit log — it's a memory aid for the next person on call. Keep it short; the per-event detail is in the logs.

Where to put it: there isn't a `runbook-log.md` yet. Create one in `docs/onboarding/` (or wherever your team prefers) the first time you have an incident worth recording.
