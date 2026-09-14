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

# ── Summary ────────────────────────────────────────────────────────────────
if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
