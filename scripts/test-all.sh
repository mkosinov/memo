#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.
#
# Parallelization strategy:
# - Backend pytest runs in parallel with frontend stages.
# - Lint, type-check, vitest all run in parallel.
# - 5 Playwright shards run in PARALLEL, each with its own isolated stack:
#   * Its own SQLite DB (test_memo_shard{1-5}.db)
#   * Its own FastAPI backend (port 8001-8005)
#   * Its own Next.js frontend (port 3002-3006)
#   No cross-shard interference.
# - Visual compliance runs last (needs dev server on :3001).
# - Total runtime ≈ slowest shard setup + slowest shard tests.
#
# Env vars:
#   VISUAL_COMPLIANCE=0   Skip visual compliance check (default: 1, run it)
#   SEQUENTIAL=1          Run all stages sequentially (legacy, ~15 min).
#                         Used for debugging.
#   VISUAL_COMPLIANCE_URL Override dev server URL for visual compliance.

set -euo pipefail

# Set CI=true so pnpm doesn't require TTY for module purge confirmation.
# Pre-push hook runs in non-TTY context (git push is not interactive).
export CI=true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${TMPDIR:-/tmp}/test-all-logs"
mkdir -p "$LOG_DIR"

# Allow forcing legacy sequential mode
if [ "${SEQUENTIAL:-0}" = "1" ]; then
  echo "🔍 Running local test suite (SEQUENTIAL mode)..."

  echo "  → lint..."
  pnpm run lint
  echo "  → type-check..."
  (cd frontend/admin && pnpm run type-check)
  echo "  → vitest..."
  (cd frontend/admin && pnpm run test)
  echo "  → playwright..."
  (cd frontend/admin && CI= pnpm exec playwright test --workers=1)
  echo "  → backend pytest..."
  (cd backend && uv run pytest)
  if [ "${VISUAL_COMPLIANCE:-1}" != "0" ]; then
    echo "  → visual-compliance-check..."
    # ... (same as below)
  fi
  echo "🚀 All checks passed."
  exit 0
fi

echo "🔍 Running local test suite (PARALLEL mode)..."

# Track all background PIDs for waiting
ALL_PIDS=()

# ── Backend pytest (independent) ───────────────────────────────────────────
echo "  → backend pytest..."
(
  cd backend && uv run pytest > "$LOG_DIR/pytest.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Lint (turbo, cached) ──────────────────────────────────────────────────
echo "  → lint..."
pnpm run lint > "$LOG_DIR/lint.log" 2>&1 &
ALL_PIDS+=($!)

# ── Type-check (admin) ─────────────────────────────────────────────────────
echo "  → type-check..."
(
  cd frontend/admin && pnpm run type-check > "$LOG_DIR/typecheck.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Vitest (admin unit tests) ──────────────────────────────────────────────
echo "  → vitest..."
(
  cd frontend/admin && pnpm run test > "$LOG_DIR/vitest.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Playwright shards: per-shard DB + backend + frontend ───────────────────
# Each shard gets an isolated stack:
#   SHARD_ID=1 → DB: test_memo_shard1.db, backend: :8001, frontend: :3002
#   SHARD_ID=2 → DB: test_memo_shard2.db, backend: :8002, frontend: :3003
#   ...
#   SHARD_ID=5 → DB: test_memo_shard5.db, backend: :8005, frontend: :3006
#
# This eliminates cross-shard DB interference entirely.
# Each stack runs via scripts/e2e-shard-start.sh which:
#   1. Seeds the DB (if empty)
#   2. Starts FastAPI on BACKEND_PORT
#   3. Starts Next.js on SHARD_PORT (foreground)
#
# Playwright connects via reuseExistingServer: true.

SHARD_PROJECTS=("shard-services" "shard-schedule" "shard-records" "shard-clients" "shard-rest")
SHARD_BACKEND_PORTS=(8001 8002 8003 8004 8005)
SHARD_FRONTEND_PORTS=(3002 3003 3004 3005 3006)

echo "  → preparing per-shard databases..."
# Ensure sqlite3 is available
if ! command -v sqlite3 &>/dev/null; then
  echo "❌ sqlite3 not found — required for per-shard DB setup" >&2
  exit 1
fi

# Create master DB with seed data (idempotent — only if missing or empty)
MASTER_DB="backend/test_memo.db"
if [ ! -f "$MASTER_DB" ] || [ "$(sqlite3 "$MASTER_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo 0)" -lt 5 ]; then
  echo "  → seeding master test DB..."
  (
    cd backend
    DATABASE_URL="sqlite+aiosqlite:///$(pwd)/test_memo.db" \
      PYTHONPATH=src uv run python -m seed.seed
  )
fi

# Create per-shard DB copies from master
for i in $(seq 1 5); do
  SHARD_DB="backend/test_memo_shard${i}.db"
  cp "$MASTER_DB" "$SHARD_DB"
done
echo "  → per-shard DBs ready (5 copies of $MASTER_DB)"

# Cleanup function for shard stacks
SHARD_BACKEND_PIDS=()
cleanup_shards() {
  echo ""
  echo "Cleaning up shard stacks..."
  for pid in "${SHARD_BACKEND_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  # Remove per-shard DB copies (master DB is kept)
  rm -f backend/test_memo_shard*.db
}
trap cleanup_shards EXIT

# Start 5 shard stacks in parallel
echo "  → starting 5 shard stacks..."
for i in $(seq 0 4); do
  SHARD_NUM=$((i + 1))
  PROJECT="${SHARD_PROJECTS[$i]}"
  BACKEND_PORT="${SHARD_BACKEND_PORTS[$i]}"
  FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
  SHARD_DB="backend/test_memo_shard${SHARD_NUM}.db"
  BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

  (
    cd "$ROOT"
    SHARD_ID="$SHARD_NUM" \
    SHARD_PORT="$FRONTEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    TEST_DB_PATH="$SHARD_DB" \
    BACKEND_URL="$BACKEND_URL" \
    NEXT_PUBLIC_API_URL="$BACKEND_URL" \
      bash scripts/e2e-shard-start.sh
  ) > "$LOG_DIR/shard-stack-${SHARD_NUM}.log" 2>&1 &

  # Track the backend PID (parent of the startup script's children)
  # The startup script runs backend in background, frontend in foreground.
  # We need the backend PID for cleanup. Since the startup script backgrounds
  # the backend, we capture it from the log after a short delay.
  # For now, we kill the entire process group on cleanup.
  SHARD_BACKEND_PIDS+=($!)
done

# Wait for all shard stacks to be ready (check frontend ports)
echo "  → waiting for shard frontends to be ready..."
SHARD_READY=("" "" "" "" "")
# 5 parallel Next.js dev servers need more time to compile first request.
# --max-time 30 + 60 iterations = up to 30 min total (usually ~2-3 min).
for _ in $(seq 1 60); do
  ALL_READY=true
  for i in $(seq 0 4); do
    if [ "${SHARD_READY[$i]}" = "ready" ]; then continue; fi
    FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}/" --max-time 30 2>/dev/null | grep -qE "^(2|3)"; then
      SHARD_READY[$i]="ready"
      echo "    shard $((i + 1)) ready (frontend :${FRONTEND_PORT})"
    else
      ALL_READY=false
    fi
  done
  if [ "$ALL_READY" = true ]; then break; fi
  sleep 1
done
# Check for any shards that failed to start
for i in $(seq 0 4); do
  if [ "${SHARD_READY[$i]}" != "ready" ]; then
    echo "❌ Shard $((i + 1)) frontend failed to start on :${SHARD_FRONTEND_PORTS[$i]}"
    echo "   Check: $LOG_DIR/shard-stack-$((i + 1)).log"
    exit 1
  fi
done

# Extra buffer for Next.js compilation to stabilize
echo "  → waiting 30s for Next.js compilation to stabilize..."
sleep 30

# Run 5 Playwright shards in parallel, each against its own frontend
echo "  → running 5 Playwright shards in parallel..."
for i in $(seq 0 4); do
  SHARD_NUM=$((i + 1))
  PROJECT="${SHARD_PROJECTS[$i]}"
  FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
  BACKEND_PORT="${SHARD_BACKEND_PORTS[$i]}"
  BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
  SHARD_DB="backend/test_memo_shard${SHARD_NUM}.db"

  (
    cd frontend/admin
    SHARD_ID="$SHARD_NUM" \
    SHARD_PORT="$FRONTEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    TEST_DB_PATH="$ROOT/$SHARD_DB" \
    BACKEND_URL="$BACKEND_URL" \
    NEXT_PUBLIC_API_URL="$BACKEND_URL" \
    CI= pnpm exec playwright test --project="$PROJECT" --workers=1 \
      > "$LOG_DIR/pw-$PROJECT.log" 2>&1
  ) &
  ALL_PIDS+=($!)
done

# ── Wait for all parallel stages ───────────────────────────────────────────
FAIL=0
for pid in "${ALL_PIDS[@]}"; do
  if ! wait "$pid"; then
    FAIL=1
  fi
done

if [ $FAIL -ne 0 ]; then
  echo ""
  echo "❌ One or more test stages failed. Failed PIDs:"
  # Just list all log files — the exit codes already tell us which failed
  for log in "$LOG_DIR"/*.log; do
    echo "  → $(basename "$log")"
  done
  exit 1
fi

# ── Visual compliance (needs dev server, runs after parallel stages) ──────
if [ "${VISUAL_COMPLIANCE:-1}" != "0" ]; then
  echo "  → visual-compliance-check..."
  SPEC_FILE="$ROOT/docs/specs/2026-06-19-current-user-scenarios.md"
  if [ ! -f "$SPEC_FILE" ]; then
    echo "  ⚠️  $SPEC_FILE not found; skipping visual compliance"
  elif [ -x "$ROOT/superagents/scripts/visual-compliance-check.sh" ]; then
    VISUAL_COMPLIANCE_URL="${VISUAL_COMPLIANCE_URL:-http://localhost:3001}"
    "$ROOT/superagents/scripts/visual-compliance-check.sh" \
      "$VISUAL_COMPLIANCE_URL" \
      "$SPEC_FILE" \
      /tmp/visual-compliance \
      mobile || {
        echo "❌ Visual compliance failed. See /tmp/visual-compliance/report.md"
        exit 1
      }
  else
    echo "  ⚠️  visual-compliance-check.sh not found; skipping"
  fi
else
  echo "  ⊘ visual-compliance-check: skipped (VISUAL_COMPLIANCE=0)"
fi

echo "🚀 All checks passed."
