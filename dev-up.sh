#!/usr/bin/env bash
#
# dev-up.sh — Build and run the full CYDB dev environment on Podman (macOS).
#
# Brings up, from scratch:
#   • a Podman pod (cydb-dev) sharing one network namespace, so the app
#     reaches Manticore on localhost:9308 exactly like the OpenShift sidecar
#   • the Manticore search sidecar (manticoresearch/manticore:25.0.0)
#   • the app image (built from ./Containerfile); its entrypoint applies
#     Drizzle migrations + seeds the bootstrap admin, then boots the server
#   • (optional) mock submissions so search has something to index
#
# The app runs the PRODUCTION image but with NODE_ENV=development so that, over
# plain http://localhost, session cookies aren't marked `secure` (which the
# browser would refuse to send) and the dev-auth bypass panel is available.
#
# Usage:
#   ./dev-up.sh                 # from scratch: rebuild image, fresh volumes, seed
#   ./dev-up.sh --keep-data     # reuse existing data/search volumes
#   ./dev-up.sh --no-build      # skip the image build (reuse cydb-submissions:dev)
#   ./dev-up.sh --no-seed       # don't seed mock submissions
#   ./dev-up.sh --down          # tear everything down and exit
#   ./dev-up.sh -h | --help
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config (override any of these via the environment, e.g. APP_PORT=8080 ./dev-up.sh)
# ---------------------------------------------------------------------------
POD_NAME="${POD_NAME:-cydb-dev}"
APP_IMAGE="${APP_IMAGE:-cydb-submissions:dev}"
MANTICORE_IMAGE="${MANTICORE_IMAGE:-manticoresearch/manticore:25.0.0}"

APP_PORT="${APP_PORT:-3000}"            # http://localhost:$APP_PORT
MANTICORE_PORT="${MANTICORE_PORT:-9308}" # published so you can run the integration tests from the host

VOL_DB="${VOL_DB:-cydb-dev-db}"
VOL_ATTACH="${VOL_ATTACH:-cydb-dev-attachments}"
VOL_SEARCH="${VOL_SEARCH:-cydb-dev-manticore}"

APP_CTR="${POD_NAME}-app"
MANTICORE_CTR="${POD_NAME}-manticore"

# Dev credentials / secrets (override via env to taste).
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -hex 24)}"   # 48 hex chars (>=32 required)
ADMIN_EMAIL="${ADMIN_BOOTSTRAP_EMAIL:-admin@test.local}"   # needs a dotted domain — Better Auth's signUpEmail validator rejects bare 'admin@test'
ADMIN_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-dev-password-12345}"
DEV_AUTH_BYPASS="${DEV_AUTH_BYPASS:-admin@test.local:admin,worker@test.local:cfd_worker,clinician@test.local:clinician,super@test.local:admin+cfd_worker}"

# Flags
DO_BUILD=1
FRESH_DATA=1
DO_SEED=1
DO_DOWN=0

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"  "$c_off" "$*"; }
ok()   { printf '%s ✓ %s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s ! %s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
die()  { printf '%s ✗ %s %s\n' "$c_red"   "$c_off" "$*" >&2; exit 1; }

usage() { sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build)  DO_BUILD=0 ;;
    --keep-data) FRESH_DATA=0 ;;
    --no-seed)   DO_SEED=0 ;;
    --down)      DO_DOWN=1 ;;
    -h|--help)   usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# Run from the project root (this script lives there, next to Containerfile).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f Containerfile ] || die "Containerfile not found in $(pwd) — run this from the cydb-submissions directory."

# ---------------------------------------------------------------------------
# Preflight: Podman + its macOS VM
# ---------------------------------------------------------------------------
command -v podman >/dev/null 2>&1 || die "podman not found. Install it: brew install podman"

ensure_machine() {
  if podman info >/dev/null 2>&1; then return; fi
  log "Podman VM is not reachable — starting it (macOS runs Podman in a Linux VM)…"
  if ! podman machine inspect >/dev/null 2>&1; then
    log "No Podman machine exists yet — initialising one (one-time, downloads a VM image)…"
    podman machine init
  fi
  podman machine start || true
  # give the socket a moment, then verify
  for _ in $(seq 1 30); do podman info >/dev/null 2>&1 && break; sleep 1; done
  podman info >/dev/null 2>&1 || die "Could not reach the Podman VM. Try: podman machine start"
}

# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
teardown_pod() {
  if podman pod exists "$POD_NAME" 2>/dev/null; then
    log "Removing existing pod '$POD_NAME'…"
    podman pod rm -f "$POD_NAME" >/dev/null
  fi
}

teardown_volumes() {
  for v in "$VOL_DB" "$VOL_ATTACH" "$VOL_SEARCH"; do
    if podman volume exists "$v" 2>/dev/null; then
      log "Removing volume '$v'…"
      podman volume rm -f "$v" >/dev/null
    fi
  done
}

# ---------------------------------------------------------------------------
# Readiness polling
# ---------------------------------------------------------------------------
wait_for_manticore() {
  log "Waiting for Manticore on http://localhost:${MANTICORE_PORT}…"
  for _ in $(seq 1 60); do
    if curl -s "http://localhost:${MANTICORE_PORT}/sql" --data-urlencode 'query=SHOW TABLES' >/dev/null 2>&1; then
      ok "Manticore is up."
      return 0
    fi
    sleep 1
  done
  die "Manticore did not become ready. Check: podman logs ${MANTICORE_CTR}"
}

wait_for_app() {
  log "Waiting for the app to migrate, seed, boot, and report ready on http://localhost:${APP_PORT}/readyz…"
  log "${c_dim}(first boot runs Drizzle migrations + admin seed inside the container)${c_off}"
  for _ in $(seq 1 90); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/readyz" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then
      ok "App is ready (/readyz 200 — db, attachments, auth, and search all green)."
      return 0
    fi
    # Surface a crash early instead of waiting the full timeout.
    if ! podman container exists "$APP_CTR" 2>/dev/null || \
       [ "$(podman inspect -f '{{.State.Running}}' "$APP_CTR" 2>/dev/null || echo false)" != "true" ]; then
      warn "App container is not running. Last logs:"
      podman logs --tail 40 "$APP_CTR" 2>&1 | sed 's/^/    /' || true
      die "App container exited during startup."
    fi
    sleep 1
  done
  warn "App did not reach /readyz=200 within the timeout. Recent logs:"
  podman logs --tail 40 "$APP_CTR" 2>&1 | sed 's/^/    /' || true
  die "Startup timed out. A 503 from /readyz usually means the search check is failing — check ${MANTICORE_CTR} logs."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
ensure_machine

if [ "$DO_DOWN" = "1" ]; then
  teardown_pod
  teardown_volumes
  ok "Dev environment torn down (pod + data/search volumes removed)."
  exit 0
fi

log "Building the CYDB dev environment from scratch on Podman."
teardown_pod
if [ "$FRESH_DATA" = "1" ]; then
  teardown_volumes
else
  warn "--keep-data: reusing existing volumes (DB will keep prior data; migrations are idempotent)."
fi

# 1) App image
if [ "$DO_BUILD" = "1" ]; then
  log "Building app image '$APP_IMAGE' from Containerfile (npm ci + vite build — this can take a few minutes)…"
  podman build -t "$APP_IMAGE" -f Containerfile .
  ok "Built $APP_IMAGE"
else
  podman image exists "$APP_IMAGE" || die "--no-build set but image '$APP_IMAGE' does not exist. Run once without --no-build."
  warn "--no-build: reusing existing image $APP_IMAGE"
fi

# 2) Manticore image
log "Pulling search image '$MANTICORE_IMAGE' (if not already present)…"
podman pull "$MANTICORE_IMAGE" >/dev/null
ok "Have $MANTICORE_IMAGE"

# 3) Pod (publishes the app + Manticore ports at the pod level)
log "Creating pod '$POD_NAME' (app :${APP_PORT}, manticore :${MANTICORE_PORT})…"
podman pod create --name "$POD_NAME" \
  -p "${APP_PORT}:3000" \
  -p "${MANTICORE_PORT}:9308" >/dev/null
ok "Pod created"

# 4) Manticore sidecar — start first so the index is reachable when the app boots
#
# --user 999 (the image's `manticore` user) is REQUIRED under rootless Podman.
# The image entrypoint, when started as root, runs
#   find … /dev/stdout ! -user manticore -exec chown manticore:manticore
# before dropping privileges. Under rootless Podman /dev/stdout is a log pipe
# Podman owns, so that chown fails with EPERM and `set -eo pipefail` aborts the
# entrypoint (Exited 1) before searchd ever starts. OpenShift never hits this
# because it runs the pod as an arbitrary non-root UID; running as 999 here
# skips the root-only chown branch and mirrors that behaviour.
log "Starting Manticore sidecar container '$MANTICORE_CTR'…"
podman run -d --pod "$POD_NAME" --name "$MANTICORE_CTR" \
  --user 999 \
  --ulimit nofile=65536:65536 \
  -v "${VOL_SEARCH}:/var/lib/manticore" \
  "$MANTICORE_IMAGE" >/dev/null
wait_for_manticore

# 5) App container — its CMD runs migrate → seed-admin → node build
log "Starting app container '$APP_CTR'…"
podman run -d --pod "$POD_NAME" --name "$APP_CTR" \
  -e NODE_ENV=development \
  -e ORIGIN="http://localhost:${APP_PORT}" \
  -e DATABASE_URL=/data/db/local.db \
  -e ATTACHMENTS_DIR=/data/attachments \
  -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  -e ADMIN_BOOTSTRAP_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASSWORD" \
  -e DEV_AUTH_BYPASS="$DEV_AUTH_BYPASS" \
  -e MANTICORE_URL="http://localhost:9308" \
  -e SEARCH_RECONCILE_INTERVAL_MS=2000 \
  -e SEARCH_RECONCILE_BATCH=50 \
  -e OCR_WORKER_ENABLED=1 \
  -e OCR_PROVIDER=stub \
  -e MAIL_TRANSPORT=log \
  -v "${VOL_DB}:/data/db" \
  -v "${VOL_ATTACH}:/data/attachments" \
  "$APP_IMAGE" >/dev/null
wait_for_app

# 6) Optional: seed mock submissions so search has content (reconciler indexes them)
if [ "$DO_SEED" = "1" ]; then
  log "Seeding mock submissions (so search has data; reconciler will index them within ~2s)…"
  if podman exec \
       -e DATABASE_URL=/data/db/local.db \
       -e ATTACHMENTS_DIR=/data/attachments \
       "$APP_CTR" node scripts/seed-mock-submissions.mjs; then
    ok "Mock submissions seeded."
  else
    warn "Mock seeding failed (non-fatal). Seed manually with:"
    warn "  podman exec -e DATABASE_URL=/data/db/local.db ${APP_CTR} node scripts/seed-mock-submissions.mjs"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
cat <<EOF

${c_green}CYDB dev environment is up.${c_off}

  App         ${c_blue}http://localhost:${APP_PORT}${c_off}
  Readiness   http://localhost:${APP_PORT}/readyz   (200 = db + attachments + auth + search all healthy)
  Manticore   http://localhost:${MANTICORE_PORT}    (published for host-side integration tests)

  Sign in     Bootstrap admin:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}
              …or use the "Dev impersonation" panel on /login (one click per role):
              admin@test.local · worker@test.local · clinician@test.local · super@test.local
  Search      Sign in as admin/worker → /submissions → use the search box (try: aut*, "speech delay", @ocr_text vineland)

Useful commands:
  podman pod ps
  podman logs -f ${APP_CTR}                 # app logs (JSON per line; pipe to: | jq -c .)
  podman logs -f ${MANTICORE_CTR}           # search engine logs
  podman exec -it ${APP_CTR} sqlite3 /data/db/local.db
  MANTICORE_URL=http://localhost:${MANTICORE_PORT} ./node_modules/.bin/vitest --project server --run search-manticore-integration
  ./dev-up.sh --down                        # tear it all down

EOF
