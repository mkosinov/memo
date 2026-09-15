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

# ── Внутренний хелпер: свип «порт + маска команды» ─────────────────────────
# Использование: _sweep_masked PORTS_VAR PGPATTERN GATE1 [GATE2 ...]
#   PORTS_VAR — имя глобала-массива портов (SHARD_FRONTEND_PORTS/...);
#   PGPATTERN — pgrep -f шаблон кандидатов (номинация, не приговор);
#   GATE*     — подстроки, хотя бы одна из которых должна быть в ps args.
# Убийство только при конъюнкции: args содержит маску И pid держит порт из
# списка. Голый lsof-килл без маски в уборщике запрещён (гонка с невиновным
# займётом порта); держатели без порта и порты без маски не трогаются.
# bash 3.2-совместимо: имя массива читается через eval-косвенность.
_sweep_masked() {
  local ports_var="$1" pgpat="$2"; shift 2
  local pid args port
  for pid in $(pgrep -f "$pgpat" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    local matched=false gate
    for gate in "$@"; do
      case "$args" in
        *"$gate"*) matched=true; break ;;
      esac
    done
    [ "$matched" = true ] || continue
    # Индирекция по имени: ports_var указывает на массив портов вызывающего.
    for port in $(eval "printf '%s\n' \"\${${ports_var}[@]}\""); do
      if lsof -ti :"$port" 2>/dev/null | grep -qx "$pid"; then
        kill -9 "$pid" 2>/dev/null || true
        break
      fi
    done
  done
}

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
  # ps-args gate: pkill -P fires only for PIDs whose args really contain the
  # shard mask, so a stray pgrep match (e.g. an editor grep buffer) never
  # gets its children murdered here.
  local pid args
  for pid in $(pgrep -f "next dev -p 300[2-3]" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *"next dev -p 300"[2-3]*)
        pkill -9 -P "$pid" 2>/dev/null || true   # forked next-server child
        kill -9 "$pid" 2>/dev/null || true       # pnpm wrapper / next dev parent
        ;;
    esac
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
  # a bare `lsof`-kill would murder it. Two-step match (pgrep -f cannot AND):
  # pgrep only *nominates* candidates; the ps-args gate + port-hold check is
  # the kill decision.
  #
  # Frontends: the socket-holding orphan grandchild rewrites its process
  # title (`process.title = "next-server (vX)"`) BEFORE server.listen(), so
  # its args contain NO "next dev" — the mask must also accept the title
  # form. Candidates come from both pgrep patterns; the gate for the dev-form
  # is derived from the port list (ps args contain `next dev -p <port>`),
  # so it matches real argv and honours test-override ports. The port hold
  # (lsof on a shard port) is the discriminator — a next-server holding NO
  # shard port is never touched. NEVER `pkill -f "next-server"` — a blanket
  # kill would take down every Next.js dev server, incl. :3000/:3001.
  local fgate=()
  for port in "${SHARD_FRONTEND_PORTS[@]}"; do
    fgate+=("next dev -p $port")
  done
  fgate+=("next-server (v")
  _sweep_masked SHARD_FRONTEND_PORTS "next dev -p 300[2-3]" "${fgate[@]}"
  _sweep_masked SHARD_FRONTEND_PORTS "next-server" "${fgate[@]}"

  # Backends: real shard backends run as `uv run uvicorn src.main:app ...`;
  # the test DB name lives in DATABASE_URL env, not in argv — so argv cannot
  # discriminate shard uvicorns from any other, and the port hold is the
  # discriminator (shard backends listen on SHARD_BACKEND_PORTS only).
  _sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"

  # Remove per-shard DB copies (master DB is kept)
  rm -f "$ROOT"/backend/test_memo_shard*.db

  return 0
}
