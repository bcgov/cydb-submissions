# OpenShift templates

Templates only — not applied. To deploy:

```sh
oc apply -f openshift/pvc-db.yaml
oc apply -f openshift/pvc-attachments.yaml
oc apply -f openshift/secret.yaml             # create from secret.example.yaml; never commit
oc apply -f openshift/configmap-<env>.yaml    # see Per-environment ConfigMaps below; never commit
oc apply -f openshift/deployment.yaml
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

## Per-environment ConfigMaps

`openshift/configmap-dev.yaml`, `openshift/configmap-test.yaml`, and `openshift/configmap-prod.yaml` carry the non-secret runtime env for each cluster (OCR provider choice, BC Gov DI base URL, CHEFS poller flag, log level, mailer transport, etc.). They are **gitignored** — each operator maintains the one that matches the cluster they're deploying to. Secrets (API keys, OAuth client creds, SMTP credentials, BETTER_AUTH_SECRET, ADMIN_BOOTSTRAP_*) stay in `cydb-submissions-secrets`.

Wire whichever ConfigMap you applied into the Deployment by adding it to the container's `envFrom:` list — for example:

```yaml
envFrom:
  - secretRef:
      name: cydb-submissions-secrets
  - configMapRef:
      name: cydb-submissions-config
```

When `envFrom: configMapRef` is in place you can delete the inline `env:` block from `deployment.yaml` (the ConfigMap values take precedence anyway; the inline block is kept today only because the ConfigMaps aren't checked in).

Storage layout:
- `cydb-submissions-db` (1Gi, RWO) — mounted at `/data/db`, holds `local.db` and its `-shm` / `-wal` siblings.
- `cydb-submissions-attachments` (10Gi, RWO) — mounted at `/data/attachments`, holds one subdirectory per submission UUID. Resize independently as the corpus grows.

Notes:
- `replicas: 1`. The Phase-1 in-process rate limiter and the Phase-2 bypass shim assume a single pod. Multi-pod scaling is a deliberate future task.
- Migrations run on pod start (`scripts/migrate.mjs`) followed by `seed-admin.mjs`. If migrations grow expensive, switch to a one-shot OpenShift `Job` invoked before deployment rollout.
- Image stream + BuildConfig wiring is left to the platform team.

## OCR environment variables

The OCR worker is **off by default**. To turn it on in a deployment, you need (1) the worker enable flag, (2) a provider selection, and (3) the credentials that the chosen provider needs. Everything else has a working default.

### 1. Always required

| Variable | Where | Value |
| --- | --- | --- |
| `OCR_WORKER_ENABLED` | Deployment env | `"1"` to start the worker. Anything else (including unset) leaves the queue dormant. |
| `OCR_PROVIDER` | Deployment env | One of `stub` / `stub-fail` / `stub-flaky` (dev/CI only) / `kong-ms-di` / `bcgov-di`. |

### 2. Required per provider

**`OCR_PROVIDER=bcgov-di`** — BC Gov AI Adoption Document Intelligence backend (`x-api-key`, workflow-driven). This is the path documented in `docs/superpowers/plans/ocr-config-email.md`.

| Variable | Where | Value |
| --- | --- | --- |
| `BCGOV_DI_BASE_URL` | Deployment env | Test backend: `https://bcgov-di-test-backend-fd34fb-test.apps.silver.devops.gov.bc.ca`. |
| `BCGOV_DI_API_KEY` | **Secret** (`cydb-submissions-secrets`) | Group-scoped key from the AI Adoption team. Never log; the pino redactor scrubs `x-api-key` defensively. |
| `BCGOV_DI_WORKFLOW_SLUG` | Deployment env (optional) | Defaults to `ocr-only-minimal`. Override only if the AI Adoption team provisions a different workflow. |
| `OCR_MODEL_ID` | Deployment env (optional) | Defaults to `prebuilt-read`. The BC Gov backend infers the Azure model from the workflow + API key, so overriding this only affects the `model_id` recorded in `OcrAnalysis`. |

**`OCR_PROVIDER=kong-ms-di`** — Raw BC Gov Kong gateway → Azure Document Intelligence (OAuth2 client_credentials, `operation-location` polling).

| Variable | Where | Value |
| --- | --- | --- |
| `KONG_BASE_URL` | Deployment env | e.g. `https://api.gov.bc.ca/document-intelligence`. |
| `KONG_TOKEN_URL` | **Secret** | OAuth2 token endpoint. |
| `KONG_CLIENT_ID` | **Secret** | Provisioned by the BC Gov API Platform team. |
| `KONG_CLIENT_SECRET` | **Secret** | Provisioned by the BC Gov API Platform team. |
| `OCR_MODEL_ID` | Deployment env (optional) | Defaults to `prebuilt-read`. |
| `AZURE_DI_API_VERSION` | Deployment env (optional) | Defaults to `2024-11-30`. Pin only when Azure ships a version with a relevant change. |

**`OCR_PROVIDER=stub*`** — Dev/CI only. No credentials needed.

| Variable | Where | Value |
| --- | --- | --- |
| `OCR_STUB_FIXTURES` | Deployment env (optional) | Path to fixture `.txt` files. Defaults to `tests/fixtures/ocr` (not present in the runtime image). |
| `OCR_STUB_FLAKY_FAILURES` | Deployment env (optional) | Used by `stub-flaky`; defaults to `1`. |

### 3. Worker tuning (optional)

Defaults below are baked into the worker. Override in the deployment env if the BC Gov DI backend pushes back or you want different breaker behaviour.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OCR_MAX_CONCURRENCY` | `1` | In-flight requests. Capped at 4 — the breaker assumes a single pod. |
| `OCR_MAX_ATTEMPTS` | `3` | Per-job retry budget. Transient failures retry; only terminal failures count against the breaker. |
| `OCR_FAILURE_BREAKER` | `4` | Consecutive terminal failures before the worker sets `system_state.ocr.halted` and stops dispatching. |
| `OCR_POLL_INTERVAL_MS` | `1000` | Worker tick interval for the local lease loop (not the provider's HTTP poll). |

### 4. Halted-queue alert mailer (optional)

The worker emails on transition to halted. The supported transport for BC Gov workloads is **CHES** (Common Hosted Email Service) — a web API wrapping nodemailer behind Keycloak OAuth2. See `CHES-instructions.md` at the repo root for the operational constraints (gov-hosted `from:` domain, SPANBC source IP requirement, rate limits).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `log` | `log` (default — alerts go to pino) \| `ches` (CHES web service) \| `smtp` (stub; throws on send). |
| `OCR_ALERT_RECIPIENTS` | empty | Comma-separated. Empty = log-only (no mail attempt) regardless of transport. |
| `OCR_ALERT_FROM` | `cydb-noreply@gov.bc.ca` | Sender address for halt alerts. Must be a gov-hosted domain when `MAIL_TRANSPORT=ches`. |
| `CHES_BASE_URL` | `https://ches.api.gov.bc.ca/api/v1` | CHES web service base URL. |
| `CHES_TOKEN_URL` | unset | Keycloak OAuth2 token endpoint, realm-scoped. e.g. `https://loginproxy.gov.bc.ca/auth/realms/comsvcauth/protocol/openid-connect/token` (verify realm with the team that provisioned your CHES service account). |
| `CHES_CLIENT_ID` / `CHES_CLIENT_SECRET` | unset | **Secret.** Keycloak service-account credentials. Required when `MAIL_TRANSPORT=ches`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | unset | Only consulted when `MAIL_TRANSPORT=smtp`. The SmtpMailer is a stub and throws — prefer `ches`. |

## BC Gov SSO (Keycloak OIDC)

Staff authenticate against the BC Gov Common Hosted Single Sign-On service. The `SSO/` directory at the repo root contains the per-environment installation JSON files issued by the BC Gov SSO team. The realm is `standard` for all three environments; only the loginproxy host and the client secret change.

| Variable | Where | Value |
| --- | --- | --- |
| `SSO_ISSUER_URL` | Deployment env / ConfigMap | `${auth-server-url}/realms/standard`. Dev: `https://dev.loginproxy.gov.bc.ca/auth/realms/standard`. Test: `https://test.loginproxy.gov.bc.ca/auth/realms/standard`. Prod: `https://loginproxy.gov.bc.ca/auth/realms/standard`. Leave **empty** to disable SSO (the `/login` page falls back to email+password). |
| `SSO_CLIENT_ID` | **Secret** | `resource` field from the installation JSON. Same value (`cydb-submissions-6444`) across all three environments today. |
| `SSO_CLIENT_SECRET` | **Secret** | `credentials.secret` from the installation JSON. Different per environment. |

**Operator setup, per environment:**

1. Open `SSO/CYDB Submissions-installation-<env>.json`. Copy `resource` → `SSO_CLIENT_ID`, `credentials.secret` → `SSO_CLIENT_SECRET` into `cydb-submissions-secrets`. Construct `SSO_ISSUER_URL` as `${auth-server-url}/realms/${realm}` and put it in the env-matching ConfigMap (the three `configmap-*.yaml` files already have this set).
2. Register the OAuth callback URI with the BC Gov SSO team via the CSS app: `https://<your-route-host>/api/auth/oauth2/callback/keycloak` (the `keycloak` segment is the provider id better-auth's helper sets; do **not** rename it).
3. In the CSS app, under the integration's Role Management, create the three roles `admin`, `cfd_worker`, `clinician` and assign IDIR users to them. The app's role guard checks the local `userRoles` table, which is upserted on every sign-in from the access token's `client_roles` claim. Users without a recognised role will sign in successfully but be blocked from all role-gated routes.
4. Audience check (per the CSS docs): the standard realm is shared across teams, so only roles for `aud=cydb-submissions-6444` count. The app reads `resource_access.${SSO_CLIENT_ID}.roles` as a defensive fallback to `client_roles`.

**Local development:** Don't set `SSO_ISSUER_URL`. Use `DEV_AUTH_BYPASS=email:role` instead — the bypass shim refuses to operate when `NODE_ENV=production`, so the configmap leaves it empty in test and prod.

### Minimal `bcgov-di` deployment checklist

1. In the Deployment env block (`openshift/deployment.yaml`): `OCR_WORKER_ENABLED=1`, `OCR_PROVIDER=bcgov-di`, `BCGOV_DI_BASE_URL=…`, `BCGOV_DI_WORKFLOW_SLUG=ocr-only-minimal` (the template already carries the URL + workflow).
2. In the Secret (`cydb-submissions-secrets`): `BCGOV_DI_API_KEY=…`.
3. Roll out the Deployment. The worker reads its config at boot — there is no runtime reload.
4. Watch `/readyz` (it reports `queue: 'ok' | 'halted' | 'disabled'` in the body) and `/admin/ocr` for the queue state. The HTTP status of `/readyz` deliberately stays 200 even when halted — the public form path is independent of the back-office queue.
