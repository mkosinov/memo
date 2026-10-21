#!/usr/bin/env bash
# Per-shard E2E test server stack.
#
# Starts a FastAPI backend + Next.js frontend for ONE Playwright shard.
# Each shard gets its own DB, backend port, and frontend port.
#
# Environment variables (all required):
#   SHARD_ID          1-4 (determines DB path)
#   SHARD_PORT        Frontend port (e.g. 3002)
#   BACKEND_PORT      Backend port (e.g. 8001)
#   TEST_DB_PATH      Path to shard's SQLite DB (e.g. backend/test_memo_shard1.db)
#   BACKEND_URL       Backend URL for E2E factories (e.g. http://127.0.0.1:8001)
#   NEXT_PUBLIC_API_URL  Backend URL for browser (same as BACKEND_URL)
#
#   SHARD_RUN_TAG     Optional (#317): 6-lowercase-hex run tag. Set → all
#                    run resources get tag-suffixed names
#                    (.next-shard-<id>_<tag>, test_files_shard<id>_<tag>)
#                    and the script writes a manual-stack run lease (spec
#                    §3.3) removed on exit. Empty/unset (CI) → exact legacy
#                    names, no lease, zero behavior change.
#   SHARD_MANAGED_STACK  Optional (#317 Fix A): set non-empty by test-all.sh
#                    when IT starts this script (both shards). The
#                    orchestrator already wrote the 4-port run lease for
#                    the tag — a managed stack must NOT write its own
#                    2-port lease (last-writer-wins would clobber the
#                    orchestrator's, shrinking busy-protection to 2 of 4
#                    ports) and must NOT remove the orchestrator's lease
#                    on exit. Absent → manual mode, byte-identical lease
#                    behavior.
#
#   SHARD_STACK_WATCH_S  Optional (#448 Task 3): fail-fast watch interval
#                    in seconds while both servers are up (default 5,
#                    hard max 600; garbage/0/negative → default — see
#                    _watch_interval_s in shard-helpers.sh). Either
#                    server dying is detected within one interval.
#   SHARD_STACK_LOG  Optional (#448 Task 3): stack log path printed in
#                    the death diagnosis. Defaults to this script's own
#                    stdout target (fd 1 readlink) — exactly the
#                    $LOG_DIR/shard-stack-N.log the orchestrator
#                    redirects the whole stack into; a terminal/pipe run
#                    has no tail-able log → «log not created».
#
# Usage:
#   SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
#     TEST_DB_PATH=backend/test_memo_shard1.db \
#     BACKEND_URL=http://127.0.0.1:8001 \
#     NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
#     bash scripts/e2e-shard-start.sh
#
# The script:
#   1. Starts FastAPI backend on BACKEND_PORT
#   2. Waits for backend to be ready (Alembic runs during startup)
#   3. Seeds DB with test data (idempotent — safe if tables exist)
#   4. Starts Next.js frontend on SHARD_PORT
#   5. Waits for frontend to respond
#   6. Keeps running (frontend in foreground, backend in background)
#
# Playwright connects via reuseExistingServer: true.

set -euo pipefail

# ── Validate env vars ──────────────────────────────────────────────────────
for var in SHARD_ID SHARD_PORT BACKEND_PORT TEST_DB_PATH BACKEND_URL NEXT_PUBLIC_API_URL; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set" >&2
    exit 1
  fi
done

# GH #209 — fail fast on a SHARD_ID typo: it used to fall through to
# Playwright project resolution, where CI reported "0 spec files" far from
# the root cause. #415 (spec §3.2) — canonical shards are now 1-4 (four
# native CI shards); ports stay caller-provided (1→3002/8001 ...
# 4→3005/8004). Fail here, at the source.
case "$SHARD_ID" in
  1|2|3|4) ;;
  *)
    echo "ERROR: SHARD_ID must be 1–4 (canonical shards; got '$SHARD_ID')" >&2
    exit 1
    ;;
esac

# ── #317: optional run tag (spec §3.1) ──────────────────────────────────────
# Empty/unset (CI, legacy manual runs) → exact legacy resource names, no
# lease, zero behavior change. Set → must be 6 LOWERCASE hex chars: the tag
# lands in paths and the cleaners' rm-globs, so foreign chars (`/`, `*`,
# `..`, spaces) are excluded by format — the same ^[0-9a-f]{6}$ regex
# write_run_lease enforces. Fatal BEFORE any resource/dir creation.
SHARD_RUN_TAG="${SHARD_RUN_TAG:-}"
if [ -n "$SHARD_RUN_TAG" ]; then
  _run_tag_re='^[0-9a-f]{6}$'
  if ! [[ "$SHARD_RUN_TAG" =~ $_run_tag_re ]]; then
    echo "ERROR: SHARD_RUN_TAG must be 6 lowercase hex chars ([0-9a-f]{6}); got '$SHARD_RUN_TAG'" >&2
    exit 1
  fi
fi

# #317 Fix A: non-empty → MANAGED stack — the run-lease lifecycle for this
# tag belongs to the orchestrator (test-all.sh wrote the 4-port lease and
# removes it in its own EXIT trap). Checked at the lease write below and in
# remove_own_lease. Children inherit the flag via env; no consumer exists
# downstream (manual mode never sets it).
SHARD_MANAGED_STACK="${SHARD_MANAGED_STACK:-}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ADMIN_DIR="$ROOT_DIR/frontend/admin"

export PATH="/root/.npm-global/bin:$PATH"

# Export env vars so child processes (uvicorn, next dev, Playwright later)
# inherit them; #317: SHARD_RUN_TAG too (spec §3.4 — the TS side reads it).
export SHARD_ID SHARD_PORT BACKEND_PORT TEST_DB_PATH BACKEND_URL NEXT_PUBLIC_API_URL SHARD_RUN_TAG

# #317: run-lease helpers (write_run_lease/remove_run_lease, spec §3.3).
# Definitions-only at source time — the lease calls below are gated on a
# non-empty SHARD_RUN_TAG, so untagged (CI) runs get zero extra behavior.
source "$ROOT_DIR/scripts/lib/shard-helpers.sh"

# Isolated build dir per shard (#264): next.config.mjs reads NEXT_DIST_DIR for
# its distDir, so each shard compiles into its own build dir. This script is
# the SOLE producer of NEXT_DIST_DIR — shards never touch the default build
# dir, so no wipe or port-guard for it is needed here.
# #317 (spec §3.1): a tagged run appends _${SHARD_RUN_TAG}; an empty tag
# keeps the EXACT legacy name — the CI path is byte-identical.
if [ -n "$SHARD_RUN_TAG" ]; then
  export NEXT_DIST_DIR=".next-shard-${SHARD_ID}_${SHARD_RUN_TAG}"
else
  export NEXT_DIST_DIR=".next-shard-${SHARD_ID}"
fi

# Resolve TEST_DB_PATH to absolute path for the seed script
ABS_DB_PATH="$TEST_DB_PATH"
if [[ ! "$ABS_DB_PATH" = /* ]]; then
  ABS_DB_PATH="$ROOT_DIR/$ABS_DB_PATH"
fi
export DATABASE_URL="sqlite+aiosqlite:///$ABS_DB_PATH"

# GH #262 §6 — test-scoped avatar storage (FILES_DIR). Mirrors
# e2e/fixtures/seed-reset.ts:resolveTestFilesDir (SHARD_ID branch) so the
# backend serves/writes portraits into the SAME dir the Playwright reset wipes.
# Shards must NOT share the dev ./files dir or each other's (cross-shard
# avatar leaks + a wipe racing a live upload). Cwd-relative like DATABASE_URL;
# uvicorn runs from $BACKEND_DIR, so resolve to an absolute path.
# #317 (spec §3.1): a tagged run uses test_files_shard<id>_<tag>; an empty
# tag keeps the EXACT legacy name (CI byte-identical).
if [ -n "$SHARD_RUN_TAG" ]; then
  ABS_FILES_DIR="$ROOT_DIR/backend/test_files_shard${SHARD_ID}_${SHARD_RUN_TAG}"
else
  ABS_FILES_DIR="$ROOT_DIR/backend/test_files_shard${SHARD_ID}"
fi
export FILES_DIR="$ABS_FILES_DIR"
export TEST_FILES_DIR="$ABS_FILES_DIR"
echo "[shard-$SHARD_ID] Files dir: $ABS_FILES_DIR"

# ── #317: manual-stack run lease (spec §3.3) ───────────────────────────────
# A tagged MANUAL stack writes the same 8-field lease test-all.sh writes,
# zero-padding the two port slots it does not use (a manual stack has only
# SHARD_PORT + BACKEND_PORT): `pid tag SHARD_PORT BACKEND_PORT 0 0 epoch`.
# PID is our own $$ — this script lives as long as the stack (the frontend
# runs in foreground), so lease liveness == stack liveness for
# sweep_dead_runs/audit_orphan_tagged. Written after env validation (incl.
# the tag check above) but BEFORE any server starts; removed on exit by
# remove_own_lease (wired into the traps below — idempotent).
# Fix A: a MANAGED stack (SHARD_MANAGED_STACK set by test-all.sh) touches
# NO lease in either direction — the orchestrator's 4-port lease for this
# tag already exists, and this stack's own 2-port write would clobber it
# (last-writer-wins) while its exit trap would remove the orchestrator's
# lease mid-run.
if [ -n "$SHARD_RUN_TAG" ] && [ -z "$SHARD_MANAGED_STACK" ]; then
  if ! write_run_lease "$SHARD_RUN_TAG" "$$" "$SHARD_PORT" "$BACKEND_PORT" 0 0; then
    echo "[shard-$SHARD_ID] ERROR: cannot write run lease ${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run — aborting before servers start" >&2
    exit 1
  fi
  echo "[shard-$SHARD_ID] Run lease: ${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run (pid $$, ports $SHARD_PORT $BACKEND_PORT 0 0)"
elif [ -n "$SHARD_RUN_TAG" ]; then
  echo "[shard-$SHARD_ID] Managed stack (SHARD_MANAGED_STACK set) — lease ${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run is the orchestrator's; not writing it"
fi

# #317: remove THIS run's own lease on exit — idempotent (file-presence
# guard makes untagged runs, double trap fires and already-removed leases
# no-ops); foreign leases are never touched. Fix A: a managed stack owns
# NO lease — early return (the orchestrator removes its own).
remove_own_lease() {
  if [ -n "${SHARD_MANAGED_STACK:-}" ]; then
    return 0
  fi
  if [ -n "${SHARD_RUN_TAG:-}" ] && [ -e "${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run" ]; then
    remove_run_lease "$SHARD_RUN_TAG"
  fi
}

echo "[shard-$SHARD_ID] Starting stack: frontend=:$SHARD_PORT backend=:$BACKEND_PORT db=$ABS_DB_PATH"

# #152: wipe shard DB so seed runs on an empty schema. alembic recreates
# the schema on backend startup; seed then populates with current-week
# dates. Without this, idempotent seed skip leaves ev_* on past weeks.
# Guard: refuse to delete non-test DBs (e.g. dev memo.db).
if [[ "$ABS_DB_PATH" != *"test_memo"* ]]; then
  echo "[shard-$SHARD_ID] ERROR: refusing to delete non-test DB: $ABS_DB_PATH" >&2
  echo "[shard-$SHARD_ID]        TEST_DB_PATH must contain 'test_memo' (e.g. backend/test_memo_shard1.db)" >&2
  exit 1
fi
rm -f "$ABS_DB_PATH"
echo "[shard-$SHARD_ID] Wiped shard DB: $ABS_DB_PATH"

# GH #262 §6 — wipe the shard's avatars dir together with the DB (only after
# the test-DB guard above passes, so a rejected run touches no storage) so the
# stack starts clean — seed users carry no avatars. The backend re-creates
# FILES_DIR/avatars on boot (main.py lifespan).
rm -rf "$ABS_FILES_DIR"

# GH #264 — stale .next poisoning is solved by NEXT_DIST_DIR build isolation
# (each shard compiles into its own .next-shard-<id>, exported above); the
# legacy port-guarded wipe of the shared frontend/admin/.next is retired.

# ── Start FastAPI backend ──────────────────────────────────────────────────
# Backend starts first so Alembic can create/migrate tables.
cd "$BACKEND_DIR"
ENV_FILE=.env.test DATABASE_URL="$DATABASE_URL" PYTHONPATH=src \
  uv run uvicorn src.main:app --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!
echo "[shard-$SHARD_ID] Backend PID: $BACKEND_PID"

# Cleanup on exit
cleanup() {
  echo "[shard-$SHARD_ID] Shutting down (backend PID: $BACKEND_PID)..."
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  remove_own_lease
}
trap cleanup EXIT INT TERM

# Wait for backend to be ready (max 60s — 2 parallel FastAPI/uicorn + alembic
# can take 10-30s each under load, allow plenty of headroom)
BACKEND_READY=false
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/docs" --max-time 10 2>/dev/null | grep -qE "^(2|3)"; then
    echo "[shard-$SHARD_ID] Backend ready on :$BACKEND_PORT"
    BACKEND_READY=true
    break
  fi
  sleep 1
done
if [ "$BACKEND_READY" = false ]; then
  echo "[shard-$SHARD_ID] ERROR: Backend failed to start on :$BACKEND_PORT" >&2
  exit 1
fi

# ── Seed DB (after backend starts — tables created by Alembic) ─────────────
# Seed is idempotent: checks existence before inserting.
# Uses Base.metadata.create_all as safety net (no-op if tables exist).
echo "[shard-$SHARD_ID] Seeding database..."
cd "$BACKEND_DIR" && DATABASE_URL="$DATABASE_URL" PYTHONPATH=src \
  uv run python -m seed.seed
echo "[shard-$SHARD_ID] Database seeded."

# ── GH #310: snapshot the canonical seed-reset script ──────────────────────
# The DB holds the pristine seed RIGHT NOW (wipe → schema → seed above), so
# this is the one moment the canon can be captured. The Playwright side
# (fixtures/seed-reset.ts) applies this file before every test — total
# restore of every table except audit_logs/sessions. Generation failure
# aborts the stack (set -e): a missing canon must fail loudly, and a stale
# file from a previous stack is removed by the generator itself.
python3 "$ROOT_DIR/scripts/gen_seed_canon.py" "$ABS_DB_PATH" "$ABS_DB_PATH.canon.sql"


# ── Start Next.js frontend ────────────────────────────────────────────────
cd "$ADMIN_DIR"
echo "[shard-$SHARD_ID] Starting frontend on :$SHARD_PORT..."
pnpm exec next dev -p "$SHARD_PORT" &
FRONTEND_PID=$!
echo "[shard-$SHARD_ID] Frontend PID: $FRONTEND_PID"

# Extend cleanup to also kill frontend, and (#448 Task 3) to sweep MASKED
# grandchild holders of THIS stack's ports: `next dev` re-execs into a
# next-server worker it does not propagate signals to — the orphan keeps
# the shard port LISTENing. The /proc resolver (listen_pairs) makes the
# re-titled holder visible, and _sweep_masked kills it iff the conjunction
# holds (args mask AND LISTEN on one of our ports — same masks/gates as
# cleanup_shards; a bare port kill is forbidden, an innocent process that
# grabbed a freed port between our TERM and the sweep is never touched).
STACK_FRONTEND_PORTS=("$SHARD_PORT")
STACK_BACKEND_PORTS=("$BACKEND_PORT")
_orig_cleanup() {
  echo "[shard-$SHARD_ID] Shutting down..."
  kill "$FRONTEND_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  _sweep_masked STACK_FRONTEND_PORTS "next dev -p $SHARD_PORT" "next dev -p $SHARD_PORT" "next-server (v"
  _sweep_masked STACK_FRONTEND_PORTS "next-server" "next dev -p $SHARD_PORT" "next-server (v"
  _sweep_masked STACK_BACKEND_PORTS "uvicorn" "uvicorn"
  remove_own_lease
}
# Signal-aware teardown (#448 Task 3): INT/TERM run the cleanup and exit
# 128+sig (precedent: test-all.sh on_signal). A handler that merely
# RETURNED would resume the watch loop below, which would see the
# TERM-killed children and report a bogus "died" verdict (exit 1) on every
# normal orchestrator teardown. remove_own_lease stays covered: the EXIT
# trap is cleared, but _orig_cleanup itself removes it (idempotent by
# design — double fires and pre-lease calls are no-ops).
_stack_on_signal() {
  trap - EXIT
  _orig_cleanup
  exit $((128 + $1))
}
trap _orig_cleanup EXIT
trap '_stack_on_signal 2' INT
trap '_stack_on_signal 15' TERM

# Wait for frontend to be ready (max 120s — 2 parallel Next.js dev servers
# can take 15-30s each under load, allow plenty of headroom.
# Use --max-time 30 for curl because Next.js dev server compiles routes
# on first request, which can take 20+ seconds.
for i in $(seq 1 120); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$SHARD_PORT/" --max-time 30 2>/dev/null | grep -qE "^(2|3)"; then
    echo "[shard-$SHARD_ID] Frontend ready on :$SHARD_PORT"
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "[shard-$SHARD_ID] ERROR: Frontend failed to start on :$SHARD_PORT" >&2
    exit 1
  fi
  sleep 1
done

# Force-compile all major routes by hitting them once
# Keep this list in sync with frontend/admin/e2e/fixtures/warmup-routes.ts
# (TS-side source of truth; bash can't import TS, so we keep a copy here).
echo "[shard-$SHARD_ID] Warming up routes..."
WARMUP_ROUTES=(
  "/"
  "/schedule"
  "/clients"
  "/records"
  "/services"
  "/staff"
  "/locations"
  "/tags"
  "/positions"
  "/photos"
)
for route in "${WARMUP_ROUTES[@]}"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$SHARD_PORT$route" --max-time 60 2>/dev/null || echo "000")
  echo "  [shard-$SHARD_ID] $route → $HTTP_CODE"
done

# ── #448 Task 3: stack log path for the death diagnosis ────────────────────
# The orchestrator redirects this whole script into $LOG_DIR/shard-stack-N.log
# and both servers inherit that stdout — their last words land there, so THAT
# file is "the stack log". Explicit SHARD_STACK_LOG wins (manual override /
# test seam); else resolve our own fd 1 (regular file only — a terminal or
# pipe run has no tail-able log); else empty → «log not created».
SHARD_STACK_LOG="${SHARD_STACK_LOG:-}"
if [ -z "$SHARD_STACK_LOG" ]; then
  # /proc/$$/fd/1, NOT /proc/self/fd/1: inside the command substitution
  # fd 1 is the capture pipe; $$ stays the script's pid, so its fd table
  # names the real stdout target.
  _fd1_target="$(readlink "/proc/$$/fd/1" 2>/dev/null || true)"
  case "$_fd1_target" in
    /*) [ -f "$_fd1_target" ] && SHARD_STACK_LOG="$_fd1_target" || true ;;
  esac
fi

echo "[shard-$SHARD_ID] Stack ready. Waiting for shutdown signal..."
# Fail-fast watch (#448 Task 3, spec §3.2): wait for EITHER server, not just
# the frontend. While both pins live (kill -0; bash reaps dead background
# children, so a reaped pin fails the probe), sleep one interval
# (SHARD_STACK_WATCH_S via _watch_interval_s). Death of either — backend
# checked first, first dead wins — prints the addressed verdict + the
# ALWAYS-printed stack-log path + a capped secrets-filtered tail
# (_capped_log_tail) and exits 1; the EXIT trap above still releases the
# lease and sweeps. bash 3.2: kill -0 polling, no `wait -n`.
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[shard-$SHARD_ID] ERROR: stack shard $SHARD_ID: backend died on :$BACKEND_PORT" >&2
    _capped_log_tail "$SHARD_STACK_LOG" >&2
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "[shard-$SHARD_ID] ERROR: stack shard $SHARD_ID: frontend died on :$SHARD_PORT" >&2
    _capped_log_tail "$SHARD_STACK_LOG" >&2
    exit 1
  fi
  sleep "$(_watch_interval_s "${SHARD_STACK_WATCH_S:-}")"
done
