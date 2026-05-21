# 80 · Deployment

This app deploys to the **BC Gov Gold OpenShift cluster** as a single-pod workload backed by two PVCs. The artifacts live in `openshift/`. This file walks through each artifact, how they fit together, and how to push a new build.

## The artifact set

```
openshift/
├── deployment.yaml        # The Pod spec (image, env, volumes, probes, resources)
├── service.yaml           # ClusterIP Service in front of the Pod
├── route.yaml             # Edge TLS-terminated Route in front of the Service
├── pvc-db.yaml            # PVC for /data/db (SQLite + WAL)
├── pvc-attachments.yaml   # PVC for /data/attachments
├── configmap-dev.yaml     # Per-env non-secret env vars (GITIGNORED)
├── configmap-test.yaml    # Same, for test (GITIGNORED)
├── configmap-prod.yaml    # Same, for prod (GITIGNORED)
├── secret.example.yaml    # Template for cydb-submissions-secrets (committed)
└── README.md              # In-tree pointers and operator notes
```

Plus the `Containerfile` at the repo root.

## How traffic gets in

```
                ┌──────────────────────────────────────────────┐
                │  Internet                                    │
                └────────────────────┬─────────────────────────┘
                                     │ HTTPS
                                     ▼
                ┌──────────────────────────────────────────────┐
                │  Route (route.yaml)                          │
                │  - termination: edge                         │
                │  - insecureEdgeTerminationPolicy: Redirect   │
                │  - adds x-forwarded-proto, x-forwarded-host  │
                └────────────────────┬─────────────────────────┘
                                     │ HTTP, port 80
                                     ▼
                ┌──────────────────────────────────────────────┐
                │  Service (service.yaml)                      │
                │  - selector: app=cydb-submissions            │
                │  - port 80 → targetPort 3000                 │
                └────────────────────┬─────────────────────────┘
                                     │ HTTP, port 3000
                                     ▼
                ┌──────────────────────────────────────────────┐
                │  Pod (deployment.yaml)                       │
                │  - one replica                               │
                │  - adapter-node listening on :3000           │
                │  - PROTOCOL_HEADER=x-forwarded-proto         │
                │  - HOST_HEADER=x-forwarded-host              │
                └──────────────────────────────────────────────┘
```

`adapter-node` reads `PROTOCOL_HEADER` and `HOST_HEADER` (set in the Containerfile env) to reconstruct the original HTTPS URL the user requested. This is how the app knows it's `https://cydb...` even though incoming traffic is HTTP at port 3000. SvelteKit's CSRF check uses this same origin string.

## The Pod's storage

```
Pod
│
├── /data/db                 (PVC: cydb-submissions-db, 1Gi RWO)
│     local.db
│     local.db-shm
│     local.db-wal
│
└── /data/attachments        (PVC: cydb-submissions-attachments, 10Gi RWO)
      sub_<uuid>/
        <file1>
        <file2>
```

Two PVCs deliberately — different sizes (DB stays small forever; attachments grow), different sensitivity profiles, different backup cadences possible. Both are `ReadWriteOnce`. With `replicas: 1` and `strategy: Recreate`, no scheduling problem arises.

If the attachments PVC fills up, increase the `storage: 10Gi` value in `pvc-attachments.yaml` and `oc apply -f`. OpenShift will resize the underlying volume online.

## The Containerfile

Three stages: `deps` → `build` → `runtime`. The runtime image:

- Base: `node:22-alpine` (small, security-patched regularly)
- Working dir: `/app`
- Copies in: `build/`, `node_modules/` (production-only after `npm prune --omit=dev`), `package.json`, the migrations directory, the `scripts/` directory, and the `config/` directory (for the OCR keyword list)
- Owners: `node:0` (UID 1000, GID 0). The `chmod -R g=u` makes the file mode group-equal-to-user so OpenShift's Restricted SCC (which runs the container as an arbitrary high UID in GID 0) can read+write the same files.
- Exposes port 3000
- Mounts the two PVCs at `/data/db` and `/data/attachments`
- Runs as USER 1000
- CMD: `sh -c "node scripts/migrate.mjs && node scripts/seed-admin.mjs && node build"`

The CMD chain matters:
1. **`scripts/migrate.mjs`** applies any unapplied migrations against `local.db`. Idempotent — re-runs are safe.
2. **`scripts/seed-admin.mjs`** checks if `user` is empty; if so, creates the bootstrap admin from `ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD`. Otherwise no-op.
3. **`node build`** boots the SvelteKit app (the production server).

If migrations fail, the container exits non-zero and OpenShift's RestartPolicy (`Always` by default) will restart it. If `seed-admin` fails, same. So a misconfigured Secret can produce a CrashLoopBackoff — check `oc logs` to see which step failed.

## Configuration: ConfigMap + Secret

Two Kubernetes resources hold the runtime env:

### `cydb-submissions-secrets` (Secret)

Sensitive values. Created from `openshift/secret.example.yaml` (which is committed and shows the shape but no real values). The actual `openshift/secret.yaml` is gitignored.

Includes (when populated):
- `BETTER_AUTH_SECRET` — 32+ random chars; signs sessions and OAuth state cookies
- `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` — for the first-deploy admin
- `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` — from the BC Gov SSO installation JSON
- `CHES_CLIENT_ID`, `CHES_CLIENT_SECRET` — for the email mailer
- `BCGOV_DI_API_KEY` — if using `OCR_PROVIDER=bcgov-di`
- `KONG_TOKEN_URL`, `KONG_CLIENT_ID`, `KONG_CLIENT_SECRET` — if using `OCR_PROVIDER=kong-ms-di`
- `CHEFS_API_TOKEN` — for the CHEFS poller
- `OCR_ALERT_RECIPIENTS` — kept here even though it isn't sensitive, because it changes per-env

### `cydb-submissions-config` (ConfigMap)

Non-sensitive but per-environment. Created from one of `openshift/configmap-{dev,test,prod}.yaml`. **All three are gitignored** — they document per-environment values that change without code changes, and the BC Gov security stance is that operator-maintained env files don't belong in git.

Includes:
- `NODE_ENV=production`, `HOST`, `PORT`, `DATABASE_URL`, `ATTACHMENTS_DIR`
- `LOG_LEVEL` (`info` for test/prod, `debug` for dev)
- OCR worker config: `OCR_WORKER_ENABLED`, `OCR_PROVIDER`, `OCR_MAX_CONCURRENCY`, etc.
- `BCGOV_DI_BASE_URL`, `BCGOV_DI_WORKFLOW_SLUG`
- `MAIL_TRANSPORT`, `OCR_ALERT_FROM`, `CHES_BASE_URL`, `CHES_TOKEN_URL`
- `CHEFS_POLLER_ENABLED`, `CHEFS_BASE_URL`, `CHEFS_VERSION`, `CHEFS_FILE_COMPONENTS`, `CHEFS_POLL_INTERVAL_MS`
- `SSO_ISSUER_URL` (per-environment loginproxy host)
- `BODY_SIZE_LIMIT=27000000` (≈25 MiB + headroom; adapter-node's default of 512K would truncate every real upload)

### How they merge into the container

`openshift/deployment.yaml` wires both into the container's env:

```yaml
envFrom:
  - secretRef:
      name: cydb-submissions-secrets
  - configMapRef:
      name: cydb-submissions-config
env:
  - name: NODE_ENV
    value: production
  # ... inline env block ...
```

The inline `env:` block in `deployment.yaml` is a fallback for when the ConfigMap is missing. Where they overlap, **ConfigMap wins** (Kubernetes applies envFrom first, then inline env on top — but the ConfigMap reference goes through envFrom too, so order in `envFrom` determines precedence; we list the secret then the configmap, and both override inline).

In practice: the inline env is the safety net. The ConfigMap is the source of truth in any deployed environment.

## Building and pushing an image

There's no committed CI/CD pipeline yet. The image build is currently manual:

```bash
# From the repo root
podman build -t cydb-submissions:dev -f Containerfile .

# Sanity-check the local image
podman run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET=01234567890123456789012345678901 \
  -e ORIGIN=http://localhost:3000 \
  -e ADMIN_BOOTSTRAP_EMAIL=admin@test \
  -e ADMIN_BOOTSTRAP_PASSWORD=changeme1234567 \
  cydb-submissions:dev
# Visit http://localhost:3000

# Push to the BC Gov OpenShift internal registry
podman tag cydb-submissions:dev image-registry.openshift-image-registry.svc:5000/cydb/cydb-submissions:latest
# (Authentication and remote push depend on your `oc login` + service account)
```

`deployment.yaml`'s `image:` field references `image-registry.openshift-image-registry.svc:5000/cydb/cydb-submissions:latest`. That's the in-cluster registry path. Once an image with that tag is pushed, the next pod restart picks it up.

The ImageStream wiring (so the Deployment auto-redeploys on a new push) is **not** in this repo — it's an operator-installed ImageStreamTag. The BC Gov Platform team owns that.

## Deploying for the first time on a new cluster

```bash
# 1. Create the namespace (if not already present)
oc new-project cydb

# 2. Apply the PVCs
oc apply -f openshift/pvc-db.yaml
oc apply -f openshift/pvc-attachments.yaml

# 3. Create the Secret from your local secret.yaml
#    (copy secret.example.yaml → secret.yaml, fill in values, NEVER COMMIT)
oc apply -f openshift/secret.yaml

# 4. Apply the per-env ConfigMap (the one matching this cluster)
oc apply -f openshift/configmap-dev.yaml
# or configmap-test.yaml / configmap-prod.yaml

# 5. Apply the Service and Route
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml

# 6. Build and push the image (see "Building and pushing an image" above)

# 7. Apply the Deployment
oc apply -f openshift/deployment.yaml
```

Verify:

```bash
oc get pods -l app=cydb-submissions
oc logs -l app=cydb-submissions --tail=50
oc get route cydb-submissions -o jsonpath='{.spec.host}'
```

Hit the hostname in a browser. You should see the staff landing page; SSO will work once the redirect URI for this environment is registered with the BC Gov SSO team via the CSS app.

## Deploying an update

Every change goes through dev → test → prod.

For each environment:
1. Build the image, tag, push (see above).
2. Apply any changed ConfigMap (if the change touched env vars):
   ```bash
   oc apply -f openshift/configmap-<env>.yaml
   ```
3. Restart the Deployment to pick up new env + new image:
   ```bash
   oc rollout restart deployment/cydb-submissions
   ```
4. Watch the rollout:
   ```bash
   oc rollout status deployment/cydb-submissions
   ```

Because `strategy: Recreate` is set, OpenShift terminates the old pod before starting the new one. There's a brief downtime (~30 seconds typically) — this app doesn't pretend to be HA. If you need zero-downtime deploys, switch to `strategy: RollingUpdate` AND solve the SQLite single-writer constraint (it's not trivial — most likely move to Postgres).

## Probes

`deployment.yaml` sets:

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 20
```

- **`/healthz`** returns plain `ok\n`. Used as a "is the process alive" check.
- **`/readyz`** returns JSON: `{ ok, checks: { db, attachments, auth }, queue: 'ok' | 'halted' | 'disabled' }`. Status code is 200 if every `check` is true, 503 otherwise.

Important note about `/readyz`: **a halted OCR queue does NOT flip the HTTP status to 503**. The reasoning is that the public form path (and CHEFS ingest) is independent of the back-office OCR queue. If OCR is halted but submissions can still arrive, the pod is still "ready" — the queue just needs human attention.

If you want OpenShift to roll the pod when something deeper breaks, augment `/readyz` to set `ok=false` for that condition.

## Resource limits

`deployment.yaml`:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

100m CPU and 256Mi memory are comfortable at current load. The 1Gi memory limit gives headroom for a few concurrent OCR jobs (`OCR_MAX_CONCURRENCY` ≤ 4); larger uploads need more (a 25MiB PDF gets buffered into memory before the worker reads it).

If OOM kills start appearing in `oc events`, bump the memory limit first.

## Backup and recovery

PVC backups are handled by the BC Gov Platform team's snapshot infrastructure. We don't run our own.

Recovery, if you ever need it:
1. Stop the pod: `oc scale deployment/cydb-submissions --replicas=0`
2. Mount the snapshot to a temporary debug pod; `oc cp` files out
3. Restore by copying back to the live PVC mount, then scaling back to 1

This is operationally expensive. A more practical "oops" recovery (delete a misclick admin action, restore one submission row) doesn't exist; we'd have to write a one-off SQL script.

If RPO/RTO matter to you (or to a security review), confirm with the Platform team:
- How often is the PVC snapshot taken?
- How long is it retained?
- What's the recovery time?

The standard BC Gov Gold cluster has documented values; they're not currently mirrored in this repo.

## Image hygiene

- The base image is `node:22-alpine`. The `:22-alpine` tag floats — when Node patches Alpine, our next build picks it up.
- We do **not** pin a digest. Trade-off: less reproducible builds for less manual security patching. If reproducibility matters to you, pin to a specific digest and add a quarterly review.
- `npm prune --omit=dev` runs in the build stage so the runtime image only contains production deps. Dev advisories (vitest, eslint) don't ride to production.

## Common operational tasks

### Rotating BETTER_AUTH_SECRET

1. Generate a new 32+ char random string: `openssl rand -base64 48`
2. Update the Secret: `oc patch secret cydb-submissions-secrets -p '{"stringData":{"BETTER_AUTH_SECRET":"<new>"}}'`
3. Restart the pod: `oc rollout restart deployment/cydb-submissions`
4. **All sessions invalidated.** Users have to sign in again. This is the cost of rotating the cookie-signing key.

### Rotating SSO_CLIENT_SECRET

1. The BC Gov SSO team issues a new client secret via the CSS app.
2. Update the Secret: `oc patch secret cydb-submissions-secrets -p '{"stringData":{"SSO_CLIENT_SECRET":"<new>"}}'`
3. Restart the pod.
4. New SSO sign-ins use the new secret; existing sessions remain valid until their `expiresIn` (8h).

### Rotating CHEFS_API_TOKEN

Either through the admin UI (`/admin/chefs ?/rotateToken`) which writes to the DB, **or** by updating the Secret. Env-set tokens override DB-set ones.

### Resuming a halted OCR queue

Sign in as admin → `/admin/queues` → click "Resume OCR". Or directly:

```bash
oc exec deployment/cydb-submissions -- sh -c "echo 'DELETE FROM system_state WHERE key=\"ocr.halted\";' | sqlite3 /data/db/local.db"
```

The worker picks up its next tick within `OCR_POLL_INTERVAL_MS`.

### Looking at the live database

```bash
oc exec -it deployment/cydb-submissions -- sqlite3 /data/db/local.db
```

The `-it` flag is required for the interactive prompt to work. `Ctrl-D` to exit.

### Tailing logs

```bash
oc logs -f deployment/cydb-submissions
```

The output is JSON-per-line. Pipe through `jq` for readability:

```bash
oc logs deployment/cydb-submissions | jq -c 'select(.level >= 40)'   # warn+
```

## Multi-env walk-through

The three environments are configured to exercise progressively more of the integration surface:

| | dev | test | prod |
|---|---|---|---|
| `NODE_ENV` | production | production | production |
| `LOG_LEVEL` | debug | info | info |
| `OCR_WORKER_ENABLED` | 1 | 1 | 1 |
| `OCR_PROVIDER` | stub | bcgov-di | bcgov-di |
| `MAIL_TRANSPORT` | log | ches | ches |
| `OCR_ALERT_RECIPIENTS` | (empty) | test mailbox | ops mailbox |
| `CHEFS_POLLER_ENABLED` | 0 | 1 | 1 |
| `SSO_ISSUER_URL` | dev.loginproxy | test.loginproxy | loginproxy |
| `DEV_AUTH_BYPASS` | (empty) | (empty) | (empty) |

Dev cluster runs `NODE_ENV=production` but with the OCR stub provider and log-only mail — useful for confirming the deployed app boots end-to-end without actually calling external services. Test cluster talks to real CHEFS and real OCR but quiet email. Prod is real-everything.

`DEV_AUTH_BYPASS` is empty in all three. The shim's own guard against `NODE_ENV=production` is the belt; this is the braces.

## What's NOT in this repo

A few things you'll need to interact with that don't live here:

- **The container image registry credentials.** Configured via `oc login` + an OpenShift service account.
- **The BC Gov SSO CSS app.** Where you register the redirect URI and create roles. https://bcgov.github.io/sso-requests/ or the live console (link from BC Gov Platform docs).
- **The CHES request form.** Where you ask for a CHES service account.
- **The BC Gov AI Adoption DI service request.** Where you ask for a workflow and API key.
- **The PVC snapshot schedule.** Configured by Platform Services.

Most of these are one-time setup. The CSS app is the one you'll touch most often as the role-membership manager.
