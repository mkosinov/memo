#!/usr/bin/env bash
# Shell-level dry-run test for e2e-shard-start.sh wipe + path guard.
#
# Spec: docs/specs/2026-07-20-seed-staleness-152-design.md (items A, R-1, R-5)
#
# We do NOT start real backend/frontend. Instead we stub `uv`, `pnpm`, `curl`
# on PATH so the script exits early. The `uv` stub reports whether the DB
# file referenced by DATABASE_URL is present at the moment it is invoked
# (which is AFTER the wipe, so a working wipe → "FILE_ABSENT").

set -euo pipefail

# Resolve script directory regardless of caller's cwd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARD_SCRIPT="$REPO_ROOT/scripts/e2e-shard-start.sh"

if [ ! -f "$SHARD_SCRIPT" ]; then
  echo "FATAL: shard script not found at $SHARD_SCRIPT" >&2
  exit 1
fi

# Per-run isolated work + stubs dirs
WORK="$(mktemp -d -t shard-dryrun-XXXXXX)"
STUBS="$(mktemp -d -t shard-stub-XXXXXX)"
cleanup() {
  rm -rf "$WORK" "$STUBS"
}
trap cleanup EXIT

mkdir -p "$STUBS"

# uv stub: inspects $DATABASE_URL; reports file presence at invocation time.
cat > "$STUBS/uv" <<'EOF'
#!/bin/sh
# Intercept the call site that comes AFTER the wipe in e2e-shard-start.sh.
# If wipe worked → file gone → FILE_ABSENT.
# If wipe didn't work → file present → "FILE_PRESENT: <first 100 bytes>".
if [ -n "${DATABASE_URL:-}" ]; then
  FILE="${DATABASE_URL#sqlite+aiosqlite://}"
  if [ -f "$FILE" ]; then
    echo "FILE_PRESENT: $(head -c 100 "$FILE")"
  else
    echo "FILE_ABSENT"
  fi
else
  echo "NO_DATABASE_URL"
fi
exit 0
EOF
chmod +x "$STUBS/uv"

# pnpm + curl: trivial pass-throughs so the script doesn't hang on later steps.
printf '#!/bin/sh\nexit 0\n' > "$STUBS/pnpm"
printf '#!/bin/sh\nexit 0\n' > "$STUBS/curl"
chmod +x "$STUBS/pnpm" "$STUBS/curl"

FAIL=0

# ── Case 1: wipe removes the file before uv is invoked ────────────────────
TEST_DB="$WORK/test_memo_dryrun.db"
printf 'old data' > "$TEST_DB"
[ -f "$TEST_DB" ] || { echo "FATAL: failed to seed test DB" >&2; exit 1; }

set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$TEST_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  PATH="$STUBS:$PATH" \
  timeout 10 bash "$SHARD_SCRIPT" > "$WORK/run.log" 2>&1 || true
RUN_EXIT=$?
set -e

echo "── Case 1 log ──"
cat "$WORK/run.log"
echo "─────────────────"

if grep -q "FILE_ABSENT" "$WORK/run.log"; then
  echo "PASS Case 1: wipe removed the file before uv was invoked"
else
  echo "FAIL Case 1: expected FILE_ABSENT in log; wipe did not happen or stub did not intercept"
  FAIL=1
fi

# ── Case 2: path guard rejects non-test DBs ───────────────────────────────
set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="/tmp/memo.db" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  PATH="$STUBS:$PATH" \
  timeout 5 bash "$SHARD_SCRIPT" > "$WORK/guard.log" 2>&1
GUARD_EXIT=$?
set -e

echo "── Case 2 log ──"
cat "$WORK/guard.log"
echo "─────────────────"

if [ "$GUARD_EXIT" -ne 0 ] && grep -q "refusing to delete non-test DB" "$WORK/guard.log"; then
  echo "PASS Case 2: guard rejected non-test DB with diagnostic"
else
  echo "FAIL Case 2: expected non-zero exit + 'refusing to delete non-test DB' message"
  echo "  exit code: $GUARD_EXIT"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
