# OpenShift templates

Templates only — not applied. To deploy:

```sh
oc apply -f openshift/pvc-db.yaml
oc apply -f openshift/pvc-attachments.yaml
oc apply -f openshift/secret.yaml          # create from secret.example.yaml; never commit
oc apply -f openshift/deployment.yaml
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

Storage layout:
- `cydb-submissions-db` (1Gi, RWO) — mounted at `/data/db`, holds `local.db` and its `-shm` / `-wal` siblings.
- `cydb-submissions-attachments` (10Gi, RWO) — mounted at `/data/attachments`, holds one subdirectory per submission UUID. Resize independently as the corpus grows.

Notes:
- `replicas: 1`. The Phase-1 in-process rate limiter and the Phase-2 bypass shim assume a single pod. Multi-pod scaling is a deliberate future task.
- Migrations run on pod start (`scripts/migrate.mjs`) followed by `seed-admin.mjs`. If migrations grow expensive, switch to a one-shot OpenShift `Job` invoked before deployment rollout.
- Image stream + BuildConfig wiring is left to the platform team.
