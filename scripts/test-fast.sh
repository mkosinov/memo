#!/usr/bin/env bash
# Fast pre-push test suite — runs in ~1-2 min.
#
# Use for pre-push hook and local quick verification.
# For full suite (incl. Playwright E2E + visual regression), use test-all.sh
# or `pnpm test:all` in CI.
#
# What's included:
#   - lint (turbo, cached on incremental)
#   - type-check (admin app)
#   - vitest (admin unit tests)
#   - backend pytest (runs in parallel with frontend steps)
#
# What's NOT included (moved to test-all.sh / CI):
#   - Playwright E2E tests (~13 min, env issues with multi-worker)
#   - Visual compliance / regression screenshots
#
# Env vars:
#   FULL_TESTS=1   Run the full suite (delegates to test-all.sh) instead.
#                   Used by pre-push hook when a more thorough check is wanted
#                   before merging to main.

set -euo pipefail

export CI=true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${TMPDIR:-/tmp}/test-fast-logs"
mkdir -p "$LOG_DIR"

echo "⚡ Running fast test suite (pre-push)..."

# Delegate to full suite if requested
if [ "${FULL_TESTS:-0}" = "1" ]; then
  exec "$ROOT/scripts/test-all.sh"
fi

# ── Backend pytest (parallel with frontend) ───────────────────────────────
PYTEST_PID=""
if [ -d "backend" ]; then
  echo "  → backend pytest (parallel)..."
  (
    cd backend && uv run pytest > "$LOG_DIR/pytest.log" 2>&1
  ) &
  PYTEST_PID=$!
else
  echo "  ⚠️  backend/ not found; skipping"
fi

# ── Frontend: lint → typecheck → vitest (sequential) ─────────────────────
echo "  → lint..."
pnpm run lint

echo "  → type-check..."
if [ -f "frontend/admin/package.json" ] && \
   grep -q '"type-check"' frontend/admin/package.json; then
  (cd frontend/admin && pnpm run type-check)
else
  echo "  ⚠️  type-check script not found in frontend/admin/package.json (skip)"
fi

echo "  → vitest..."
(cd frontend/admin && pnpm run test)

# ── Wait for parallel backend pytest ──────────────────────────────────────
if [ -n "$PYTEST_PID" ]; then
  if ! wait "$PYTEST_PID"; then
    echo "❌ Backend pytest failed. See $LOG_DIR/pytest.log"
    tail -30 "$LOG_DIR/pytest.log" || true
    exit 1
  fi
fi

echo "⚡ Fast checks passed. (For Playwright + visual: pnpm test:all)"
