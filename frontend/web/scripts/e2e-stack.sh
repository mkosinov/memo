#!/usr/bin/env bash
# Web-e2e test stack (#513 Task 6) — ONE FastAPI backend + ONE Next.js web
# server for the web Playwright project.
#
# WEB mirror of scripts/e2e-shard-start.sh (the donor). Deviations from the
# donor, each documented at its site:
#   - SHARD_ID is gone (the web project has exactly one stack per run);
#   - the frontend is frontend/web (not admin), port var is WEB_PORT;
#   - OTP_TRANSPORT=dev is exported for the backend: without a transport
#     POST /auth/otp/request is fail-closed 503 (#499 §4.2) and NO client
#     login can ever happen — the whole #513 fixture depends on it;
#   - the storageState login lives in Playwright globalSetup (the donor's
#     globalSetup does the same, minus the OTP flow).
#
# Environment variables (all required):
#   WEB_PORT          web dev-server port (from the 28000-32700 window)
#   BACKEND_PORT      backend port (from the same window)
#   TEST_DB_PATH      the run's SQLite DB (e.g. backend/test_memo_web_<tag>.db)
#   BACKEND_URL       backend URL for fixtures (http://127.0.0.1:<BACKEND_PORT>)
#   NEXT_PUBLIC_API_URL  backend URL for the browser (same as BACKEND_URL)
#
#   SHARD_RUN_TAG     optional (#317 canon): 6-lowercase-hex run tag. Set →
#                     tag-suffixed resources (DB is named by the caller,
#                     NEXT_DIST_DIR/test_files get the suffix) and a
#                     manual-stack run lease (removed on exit).
#   SHARD_MANAGED_STACK  set non-empty by scripts/test-e2e.sh when IT starts
#                     this script: the orchestrator already wrote the 4-port
#                     run lease for the tag — a managed stack must NOT write
#                     its own 2-port lease (last-writer-wins would clobber
#                     the orchestrator's) and must NOT remove it on exit.
#
# Usage (managed — the normal path):
#   bash scripts/test-e2e.sh        # allocates tag+ports, starts this script
# Usage (manual, tag + window ports):
#   WEB_PORT=… BACKEND_PORT=… TEST_DB_PATH=backend/test_memo_web_<tag>.db \
#     BACKEND_URL=http://127.0.0.1:… NEXT_PUBLIC_API_URL=http://127.0.0.1:… \
#     SHARD_RUN_TAG=<tag> bash scripts/e2e-stack.sh
#
# The script:
#   1. Starts FastAPI backend on BACKEND_PORT (fresh DB, Alembic on boot)
#   2. Seeds the DB (incl. the #513 cabinet delta)
#   3. Snapshots the seed canon (consumed by later #513 specs; GH #310)
#   4. Starts the Next.js web dev server on WEB_PORT (own NEXT_DIST_DIR)
#   5. Warms up / and /cabinet, prints the READY marker, keeps watching
#
# Playwright then runs SEPARATELY with E2E_STACK=1 (test-e2e.sh assembles
# the env). Teardown kills both servers, sweeps masked orphans (the donor's
# next-server re-exec problem, #448) and releases the lease.

set -euo pipefail

for var in WEB_PORT BACKEND_PORT TEST_DB_PATH BACKEND_URL NEXT_PUBLIC_API_URL; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR [web-e2e-stack]: $var is not set" >&2
    exit 1
  fi
done

# ── #317: optional run tag (same validation as the donor) ──────────────────
SHARD_RUN_TAG="${SHARD_RUN_TAG:-}"
if [ -n "$SHARD_RUN_TAG" ]; then
  _run_tag_re='^[0-9a-f]{6}$'
  if ! [[ "$SHARD_RUN_TAG" =~ $_run_tag_re ]]; then
    echo "ERROR [web-e2e-stack]: SHARD_RUN_TAG must be 6 lowercase hex chars ([0-9a-f]{6}); got '$SHARD_RUN_TAG'" >&2
    exit 1
  fi
fi
SHARD_MANAGED_STACK="${SHARD_MANAGED_STACK:-}"

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/frontend/web"

export PATH="/root/.npm-global/bin:$PATH"

# Export env so child processes (uvicorn, next dev) inherit them.
export WEB_PORT BACKEND_PORT TEST_DB_PATH BACKEND_URL NEXT_PUBLIC_API_URL SHARD_RUN_TAG

# Run-lease helpers (write_run_lease/remove_run_lease/_sweep_masked — the
# #317/#448 canon; definitions-only at source time).
source "$ROOT_DIR/scripts/lib/shard-helpers.sh"

# Isolated build dir (GH #264 pattern): web's next.config.mjs reads
# NEXT_DIST_DIR. STABLE name (no tag suffix — the admin tsconfig
# precedent): the web project runs ONE stack per run (the stable default
# tag's lease guard rejects a parallel same-tag run), so one e2e build
# dir is exact; a stable name also keeps Next's auto-appended
# `dist-e2e/types/**` tsconfig include stable across runs.
export NEXT_DIST_DIR="dist-e2e"

# Resolve TEST_DB_PATH to an absolute path for the seed script.
ABS_DB_PATH="$TEST_DB_PATH"
if [[ ! "$ABS_DB_PATH" = /* ]]; then
  ABS_DB_PATH="$ROOT_DIR/$ABS_DB_PATH"
fi
export DATABASE_URL="sqlite+aiosqlite:///$ABS_DB_PATH"

# Test-scoped avatar storage (GH #262 §6 pattern), tag-suffixed like the DB.
if [ -n "$SHARD_RUN_TAG" ]; then
  ABS_FILES_DIR="$ROOT_DIR/backend/test_files_web_${SHARD_RUN_TAG}"
else
  ABS_FILES_DIR="$ROOT_DIR/backend/test_files_web"
fi
export FILES_DIR="$ABS_FILES_DIR"
export TEST_FILES_DIR="$ABS_FILES_DIR"

# ── Manual-stack run lease (#317 spec §3.3 — donor semantics) ──────────────
if [ -n "$SHARD_RUN_TAG" ] && [ -z "$SHARD_MANAGED_STACK" ]; then
  if ! write_run_lease "$SHARD_RUN_TAG" "$$" "$WEB_PORT" "$BACKEND_PORT" 0 0; then
    echo "ERROR [web-e2e-stack]: cannot write run lease for tag ${SHARD_RUN_TAG} — aborting before servers start" >&2
    exit 1
  fi
  echo "[web-e2e] Run lease: ${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run (pid $$, ports $WEB_PORT $BACKEND_PORT 0 0)"
fi

remove_own_lease() {
  if [ -n "${SHARD_MANAGED_STACK:-}" ]; then
    return 0
  fi
  if [ -n "${SHARD_RUN_TAG:-}" ] && [ -e "${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run" ]; then
    remove_run_lease "$SHARD_RUN_TAG"
  fi
}

echo "[web-e2e] Starting stack: web=:$WEB_PORT backend=:$BACKEND_PORT db=$ABS_DB_PATH tag=${SHARD_RUN_TAG:-none}"

# Wipe the run DB so the seed populates a clean schema (#152 pattern);
# guard: refuse to delete non-test DBs.
if [[ "$ABS_DB_PATH" != *"test_memo"* ]]; then
  echo "ERROR [web-e2e-stack]: refusing to delete non-test DB: $ABS_DB_PATH" >&2
  echo "       TEST_DB_PATH must contain 'test_memo' (e.g. backend/test_memo_web_000513.db)" >&2
  exit 1
fi
rm -f "$ABS_DB_PATH" "$ABS_DB_PATH-shm" "$ABS_DB_PATH-wal"
echo "[web-e2e] Wiped run DB: $ABS_DB_PATH"

# Wipe the run's avatars dir together with the DB (GH #262 §6 pattern).
rm -rf "$ABS_FILES_DIR"

# ── Start FastAPI backend ──────────────────────────────────────────────────
# CORS (#499 §5): exact origins only — the web origin rides the REAL env
# var (overrides .env.test), so dynamic window ports work; both host
# spellings listed. OTP_TRANSPORT=dev: REQUIRED for the #513 login (see
# the header) — the dev transport also gates the response's dev_code echo,
# which the fixture deliberately does NOT use (the code is read from the
# DB). ENV stays at its default "development".
cd "$BACKEND_DIR"
ENV_FILE=.env.test DATABASE_URL="$DATABASE_URL" PYTHONPATH=src \
  CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT" \
  OTP_TRANSPORT=dev \
  uv run uvicorn src.main:app --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!
echo "[web-e2e] Backend PID: $BACKEND_PID"

cleanup() {
  echo "[web-e2e] Shutting down (web PID: ${FRONTEND_PID:-?}, backend PID: $BACKEND_PID)..."
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && wait "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  # Masked-orphan sweep (#448): next dev re-execs into a next-server
  # worker it does not propagate signals to — kill it only under the
  # donor's conjunction (args mask AND LISTEN on one of our ports).
  STACK_FRONTEND_PORTS=("$WEB_PORT")
  STACK_BACKEND_PORTS=("$BACKEND_PORT")
  _sweep_masked STACK_FRONTEND_PORTS "next dev -p $WEB_PORT" "next dev -p $WEB_PORT" "next-server (v"
  _sweep_masked STACK_FRONTEND_PORTS "next-server" "next dev -p $WEB_PORT" "next-server (v"
  _sweep_masked STACK_BACKEND_PORTS "uvicorn" "uvicorn"
  remove_own_lease
}
trap cleanup EXIT
# Signal-aware teardown (#448 donor lesson): INT/TERM run the cleanup and
# exit 128+sig. A handler that merely RETURNED would resume the watch
# loop below, which would see the TERM-killed children and report a
# bogus "died" verdict (exit 1) on every normal orchestrator teardown.
_stack_on_signal() {
  trap - EXIT
  cleanup
  exit $((128 + $1))
}
trap '_stack_on_signal 2' INT
trap '_stack_on_signal 15' TERM

# Wait for backend (Alembic runs during startup; 60s headroom like donor).
BACKEND_READY=false
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/docs" --max-time 10 2>/dev/null | grep -qE "^(2|3)"; then
    echo "[web-e2e] Backend ready on :$BACKEND_PORT"
    BACKEND_READY=true
    break
  fi
  sleep 1
done
if [ "$BACKEND_READY" = false ]; then
  echo "ERROR [web-e2e-stack]: Backend failed to start on :$BACKEND_PORT" >&2
  exit 1
fi

# ── Seed (after backend — Alembic created the tables) ──────────────────────
# EXPLICIT absolute DATABASE_URL (the seeder reads os.environ, not ENV_FILE).
echo "[web-e2e] Seeding database..."
cd "$BACKEND_DIR" && DATABASE_URL="$DATABASE_URL" PYTHONPATH=src \
  uv run python -m seed.seed
echo "[web-e2e] Database seeded."

# ── Seed canon snapshot (GH #310 pattern) ─────────────────────────────────
# Nothing consumes it in Task 6 (the smoke specs are read-only); the
# C-scenarios (Tasks 7-10) get per-test seed resets for free. Generation
# failure aborts (set -e): a missing canon must fail loudly when it IS
# consumed later.
python3 "$ROOT_DIR/scripts/gen_seed_canon.py" "$ABS_DB_PATH" "$ABS_DB_PATH.canon.sql"
echo "[web-e2e] Seed canon snapshotted."

# ── Start the Next.js web dev server ──────────────────────────────────────
cd "$WEB_DIR"
echo "[web-e2e] Starting web dev server on :$WEB_PORT..."
NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" pnpm exec next dev -p "$WEB_PORT" &
FRONTEND_PID=$!
echo "[web-e2e] Web PID: $FRONTEND_PID"

# Wait for web (max 120s; first compile can take 20s+).
WEB_READY=false
for i in $(seq 1 120); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$WEB_PORT/" --max-time 30 2>/dev/null | grep -qE "^(2|3)"; then
    echo "[web-e2e] Web ready on :$WEB_PORT"
    WEB_READY=true
    break
  fi
  sleep 1
done
if [ "$WEB_READY" = false ]; then
  echo "ERROR [web-e2e-stack]: web dev server failed to start on :$WEB_PORT" >&2
  exit 1
fi

# Warm up the routes #513 touches (dev compile on first hit).
for route in "/" "/cabinet"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$WEB_PORT$route" --max-time 60 2>/dev/null || echo "000")
  echo "  [web-e2e] $route → $HTTP_CODE"
done

# The greppable marker scripts/test-e2e.sh waits for.
echo "[web-e2e] WEB E2E STACK READY web=:$WEB_PORT backend=:$BACKEND_PORT db=$ABS_DB_PATH tag=${SHARD_RUN_TAG:-none}"

# Fail-fast watch (#448 pattern): either server dying ends the run.
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR [web-e2e-stack]: backend died on :$BACKEND_PORT" >&2
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "ERROR [web-e2e-stack]: web dev server died on :$WEB_PORT" >&2
    exit 1
  fi
  sleep 5
done
