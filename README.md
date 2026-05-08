# CYDB Submissions (Phase 1)

Public-facing CYDB application form. Renders the Form.io schema (`../cydb_form_schema.json`)
as native Svelte components on shadcn-svelte, validates submissions server-side, and
persists to SQLite + a PVC-backed attachments directory.

## Local development

```bash
cp .env.example .env
npm install
npm run db:migrate         # apply schema to local.db
npm run dev                # http://localhost:5173
```

## Tests

```bash
npm run test:unit -- --run                       # vitest server suite
./node_modules/.bin/playwright install chromium  # one-time
npm run test:e2e                                 # builds + previews + runs Playwright
```

`vitest` must be invoked via the local binary or `npm run test:unit`. `npx vitest`
pulls a different version that does not honour the `--project server` filter.

## Build / container

```bash
npm run build
podman build -t cydb-submissions:dev .   # or docker buildx build
```

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
| `BETTER_AUTH_SECRET` | Reserved for Phase 4; unused in Phase 1 |

## Notes

- The Phase-1 rate limiter is in-process. Multi-pod horizontal scaling will require
  an external store (Redis or a SQLite-backed counter) — plan a swap before scaling
  beyond a single OpenShift pod.
- All submissions are anonymous in Phase 1. Phase 2 introduces BC Gov SSO (OIDC)
  for staff routes and Phase 4 introduces local username+password for clinicians
  via the already-scaffolded better-auth dependency.
- Demo notice on the home page makes it clear that Phase 1 is non-production data.
