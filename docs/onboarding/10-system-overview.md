# 10 · System overview

## What this app does

The **Children & Youth Disability Benefit (CYDB) Submissions** application receives intake forms from families applying for the CYDB program, stores the application + supporting documents, runs OCR over the attachments, and presents the resulting case to two classes of staff (CFD workers and clinicians) for review.

### The user-facing form

Submitters complete a multi-section form (child info, developmental history, diagnosis, functional impact, co-occurring conditions, current supports, consent attestations) and upload supporting documents (PDFs, images, Word etc). The form's structure, validation rules, and option lists come from a **Form.io v2-style JSON schema** (`src/lib/form/cydb_form_schema.json`) that was originally authored on the BC Government **CHEFS** (Common Hosted Forms Service) platform. The visual layout matches the CHEFS rendering so submitters and staff have a consistent experience.

The user-facing form is a fallback measure. The production footing is to have a CHEFS form be the primary applicant interface, with this app handling the OCR processing and submission evaluation.

### The processing pipeline

Once a submission lands, it flows through this state machine (column `status` on `submissions`):

```
submitted → OCR queued → OCR processed → ready for review → ready for clinician → reviewed
                       ↘ OCR Error                        ↗
                                       ↘ invalid (separate table)
```

`OCR queued` and `OCR processed` are driven by the in-process OCR worker. `ready for clinician` is a manual transition by a CFD worker. `reviewed` is the terminal state once a clinician finishes their assessment.

### The user roles

| Role | What they do |
|---|---|
| `admin` | System operations: manage other users' roles, configure CHEFS ingestion, resume halted queues, requeue failed OCR jobs, see all submissions. |
| `cfd_worker` | Triage incoming submissions, review the OCR output, annotate, and assign cases to clinicians. Sees the intake/processing slice of statuses. |
| `clinician` | Receives assigned cases. Reads the submission + attachments + OCR output. Records their evaluation. Sees `ready for clinician` cases only. |
| (anonymous) | Originally allowed to submit the public form. In the current deployment the public form is **archived** and submissions arrive via the CHEFS poller instead. |

Roles are stored in a local `userRoles` table. They are also synced from BC Gov SSO on each sign-in (see `50-auth-and-roles.md`).

## Where the data is

| Class | Where it lives | Notes |
|---|---|---|
| Form payloads | `submissions` table in SQLite (`/data/db/local.db` in the deployed pod) | Every leaf field has a typed column; multi-select arrays are stored as JSON; the original raw payload is also retained for forensic / replay use |
| Invalid submissions | `invalid_submissions` table | Same shape minus typed columns; payload + zod issue list kept for defect review |
| Attachments | PVC at `/data/attachments`, one subdirectory per submission UUID | sha256 fingerprint recorded in `submission_attachments` |
| OCR text + keyword hits | `ocr_analyses` + `keyword_hits` tables | Per-attachment text + per-submission keyword counts |
| Sessions / accounts | `user`, `account`, `session`, `verification` (better-auth tables) | OAuth `account` rows carry the SSO access/refresh tokens |
| Audit events | pino stdout → OpenShift log aggregator | No in-app audit table; the `auditLog()` wrapper is an allowlist gate |

## Decision log

These are choices that have already been made. Don't re-litigate them unless you have new evidence.

### Stack choices

**SvelteKit over Next.js / Remix.** SvelteKit gives us server-side rendering, file-system routing, and form actions out of the box. Svelte's compile-time approach makes the production bundle small and the runtime fast. The trade-off is a smaller ecosystem than React — you'll occasionally find a problem that has 50 React answers and 2 Svelte answers (for some this is a feature). Lean on the SvelteKit docs and the project's existing patterns; this onboarding tree captures the rest.

**SQLite with `better-sqlite3` instead of Postgres / MySQL.** The submission volume is modest (40,000 over 3-6 months
?; SQLite is sufficient and the operational story (single file on a PVC) is much simpler than a managed database. Drizzle's SQLite dialect is good. The decision to revisit Postgres would come from one of: scale (>100k rows, write contention), need for multi-writer (multiple app pods), or BC Gov standardisation pressure. None apply today.

**`better-auth` instead of Auth.js / Lucia / hand-rolled.** Picked for: SvelteKit-native cookie handling, OIDC plugin (`genericOAuth` + `keycloak()` helper) that matches BC Gov SSO's Keycloak realm, Drizzle adapter, low ceremony for email/password as the clinician fallback. It's a young library; pin minor versions and read release notes before bumping.

**`shadcn-svelte` for UI primitives.** Components are copied into our `$lib/components/ui/` folder rather than `npm install`-ed. You own them. Built on `bits-ui` (headless primitives) styled with Tailwind. Avoid pulling in a second component library — every primitive we need (Card, Button, Badge, Table, AlertDialog, Input, Label) is already present.

**`pino` for logging with a custom `redactPII` allowlist.** Structured JSON to stdout, captured by OpenShift's log aggregator. The custom allowlist is preferred over pino's built-in `redact` paths because our payloads aren't shape-stable enough for path-based redaction. See `60-workers-and-integrations.md` and the logger module for the allowlist.

**`zod` for schema validation, derived from the Form.io JSON.** The CHEFS-authored form schema is parsed at module load (`src/lib/form/options.ts`) into typed `OPTIONS` and `FIELDS` exports, which feed both client-side rendering and server-side zod validation. Field allowlists stay in lockstep with the schema automatically. Don't hand-maintain enum lists.

### Architectural choices

**In-process workers, not a separate service.** Both the OCR queue worker and the CHEFS poller run on a `setInterval` inside the same Node process that serves HTTP. Reasons: simpler ops (one process, one PVC, one set of env), shared in-memory primitives (single-flight locks, breaker state), and the workload is small enough that the in-process cost is invisible.

The trade-offs you should know:
- **`replicas: 1`** in the Deployment. Scaling out would mean two workers racing for the same DB rows. The lease loop uses an UPDATE-then-SELECT pattern that would tolerate it, but the in-memory rate limiter and bypass cookie don't.
- **A long-running provider call blocks nothing** because the worker's lease loop is async, but it does hold one of the configured `OCR_MAX_CONCURRENCY` slots.

**Halt-sentinel pattern.** When the OCR worker (or CHEFS poller) sees too many consecutive terminal failures, it writes a row into the `system_state` table (`key='ocr.halted'` or `'chefs.halted'`) and stops dispatching. The breaker can only be cleared by an admin via `/admin/queues` (or the dedicated `/admin/ocr` and `/admin/chefs` pages). This puts a human in the loop before retrying — important when the failure mode might be a credentials problem or an external outage. Sees `60-workers-and-integrations.md` for the full pattern.

**No in-app audit table.** Audit events flow through pino into stdout, then to OpenShift's log aggregator. We get append-only-by-transport, off-pod storage, and shared infrastructure for free. The trade-off is retention policy is the platform team's call, not ours. The `auditLog()` wrapper enforces a compile-time allowlist of event names so emitted strings can't drift silently.

### Integration choices

**BC Gov SSO (Keycloak) for staff authentication.** All three environments (dev/test/prod) use the `standard` realm of `loginproxy.gov.bc.ca`. Per-environment installation JSONs are issued by the BC Gov SSO team; the values are loaded into `SSO_*` env vars. PKCE is enabled. Role assignment is JIT-synced from the access token's `client_roles` claim (with `resource_access.<client>.roles` as a fallback).

**Email via BC Gov CHES, not raw SMTP.** The mailer module supports three transports: `log` (default), `ches` (production), and `smtp` (stub; throws on send). CHES is a BC Gov-hosted REST wrapper around nodemailer behind Keycloak OAuth2. Direct SMTP is not used because BC Gov outbound mail has tight SPF/DKIM/source-IP restrictions that CHES already handles.

**OCR via either BC Gov AI Adoption DI backend (`bcgov-di`) or Kong gateway → Azure DI (`kong-ms-di`).** Both are supported via the `OCR_PROVIDER` env var. Test/prod environments use `bcgov-di` (workflow-driven, x-api-key auth). The Kong path is retained as a fallback and for environments where AI Adoption hasn't provisioned a workflow. A `stub` provider reads canned text files from `tests/fixtures/ocr/` and powers the test suite + local dev.

**CHEFS ingest, not the public form route.** Originally Phase 1 shipped an anonymous public form at `/`. After Phase 2 ship, the team chose to use BC Gov **CHEFS** (Common Hosted Forms Service) as the public submission surface instead — CHEFS handles bot detection, accessibility audits, and BC Gov-standard form ergonomics for free. The local public form was moved to `archive/public-form/`. The CHEFS poller pulls completed submissions on a configurable interval and writes them into the same database tables.

### Configuration choices

**Per-environment ConfigMaps are gitignored.** `openshift/configmap-{dev,test,prod}.yaml` carry non-secret runtime env (issuer URLs, base URLs, worker tuning, log level). They are deliberately **not** committed because they document cluster-specific values that change without code changes. Each operator maintains the file that matches the cluster they're targeting. The `secret.example.yaml` and the three configmap files are documented in `80-deployment.md`.

**`BODY_SIZE_LIMIT=27000000` in deployment env.** adapter-node's default upload cap is 512 KB. The product's documented attachment cap is 25 MiB. Without `BODY_SIZE_LIMIT` set explicitly, adapter-node truncates anything over 512 KB before the in-app cap ever runs. The value is set in `openshift/deployment.yaml` and all three configmaps.

**`DEV_AUTH_BYPASS` is dev-only.** The shim refuses to operate when `NODE_ENV=production`. It's used for local development and Playwright tests. The dev login page surfaces each configured persona as a one-click button. Production ops should never set this.

## What lives outside this repo

You might encounter these in conversation. They're not yours to own but you'll interact with them.

- **The CHEFS form definition.** The CHEFS team hosts the public-facing form. The schema JSON is in this repo (`src/lib/form/cydb_form_schema.json`), but the *deployed* CHEFS form is configured in the CHEFS admin UI. If the form changes, the schema must be re-exported and committed.
- **BC Gov SSO client registration.** Each environment has its own client ID, secret, and registered redirect URI. The CSS (Common Hosted SSO) app is where roles are created and IDIR users assigned to them. Changes happen there, not here.
- **CHES service account.** The OAuth2 client ID/secret that lets us send mail. Issued by the BC Gov CHES team; we use them via the `CHES_CLIENT_ID` / `CHES_CLIENT_SECRET` env vars.
- **BC Gov AI Adoption DI backend.** Hosts the OCR pipeline. The `BCGOV_DI_API_KEY` is group-scoped and issued by the AI Adoption team.
- **The OpenShift Gold cluster.** Hosting, PVC backup, certificate rotation, image registry. Owned by BC Gov Platform Services.

When any of these change in ways that affect us, you'll usually be told via email; sometimes you'll discover it when a sign-in starts failing. `90-runbook.md` covers the most common failure modes and what to do about each.
