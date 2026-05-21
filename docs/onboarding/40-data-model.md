# 40 · Data model

The persistent state of this application lives in **one SQLite file** (`/data/db/local.db` in the deployed pod, `./local.db` or whatever `DATABASE_URL` points to in dev) plus an **attachments PVC** (`/data/attachments`). This file walks both.

## The schema at a glance

11 tables, in two groups:

**App tables** (`src/lib/server/db/schema.ts`):
- `submissions` — one row per accepted submission, every leaf field has its own column
- `submission_metadata` — IP, user agent, etc. (one row per submission)
- `submission_attachments` — one row per uploaded file
- `invalid_submissions` — submissions that failed server-side validation (separate table for defect review)
- `user_roles` — role assignments
- `ocr_jobs` — OCR work queue
- `ocr_results` — per-attachment OCR output
- `keyword_hits` — per-(submission, keyword) match count
- `system_state` — key/value store for cross-process state (halt sentinels, last-sync, breaker counts)

**better-auth tables** (`src/lib/server/db/auth.schema.ts`):
- `user`, `session`, `account`, `verification` — the standard better-auth schema. We don't define these ourselves; better-auth requires them.

## Column-naming conventions

Drizzle lets you use a TypeScript camelCase column name with a different on-disk SQL name. We **inconsistently** use both:

- `submissions.dateOfBirth` — same name in TS and SQL (camelCase in SQLite)
- `submissions.submitterSurname` ↔ `submitter_surname` (snake_case in SQL)
- `submissionAttachments.storedPath` ↔ `stored_path`

The original CHEFS form schema uses camelCase for leaf field keys, so the form-data columns kept their camelCase to make the mapping mechanical. Newer columns (metadata, audit-style fields) use snake_case in SQL. **When writing raw SQL in tests or migrations, check the actual column name** — don't assume one or the other.

This is the trap that bit a Playwright test once and produced an error like `SqliteError: column information_accurate doesn't exist`. The column on disk is `informationAccurate`. If you see one of these, the fix is to use Drizzle (`db.insert(submissions).values({ informationAccurate: 1 })`) instead of raw SQL, or match the actual on-disk name.

## Table walkthroughs

### `submissions`

```ts
id                     INTEGER PRIMARY KEY AUTOINCREMENT
submission_uuid        TEXT NOT NULL UNIQUE       -- public-safe stable identifier
status                 TEXT NOT NULL DEFAULT 'submitted'
submitter_surname      TEXT                       -- nullable; populated when known
-- Form fields (camelCase in SQL):
dateOfBirth            TEXT
primaryLanguage        TEXT
developmentalConcerns  INTEGER (boolean mode)
ageOfFirstConcern      TEXT
hasFormalDiagnosis     INTEGER (boolean mode)
diagnosticStatus       TEXT
assessmentTools        TEXT (json mode) -> string[]
communication          TEXT
socialInteraction      TEXT
dailyLivingSkills      TEXT
behaviouralConcerns    TEXT
conditions             TEXT (json mode) -> string[]
services               TEXT (json mode) -> string[]
weeklyHours            REAL
informationAccurate    INTEGER (boolean mode) NOT NULL
dataSharingConsent     INTEGER (boolean mode) NOT NULL
raw_payload            TEXT (json mode) NOT NULL  -- exact JSON the form posted
created_at, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX  submissions_status_idx  (status)
INDEX  submissions_created_idx (created_at)
INDEX  submissions_surname_idx (submitter_surname)
CHECK  status IN (one of SUBMISSION_STATUSES)
```

**Why every leaf field gets its own column instead of just JSON?** Two reasons:
1. Indexable / queryable status, dates, and surname.
2. It matches a product requirement that every form field must have a column in the database.

**Why also keep `raw_payload`?** Forensic reproducibility. If we ever need to re-validate a submission against a newer schema, or run a backfill script, we have the exact JSON the client sent.

**Multi-select arrays as JSON.** SQLite has no native array type. `assessmentTools`, `conditions`, and `services` are stored as JSON text. Drizzle's `.$type<string[]>()` annotation gives you a typed read, but you're still serializing into a text column.

**SubmissionStatus** is a TypeScript union derived from the constant array `SUBMISSION_STATUSES`. The DB has a matching `CHECK` constraint, so a typo at the app layer that escapes TypeScript will still be caught by SQLite.

### `submission_metadata`

```ts
id                  INTEGER PRIMARY KEY
submission_id       INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE UNIQUE
ip_address          TEXT
user_agent          TEXT
accept_language     TEXT
referer             TEXT
request_method      TEXT
tls_version         TEXT          -- not populated by the current code; reserved
session_id          TEXT          -- legacy field; not populated
browser_fingerprint TEXT          -- legacy field; not populated
csrf_token_echo     TEXT
submission_timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

One-to-one with `submissions`. The data here is populated by `extractMetadata()` in `src/lib/server/metadata.ts` at write time. The `tls_version` / `session_id` / `browser_fingerprint` columns are present in the schema but **not currently populated**; they were anticipated for future use and kept rather than dropped.

### `submission_attachments`

```ts
id                INTEGER PRIMARY KEY
submission_id     INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE
original_filename TEXT NOT NULL    -- basename of the client-uploaded file
stored_path       TEXT NOT NULL    -- absolute path inside the PVC
size_bytes        INTEGER NOT NULL
mime_type         TEXT NOT NULL
sha256            TEXT NOT NULL    -- fingerprint of the persisted bytes
uploaded_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX attachments_submission_idx (submission_id)
```

`original_filename` is sanitised (basename + safe-chars only) by `saveAttachments` in `src/lib/server/storage.ts` before being stored. So even if the upload was named `../../etc/passwd`, the row will have a sanitised name.

`stored_path` is the path on the PVC. When serving downloads via `/attachments/[id]/+server.ts`, we `path.resolve(att.storedPath)` and stream from disk. If the file is missing on disk (PVC restore mismatch, manual cleanup), the endpoint returns 410.

`sha256` is computed at write time from the bytes about to be persisted. We don't currently re-verify on read (would be a useful integrity check for a future hardening pass).

### `invalid_submissions`

```ts
id                INTEGER PRIMARY KEY
submission_uuid   TEXT NOT NULL UNIQUE
raw_payload       TEXT NOT NULL          -- the JSON the client sent
validation_errors TEXT NOT NULL (json)   -- zod issue list
ip_address        TEXT
user_agent        TEXT
received_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Submissions that fail server-side zod validation don't go into `submissions`; they go here instead. The purpose is **defect review** — if many submissions fail the same way, that's a signal that the form rendering is broken, the schema is wrong, or someone is sending malformed payloads. There's no UI to view these yet; if you need to look, query the table directly:

```sql
SELECT received_at, validation_errors FROM invalid_submissions ORDER BY id DESC LIMIT 20;
```

### `user_roles`

```ts
id          INTEGER PRIMARY KEY
user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
role        TEXT NOT NULL
created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

UNIQUE INDEX user_roles_unique (user_id, role)
CHECK role IN ('admin', 'cfd_worker', 'clinician')
```

Authoritative for routing. The `Role` TypeScript union (`'admin' | 'cfd_worker' | 'clinician'`) and the `ROLES` constant tuple are derived from a single declaration in `src/lib/server/auth-types.ts`; the DB `CHECK` mirrors it.

One user can hold multiple roles (e.g. an admin who also reviews as a cfd_worker). The unique index is on the pair, not the user.

For SSO sign-ins, this table is **JIT-synced** from the access token's `client_roles` claim — `extractSsoRoles` filters and `syncUserRoles` writes. See `50-auth-and-roles.md`.

For local email/password sign-ins (the clinician fallback), roles are inserted manually — either by the admin bootstrap script (which inserts `admin` for the first user) or by an admin action that today doesn't exist as a UI surface. Promoting a clinician requires a SQL insert directly.

### `ocr_jobs`

```ts
id              INTEGER PRIMARY KEY
attachment_id   INTEGER NOT NULL REFERENCES submission_attachments(id) ON DELETE CASCADE
status          TEXT NOT NULL DEFAULT 'queued'
attempts        INTEGER NOT NULL DEFAULT 0
requeue_count   INTEGER NOT NULL DEFAULT 0
last_error      TEXT
next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
leased_by       TEXT
leased_at       TEXT
created_at, updated_at

INDEX ocr_jobs_status_next_idx (status, next_attempt_at)
INDEX ocr_jobs_attachment_idx  (attachment_id)
CHECK status IN ('queued','processing','succeeded','failed','abandoned')
```

The OCR worker's queue. State machine:

```
queued → processing → succeeded
                    ↘ failed (then maybe back to queued for retry, or abandoned)
```

- `next_attempt_at` is how the back-off is implemented. After a retryable failure, `recordFailure` sets it to `now + backoff(attempts)`. The lease query picks jobs whose `next_attempt_at <= CURRENT_TIMESTAMP`.
- `leased_by` and `leased_at` are populated when a job is leased. They're not really used for distributed exclusion (we only have one worker) but they're handy for debugging stuck jobs.
- `requeue_count` is incremented when an admin clicks "requeue" in `/admin/ocr` — useful for spotting jobs that keep failing.

### `ocr_results`

```ts
id            INTEGER PRIMARY KEY
attachment_id INTEGER NOT NULL UNIQUE REFERENCES submission_attachments(id) ON DELETE CASCADE
raw_text      TEXT NOT NULL
pages         INTEGER
model_id      TEXT NOT NULL
api_version   TEXT NOT NULL
processed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

The OCR output, one row per attachment. `raw_text` is the full extracted text — this can be megabytes for big PDFs. We don't paginate it for storage; if size becomes a concern, splitting into a separate page-level table is the obvious refactor.

`model_id` and `api_version` are recorded so we can later tell which model/version produced a given extraction. If the BC Gov AI Adoption team upgrades their backend, you'll see the version field change.

### `keyword_hits`

```ts
id           INTEGER PRIMARY KEY
submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE
keyword      TEXT NOT NULL
count        INTEGER NOT NULL
computed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

UNIQUE INDEX keyword_hits_submission_keyword_unique (submission_id, keyword)
```

The keyword evaluator scans each `ocr_results.raw_text`, counts occurrences of each keyword from `config/keywords.json`, and upserts the count into this table (one row per (submission, keyword) pair).

The upsert uses Drizzle's `onConflictDoUpdate` keyed by the unique index, so re-running the evaluator is idempotent.

### `system_state`

```ts
key        TEXT PRIMARY KEY
value      TEXT NOT NULL   (JSON-encoded payload)
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

The whatever-you-want-to-persist table. Read via `getSystemState<T>(db, key)` and write via `setSystemState(db, key, value)`. Keys in use today:

| Key | Payload | Purpose |
|---|---|---|
| `ocr.halted` | `{ trippedAt, threshold, lastErrorClass }` | OCR breaker tripped; worker skips all ticks |
| `ocr.failureCount` | `number` | Consecutive terminal failures for the OCR breaker |
| `chefs.halted` | `{ trippedAt, threshold, lastErrorClass }` | CHEFS poller breaker tripped |
| `chefs.failureCount` | `number` | Consecutive failures for the CHEFS poller breaker |
| `chefs.lastSync` | `SyncResult` | What the last CHEFS sync did (visible in /admin/queues) |
| `chefs.config` | `{ formId, version, baseUrl, fileComponents, apiParams, pollerEnabled, pollIntervalMs }` | DB-stored CHEFS configuration (env vars override at read time) |
| `chefs.apiToken` | `string` | The CHEFS API token (sensitive — only ever stored encrypted-at-rest by SQLite-on-PVC; never logged) |

Don't be precious about adding new keys here. If a new piece of cross-restart state shows up, this table is where it goes.

### better-auth tables

`user`, `account`, `session`, `verification`. We don't author these — better-auth requires them and we generated the migration once via `@better-auth/cli`. Brief shape:

- `user` — primary user record. `id` (text primary key), `name`, `email`, `email_verified`, `image`, timestamps.
- `account` — OAuth provider account links. One row per (user × provider). Carries `access_token`, `refresh_token`, `id_token`, `provider_id` (e.g. `'keycloak'`), and `account_id` (the IdP's user id). Also stores the local password hash for email-and-password accounts.
- `session` — active session tokens. `token` (the cookie value, indexed for fast lookup), `expires_at`, `user_id`.
- `verification` — used for email verification and password reset. We don't expose either feature, so this table is effectively empty.

You'll touch these only via better-auth's API (`auth.api.signInEmail`, `auth.api.signOut`, `auth.api.signInWithOAuth2`). Don't write directly unless you're in a migration.

## Migrations

Migrations live in `src/lib/server/db/migrations/`:

```
0000_unknown_tomas.sql        # Phase 1: submissions, attachments, metadata, invalid_submissions
0001_heavy_luckman.sql        # Phase 2: better-auth tables, user_roles
0002_phase3_ocr.sql           # Phase 3: ocr_jobs, ocr_results, keyword_hits, system_state
meta/                         # Drizzle bookkeeping (don't edit by hand)
```

### Workflow when you add a column / table

1. **Edit the schema** in `src/lib/server/db/schema.ts` (or `auth.schema.ts` if it's a better-auth change, but that's rare).
2. **Generate the migration**:
   ```bash
   npx drizzle-kit generate
   ```
   This writes a new `NNNN_*.sql` file and updates `meta/`.
3. **Review the generated SQL.** drizzle-kit's choices are usually correct, but check that DESTRUCTIVE changes (DROP COLUMN, NOT NULL on an existing column without default) aren't hidden inside.
4. **Run the migration locally:**
   ```bash
   node scripts/migrate.mjs
   ```
   This uses `better-sqlite3` directly and applies all unapplied migrations in order.
5. **Write a test** for the new column / table.

### Workflow when the migration applies in production

`scripts/migrate.mjs` runs on container start (the Containerfile entrypoint calls it before invoking `node build/`). So migrations apply once per pod restart. With `replicas: 1` and `strategy: Recreate`, there's no race between two pods migrating simultaneously.

If you need a long migration, do it in two deploys:
1. Add the new column / table as nullable; deploy. Both old and new code work.
2. Backfill data + add NOT NULL constraint; deploy.

### Foreign keys

`better-sqlite3` does **not** enforce foreign keys by default. `scripts/migrate.mjs` and `src/lib/server/db/index.ts` both execute `PRAGMA foreign_keys = ON` at connection open. If you write a script that opens a new connection, do the same.

## The attachments PVC

```
/data/attachments/
  sub_<uuid-1>/
    <basename1>
    <basename2>
  sub_<uuid-2>/
    <basename3>
```

One directory per submission UUID. Each file is the raw upload, name sanitised at write time. The DB's `stored_path` is the absolute path to the file.

PVC backups are the BC Gov Platform team's job; we don't have an in-app backup. If you need to migrate to a new PVC, copy the tree, point `ATTACHMENTS_DIR` at the new mount, and confirm `submission_attachments.stored_path` rows still resolve.

## Connection management

- `src/lib/server/db/index.ts` opens **a single `better-sqlite3` connection** at module load, calls `PRAGMA foreign_keys = ON`, and exports it as `db`.
- SQLite supports many readers but one writer at a time. Our writer is the same Node process; serialization is automatic.
- WAL mode is enabled by `better-sqlite3` by default. `local.db-wal` and `local.db-shm` are sibling files that need to be backed up together with the main DB file.
- The connection survives across all requests and workers in the same process. There's no per-request connection pool — SQLite + a single Node process makes one unnecessary.

## Where to look when something looks wrong

| Symptom | Likely table |
|---|---|
| "Submission shows as 'OCR Error'" | `ocr_jobs` (look for the failed row with `last_error`) |
| "Submissions list shows 0 rows but I just submitted" | `invalid_submissions` (zod might have rejected it) |
| "Admin sees no submissions even though they exist" | `user_roles` (do they actually have `admin`?) |
| "OCR queue won't start" | `system_state.ocr.halted`  — check `value`, then `/admin/queues` Resume |
| "CHEFS sync says it ran but no new submissions" | `system_state.chefs.lastSync` (`{ added: 0 }` means CHEFS returned nothing new) |
| "Attachment download returns 410" | The file is missing from the PVC; the DB row is still there |

## SQL escape hatch

When you need to poke at production data:

```bash
# In the pod
sqlite3 /data/db/local.db

# Useful diagnostic queries:
SELECT status, COUNT(*) FROM submissions GROUP BY status;
SELECT status, COUNT(*) FROM ocr_jobs GROUP BY status;
SELECT key, value FROM system_state ORDER BY updated_at DESC;
SELECT received_at, validation_errors FROM invalid_submissions ORDER BY id DESC LIMIT 10;
```

Never `UPDATE` or `DELETE` directly without good reason — there's no audit trail for raw SQL changes. If you need to fix data, write a one-off script and commit it under `scripts/`.
