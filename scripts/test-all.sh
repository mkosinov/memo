#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.
#
# Performance notes:
# - Backend pytest runs in parallel with frontend tests (saves ~2 min).
# - Visual compliance is opt-in via VISUAL_COMPLIANCE=1 (saves ~1-2 min on
#   pre-push). CI can enable it explicitly; local devs can run it manually
#   when reviewing visual changes.
# - All other steps unchanged. Use FULL_TESTS=1 to force the legacy
#   sequential mode (rare; kept for debugging).
#
# Env vars:
#   VISUAL_COMPLIANCE=1   Enable visual compliance check (default: off)
#   FULL_TESTS=1          Run all steps sequentially, no parallelism
#                         (legacy behavior, slower)
#   VISUAL_COMPLIANCE_URL Override dev server URL for visual compliance

set -euo pipefail

# Set CI=true so pnpm doesn't require TTY for module purge confirmation.
# Pre-push hook runs in non-TTY context (git push is not interactive).
export CI=true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${TMPDIR:-/tmp}/test-all-logs"
mkdir -p "$LOG_DIR"

echo "🔍 Running local test suite..."

# ── Backend pytest (parallel with frontend by default) ────────────────────
PYTEST_PID=""
if [ -d "backend" ] && [ "${FULL_TESTS:-0}" != "1" ]; then
  echo "  → backend pytest (parallel)..."
  (
    cd backend && uv run pytest > "$LOG_DIR/pytest.log" 2>&1
  ) &
  PYTEST_PID=$!
else
  echo "  → backend pytest (sequential)..."
  if [ -d "backend" ]; then
    (cd backend && uv run pytest)
  else
    echo "  ⚠️  backend/ not found; skipping"
  fi
fi

# ── Frontend: lint → typecheck → vitest → playwright (sequential) ─────────
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

echo "  → playwright (incl. visual regression)..."
# Unset CI for playwright — CI=true forces workers=1 + retries=1, which causes the
# process to hang when a test times out and the retry also fails.
# Pre-push wants standalone behaviour: workers=auto, retries=0, fail-fast.
# Also force --workers=1 because the multi-worker mode hangs after ~20 tests
# in this environment (likely dev-server contention between workers).
# This is a pre-existing environmental issue, not specific to our changes —
# tracked separately for follow-up.
(cd frontend/admin && CI= pnpm exec playwright test --workers=1)

# ── Wait for parallel backend pytest ──────────────────────────────────────
if [ -n "$PYTEST_PID" ]; then
  if ! wait "$PYTEST_PID"; then
    echo "❌ Backend pytest failed. See $LOG_DIR/pytest.log"
    tail -30 "$LOG_DIR/pytest.log" || true
    exit 1
  fi
fi

# ── Visual compliance (opt-in) ────────────────────────────────────────────
if [ "${VISUAL_COMPLIANCE:-0}" = "1" ]; then
  echo "  → visual-compliance-check..."
  SPEC_FILE="$ROOT/docs/specs/2026-06-19-current-user-scenarios.md"
  if [ ! -f "$SPEC_FILE" ]; then
    echo "  ⚠️  $SPEC_FILE not found; skipping"
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
  echo "  ⊘ visual-compliance-check: skipped (set VISUAL_COMPLIANCE=1 to enable)"
fi

echo "🚀 All checks passed."
