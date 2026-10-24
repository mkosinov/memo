#!/usr/bin/env bash
# test-e2e.sh — the web-e2e orchestrator (#513 Task 6).
#
# WEB mirror of scripts/test-all.sh (the donor), shrunk to one stack:
#   1. run identity — tag + 4 dynamic ports from the 28000-32700 window
#      (the dev-workflow port canon: 4 ports per tagged run; the lease
#      holds all four, the stack uses web+backend);
#   2. start scripts/e2e-stack.sh as a MANAGED child (it must not write
#      its own 2-port lease — #317 Fix A);
#   3. wait for the stack's READY marker;
#   4. run Playwright against the stack (E2E_STACK=1 → no webServer);
#   5. ALWAYS tear the stack down and release the lease (EXIT/INT/TERM).
#
# Tag: the task labels this family 'web513', but the lease canon mandates
# ^[0-9a-f]{6}$ — the stable hex rendering of the issue number is used:
# 000513. Override with WEB_E2E_RUN_TAG (also 6-hex) for parallel runs.
#
# Usage:
#   cd frontend/web && pnpm run test:e2e:stack      # or:
#   bash frontend/web/scripts/test-e2e.sh [playwright args...]
#   WEB_E2E_RUN_TAG=a1b2c3 bash frontend/web/scripts/test-e2e.sh  # parallel run
#
# NEVER touches: playground 3100/3101, admin shard ports 3002-3005, the
# notify pair 3006/8005, legacy dev 3000/8000 — ports come exclusively
# from the dynamic window via allocate_shard_ports.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIR="$ROOT_DIR/frontend/web"

export PATH="/root/.npm-global/bin:$PATH"

source "$ROOT_DIR/scripts/lib/shard-helpers.sh"

# ── Phase 1: start-clean (canon §3.3) ──────────────────────────────────────
LIVE_RUN_PORTS="$(sweep_dead_runs)"
_live_ports_filtered=""
for _p in $LIVE_RUN_PORTS; do
  [ "$_p" = "0" ] || _live_ports_filtered="$_live_ports_filtered $_p"
done
LIVE_RUN_PORTS="${_live_ports_filtered# }"

# ── Phase 2: run identity — tag + dynamic port allocation ─────────────────
WEB_E2E_RUN_TAG="${WEB_E2E_RUN_TAG:-000513}"
_tag_re='^[0-9a-f]{6}$'
if ! [[ "$WEB_E2E_RUN_TAG" =~ $_tag_re ]]; then
  echo "ERROR [test-e2e]: WEB_E2E_RUN_TAG must be 6 lowercase hex chars; got '$WEB_E2E_RUN_TAG'" >&2
  exit 1
fi
# A live lease for the SAME tag means a web stack is already up — fail
# loud instead of clobbering its lease/ports (use another tag to parallel).
if [ -e "${SHARD_RUNS_DIR}/${WEB_E2E_RUN_TAG}.run" ]; then
  echo "ERROR [test-e2e]: lease ${SHARD_RUNS_DIR}/${WEB_E2E_RUN_TAG}.run already exists — a web-e2e run with this tag is live. Wait for it or set WEB_E2E_RUN_TAG to another 6-hex tag." >&2
  exit 1
fi

echo "[test-e2e] allocating 4 ports from the 28000-32700 window (tag $WEB_E2E_RUN_TAG)..."
if ! ALLOC_PORTS="$(allocate_shard_ports $LIVE_RUN_PORTS)"; then
  echo "ERROR [test-e2e]: allocate_shard_ports failed — aborting before any run resources are created." >&2
  exit 1
fi
read -r WEB_PORT BACKEND_PORT RESERVED_P3 RESERVED_P4 <<< "$ALLOC_PORTS"
for _port in "$WEB_PORT" "$BACKEND_PORT" "$RESERVED_P3" "$RESERVED_P4"; do
  case "$_port" in
    ''|*[!0-9]*)
      echo "ERROR [test-e2e]: allocate_shard_ports returned a non-numeric port ('$_port') — aborting." >&2
      exit 1
      ;;
  esac
done

TEST_DB_PATH="backend/test_memo_web_${WEB_E2E_RUN_TAG}.db"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
LOG_DIR="${TMPDIR:-/tmp}/memo-web-e2e-logs/run-${WEB_E2E_RUN_TAG}"
mkdir -p "$LOG_DIR"

# The «тег/порты прогона» line (canon §3.1 requirement).
echo "🏷  web-e2e run tag: $WEB_E2E_RUN_TAG | web :$WEB_PORT | backend :$BACKEND_PORT | reserved :$RESERVED_P3 :$RESERVED_P4 | logs: $LOG_DIR"

# Orchestrator-owned 4-port lease (the child runs with SHARD_MANAGED_STACK=1
# and touches no lease — #317 Fix A).
if ! write_run_lease "$WEB_E2E_RUN_TAG" "$$" "$WEB_PORT" "$BACKEND_PORT" "$RESERVED_P3" "$RESERVED_P4"; then
  echo "ERROR [test-e2e]: cannot write run lease — aborting before the stack starts." >&2
  exit 1
fi

STACK_PID=""
cleanup() {
  if [ -n "$STACK_PID" ]; then
    echo "[test-e2e] Tearing down the stack (pid $STACK_PID)..."
    kill "$STACK_PID" 2>/dev/null || true
    # The stack's own traps do the masked-orphan sweep + child waits;
    # give it a moment, then make sure it is really gone.
    for _i in $(seq 1 20); do
      kill -0 "$STACK_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$STACK_PID" 2>/dev/null || true
    wait "$STACK_PID" 2>/dev/null || true
  fi
  remove_run_lease "$WEB_E2E_RUN_TAG"
  echo "[test-e2e] Lease ${WEB_E2E_RUN_TAG}.run released."
}
on_signal() {
  trap - EXIT
  cleanup
  exit $((128 + $1))
}
trap cleanup EXIT
trap 'on_signal 2' INT
trap 'on_signal 15' TERM

# ── Phase 3: the managed stack child ───────────────────────────────────────
STACK_LOG="$LOG_DIR/web-stack.log"
echo "[test-e2e] Starting the stack (log: $STACK_LOG)..."
WEB_PORT="$WEB_PORT" BACKEND_PORT="$BACKEND_PORT" \
  TEST_DB_PATH="$TEST_DB_PATH" \
  BACKEND_URL="$BACKEND_URL" NEXT_PUBLIC_API_URL="$BACKEND_URL" \
  SHARD_RUN_TAG="$WEB_E2E_RUN_TAG" SHARD_MANAGED_STACK=1 \
  bash "$WEB_DIR/scripts/e2e-stack.sh" >"$STACK_LOG" 2>&1 &
STACK_PID=$!

# Wait for the READY marker (stack boot: alembic + seed + next dev — up to
# ~4 min under load), bailing out as soon as the child dies.
READY_MARKER="WEB E2E STACK READY"
STACK_READY=false
for _i in $(seq 1 240); do
  if grep -q "$READY_MARKER" "$STACK_LOG" 2>/dev/null; then
    STACK_READY=true
    break
  fi
  if ! kill -0 "$STACK_PID" 2>/dev/null; then
    echo "ERROR [test-e2e]: the stack died during startup. Last log lines:" >&2
    tail -n 30 "$STACK_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
if [ "$STACK_READY" = false ]; then
  echo "ERROR [test-e2e]: the stack did not become ready in 240s. Last log lines:" >&2
  tail -n 30 "$STACK_LOG" >&2 || true
  exit 1
fi
echo "[test-e2e] Stack ready. Running Playwright..."

# ── Phase 4: Playwright against the stack ─────────────────────────────────
cd "$WEB_DIR"
set +e
E2E_STACK=1 \
WEB_PORT="$WEB_PORT" \
BACKEND_URL="$BACKEND_URL" NEXT_PUBLIC_API_URL="$BACKEND_URL" \
TEST_DB_PATH="$TEST_DB_PATH" \
SHARD_RUN_TAG="$WEB_E2E_RUN_TAG" \
pnpm exec playwright test "$@"
PLAYWRIGHT_RC=$?
set -e

if [ "$PLAYWRIGHT_RC" -eq 0 ]; then
  echo "[test-e2e] ✅ Playwright passed (rc 0)."
else
  echo "[test-e2e] ❌ Playwright failed (rc $PLAYWRIGHT_RC). Stack log: $STACK_LOG"
fi

exit "$PLAYWRIGHT_RC"
