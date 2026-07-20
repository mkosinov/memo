#!/usr/bin/env bash
# Per-shard E2E test server stack.
#
# Starts a FastAPI backend + Next.js frontend for ONE Playwright shard.
# Each shard gets its own DB, backend port, and frontend port.
#
# Environment variables (all required):
#   SHARD_ID          1-2 (determines DB path)
#   SHARD_PORT        Frontend port (e.g. 3002)
#   BACKEND_PORT      Backend port (e.g. 8001)
#   TEST_DB_PATH      Path to shard's SQLite DB (e.g. backend/test_memo_shard1.db)
#   BACKEND_URL       Backend URL for E2E factories (e.g. http://127.0.0.1:8001)
#   NEXT_PUBLIC_API_URL  Backend URL for browser (same as BACKEND_URL)
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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ADMIN_DIR="$ROOT_DIR/frontend/admin"

export PATH="/root/.npm-global/bin:$PATH"

# Export env vars so child processes (uvicorn, next dev) inherit them
export SHARD_ID SHARD_PORT BACKEND_PORT TEST_DB_PATH BACKEND_URL NEXT_PUBLIC_API_URL

# Resolve TEST_DB_PATH to absolute path for the seed script
ABS_DB_PATH="$TEST_DB_PATH"
if [[ ! "$ABS_DB_PATH" = /* ]]; then
  ABS_DB_PATH="$ROOT_DIR/$ABS_DB_PATH"
fi
export DATABASE_URL="sqlite+aiosqlite:///$ABS_DB_PATH"

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

# ── Start Next.js frontend ────────────────────────────────────────────────
cd "$ADMIN_DIR"
echo "[shard-$SHARD_ID] Starting frontend on :$SHARD_PORT..."
pnpm exec next dev -p "$SHARD_PORT" &
FRONTEND_PID=$!
echo "[shard-$SHARD_ID] Frontend PID: $FRONTEND_PID"

# Extend cleanup to also kill frontend
_orig_cleanup() {
  echo "[shard-$SHARD_ID] Shutting down..."
  kill "$FRONTEND_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap _orig_cleanup EXIT INT TERM

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
  "/masters"
  "/locations"
  "/tags"
  "/photos"
)
for route in "${WARMUP_ROUTES[@]}"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$SHARD_PORT$route" --max-time 60 2>/dev/null || echo "000")
  echo "  [shard-$SHARD_ID] $route → $HTTP_CODE"
done

echo "[shard-$SHARD_ID] Stack ready. Waiting for shutdown signal..."
# Block until killed by parent (test-all.sh cleanup)
wait "$FRONTEND_PID" 2>/dev/null || true
