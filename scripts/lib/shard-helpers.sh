# Sourced library for test-all.sh: shard orphan cleanup, build-dir wipe and
# the bounded EXIT-trap cleaner. NOT executable — always sourced:
#   source "$ROOT/scripts/lib/shard-helpers.sh"
#
# No `set -euo pipefail` here — the caller's flags apply (test-all.sh runs
# under `set -euo pipefail`). Every fallible command inside these functions
# is guarded (`|| true`, `if cmd;`) so `set -e` never aborts the caller from
# library code.
#
# Functions read shard ports from the caller's globals (no function
# arguments — tests override them before sourcing):
#   SHARD_FRONTEND_PORTS=(3002 3003)
#   SHARD_BACKEND_PORTS=(8001 8002)

CLEANUP_BUDGET_S=10

# ── Kill orphan processes from previous runs ───────────────────────────────
# Previous pre-push runs may have left Next.js/uvicorn processes on shard
# ports. Kill them to avoid EADDRINUSE and corrupted state.
kill_port_orphans() {
  for port in "${SHARD_FRONTEND_PORTS[@]}" "${SHARD_BACKEND_PORTS[@]}"; do
    # Find PIDs listening on this port and kill them
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "    killing orphan processes on port $port: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
  done
  sleep 2

  # Also kill any orphan shard-stack processes from previous runs (worktrees
  # etc.). Shard frontends run `next dev -p 3002/3003`; the forked next-server
  # child loses the port from its cmdline (process title overwrites it with
  # "next-server (vX)"), so match the parent chain and kill its children.
  # NEVER `pkill -f "next-server"` — it matches EVERY Next.js dev server,
  # including the dev stack on :3000/:3001 and unrelated host instances.
  local pid
  for pid in $(pgrep -f "next dev -p 300[2-3]" 2>/dev/null || true); do
    pkill -9 -P "$pid" 2>/dev/null || true   # forked next-server child
    kill -9 "$pid" 2>/dev/null || true       # pnpm wrapper / next dev parent
  done
  sleep 1
}

# ── Remove stale shard build dirs (unconditional, fail-fast) ──────────────
# Each shard compiles into frontend/admin/.next-shard-N (NEXT_DIST_DIR).
# Wiping them on every start makes the run deterministic: chunks are never
# inherited across runs. Unconditional — independent of port state (shards
# own these dirs exclusively; nobody else can hold them). Empty match set
# (clean machine, first run) is SUCCESS — nothing to remove.
wipe_shard_dirs() {
  local wiped=false dir
  shopt -s nullglob
  for dir in "$ROOT"/frontend/admin/.next-shard-*; do
    wiped=true
    if ! rm -rf "$dir"; then
      shopt -u nullglob
      echo "❌ Failed to remove stale shard build dir: $dir" >&2
      exit 1
    fi
  done
  shopt -u nullglob
  if [ "$wiped" = false ]; then
    echo "  → no shard build dirs to wipe (clean run)"
  fi
}

# ── Cleanup function for shard stacks (EXIT trap) ─────────────────────────
# Bounded ladder: TERM wrappers → budgeted wait → KILL survivors →
# port+cmdline sweep → remove shard DBs. Every step is bounded; nothing in
# the trap can hang the run.
cleanup_shards() {
  echo ""
  echo "Cleaning up shard stacks..."

  # TERM the wrappers (SHARD_BACKEND_PIDS holds the background subshell PIDs
  # from test-all.sh). TERM to the wrapper cascade-TERMs its tracked children
  # (the FastAPI backend, the `next dev` parent), but NOT the grandchild
  # next-server — `next dev` re-execs into a next-server child it does not
  # propagate signals to. The only way to finish such a survivor is the sweep
  # below (step 4); extending e2e-shard-start.sh's tracking to cover it would
  # mean hidden PGID machinery, rejected by spec §3.3.
  local pid port pids args alive
  if [ -n "${SHARD_BACKEND_PIDS:-}" ]; then
    for pid in "${SHARD_BACKEND_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi

  # Budgeted wait: poll liveness instead of unbounded `wait` (#122 — the
  # wrapper dies on TERM but the next-server grandchild can keep the wrapper's
  # wait from returning forever). Max CLEANUP_BUDGET_S seconds, 0.5s interval.
  local deadline=$((SECONDS + CLEANUP_BUDGET_S))
  alive=false
  if [ -n "${SHARD_BACKEND_PIDS:-}" ]; then
    while true; do
      alive=false
      for pid in "${SHARD_BACKEND_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
          alive=true
        fi
      done
      [ "$alive" = false ] && break
      [ "$SECONDS" -ge "$deadline" ] && break
      sleep 0.5
    done
  fi

  # Survivors get SIGKILL (kill -9 also breaks SIG_IGN-holding processes).
  if [ "$alive" = true ]; then
    for pid in "${SHARD_BACKEND_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  # Control sweep: port + command mask, never a bare port kill — if an
  # innocent process grabbed a shard port between our kills and the sweep,
  # a bare `lsof`-kill would murder it. `pgrep -f` cannot AND patterns, so
  # filtering by arguments is the second step (ps args check).
  #
  # Frontends: candidates `next dev -p 300[2-3]` — catches the next-server
  # grandchild holding the listening socket if its parent chain died on TERM.
  # NEVER `pkill -f "next-server"` — it matches EVERY Next.js dev server,
  # including the dev stack on :3000/:3001 and unrelated host instances.
  for pid in $(pgrep -f "next dev -p 300[2-3]" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *"next dev"*)
        for port in "${SHARD_FRONTEND_PORTS[@]}"; do
          if lsof -ti :"$port" 2>/dev/null | grep -qx "$pid"; then
            kill -9 "$pid" 2>/dev/null || true
            break
          fi
        done
        ;;
    esac
  done

  # Backends: candidates `uvicorn`, keep only shard ones (test DB name in
  # args) that hold a shard backend port.
  for pid in $(pgrep -f "uvicorn" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *test_memo_shard*)
        for port in "${SHARD_BACKEND_PORTS[@]}"; do
          if lsof -ti :"$port" 2>/dev/null | grep -qx "$pid"; then
            kill -9 "$pid" 2>/dev/null || true
            break
          fi
        done
        ;;
    esac
  done

  # Remove per-shard DB copies (master DB is kept)
  rm -f "$ROOT"/backend/test_memo_shard*.db

  return 0
}
