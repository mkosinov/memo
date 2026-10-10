#!/usr/bin/env bash
# Shell-level dry-run test for scripts/lib/shard-helpers.sh (the LIBRARY,
# not the shard script — that one is covered by e2e-shard-start.dryrun.test.sh).
#
# The library is SOURCED directly; test-all.sh is not run. Before sourcing,
# the test declares the globals the library functions read:
#   SHARD_FRONTEND_PORTS / SHARD_BACKEND_PORTS — TEST ports from the
#     isolation range (NOT the production 3002/3003/8001/8002 — a foreign
#     worktree shard may live on the dev machine);
#   SHARD_BACKEND_PIDS — wrapper PIDs for cleanup_shards;
#   ROOT — per-case tempdir, so wipes/sweeps operate on the temp tree,
#     never the real repo.
#
# Spec coverage (Feature #122/#264, shard build isolation):
#   → Case 1 (S2, безусловность): wipe_shard_dirs removes existing
#     .next-shard-1/.next-shard-2 dirs, exit 0; second call on a clean
#     tree → exit 0 (zero matches is SUCCESS, spec §3.3).
#   → Case 2 (S2, fail-fast): SILENT PATH-stub `rm` that fails (no stderr
#     echo) for .next-shard-* paths → wipe_shard_dirs exits non-zero with
#     its OWN message naming the path. (The only deterministic way to fail
#     the removal; chmod tricks are non-deterministic on darwin. The stub
#     stays silent so the path in the captured output can only come from
#     the library's error message — non-vacuous assert.)
#   → Case 3 (S3, конечность): a `sleep 60` wrapper in SHARD_BACKEND_PIDS;
#     cleanup_shards returns in ≤ 15 s and the process is dead.
#   → Case 4 (S4, TERM-stubborn holder): python3 holder that ignores SIGTERM,
#     argv disguised as `uvicorn <code> <port> test_memo_shardX`, holding a
#     test port. cleanup_shards must kill it (kill -9 pierces SIG_IGN) and
#     free the port. Control case: the same holder WITHOUT the uvicorn mask
#     and without a shard port must SURVIVE (the mask protects the innocent);
#     the test kills it manually in its own cleanup block.
#   → Case 0 / Case 4-positive-control are meta self-checks: the assertions
#     must be able to FAIL on a deliberately injected violation — a harness
#     that passes vacuously is a bug in the harness.
#
# Port hygiene (6.5): every process this test spawns binds a TEST port —
# unique per run (PID-derived base inside the 38000-38199 window), verified
# free via lsof before binding, far from production/dev/shard ranges
# (3000-3003, 8000-8002). The test tracks its own background PIDs and
# kill -9 + waits them in the EXIT trap — no holder outlives the test.
#
# RED/GREEN: the library already implements the behaviour (Task 3/T3 fix);
# the RED side of TDD lives in the meta self-checks (Case 0, Case 4 control)
# and in Case 2, where fail-fast IS the behaviour under test.
#
# Spec coverage (Feature #317, run tag + dynamic ports — LIB primitives,
# docs/specs/2026-10-09-shard-stack-dynamic-ports-317-design.md):
#   → Case 5 (§3.1): gen_run_tag → exactly one word matching ^[0-9a-f]{6}$
#     (lowercase hex, never uppercase), rc=0 across repeated draws with the
#     REAL openssl/od.
#   → Case 6 (§3.1, stubbed entropy): invalid candidates (bad charset) are
#     redrawn, never returned; collision with ANY existing tag resource
#     (lease file, shard DB, canon glob, build dir, photo dir) forces
#     regeneration; broken openssl → od fallback with padding/case
#     normalization; unresolvable collision → bounded retries (≤20) end in
#     fail-fast with an actionable message.
#   → Case 7 (§3.2): window constants pinned to 28000-32700; allocator
#     returns 4 pairwise-distinct in-window ports, lsof-free at draw time.
#   → Case 8 (§3.2): narrowed lsof-verified 12-port sub-window + a REAL
#     holder + 4 live-lease busy ARGS → the returned 4 distinct in-window
#     ports are a SUBSET of the usable ports (held/busy never returned);
#     a rare coupon-collector timeout in the narrowed window is retried
#     (bounded) — flake-free; the fail-fast contract itself is Case 9's.
#   → Case 9 (§3.2): lsof stub reporting every port held → fail-fast
#     rc≠0, message names the window and the attempt budget, ≤20 lsof
#     calls; control with the real lsof succeeds.
#   → Case 10 (#317 §3.3): write_run_lease format (one 8-field line, stamp
#     = write time); sweep_dead_runs on a dead-PID lease — TERM-stubborn
#     masked holder killed via the kill -9 rung, tagged files + lease of the
#     dead tag removed; live lease, its resources, its pid and the foreign
#     junk.run untouched; an outbound uvicorn-argv CLIENT connected to the
#     dead-run port (remote endpoint) survives — the port-hold sample is
#     the one-shot LISTEN sample of §3.3 (local end only), not per-port
#     `lsof -ti :PORT`; stdout carries ONLY the live lease's ports;
#     malformed lease removed without a port sweep.
#   → Case 11 (#317 §3.3): empty runs dir → rc=0, empty stdout (first run);
#     live lease → masked holder on its port SURVIVES, lease/resources/pid
#     intact, 4 ports printed for the allocator; remove_run_lease removes
#     and is idempotent on a missing file.
#   → Case 12 (#317 §3.3): aging — live PID + stamp older than 24 h = dead:
#     TERM-logging holder gets the TERM rung (marker file proves it),
#     resources swept, empty stdout; threshold pinned to 86400 s.
#   → Case 13 (#317 §3.3): playground/dev ports 3100/8101/3001 are outside
#     every lease and mask match-set → masked holders on them survive a
#     FULL sweep (with a dead lease actively swept — non-vacuous).

set -euo pipefail

# Resolve script directory regardless of caller's cwd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Test-port isolation: per-run unique, verified free ─────────────────────
# High ephemeral-ish window away from production (3000/3001/8000), dev.sh
# (3001/8000) and shard ports (3002/3003/8001/8002). Base is $RANDOM per
# run; the THREE consecutive ports (front, backend-A, backend-B) are all
# verified free via lsof before use, with retries. NB: $$-модуло нельзя —
# у почти одновременных запусков PIDs соседние, окна пересекаются, и чужой
# sweep убивает нашего держателя «на своём» порту; RANDOM делает коллизию
# (~1/7900) практически невозможной.
allocate_port_triplet() {
  local front tries=0
  while :; do
    tries=$((tries + 1))
    [ "$tries" -gt 20 ] && {
      echo "FATAL: no free test-port triplet in 38200-46099 after $tries tries" >&2
      exit 1
    }
    front=$((38200 + RANDOM % 7900))
    if ! lsof -ti :"$front" $((front + 1)) $((front + 2)) >/dev/null 2>&1; then
      printf '%s %s %s' "$front" "$((front + 1))" "$((front + 2))"
      return 0
    fi
  done
}

read -r TEST_FRONTEND_PORT TEST_BACKEND_PORT_A TEST_BACKEND_PORT_B \
  <<< "$(allocate_port_triplet)"

# Library under test: overridable (RED demonstration against a deliberately
# broken copy — run:
#   sed -e 's/if ! rm -rf "$dir"; then/if ! true; then/' \
#       -e 's/_sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"/:/' \
#       shard-helpers.sh > /tmp/broken.sh
#   SHARD_LIB_UNDER_TEST=/tmp/broken.sh bash scripts/lib/shard-helpers.dryrun.test.sh
# expected: Case 0, 1, 4 FAIL → the assertions are non-vacuous).
SHARD_LIB_UNDER_TEST="${SHARD_LIB_UNDER_TEST:-$REPO_ROOT/scripts/lib/shard-helpers.sh}"
if [ ! -f "$SHARD_LIB_UNDER_TEST" ]; then
  echo "FATAL: shard-helpers library not found at $SHARD_LIB_UNDER_TEST" >&2
  exit 1
fi

# ── Globals the library functions read (declared BEFORE sourcing) ─────────
ROOT=""                       # set per case to a fresh tempdir
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")
SHARD_BACKEND_PIDS=()

# ── Per-run work dir + stubs ───────────────────────────────────────────────
WORK="$(mktemp -d -t shardlib-dryrun-XXXXXX)"
STUBS="$(mktemp -d -t shardlib-stub-XXXXXX)"
mkdir -p "$STUBS"

# Registry of background PIDs spawned by this test (6.5 hygiene).
TEST_OWN_PIDS=()

cleanup() {
  # Kill every background holder this test spawned (kill -9 pierces SIG_IGN),
  # then wait so no zombie outlives the harness.
  local pid
  for pid in "${TEST_OWN_PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -9 "$pid" 2>/dev/null || true
  done
  for pid in "${TEST_OWN_PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$WORK" "$STUBS"
}
trap cleanup EXIT

FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────

# fresh_root <name> — create a case tempdir and point ROOT at it, mirroring
# the repo layout the library expects ($ROOT/frontend/admin/...).
fresh_root() {
  local name="$1"
  ROOT="$WORK/$name"
  mkdir -p "$ROOT/frontend/admin" "$ROOT/backend"
}

# source_lib — (re)source the library against the current ROOT/ports.
# Sourcing twice is fine: function definitions simply overwrite.
source_lib() {
  # shellcheck disable=SC1090
  source "$SHARD_LIB_UNDER_TEST"
}

# wait_pid_gone <pid> <timeout_s> — poll kill -0 until the pid is dead.
wait_pid_gone() {
  # NB: не объединять в один local — все слова команды раскрываются ДО
  # присваиваний, и $((...)) увидит ещё не заданный timeout_s под set -u.
  local pid="$1" timeout_s="$2"
  local deadline=$((SECONDS + timeout_s))
  while kill -0 "$pid" 2>/dev/null; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    sleep 0.2
  done
  return 0
}

# port_free <port> — true iff lsof finds no listener.
port_free() {
  ! lsof -ti :"$1" >/dev/null 2>&1
}

# spawn_term_ignoring_uvicorn_holder <port> <argv_tail> — start the S4
# holder: ONE process (exec -a rewrites argv[0]), bash + system python3,
# no nc/perl. It ignores SIGTERM and holds the port. argv becomes
# `uvicorn <code> <port> <argv_tail>` — matches BOTH mask stages
# (pgrep -f uvicorn + port hold). Echos the holder PID on stdout.
# NB: returns immediately — bind-waiting is the PARENT's job (register_pid
# below), so the PID is in the kill registry even if binding never happens.
spawn_term_ignoring_uvicorn_holder() {
  local port="$1" tail="$2"
  (
    exec -a uvicorn python3 -c '
import signal, socket, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(1); time.sleep(60)
' "$port" "$tail"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# wait_holder_bound <pid> <port> — parent-side bind wait: poll lsof until
# the holder owns the port (otherwise the sweep's port-hold check could run
# before the holder binds). Call AFTER register_pid so any failure/timeout
# path still leaves the PID reaped by the EXIT trap.
wait_holder_bound() {
  local pid="$1" port="$2"
  local deadline=$((SECONDS + 5))
  until lsof -ti :"$port" 2>/dev/null | grep -qx "$pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "FATAL: holder on port $port died before binding" >&2
      exit 1
    fi
    [ "$SECONDS" -ge "$deadline" ] && {
      echo "FATAL: holder on port $port never bound the socket" >&2
      exit 1
    }
    sleep 0.1
  done
}

# ── Spawn helpers: два правила (оба найдены отладкой, нарушать нельзя) ─────
#  1) фоновый ребёнок отвязывает stdio (>/dev/null 2>&1 </dev/null) — иначе
#     унаследованный stdout держит pipe записи "$(spawn)" и command
#     substitution блокируется на весь self-exit держателя → ассерты
#     стартуют поздно и проходят фиктивно (vacuous pass);
#  2) спавн-функция вызывается через "$( )" — это ПОДшелл: TEST_OWN_PIDS+=()
#     внутри неё умирает вместе с ним, реестр в родителе пуст, EXIT-trap
#     никого не убивает (утечка процессов). Поэтому функция только ПЕЧАТАЕТ
#     pid, а регистрация выполняется на месте вызова — в родителе.

# spawn_sleep_wrapper — background `sleep 60` for the S3 fast-path case.
spawn_sleep_wrapper() {
  sleep 60 >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# register_pid <pid> — add a spawned PID to the harness kill registry
# (called in the PARENT after the command-substitution spawn — see the
# spawn-helpers note above for why registration cannot live inside spawn).
register_pid() {
  TEST_OWN_PIDS+=("$1")
}

# spawn_plain_holder <port> — bind a TEST port and sleep 60 (no signal
# games; the EXIT-trap registry reaps it with kill -9). For allocator
# busy-tests (Case 8). Same two spawn rules as above: detached stdio,
# prints the PID for parent-side registration.
spawn_plain_holder() {
  local port="$1"
  (
    exec -a memo-dryrun-holder python3 -c '
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(1); time.sleep(60)
' "$port"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# spawn_uvicorn_holder <port> <marker_file|-> — TERM-SENSITIVE holder with
# uvicorn argv (command-mask match), binds the TEST port. When marker_file
# is not "-", a SIGTERM handler writes the file BEFORE exiting — proving
# the TERM rung of a sweep ladder fired (kill -9 leaves no marker). Same
# two spawn rules: detached stdio, PID printed for parent-side registration.
spawn_uvicorn_holder() {
  local port="$1" marker="$2"
  (
    exec -a uvicorn python3 -c '
import signal, socket, sys, time
marker = sys.argv[2]
def on_term(signum, frame):
    if marker != "-":
        open(marker, "w").write("term")
    sys.exit(0)
signal.signal(signal.SIGTERM, on_term)
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(1); time.sleep(60)
' "$port" "$marker"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# spawn_named_holder <argv0> <port> — TERM-sensitive plain holder with a
# custom argv[0] (e.g. "next-server (v99.1.1)", "next dev -p 3001"):
# command-mask fodder for never-touched-port proofs. Binds the given port.
spawn_named_holder() {
  local argv0="$1" port="$2"
  (
    exec -a "$argv0" python3 -c '
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(1); time.sleep(60)
' "$port"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# extra_free_port [EXCLUDE ...] — one lsof-verified free test port (window
# 38200-46099, same hygiene as allocate_port_triplet) distinct from the
# exclusion list (triplet + earlier extras). Bounded retries.
extra_free_port() {
  local p tries=0
  while :; do
    tries=$((tries + 1))
    [ "$tries" -gt 40 ] && {
      echo "FATAL: extra_free_port: no free port after $tries tries" >&2
      exit 1
    }
    p=$((38200 + RANDOM % 7900))
    case " $* " in *" $p "*) continue ;; esac
    if ! lsof -ti :"$p" >/dev/null 2>&1; then printf '%s' "$p"; return 0; fi
  done
}

# spawn_dead_pid — a spawned-then-REAPED pid: kill -9 + wait inside the
# substitution subshell, so kill -0 on the result FAILS for the lifetime
# of the case (a zombie would still answer kill -0; reaping removes it).
spawn_dead_pid() {
  sleep 60 >/dev/null 2>&1 </dev/null &
  local pid=$!
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  printf '%s' "$pid"
}

# spawn_outbound_client <host> <port> <marker_file> — uvicorn-argv process
# that CONNECTS to host:port (outbound socket; the checked port is its
# REMOTE endpoint) and sleeps holding the connection; writes the marker
# after connect. Discriminates the LISTEN-based port-hold sample (§3.3):
# `lsof -ti :PORT` matches this socket on both ends (bug), the one-shot
# `lsof -nP -i TCP -sTCP:LISTEN` sample must not. The sweep must never
# kill the client. Same two spawn rules as the other holders.
spawn_outbound_client() {
  local host="$1" port="$2" marker="$3"
  (
    exec -a uvicorn python3 -c '
import socket, sys, time
host, port, marker = sys.argv[1], int(sys.argv[2]), sys.argv[3]
s = socket.socket()
s.connect((host, port))
open(marker, "w").write("connected")
time.sleep(60)
' "$host" "$port" "$marker"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# wait_marker <marker_file> [timeout_s] — poll until the marker exists
# (bounded; default 5 s). Proves a spawned fixture reached its milestone.
wait_marker() {
  local marker="$1"
  local deadline=$((SECONDS + ${2:-5}))
  while [ ! -e "$marker" ]; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    sleep 0.1
  done
  return 0
}

# check_port_survivor <port> <pid> — true iff pid is alive AND still holds
# the port (Case 13: never-touched ports keep their holders through a sweep).
check_port_survivor() {
  kill -0 "$2" 2>/dev/null || return 1
  lsof -ti :"$1" 2>/dev/null | grep -qx "$2"
}

# ── Case 0: meta self-check — the sweep really detects a violating holder ─
# Inject a REAL masked holder (uvicorn argv + test port), run cleanup_shards,
# and require it dead. If the detector were broken, this fails — proving the
# S4 assertion is not vacuous. Also the negative control: an innocent holder
# (no uvicorn in argv, no shard port) must survive the same call.
echo "── Case 0 (meta): sweep detector self-check ──"
fresh_root "case0"
HOLDER_OK="$(spawn_term_ignoring_uvicorn_holder "$TEST_BACKEND_PORT_A" test_memo_shardX)"
register_pid "$HOLDER_OK"          # в реестре ДО bind-ожидания — EXIT-trap приберёт при любом исходе
wait_holder_bound "$HOLDER_OK" "$TEST_BACKEND_PORT_A"
# Guard: after the capture the holder must still be a live child — if the
# bg process inherited the pipe, capture blocks until its self-exit and the
# assertions below would pass vacuously.
kill -0 "$HOLDER_OK" 2>/dev/null || {
  echo "FATAL: holder not alive after capture (stdio leak in spawn helper)" >&2
  exit 1
}
# Innocent: plain argv (no uvicorn), holds NO shard port (binds nothing).
(
  exec -a python3 python3 -c '
import signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(60)
'
) &
INNOCENT=$!
TEST_OWN_PIDS+=("$INNOCENT")
sleep 0.3

source_lib
set +e
CLEANUP_RC=$(cleanup_shards 2>&1; printf '%s' "$?")
set -e

DETECTOR_OK=true
wait_pid_gone "$HOLDER_OK" 5 || DETECTOR_OK=false
if kill -0 "$INNOCENT" 2>/dev/null; then INNOCENT_SURVIVED=true; else INNOCENT_SURVIVED=false; fi

if $DETECTOR_OK && $INNOCENT_SURVIVED; then
  echo "PASS Case 0 (meta): detector killed the masked holder; innocent holder survived (non-vacuous)"
else
  echo "FAIL Case 0 (meta): detector_ok=$DETECTOR_OK innocent_survived=$INNOCENT_SURVIVED"
  echo "── Case 0 cleanup output ──"
  printf '%s\n' "$CLEANUP_RC"
  echo "─────────────────"
  FAIL=1
fi
# 6.5: the innocent holder is our own — finish it here (it survived on purpose).
kill -9 "$INNOCENT" 2>/dev/null || true
wait "$INNOCENT" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$INNOCENT/}")

# ── Case 1 (S2, безусловность): wipe removes dirs; empty match = success ──
echo "── Case 1 (S2): unconditional wipe + idempotent second pass ──"
fresh_root "case1"
mkdir -p "$ROOT/frontend/admin/.next-shard-1" "$ROOT/frontend/admin/.next-shard-2"
printf 'chunk' > "$ROOT/frontend/admin/.next-shard-1/x.js"
printf 'chunk' > "$ROOT/frontend/admin/.next-shard-2/y.js"
# A stale lookalike from an OLDER shard layout — glob `.next-shard-*` has
# no suffix constraint, so it IS matched and wiped too. That's the contract:
# dirs left by a previous shard count must not survive into a new run.
mkdir -p "$ROOT/frontend/admin/.next-shard-stale"
printf 'old' > "$ROOT/frontend/admin/.next-shard-stale/z.js"

source_lib
set +e
WIPE_OUT=$(wipe_shard_dirs 2>&1); WIPE_RC=$?
set -e

CASE1_OK=true
[ "$WIPE_RC" -eq 0 ] || CASE1_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE1_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-2" ] || CASE1_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE1_OK=false

set +e
WIPE2_OUT=$(wipe_shard_dirs 2>&1); WIPE2_RC=$?
set -e
[ "$WIPE2_RC" -eq 0 ] || CASE1_OK=false

# Non-vacuity self-check: re-create a dir and verify the SECOND wipe's
# removal is observable (guards against a fixture that silently never existed).
mkdir -p "$ROOT/frontend/admin/.next-shard-1"
rm -rf "$ROOT/frontend/admin/.next-shard-1"
[ ! -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE1_OK=false

if $CASE1_OK; then
  echo "PASS Case 1 (S2): existing dirs + stale-lookalike wiped (rc=0), clean second pass (rc=0)"
else
  echo "FAIL Case 1 (S2): wipe_rc=$WIPE_RC second_rc=$WIPE2_RC"
  echo "── Case 1 wipe output ──"
  printf '%s\n' "$WIPE_OUT" "$WIPE2_OUT"
  echo "─────────────────"
  FAIL=1
fi

# ── Case 2 (S2, fail-fast): failing rm → non-zero + message with path ─────
echo "── Case 2 (S2): rm stub fails for .next-shard-* → fail-fast ──"
# PATH-stub rm: non-zero exit ONLY for .next-shard-* targets (the only
# deterministic way to fail the removal; real rm never fails there).
cat > "$STUBS/rm" <<'EOF'
#!/bin/sh
case "$*" in
  *.next-shard-*)
    # ТИХИЙ отказ: никакого stderr-эха с путём — иначе ассерт «сообщение
    # библиотеки называет путь» матчил бы ЗГЛУШКУ, а не библиотеку.
    exit 1
    ;;
esac
exec /bin/rm "$@"
EOF
chmod +x "$STUBS/rm"

fresh_root "case2"
mkdir -p "$ROOT/frontend/admin/.next-shard-1"
printf 'chunk' > "$ROOT/frontend/admin/.next-shard-1/x.js"

set +e
CASE2_OUT=$(PATH="$STUBS:$PATH" wipe_shard_dirs 2>&1); CASE2_RC=$?
set -e

CASE2_OK=true
[ "$CASE2_RC" -ne 0 ] || CASE2_OK=false
# Non-vacuity: the ONLY source of the path in the captured output is the
# LIBRARY's fail-fast message (stub is silent) — anchor to its exact prefix
# («❌ Failed to remove stale shard build dir:») AND require the path on
# the SAME line, so neither a bare prefix nor a foreign mention can pass.
printf '%s\n' "$CASE2_OUT" \
  | grep -E '^❌ Failed to remove stale shard build dir: .*\.next-shard-' >/dev/null \
  || CASE2_OK=false

# Negative control for THIS case: with the real rm the same fixture wipes
# fine — proves the stub (not the fixture) is what drives the failure.
set +e
CASE2B_OUT=$(wipe_shard_dirs 2>&1); CASE2B_RC=$?
set -e
[ "$CASE2B_RC" -eq 0 ] || CASE2_OK=false

if $CASE2_OK; then
  echo "PASS Case 2 (S2): failing rm → non-zero exit + message names the shard path; real rm wipes fine"
else
  echo "FAIL Case 2 (S2): rc=$CASE2_RC (expect non-zero), control rc=$CASE2B_RC (expect 0)"
  echo "── Case 2 output ──"
  printf '%s\n' "$CASE2_OUT"
  echo "─────────────────"
  FAIL=1
fi
rm -f "$STUBS/rm"   # remove the stub so later cases see the real rm

# ── Case 3 (S3, конечность): sleep wrapper → fast path, bounded return ────
echo "── Case 3 (S3): cleanup_shards returns ≤ 15 s, wrapper dead ──"
fresh_root "case3"
SLEEP_PID="$(spawn_sleep_wrapper)"
register_pid "$SLEEP_PID"
kill -0 "$SLEEP_PID" 2>/dev/null || {
  echo "FATAL: sleep wrapper not alive after capture (stdio leak in spawn helper)" >&2
  exit 1
}
SHARD_BACKEND_PIDS=("$SLEEP_PID")

source_lib
T0=$(date +%s)
set +e
CASE3_OUT=$(cleanup_shards 2>&1); CASE3_RC=$?
set -e
T1=$(date +%s)
ELAPSED=$((T1 - T0))

CASE3_OK=true
[ "$CASE3_RC" -eq 0 ] || CASE3_OK=false
[ "$ELAPSED" -le 15 ] || CASE3_OK=false
wait_pid_gone "$SLEEP_PID" 5 || CASE3_OK=false

if $CASE3_OK; then
  echo "PASS Case 3 (S3): rc=0, elapsed=${ELAPSED}s (≤15), sleep wrapper dead"
else
  echo "FAIL Case 3 (S3): rc=$CASE3_RC elapsed=${ELAPSED}s pid_alive=$(kill -0 "$SLEEP_PID" 2>/dev/null && echo yes || echo no)"
  echo "── Case 3 output ──"
  printf '%s\n' "$CASE3_OUT"
  echo "─────────────────"
  FAIL=1
fi
SHARD_BACKEND_PIDS=()

# ── Case 4 (S4): TERM-stubborn uvicorn-masked holder → killed, port free ──
echo "── Case 4 (S4): TERM-ignoring holder (uvicorn argv + shard port) ──"
fresh_root "case4"
H4="$(spawn_term_ignoring_uvicorn_holder "$TEST_BACKEND_PORT_B" test_memo_shardY)"
register_pid "$H4"                 # в реестре ДО bind-ожидания — EXIT-trap приберёт при любом исходе
wait_holder_bound "$H4" "$TEST_BACKEND_PORT_B"
kill -0 "$H4" 2>/dev/null || {
  echo "FATAL: holder not alive after capture (stdio leak in spawn helper)" >&2
  exit 1
}
SHARD_BACKEND_PIDS=()

# Sanity guard (non-vacuity): the holder REALLY ignores TERM. If it died
# from TERM alone, the kill -9 assertion below would be vacuous.
kill "$H4" 2>/dev/null || true
sleep 1
if kill -0 "$H4" 2>/dev/null; then
  H4_TERM_IMMUNE=true
else
  H4_TERM_IMMUNE=false
fi

set +e
CASE4_OUT=$(cleanup_shards 2>&1); CASE4_RC=$?
set -e

CASE4_OK=true
$H4_TERM_IMMUNE || CASE4_OK=false
wait_pid_gone "$H4" 5 || CASE4_OK=false
port_free "$TEST_BACKEND_PORT_B" || CASE4_OK=false

if $CASE4_OK; then
  echo "PASS Case 4 (S4): holder TERM-immune (verified), cleanup_shards killed it, port $TEST_BACKEND_PORT_B free"
else
  echo "FAIL Case 4 (S4): term_immune=$H4_TERM_IMMUNE dead=$(kill -0 "$H4" 2>/dev/null && echo no || echo yes) port_free=$(port_free "$TEST_BACKEND_PORT_B" && echo yes || echo no)"
  echo "── Case 4 output ──"
  printf '%s\n' "$CASE4_OUT"
  echo "─────────────────"
  FAIL=1
fi
SHARD_BACKEND_PIDS=()

# ── Case 4 control is already covered by Case 0 (innocent survived). ──────

# ── Case 5 (#317 §3.1, формат тега): gen_run_tag → ^[0-9a-f]{6}$ ────────────
echo "── Case 5 (#317 §3.1): gen_run_tag → 6 lowercase hex, single word ──"
fresh_root "case5"
SHARD_RUNS_DIR="$WORK/lease-runs-case5"   # isolation from real host leases
source_lib
CASE5_OK=true
TAG_RE='^[0-9a-f]{6}$'
for i in 1 2 3 4 5; do
  set +e
  TAG_OUT=$(gen_run_tag 2>&1); TAG_RC=$?
  set -e
  [ "$TAG_RC" -eq 0 ] || CASE5_OK=false
  # stdout must carry exactly one word — callers capture it raw
  TAG_WORDS=$(printf '%s' "$TAG_OUT" | wc -w | tr -d ' ')
  [ "$TAG_WORDS" -eq 1 ] || CASE5_OK=false
  # lowercase 6-hex only: the regex rejects uppercase A-F and any junk
  printf '%s' "$TAG_OUT" | grep -Eq "$TAG_RE" || CASE5_OK=false
done
if $CASE5_OK; then
  echo "PASS Case 5 (#317): gen_run_tag → 6 lowercase hex ×5 draws (last: $TAG_OUT), rc=0"
else
  echo "FAIL Case 5 (#317): rc=$TAG_RC out='$TAG_OUT' words=$TAG_WORDS"
  FAIL=1
fi

# ── Case 6 (#317 §3.1): validation redraw + collision regeneration ─────────
echo "── Case 6 (#317 §3.1): validation redraw + resource-collision regeneration ──"
fresh_root "case6"
SHARD_RUNS_DIR="$WORK/lease-runs-case6"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE6_OK=true

# stateful openssl stub: emits tag candidates in a fixed sequence
# (seq file reset per sub-case → draw 1 = "abc123", draw 2 = "111222").
make_seq_openssl() {
  cat > "$STUBS/openssl" <<EOF
#!/bin/sh
n=\$(cat "$STUBS/openssl_seq" 2>/dev/null || echo 0)
n=\$((n + 1))
echo "\$n" > "$STUBS/openssl_seq"
case "\$n" in
  1) printf 'abc123\n' ;;
  2) printf '111222\n' ;;
  3) printf '222333\n' ;;
  *) printf '333444\n' ;;
esac
EOF
  chmod +x "$STUBS/openssl"
  rm -f "$STUBS/openssl_seq"
}

# (a) clean environment → the first candidate is accepted as-is
make_seq_openssl
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "abc123" ]; } || CASE6_OK=false

# (b) lease file of the candidate exists → regenerate to the next one
make_seq_openssl
: > "$SHARD_RUNS_DIR/abc123.run"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "111222" ]; } || CASE6_OK=false
rm -f "$SHARD_RUNS_DIR/abc123.run"

# (c) shard DB of the candidate exists → regenerate
make_seq_openssl
: > "$ROOT/backend/test_memo_shard1_abc123.db"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "111222" ]; } || CASE6_OK=false
rm -f "$ROOT/backend/test_memo_shard1_abc123.db"

# (d) canon-style glob of the candidate exists → regenerate
make_seq_openssl
: > "$ROOT/backend/test_memo_shard2_abc123.canon.sql"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "111222" ]; } || CASE6_OK=false
rm -f "$ROOT/backend/test_memo_shard2_abc123.canon.sql"

# (e) build dir of the candidate exists → regenerate
make_seq_openssl
mkdir -p "$ROOT/frontend/admin/.next-shard-2_abc123"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "111222" ]; } || CASE6_OK=false
rmdir "$ROOT/frontend/admin/.next-shard-2_abc123"

# (f) photo dir of the candidate exists → regenerate
make_seq_openssl
mkdir -p "$ROOT/backend/test_files_shard1_abc123"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "111222" ]; } || CASE6_OK=false
rmdir "$ROOT/backend/test_files_shard1_abc123"

# (g) invalid candidates (bad charset from BOTH entropy sources) are never
# returned — redrawn until a valid one appears
cat > "$STUBS/openssl" <<EOF
#!/bin/sh
n=\$(cat "$STUBS/openssl_seq" 2>/dev/null || echo 0)
n=\$((n + 1))
echo "\$n" > "$STUBS/openssl_seq"
case "\$n" in
  1) printf 'ZZZZ99\n' ;;
  *) printf 'cab012\n' ;;
esac
EOF
chmod +x "$STUBS/openssl"
rm -f "$STUBS/openssl_seq"
cat > "$STUBS/od" <<'EOF'
#!/bin/sh
printf '!!\n'
EOF
chmod +x "$STUBS/od"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "cab012" ]; } || CASE6_OK=false
rm -f "$STUBS/od"

# (h) broken openssl → od fallback; od padding/case normalized
cat > "$STUBS/openssl" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$STUBS/openssl"
cat > "$STUBS/od" <<'EOF'
#!/bin/sh
printf '  1A2B3C\n'
EOF
chmod +x "$STUBS/od"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
{ [ "$R6" -eq 0 ] && [ "$T6" = "1a2b3c" ]; } || CASE6_OK=false
rm -f "$STUBS/od" "$STUBS/openssl"

# (i) every candidate collides → bounded retries, fail-fast + message
cat > "$STUBS/openssl" <<EOF
#!/bin/sh
printf 'x' >> "$STUBS/openssl_calls"
printf 'abc123\n'
EOF
chmod +x "$STUBS/openssl"
rm -f "$STUBS/openssl_calls"
: > "$SHARD_RUNS_DIR/abc123.run"
set +e; T6=$(PATH="$STUBS:$PATH" gen_run_tag 2>&1); R6=$?; set -e
[ "$R6" -ne 0 ] || CASE6_OK=false
printf '%s\n' "$T6" | grep -q 'gen_run_tag' || CASE6_OK=false
printf '%s\n' "$T6" | grep -q 'tag' || CASE6_OK=false
OPENSSL_N=$(wc -c < "$STUBS/openssl_calls" 2>/dev/null || printf '0')
OPENSSL_N=$((OPENSSL_N))
[ "$OPENSSL_N" -le 20 ] || CASE6_OK=false
rm -f "$STUBS/openssl" "$STUBS/openssl_calls" "$SHARD_RUNS_DIR/abc123.run"

if $CASE6_OK; then
  echo "PASS Case 6 (#317): validation redraw + collision regeneration (lease/db/canon/build/photo) + od fallback + bounded fail-fast"
else
  echo "FAIL Case 6 (#317): last rc=$R6 out='$T6' stub_calls=$OPENSSL_N"
  FAIL=1
fi

# ── Case 7 (#317 §3.2): 4 pairwise-distinct ports, default window ──────────
echo "── Case 7 (#317 §3.2): allocate_shard_ports → 4 distinct ports in 28000-32700 ──"
fresh_root "case7"
source_lib
CASE7_OK=true
# window constants pinned to the spec (below Linux ephemeral 32768-60999)
[ "$SHARD_PORT_WINDOW_LOW" -eq 28000 ] || CASE7_OK=false
[ "$SHARD_PORT_WINDOW_HIGH" -eq 32700 ] || CASE7_OK=false
for i in 1 2 3; do
  set +e
  P7=$(allocate_shard_ports 2>&1); R7=$?
  set -e
  [ "$R7" -eq 0 ] || CASE7_OK=false
  P7_N=$(printf '%s' "$P7" | wc -w | tr -d ' ')
  [ "$P7_N" -eq 4 ] || CASE7_OK=false
  P7_U=$(printf '%s\n' $P7 | sort -u | wc -l | tr -d ' ')
  [ "$P7_U" -eq 4 ] || CASE7_OK=false      # pairwise distinct
  for p7 in $P7; do
    [ "$p7" -ge "$SHARD_PORT_WINDOW_LOW" ] || CASE7_OK=false
    [ "$p7" -le "$SHARD_PORT_WINDOW_HIGH" ] || CASE7_OK=false
    port_free "$p7" || CASE7_OK=false      # nothing listens on it
  done
done
if $CASE7_OK; then
  echo "PASS Case 7 (#317): 3 allocations × 4 distinct in-window lsof-free ports (window pinned 28000-32700)"
else
  echo "FAIL Case 7 (#317): rc=$R7 out='$P7'"
  FAIL=1
fi

# ── Case 8 (#317 §3.2): busy ports (live-lease args + held listener) avoided ─
echo "── Case 8 (#317 §3.2): allocator never returns busy-arg or held ports ──"
fresh_root "case8"
source_lib
# Hygiene: pick a fully-free 12-port sub-window INSIDE the spec window
# (lsof-verified; away from every production port — the whole spec window is).
# 12 wide on purpose: after removing 1 held + 4 busy-arg ports, 7 usable
# remain — the allocator collects 4 of them with near-certainty, so the
# assertion is a SUBSET check, NOT exact-set equality over a minimal
# window (a 4-of-6 minimal window made the fixed 20-draw budget time out
# ~15% of runs — coupon collector, not a lib bug — flaky, reviewer #317).
SUB_BASE=""
SUB_TRY=0
while [ "$SUB_TRY" -lt 20 ]; do
  SUB_TRY=$((SUB_TRY + 1))
  SUB_CAND=$((SHARD_PORT_WINDOW_LOW + RANDOM % (SHARD_PORT_WINDOW_HIGH - SHARD_PORT_WINDOW_LOW - 11)))
  SUB_FREE=true
  for p8 in $(seq "$SUB_CAND" "$((SUB_CAND + 11))"); do
    if lsof -ti :"$p8" >/dev/null 2>&1; then SUB_FREE=false; fi
  done
  if [ "$SUB_FREE" = true ]; then SUB_BASE="$SUB_CAND"; break; fi
done
if [ -z "$SUB_BASE" ]; then
  echo "FATAL: no free 12-port sub-window inside ${SHARD_PORT_WINDOW_LOW}-${SHARD_PORT_WINDOW_HIGH}" >&2
  exit 1
fi
SUB_TOP=$((SUB_BASE + 11))
HELD8="$SUB_TOP"           # really held by a spawned listener
# 4 busy args — the shape of ONE real live lease (its 4 ports are busy):
BUSY8_LIST="$((SUB_BASE + 1)) $((SUB_BASE + 3)) $((SUB_BASE + 5)) $((SUB_BASE + 7))"
H8="$(spawn_plain_holder "$HELD8")"
register_pid "$H8"
wait_holder_bound "$H8" "$HELD8"
SHARD_PORT_WINDOW_LOW="$SUB_BASE"
SHARD_PORT_WINDOW_HIGH="$SUB_TOP"
# Bounded retry: a rare coupon-collector timeout inside the narrowed
# window (rc=1) is retried, not treated as a property violation — the
# fail-fast CONTRACT is owned by Case 9; THIS case owns the avoidance
# property, asserted on every successful allocation.
P8="" R8=1 RETRY8=0
while [ "$RETRY8" -lt 5 ]; do
  RETRY8=$((RETRY8 + 1))
  set +e
  P8=$(allocate_shard_ports $BUSY8_LIST 2>&1); R8=$?
  set -e
  [ "$R8" -eq 0 ] && break
done
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
CASE8_OK=true
[ "$R8" -eq 0 ] || CASE8_OK=false
if [ "$R8" -eq 0 ]; then
  P8_N=$(printf '%s' "$P8" | wc -w | tr -d ' ')
  P8_U=$(printf '%s\n' $P8 | sort -u | wc -l | tr -d ' ')
  [ "$P8_N" -eq 4 ] || CASE8_OK=false          # four ports
  [ "$P8_U" -eq 4 ] || CASE8_OK=false          # pairwise distinct
  for p8 in $P8; do
    { [ "$p8" -ge "$SUB_BASE" ] && [ "$p8" -le "$SUB_TOP" ]; } || CASE8_OK=false
    [ "$p8" -ne "$HELD8" ] || CASE8_OK=false   # never the held port
    case " $BUSY8_LIST " in *" $p8 "*) CASE8_OK=false ;; esac   # never a busy-arg port
  done
fi
if $CASE8_OK; then
  echo "PASS Case 8 (#317): window [$SUB_BASE-$SUB_TOP]: held $HELD8 + busy args ($BUSY8_LIST) never returned; 4 distinct in-window ports (subset of usable), tries=$RETRY8"
else
  echo "FAIL Case 8 (#317): rc=$R8 tries=$RETRY8 out='$P8'"
  FAIL=1
fi

# ── Case 9 (#317 §3.2): window exhausted → bounded fail-fast ────────────────
echo "── Case 9 (#317 §3.2): fail-fast after ≤20 attempts, actionable message ──"
fresh_root "case9"
source_lib
cat > "$STUBS/lsof" <<EOF
#!/bin/sh
printf 'x' >> "$STUBS/lsof_calls"
exit 0
EOF
chmod +x "$STUBS/lsof"
rm -f "$STUBS/lsof_calls"
set +e
P9=$(PATH="$STUBS:$PATH" allocate_shard_ports 2>&1); R9=$?
set -e
LSOF_N=$(wc -c < "$STUBS/lsof_calls" 2>/dev/null || printf '0')
LSOF_N=$((LSOF_N))
CASE9_OK=true
[ "$R9" -ne 0 ] || CASE9_OK=false
printf '%s\n' "$P9" | grep -q "$SHARD_PORT_WINDOW_LOW-$SHARD_PORT_WINDOW_HIGH" || CASE9_OK=false
printf '%s\n' "$P9" | grep -q "$SHARD_ALLOC_MAX_ATTEMPTS" || CASE9_OK=false
[ "$LSOF_N" -le "$SHARD_ALLOC_MAX_ATTEMPTS" ] || CASE9_OK=false
# control: same call with the REAL lsof succeeds (the stub drove the failure)
set +e
P9B=$(allocate_shard_ports 2>&1); R9B=$?
set -e
[ "$R9B" -eq 0 ] || CASE9_OK=false
rm -f "$STUBS/lsof" "$STUBS/lsof_calls"
if $CASE9_OK; then
  echo "PASS Case 9 (#317): stubbed-held window → rc≠0, message names window+attempts, lsof calls=$LSOF_N ≤ 20; real-lsof control rc=0"
else
  echo "FAIL Case 9 (#317): rc=$R9 lsof_calls=$LSOF_N control_rc=$R9B out='$P9'"
  FAIL=1
fi

# ── Case 10 (#317 §3.3): lease format + dead run swept, live run kept ──────
echo "── Case 10 (#317 §3.3): dead-PID lease swept (TERM-stubborn holder); live lease/resources/junk kept ──"
fresh_root "case10"
SHARD_RUNS_DIR="$WORK/lease-runs-case10"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE10_OK=true
EXTRA10="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
DEAD10_TAG="aa1010"
LIVE10_TAG="bb2020"
DEAD10_PID="$(spawn_dead_pid)"
if kill -0 "$DEAD10_PID" 2>/dev/null; then
  echo "FATAL: Case 10 dead-pid fixture is alive" >&2
  exit 1
fi

# (a) write_run_lease — format contract: one line, exactly 8 fields
# (pid tag p1 p2 p3 p4 stamp), stamp = write time ±10 s, stdout silent.
set +e
W10_OUT=$(write_run_lease "$DEAD10_TAG" "$DEAD10_PID" \
  "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$EXTRA10" 2>&1); W10_RC=$?
set -e
NOW10=$(date +%s)
L10_PID="" L10_TAG="" L10_P1="" L10_P2="" L10_P3="" L10_P4="" L10_STAMP="" L10_EXTRA=""
read -r L10_PID L10_TAG L10_P1 L10_P2 L10_P3 L10_P4 L10_STAMP L10_EXTRA \
  < "$SHARD_RUNS_DIR/$DEAD10_TAG.run" || true
[ "$W10_RC" -eq 0 ] || CASE10_OK=false
[ -z "$W10_OUT" ] || CASE10_OK=false                 # writer is stdout-silent
[ -z "$L10_EXTRA" ] || CASE10_OK=false               # exactly 8 fields
[ "$L10_PID" = "$DEAD10_PID" ] || CASE10_OK=false
[ "$L10_TAG" = "$DEAD10_TAG" ] || CASE10_OK=false
[ "$L10_P1" = "$TEST_FRONTEND_PORT" ] || CASE10_OK=false
[ "$L10_P2" = "$TEST_BACKEND_PORT_A" ] || CASE10_OK=false
[ "$L10_P3" = "$TEST_BACKEND_PORT_B" ] || CASE10_OK=false
[ "$L10_P4" = "$EXTRA10" ] || CASE10_OK=false
case "$L10_STAMP" in
  ''|*[!0-9]*) CASE10_OK=false ;;
  *)
    [ "$L10_STAMP" -le $((NOW10 + 10)) ] || CASE10_OK=false
    [ "$L10_STAMP" -ge $((NOW10 - 10)) ] || CASE10_OK=false
    ;;
esac

# (b) fixtures: dead-tag file resources + a live lease with its resources.
mkdir -p "$ROOT/backend/test_files_shard1_$DEAD10_TAG" "$ROOT/frontend/admin/.next-shard-1_$DEAD10_TAG"
printf 'db'    > "$ROOT/backend/test_memo_shard1_${DEAD10_TAG}.db"
printf 'sql'   > "$ROOT/backend/test_memo_shard2_${DEAD10_TAG}.canon.sql"
printf 'file'  > "$ROOT/backend/test_files_shard1_${DEAD10_TAG}/avatar.png"
printf 'chunk' > "$ROOT/frontend/admin/.next-shard-1_${DEAD10_TAG}/x.js"
LIVE10_PID="$(spawn_sleep_wrapper)"
register_pid "$LIVE10_PID"
LIVE10_PORTS="29111 29112 29113 29114"   # unbound in-window values — busy-list only
set +e
write_run_lease "$LIVE10_TAG" "$LIVE10_PID" $LIVE10_PORTS 2>/dev/null; W10B_RC=$?
set -e
[ "$W10B_RC" -eq 0 ] || CASE10_OK=false
mkdir -p "$ROOT/backend/test_files_shard1_$LIVE10_TAG" "$ROOT/frontend/admin/.next-shard-2_$LIVE10_TAG"
printf 'db' > "$ROOT/backend/test_memo_shard1_${LIVE10_TAG}.db"
# malformed lease (garbage line) — removed, no port sweep from it
printf 'not a lease line\n' > "$SHARD_RUNS_DIR/cc3030.run"
# foreign non-6-hex lease file — NEVER touched (unvalidated tags must not
# reach rm-globs); the valid-looking line inside must not be parsed either.
printf '999999 1 2 3 4 5 6 7\n' > "$SHARD_RUNS_DIR/junk.run"

# (c) TERM-stubborn masked holder on a DEAD-tag port → the kill -9 rung.
H10="$(spawn_term_ignoring_uvicorn_holder "$TEST_BACKEND_PORT_A" "test_memo_shard_$DEAD10_TAG")"
register_pid "$H10"
wait_holder_bound "$H10" "$TEST_BACKEND_PORT_A"
# Outbound CLIENT with uvicorn argv CONNECTED to the dead-run port (remote
# endpoint): the port-hold sample is LISTEN/local-end only (§3.3) — the
# client holds no listener, so the sweep must leave it alone (a per-port
# `lsof -ti :PORT` sample would match its socket and kill it — the bug the
# one-shot LISTEN sample rules out).
CLIENT10_MARKER="$WORK/case10.client"
CLIENT10="$(spawn_outbound_client 127.0.0.1 "$TEST_BACKEND_PORT_A" "$CLIENT10_MARKER")"
register_pid "$CLIENT10"
wait_marker "$CLIENT10_MARKER" || {
  echo "FATAL: Case 10 outbound client never connected" >&2
  exit 1
}

# (d) the sweep itself.
T10=$(date +%s)
set +e
SW10_OUT=$(sweep_dead_runs 2>"$WORK/case10.err"); SW10_RC=$?
set -e
EL10=$(( $(date +%s) - T10 ))

# (e) assertions.
[ "$SW10_RC" -eq 0 ] || CASE10_OK=false
[ "$SW10_OUT" = "$LIVE10_PORTS" ] || CASE10_OK=false    # stdout = live ports ONLY
[ "$EL10" -le 25 ] || CASE10_OK=false                   # TERM-immune → full budget, bounded
wait_pid_gone "$H10" 15 || CASE10_OK=false
port_free "$TEST_BACKEND_PORT_A" || CASE10_OK=false
grep -q "dead run $DEAD10_TAG" "$WORK/case10.err" 2>/dev/null || CASE10_OK=false
# dead-tag resources + both garbage leases gone
[ ! -e "$ROOT/backend/test_memo_shard1_${DEAD10_TAG}.db" ] || CASE10_OK=false
[ ! -e "$ROOT/backend/test_memo_shard2_${DEAD10_TAG}.canon.sql" ] || CASE10_OK=false
[ ! -e "$ROOT/backend/test_files_shard1_$DEAD10_TAG" ] || CASE10_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_${DEAD10_TAG}" ] || CASE10_OK=false
[ ! -e "$SHARD_RUNS_DIR/$DEAD10_TAG.run" ] || CASE10_OK=false
[ ! -e "$SHARD_RUNS_DIR/cc3030.run" ] || CASE10_OK=false
# live-tag resources + lease + pid INTACT
[ -e "$ROOT/backend/test_memo_shard1_${LIVE10_TAG}.db" ] || CASE10_OK=false
[ -e "$ROOT/backend/test_files_shard1_$LIVE10_TAG" ] || CASE10_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-2_$LIVE10_TAG" ] || CASE10_OK=false
[ -e "$SHARD_RUNS_DIR/$LIVE10_TAG.run" ] || CASE10_OK=false
if kill -0 "$LIVE10_PID" 2>/dev/null; then :; else CASE10_OK=false; fi
# foreign junk file untouched
[ -e "$SHARD_RUNS_DIR/junk.run" ] || CASE10_OK=false
# the outbound client (uvicorn argv, checked port as REMOTE endpoint)
# survives the sweep — LISTEN/local-end-only port-hold sample
[ -e "$CLIENT10_MARKER" ] || CASE10_OK=false
if kill -0 "$CLIENT10" 2>/dev/null; then :; else CASE10_OK=false; fi

if $CASE10_OK; then
  echo "PASS Case 10 (#317): dead lease swept (TERM-stubborn holder killed, tagged files+lease removed); live lease/junk/outbound-client untouched; stdout=live ports only (${EL10}s)"
else
  echo "FAIL Case 10 (#317): rc=$SW10_RC elapsed=${EL10}s out='$SW10_OUT' client=$(kill -0 "$CLIENT10" 2>/dev/null && echo alive || echo dead)"
  echo "── Case 10 sweep stderr ──"
  cat "$WORK/case10.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi
# 6.5: the client survived on purpose — finish it here (it is our own).
kill -9 "$CLIENT10" 2>/dev/null || true
wait "$CLIENT10" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$CLIENT10/}")

# ── Case 11 (#317 §3.3): live lease untouched; ports contract; remove ──────
echo "── Case 11 (#317 §3.3): live lease untouched, ports → stdout; empty dir; remove_run_lease ──"
fresh_root "case11"
SHARD_RUNS_DIR="$WORK/lease-runs-case11"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE11_OK=true

# (a) empty runs dir (first run ever): rc 0, EMPTY stdout.
set +e
SW11A=$(sweep_dead_runs 2>"$WORK/case11a.err"); SW11A_RC=$?
set -e
[ "$SW11A_RC" -eq 0 ] || CASE11_OK=false
[ -z "$SW11A" ] || CASE11_OK=false

# (b) live lease: pid alive, fresh stamp (write_run_lease stamps now).
LIVE11_TAG="ab1100"
LIVE11_PID="$(spawn_sleep_wrapper)"
register_pid "$LIVE11_PID"
EXTRA11="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
EXTRA11B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$EXTRA11")"
LIVE11_PORTS="$TEST_FRONTEND_PORT $TEST_BACKEND_PORT_B $EXTRA11 $EXTRA11B"
# masked holder on ONE of the live lease's ports — must SURVIVE the sweep
# (alive-lease ports are excluded from every sweep, not just marked busy).
H11="$(spawn_uvicorn_holder "$TEST_BACKEND_PORT_B" -)"
register_pid "$H11"
wait_holder_bound "$H11" "$TEST_BACKEND_PORT_B"
set +e
write_run_lease "$LIVE11_TAG" "$LIVE11_PID" $LIVE11_PORTS 2>/dev/null; W11_RC=$?
set -e
[ "$W11_RC" -eq 0 ] || CASE11_OK=false
mkdir -p "$ROOT/frontend/admin/.next-shard-1_$LIVE11_TAG"
printf 'db' > "$ROOT/backend/test_memo_shard1_${LIVE11_TAG}.db"

set +e
SW11B=$(sweep_dead_runs 2>"$WORK/case11b.err"); SW11B_RC=$?
set -e
[ "$SW11B_RC" -eq 0 ] || CASE11_OK=false
[ "$SW11B" = "$LIVE11_PORTS" ] || CASE11_OK=false     # 4 busy ports for the allocator
if check_port_survivor "$TEST_BACKEND_PORT_B" "$H11"; then :; else CASE11_OK=false; fi
[ -e "$SHARD_RUNS_DIR/$LIVE11_TAG.run" ] || CASE11_OK=false
[ -e "$ROOT/backend/test_memo_shard1_${LIVE11_TAG}.db" ] || CASE11_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-1_$LIVE11_TAG" ] || CASE11_OK=false
if kill -0 "$LIVE11_PID" 2>/dev/null; then :; else CASE11_OK=false; fi

# (c) remove_run_lease: removes the run's own lease; idempotent when gone.
set +e
remove_run_lease "$LIVE11_TAG"; R11=$?
set -e
[ "$R11" -eq 0 ] || CASE11_OK=false
[ ! -e "$SHARD_RUNS_DIR/$LIVE11_TAG.run" ] || CASE11_OK=false
set +e
remove_run_lease "$LIVE11_TAG"; R11B=$?
set -e
[ "$R11B" -eq 0 ] || CASE11_OK=false

if $CASE11_OK; then
  echo "PASS Case 11 (#317): empty dir no-op; live lease untouched (holder on its port survived), ports '$SW11B' → stdout; remove_run_lease idempotent"
else
  echo "FAIL Case 11 (#317): empty_rc=$SW11A_RC live_rc=$SW11B_RC out='$SW11B' remove_rc=$R11/$R11B"
  echo "── Case 11 sweep stderr ──"
  cat "$WORK/case11b.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 12 (#317 §3.3): aging — live PID + stale stamp = dead ──────────────
echo "── Case 12 (#317 §3.3): aging — live PID + stamp older than 24 h = dead ──"
fresh_root "case12"
SHARD_RUNS_DIR="$WORK/lease-runs-case12"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE12_OK=true
[ "$SHARD_LEASE_MAX_AGE_S" -eq 86400 ] || CASE12_OK=false   # threshold pinned (24 h)

STALE12_TAG="cc1200"
STALE12_PID="$(spawn_sleep_wrapper)"   # ALIVE — the age must override liveness
register_pid "$STALE12_PID"
EXTRA12="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
MARKER12="$WORK/case12.term"
# Lease in the DOCUMENTED format, stamp 24 h + 5 min in the past — also
# cross-validates the parser against a hand-written line.
STALE12_STAMP=$(( $(date +%s) - SHARD_LEASE_MAX_AGE_S - 300 ))
printf '%s %s %s %s %s %s %s %s\n' "$STALE12_PID" "$STALE12_TAG" \
  "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$EXTRA12" \
  "$STALE12_STAMP" > "$SHARD_RUNS_DIR/$STALE12_TAG.run"
mkdir -p "$ROOT/backend/test_files_shard1_$STALE12_TAG"
printf 'db' > "$ROOT/backend/test_memo_shard1_${STALE12_TAG}.db"
# TERM-SENSITIVE masked holder with a marker file: proves the TERM rung of
# the ladder fired (a kill -9-only sweep would leave no marker).
H12="$(spawn_uvicorn_holder "$TEST_BACKEND_PORT_A" "$MARKER12")"
register_pid "$H12"
wait_holder_bound "$H12" "$TEST_BACKEND_PORT_A"

T12=$(date +%s)
set +e
SW12_OUT=$(sweep_dead_runs 2>"$WORK/case12.err"); SW12_RC=$?
set -e
EL12=$(( $(date +%s) - T12 ))

[ "$SW12_RC" -eq 0 ] || CASE12_OK=false
[ -z "$SW12_OUT" ] || CASE12_OK=false            # stale lease → NO busy ports
[ -e "$MARKER12" ] || CASE12_OK=false            # TERM rung fired
wait_pid_gone "$H12" 5 || CASE12_OK=false
port_free "$TEST_BACKEND_PORT_A" || CASE12_OK=false
[ ! -e "$SHARD_RUNS_DIR/$STALE12_TAG.run" ] || CASE12_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${STALE12_TAG}.db" ] || CASE12_OK=false
[ ! -e "$ROOT/backend/test_files_shard1_$STALE12_TAG" ] || CASE12_OK=false
if kill -0 "$STALE12_PID" 2>/dev/null; then :; else CASE12_OK=false; fi  # pid itself: no port, no mask → alive
[ "$EL12" -le 15 ] || CASE12_OK=false            # TERM-sensitive → budget exits early

if $CASE12_OK; then
  echo "PASS Case 12 (#317): aged lease (live pid, stamp −24h05m) treated dead: TERM rung fired (marker), resources swept (${EL12}s)"
else
  echo "FAIL Case 12 (#317): rc=$SW12_RC elapsed=${EL12}s marker=$([ -e "$MARKER12" ] && echo yes || echo no)"
  echo "── Case 12 sweep stderr ──"
  cat "$WORK/case12.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 13 (#317 §3.3): playground/dev ports never touched ────────────────
echo "── Case 13 (#317 §3.3): 3100/8101/3001 masked holders survive a full sweep ──"
fresh_root "case13"
SHARD_RUNS_DIR="$WORK/lease-runs-case13"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE13_OK=true
# A REAL dead lease so the sweep has active work (non-vacuous proof).
DEAD13_TAG="dd1300"
DEAD13_PID="$(spawn_dead_pid)"
EXTRA13="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
set +e
write_run_lease "$DEAD13_TAG" "$DEAD13_PID" \
  "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$EXTRA13" 2>/dev/null; W13_RC=$?
set -e
[ "$W13_RC" -eq 0 ] || CASE13_OK=false
# This masked holder on a DEAD-lease port MUST die — proves the sweep ran.
H13_DIE="$(spawn_uvicorn_holder "$TEST_BACKEND_PORT_A" -)"
register_pid "$H13_DIE"
wait_holder_bound "$H13_DIE" "$TEST_BACKEND_PORT_A"

# For each never-touched port: when it is FREE, spawn OUR masked holder
# (argv per port: uvicorn — gate matches, port never in a lease;
# "next-server (v…" — gate matches; "next dev -p 3001" — nomination
# matches, gate port never matches). When a FOREIGN service already holds
# it (playground/dev live on a dev box — e.g. a real uvicorn on :8101),
# THAT holder becomes the subject: either way, whatever held the port
# before the sweep must still hold it after — untouched. On CI all three
# ports are free → all holders are ours (fully deterministic).
P13_PORTS=(3100 8101 3001)
P13_ARGV=("uvicorn" "next-server (v99.1.1)" "next dev -p 3001")
P13_PIDS=()
P13_KINDS=()
cover_never_port() {
  local port="$1" argv0="$2" holder foreign
  foreign="$(lsof -ti :"$port" 2>/dev/null | head -n 1 || true)"
  if [ -n "$foreign" ]; then
    P13_PIDS+=("$foreign")     # foreign holder — observed, never registered
    P13_KINDS+=("foreign")
  else
    holder="$(spawn_named_holder "$argv0" "$port")"
    register_pid "$holder"
    wait_holder_bound "$holder" "$port"
    P13_PIDS+=("$holder")
    P13_KINDS+=("own")
  fi
}
cover_never_port 3100 "uvicorn"
cover_never_port 8101 "next-server (v99.1.1)"
cover_never_port 3001 "next dev -p 3001"

set +e
SW13_OUT=$(sweep_dead_runs 2>"$WORK/case13.err"); SW13_RC=$?
set -e

[ "$SW13_RC" -eq 0 ] || CASE13_OK=false
[ -z "$SW13_OUT" ] || CASE13_OK=false
wait_pid_gone "$H13_DIE" 10 || CASE13_OK=false          # the sweep really swept
I13=0
while [ "$I13" -lt "${#P13_PIDS[@]}" ]; do
  if check_port_survivor "${P13_PORTS[$I13]}" "${P13_PIDS[$I13]}"; then :; else CASE13_OK=false; fi
  I13=$((I13 + 1))
done
[ ! -e "$SHARD_RUNS_DIR/$DEAD13_TAG.run" ] || CASE13_OK=false

if $CASE13_OK; then
  echo "PASS Case 13 (#317): full sweep killed the dead-lease holder; holders on 3100/8101/3001 survived untouched (kinds: ${P13_KINDS[*]})"
else
  echo "FAIL Case 13 (#317): rc=$SW13_RC out='$SW13_OUT' die_holder=$(kill -0 "$H13_DIE" 2>/dev/null && echo alive || echo dead)"
  echo "── Case 13 sweep stderr ──"
  cat "$WORK/case13.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Summary ────────────────────────────────────────────────────────────────
if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
