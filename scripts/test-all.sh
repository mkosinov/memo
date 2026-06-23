#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.

set -euo pipefail

# Set CI=true so pnpm doesn't require TTY for module purge confirmation.
# Pre-push hook runs in non-TTY context (git push is not interactive).
export CI=true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🔍 Running local test suite..."

# 1. Lint
echo "  → lint..."
pnpm run lint

# 2. Type-check (admin app)
echo "  → type-check..."
if [ -f "frontend/admin/package.json" ] && \
   grep -q '"type-check"' frontend/admin/package.json; then
  (cd frontend/admin && pnpm run type-check)
else
  echo "  ⚠️  type-check script not found in frontend/admin/package.json (skip)"
fi

# 3. Vitest (admin unit tests)
echo "  → vitest..."
(cd frontend/admin && pnpm run test)

# 4. Playwright (admin E2E + visual regression)
# Unset CI for playwright — CI=true forces workers=1 + retries=1, which causes the
# process to hang when a test times out and the retry also fails.
# Pre-push wants standalone behaviour: workers=auto, retries=0, fail-fast.
echo "  → playwright (incl. visual regression)..."
(cd frontend/admin && CI= pnpm run test:e2e)

# 5. Visual compliance (against current-user-scenarios.md)
echo "  → visual-compliance-check..."
SPEC_FILE="$ROOT/docs/specs/2026-06-19-current-user-scenarios.md"
if [ ! -f "$SPEC_FILE" ]; then
  echo "  ⚠️  $SPEC_FILE not found; skipping visual compliance"
elif [ -x "$ROOT/superagents/scripts/visual-compliance-check.sh" ]; then
  # Allow overriding the dev server URL (useful for worktrees using non-default ports).
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

# 6. Backend pytest
echo "  → backend pytest..."
if [ -d "backend" ]; then
  (cd backend && uv run pytest)
else
  echo "  ⚠️  backend/ not found; skipping"
fi

echo "🚀 All checks passed."
