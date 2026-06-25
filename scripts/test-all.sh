#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.
#
# Parallelization strategy:
# - Backend pytest runs in parallel with frontend stages.
# - Lint, type-check, vitest, and 5 playwright shards all run in parallel.
# - Visual compliance runs last (needs dev server on :3001).
# - Total runtime ≈ max(stages) instead of sum, typically 6-8 min.
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

# ── Playwright shards in parallel (5 shards, each --workers=1) ─────────────
# Each shard runs as a separate process, all hitting the shared :3001 dev server.
# Total time = slowest shard (instead of sum of all shards).
echo "  → playwright (5 shards in parallel)..."
SHARDS=("shard-services" "shard-schedule" "shard-records" "shard-clients" "shard-rest")
for shard in "${SHARDS[@]}"; do
  (
    cd frontend/admin
    CI= pnpm exec playwright test --project="$shard" --workers=1 > "$LOG_DIR/pw-$shard.log" 2>&1
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
