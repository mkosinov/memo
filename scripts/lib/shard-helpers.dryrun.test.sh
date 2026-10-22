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
#   → Case 9 (§3.2 + #448 Task 2): fail-fast rc≠0, message names the window,
#     the attempt budget and the /proc-tables hint (the lsof advice is gone).
#     Busy-everything comes from the /proc FIXTURE (lsof-invisible holders —
#     the #448 bug class); the non-Linux fallback branch keeps the legacy
#     per-port `lsof -ti` with the PATH-stub call counter ≤ attempts budget
#     on its own unreadable-root fixture; live-proc control succeeds.
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
#   → Case 14 (#317 §3.3 tail audit): tag without a live lease = garbage —
#     all three file families (DB + canon sibling, photo dir, build dir)
#     of an orphan tag removed with NO grace; lookalikes without a valid
#     6-hex suffix (untagged legacy names, 12-hex, non-hex suffixes)
#     untouched; own-tag protection (valid tag shields, empty tag shields
#     nothing, INVALID tag shields nothing + stderr warning); log dir of
#     an orphan tag KEPT while fresh (grace is log-only); SHARD_LOGS_DIR
#     default pins to ${TMPDIR:-/tmp}/test-all-logs; audit runs with a
#     NONEXISTENT lease dir (first run collects abandoned files); rc=0,
#     stdout silent.
#   → Case 15 (#317 §3.3 tail audit): live lease of a manual stack
#     protects its file resources + log dir + pid; dead lease → file
#     resources removed immediately (no grace) but the LEASE FILE itself
#     is sweep's business (untouched); log-dir death clock: dead lease
#     started_epoch WINS over a fresh dir mtime (stale stamp + fresh mtime
#     → removed; fresh stamp → kept), no-lease dirs judged by mtime
#     (touch -t old → removed, fresh → kept); non-dir/hex-invalid run-*
#     entries untouched.
#   → Case 16 (#317 Task 4, US-6 seam): cleanup_shards removes the run's
#     OWN lease (guarded by file presence), never a foreign one; no-tag
#     caller shape touches no lease at all; kill_port_orphans is GONE
#     (unmasked port kills banned — startup cleaning is sweep_dead_runs').
#   → Case 17 (#317 Task 7 + #448 Task 2): _legacy_ports_free — the single
#     busy-gate on ports {3002,3003,8001,8002} (overridable via
#     SHARD_LEGACY_PORTS for deterministic fake-holder steering); free →
#     rc 0, one holder → rc 1, holder gone → rc 0 again; on the /proc
#     FIXTURE: attributed busy → rc 1, lsof-INVISIBLE ownerless busy →
#     rc 1 (port_free proves the invisibility), fixture-free → rc 0.
#   → Case 18 (#317 Task 7, §3.3 wipe, US-1/US-4/US-5/US-7): tagged wipe —
#     own .next-shard-*_<tag> always removed; untagged legacy + lookalikes
#     (.next-shard-N / .next-shard-stale / invalid-suffix) removed only
#     when the legacy ports are all free, kept when a fake holder occupies
#     one; foreign tagged NEVER touched; EMPTY tag → byte-identical
#     unconditional legacy glob (everything dies, incl. foreign-tagged);
#     INVALID tag → stderr warning + legacy fallback.
#   → Case 19 (#317 Task 7, §3.3 cleanup, US-1/US-4/US-6/US-7): tagged
#     cleanup file tail — own db+canon+photo+build dirs and own lease
#     removed; foreign tagged files+lease kept; untagged db/photo removed
#     only when the legacy ports are free; untagged BUILD dirs never
#     (wipe's business); EMPTY tag → today's masks exactly (test_memo_
#     shard*.db + test_files_shard*; canon.sql and .next-shard-* survive;
#     no lease side effects).
#   → Case 20 (#317 Task 7): frontend control sweep keyed on the ACTUAL
#     SHARD_FRONTEND_PORTS — `next dev -p <port>` and `next-server (v`
#     holders on the run's own dynamic ports die; argv-matching holders
#     on foreign ports survive (port-hold discriminator).
#   → Case 21 (#317 Task 7, US-6): INT and TERM to a child wired like
#     test-all.sh (trap EXIT/INT/TERM → cleanup_shards) run the cleaner:
#     exit 128+sig, wrapper dead (TERM rung), own tagged resources + own
#     lease + gate-open untagged db removed, foreign tagged + lease intact.
#   → Case 22 (#317 Task 7/Task 5): zero-port lease slots (manual stacks)
#     skip the sweep ladder naturally — dead manual lease (front back 0 0):
#     holder on a REAL lease port killed via the ladder, masked innocent
#     on an unrelated port survives, tagged files + lease removed.
#
# Spec coverage (Feature #448, /proc port resolver + fail-fast run — LIB
# primitives, docs/specs/2026-10-20-shard-port-resolver-failfast-448-design.md
# §3.1/§3.2; Task 1 added the PRIMITIVES, Task 2 migrated the five lsof call
# sites onto them — _masked_pids / allocate / _legacy_ports_free in the lib,
# TOCTOU-recheck + .next-wipe guard in test-all.sh via _listener_on):
#   → Case 23 (§3.1, US-1): listen_pairs on a /proc-form FIXTURE (make_proc_
#     fixture & co) — tcp + tcp6 tables; LISTEN rows resolved, non-LISTEN
#     (ESTABLISHED/TIME_WAIT) never reported; hex→dec port decode (incl.
#     alpha-heavy hex); inode→pid attribution incl. the fork shape (two pids
#     share one listening socket); duplicate fd of one owner does not
#     duplicate output; ownerless LISTEN inode → «- port» fail-closed busy
#     line; missing tcp6 is NOT an error (tcp rows still resolved).
#   → Case 24 (§3.1, fallback + testability gate): unreadable /proc root →
#     rc≠0, EMPTY stdout, EXACTLY ONE stderr warning (callers keep the lsof
#     path — Task 2's five sites); the SHARD_PROC_ROOT override is honoured
#     ONLY under a non-empty SHARD_PROC_DRYRUN — without the flag the sample
#     comes from the real /proc and the fixture port never leaks in.
#   → Case 25 (§3.2): _watch_interval_s normalizer — non-number/empty, 0,
#     negative, 601, float, padded → 5; 1..600 pass through (incl. 007 → 7);
#     caller shape: env SHARD_STACK_WATCH_S normalized through it.
#   → Case 26 (§3.1, US-3 conjunction): masked holder on a port → attributed
#     by the live resolver (Linux-only assert) and KILLED by _sweep_masked;
#     unmasked holder on a port → resolver sees the pair (mask is the
#     consumer's business) but the sweep spares it; unattributable fixture
#     row → sample line is exactly «- <port>» (busy, «-» is never a pgrep
#     candidate — no kill) with NO numeric pid claiming the port.
#   → Case 27 (#448 Task 2, US-2): _listener_on — the busy-probe behind the
#     legacy gate / TOCTOU recheck / .next-wipe guard — on the /proc fixture:
#     attributed busy → rc 0, ownerless busy (lsof-INVISIBLE, proven via
#     port_free — the #448 bug class) → rc 0, free → rc≠0, any-busy arg set →
#     rc 0, no args → rc≠0; fixture inert without SHARD_PROC_DRYRUN;
#     unreadable root → the legacy per-port `lsof -ti` fallback fires
#     (PATH-stub call counter ≥ 1 proves lsof really ran).
#   → Case 28 (#448 Task 2, US-2): allocate_shard_ports on the fixture —
#     fully fixture-busy window (incl. lsof-invisible ownerless rows) →
#     rc≠0 fail-fast; wider window → 4 distinct in-window ports never
#     including the fixture-busy ones (busy/free discrimination is the
#     resolver's — lsof sees those ports FREE).
#   → Case 29 (#448 Task 4, US-4/US-5, rev4 hard form): run_watchdog on real
#     background children — wrapper death while both stages live → diagnosis
#     (shard, ports, capped stack-log tail) + marker + TERM to BOTH stages
#     (the neighbor stage too — rev4); the neighbor WRAPPER survives; the
#     pre-file phase (stage lists not yet published) watches on without a
#     premature self-exit.
#   → Case 30 (#448 Task 4, US-6): wrapper death AFTER a stage already
#     finished → marker still set + the surviving stage TERMed; one finished
#     stage alone does not end the watch.
#   → Case 31 (#448 Task 4): no deaths → clean self-exit (rc 0) once every
#     stage pid is gone, no marker, wrapper untouched.
#   → Case 32 (#448 Task 4): TERM-ignoring stuck stage → escalation to
#     SIGKILL within the (shrunk) grace budget; the normal stage TERMed.

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

# ── #448 Task 4: orchestrator-watchdog stubs (real background children) ─────
# The watchdog cases deviate from the $( )-call convention ON PURPOSE: the
# fake wrappers/stages must be DIRECT children of THIS shell — exactly the
# test-all.sh shape (stack wrappers = SHARD_BACKEND_PIDS subshells, stages =
# ALL_PIDS subshells; run_watchdog itself is a background subshell SIBLING of
# both lists: kill -0 reaches them, `wait` inside the watchdog answers 127 —
# the PARENT does the reaping, which is what makes kill -0 fail there). Only
# direct children allow the parent-side `kill -9 $pid; wait $pid` moves the
# cases assert with. So: call the spawn helpers PLAINLY (no command
# substitution — a $( ) would orphan the child and break wait/reaping) and
# take the PID from `$!` right after the call; the helper's stdout printf
# goes to /dev/null (spawn rules 1-2 keep applying: detached stdio,
# registration in the parent).

# spawn_term_logging_stage MARKER — TERM-sensitive fake Playwright stage:
# python3 sleeping 300 s; on SIGTERM writes MARKER and exits 0. The marker
# proves the TERM rung reached THIS stage (SIGKILL writes nothing) — the
# neighbor-stage assertion of the rev4 hard form.
spawn_term_logging_stage() {
  local marker="$1"
  (
    exec -a pw-fake-stage python3 -c '
import signal, sys, time
marker = sys.argv[1]
def on_term(signum, frame):
    open(marker, "w").write("term")
    sys.exit(0)
signal.signal(signal.SIGTERM, on_term)
time.sleep(300)
' "$marker"
  ) >/dev/null 2>&1 </dev/null &
  printf '%s' "$!"
}

# spawn_term_ignoring_stage — stuck stage (SIGTERM → SIG_IGN): only the KILL
# rung of the watchdog ladder can stop it; its death alone proves the
# escalation fired (TERM cannot kill it). Same direct-child call shape.
spawn_term_ignoring_stage() {
  (
    exec -a pw-stuck-stage python3 -c '
import signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(300)
'
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

# ── #448 Task 1: /proc-form fixture helpers (reused by Task 2 call sites) ───
# The resolver reads three things under one root: net/tcp + net/tcp6 (kernel
# table format) and <pid>/fd/<n> symlinks with target socket:[inode]. The
# fixture mirrors that shape in a temp dir; the library honours the root
# override ONLY in dryrun mode (non-empty SHARD_PROC_DRYRUN + SHARD_PROC_ROOT
# — production reads the literal /proc and cannot be steered by the env).
# Fixture ports live in 20001-20009/2748: outside the repo service ports
# (3000-3003, 8000-8002, 3100, 8101), the shard window (28000-32700) and the
# harness triplet window (38200-46099) — nothing real binds them, so
# absence-assertions against the live /proc stay deterministic.

# make_proc_fixture DIR — skeleton: net/tcp + net/tcp6, each with the kernel
# header line. The header is LOAD-BEARING: an empty tables stream would
# break the resolver's NR==FNR awk join (empty first file), while the real
# kernel always emits it — the fixture must mirror that invariant.
make_proc_fixture() {
  mkdir -p "$1/net"
  printf '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' > "$1/net/tcp"
  printf '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' > "$1/net/tcp6"
}

# proc_fix_row DIR TABLE INODE HEXPORT [STATE] — append one socket row to
# DIR/net/TABLE (tcp|tcp6). Zero-filled local/remote addresses + the given
# hex port; state defaults to 0A (LISTEN); the inode lands in field 10
# exactly like a kernel row. sl is a cosmetic constant (field 1 is never
# parsed by the resolver).
proc_fix_row() {
  local dir="$1" tbl="$2" ino="$3" hexport="$4" state="${5:-0A}"
  printf '  0: 00000000000000000000000000000000:%s 00000000000000000000000000000000:0000 %s 00000000:00000000 00:00000000 00000000     0        0 %s 1 0000000000 100 0 0 10 0\n' \
    "$hexport" "$state" "$ino" >> "$dir/net/$tbl"
}

# proc_fix_owner DIR PID INODE — fake process: DIR/PID/fd/<inode> symlink →
# socket:[INODE] (fd entry names are irrelevant to the scan — the glob takes
# any entry under <pid>/fd/; one per owner suffices, the inode is unique).
proc_fix_owner() {
  mkdir -p "$1/$2/fd"
  ln -sf "socket:[$3]" "$1/$2/fd/$3"
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

# ── Case 9 (#317 §3.2 + #448 Task 2): window exhausted → bounded fail-fast ──
echo "── Case 9 (#317+#448): fail-fast after ≤20 attempts; fixture-busy window, /proc hint ──"
fresh_root "case9"
source_lib
# Controls (9a/9b) assume the live box has nothing on 20001-20004 — the
# Task-1-vetted fixture range; if a foreign process sits there, skip them.
CONT9=true
for p9c in 20001 20002 20003 20004; do
  port_free "$p9c" || CONT9=false
done
# 9a (resolver path): pinned 4-port window, ALL four ports fixture-busy.
# The holders are lsof-INVISIBLE (fixture rows only, no real socket) — the
# exact #448 bug class: the old lsof check called them free and the run died
# on EADDRINUSE; the resolver-driven allocator must exhaust and fail-fast
# with the /proc-tables hint (no lsof advice left in the message).
FIX9A="$WORK/procfix-case9a"
make_proc_fixture "$FIX9A"
proc_fix_row   "$FIX9A" tcp 92001 4E21 0A     # 20001 busy, attributed
proc_fix_owner "$FIX9A" 5151 92001
proc_fix_row   "$FIX9A" tcp 92002 4E22 0A     # 20002 busy, ownerless → invisible
proc_fix_row   "$FIX9A" tcp6 92003 4E23 0A    # 20003 busy (tcp6 table)
proc_fix_row   "$FIX9A" tcp6 92004 4E24 0A    # 20004 busy (tcp6 table)
SHARD_PORT_WINDOW_LOW=20001
SHARD_PORT_WINDOW_HIGH=20004
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX9A"
set +e
P9=$(allocate_shard_ports 2>&1); R9=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
CASE9A_OK=true
[ "$R9" -ne 0 ] || CASE9A_OK=false
printf '%s\n' "$P9" | grep -q "20001-20004" || CASE9A_OK=false
printf '%s\n' "$P9" | grep -q "$SHARD_ALLOC_MAX_ATTEMPTS" || CASE9A_OK=false
printf '%s\n' "$P9" | grep -q '/proc/net/tcp' || CASE9A_OK=false   # /proc hint
if printf '%s\n' "$P9" | grep -q 'lsof'; then CASE9A_OK=false; fi  # lsof advice gone
# 9a control: same pinned window against the LIVE /proc (fixture inert) —
# the real 20001-20004 are free, so the allocation must succeed: proves the
# FIXTURE rows drove the failure, not the window pinning. Bounded
# coupon-collector retry (the Case 8/28 pattern): collecting all 4 ports of
# a 4-wide window in 20 draws misses a coupon ~1.3% of runs — retried, not
# treated as a property violation.
R9C=-1 RETRY9C=0
if [ "$CONT9" = true ]; then
  while [ "$RETRY9C" -lt 5 ]; do
    RETRY9C=$((RETRY9C + 1))
    set +e
    P9C=$(allocate_shard_ports 2>&1); R9C=$?
    set -e
    [ "$R9C" -eq 0 ] && break
  done
  [ "$R9C" -eq 0 ] || CASE9A_OK=false
fi
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
# 9b (non-Linux fallback branch): fixture root WITHOUT net/tcp → listen_pairs
# rc 1 → the allocator keeps the legacy per-port `lsof -ti`; the PATH stub
# reports every port held → rc≠0, and the call counter stays within the
# attempts budget — the #317 contract, preserved byte-for-byte for non-Linux
# runs on its own fixture.
FIX9B="$WORK/procfix-case9b"
mkdir -p "$FIX9B"                             # no net/ at all
cat > "$STUBS/lsof" <<EOF
#!/bin/sh
printf 'x' >> "$STUBS/lsof_calls"
exit 0
EOF
chmod +x "$STUBS/lsof"
rm -f "$STUBS/lsof_calls"
SHARD_PORT_WINDOW_LOW=20001
SHARD_PORT_WINDOW_HIGH=20004
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX9B"
set +e
P9B=$(PATH="$STUBS:$PATH" allocate_shard_ports 2>&1); R9B=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
LSOF_N=$(wc -c < "$STUBS/lsof_calls" 2>/dev/null || printf '0')
LSOF_N=$((LSOF_N))
CASE9B_OK=true
[ "$R9B" -ne 0 ] || CASE9B_OK=false
[ "$LSOF_N" -le "$SHARD_ALLOC_MAX_ATTEMPTS" ] || CASE9B_OK=false
[ "$LSOF_N" -gt 0 ] || CASE9B_OK=false         # the legacy lsof really ran
# 9b control: unreadable root + the REAL lsof → fallback sees the fixture-only
# ports free → rc 0 (the stub drove the failure, not the broken resolver).
# Same bounded coupon-collector retry as the 9a control (4-wide window).
R9D=-1 RETRY9D=0
if [ "$CONT9" = true ]; then
  SHARD_PROC_DRYRUN=1
  SHARD_PROC_ROOT="$FIX9B"
  while [ "$RETRY9D" -lt 5 ]; do
    RETRY9D=$((RETRY9D + 1))
    set +e
    P9D=$(allocate_shard_ports 2>&1); R9D=$?
    set -e
    [ "$R9D" -eq 0 ] && break
  done
  unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
  [ "$R9D" -eq 0 ] || CASE9B_OK=false
fi
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
rm -f "$STUBS/lsof" "$STUBS/lsof_calls"
CASE9_OK=true
$CASE9A_OK || CASE9_OK=false
$CASE9B_OK || CASE9_OK=false
if $CASE9_OK; then
  echo "PASS Case 9 (#317+#448): fixture-busy window (incl. lsof-invisible) → rc≠0, message names window+attempts+/proc hint; fallback branch: lsof calls=$LSOF_N ≤ $SHARD_ALLOC_MAX_ATTEMPTS; controls rc=$R9C/$R9D (tries $RETRY9C/$RETRY9D)"
else
  echo "FAIL Case 9 (#317+#448): 9a rc=$R9 (hint=/proc-net-tcp) 9b rc=$R9B lsof_calls=$LSOF_N controls=$R9C/$R9D tries=$RETRY9C/$RETRY9D cont9=$CONT9"
  echo "── Case 9 outputs ──"
  printf '9a: %s\n9b: %s\n' "$P9" "$P9B"
  echo "─────────────────"
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

# ── Case 14 (#317 §3.3): tail audit — orphan tag without lease = garbage ────
echo "── Case 14 (#317 §3.3): tag without live lease removed; lookalikes/own tag kept ──"
fresh_root "case14"
# NONEXISTENT lease dir — decision: audit still runs over file resources
# (first run collects abandoned files; spec §3.3 «Пустой каталог лиз-файлов —
# аудит всё равно проходит»).
SHARD_RUNS_DIR="$WORK/lease-runs-case14-absent"
# Pin the log-root DEFAULT: SHARD_LOGS_DIR must resolve from TMPDIR exactly
# like the spec's ${TMPDIR:-/tmp}/test-all-logs (evaluated at source time,
# same override pattern as SHARD_RUNS_DIR). Redirect TMPDIR into WORK so the
# fake run-<tag> dirs live in the harness temp tree (EXIT trap reaps them).
TMPDIR14_SAVED="${TMPDIR:-}"
TMPDIR="$WORK/tmpdir-case14"
mkdir -p "$TMPDIR"
unset SHARD_LOGS_DIR
source_lib
CASE14_OK=true
[ "${SHARD_LOGS_DIR:-}" = "$WORK/tmpdir-case14/test-all-logs" ] || CASE14_OK=false
TMPDIR="$TMPDIR14_SAVED"
[ -n "$TMPDIR" ] || unset TMPDIR
# Fixture root for the rest of the case (the pin assert above already
# checked the lib's source-time default; pre-implementation RED runs need
# the var defined under set -u as well).
SHARD_LOGS_DIR="${SHARD_LOGS_DIR:-$WORK/tmpdir-case14/test-all-logs}"

# Orphan tag AA — no lease anywhere: ALL THREE file families are garbage.
ORPH14="aa1400"
mkdir -p "$ROOT/backend/test_files_shard1_$ORPH14" "$ROOT/frontend/admin/.next-shard-1_$ORPH14"
printf 'db'    > "$ROOT/backend/test_memo_shard1_${ORPH14}.db"
printf 'sql'   > "$ROOT/backend/test_memo_shard2_${ORPH14}.canon.sql"
printf 'file'  > "$ROOT/backend/test_files_shard1_${ORPH14}/avatar.png"
printf 'chunk' > "$ROOT/frontend/admin/.next-shard-1_${ORPH14}/x.js"
# Own tag — valid current tag shields its resources (no lease needed:
# at audit time in test-all.sh the run's OWN lease may not exist yet).
OWN14="bb1421"
mkdir -p "$ROOT/backend/test_files_shard1_$OWN14" "$ROOT/frontend/admin/.next-shard-2_$OWN14"
printf 'db'    > "$ROOT/backend/test_memo_shard1_${OWN14}.db"
# Lookalikes WITHOUT a valid 6-hex suffix — NOT audit targets (Task 7's
# wipe / legacy rules own them): untagged legacy names, 12-hex, non-hex.
printf 'db'  > "$ROOT/backend/test_memo_shard1.db"
printf 'sql' > "$ROOT/backend/test_memo_shard2.canon.sql"
mkdir -p "$ROOT/backend/test_files_shard1" "$ROOT/frontend/admin/.next-shard-stale" \
         "$ROOT/frontend/admin/.next-shard-9_badtag"
printf 'db' > "$ROOT/backend/test_memo_shard1_${ORPH14}${ORPH14}.db"   # 12 hex — not 6
# Log dirs: orphan tag but FRESH mtime → KEPT (grace is log-only, §3.3);
# own tag → KEPT.
mkdir -p "$SHARD_LOGS_DIR/run-$ORPH14" "$SHARD_LOGS_DIR/run-$OWN14"
printf 'log' > "$SHARD_LOGS_DIR/run-$ORPH14/pytest.log"

set +e
A14_OUT=$(audit_orphan_tagged "$OWN14" 2>"$WORK/case14.err"); A14_RC=$?
set -e

[ "$A14_RC" -eq 0 ] || CASE14_OK=false
[ -z "$A14_OUT" ] || CASE14_OK=false            # audit is stdout-silent
# orphan tag: every family removed, no grace
[ ! -e "$ROOT/backend/test_memo_shard1_${ORPH14}.db" ] || CASE14_OK=false
[ ! -e "$ROOT/backend/test_memo_shard2_${ORPH14}.canon.sql" ] || CASE14_OK=false
[ ! -e "$ROOT/backend/test_files_shard1_$ORPH14" ] || CASE14_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$ORPH14" ] || CASE14_OK=false
# own tag: shielded
[ -e "$ROOT/backend/test_memo_shard1_${OWN14}.db" ] || CASE14_OK=false
[ -e "$ROOT/backend/test_files_shard1_$OWN14" ] || CASE14_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-2_$OWN14" ] || CASE14_OK=false
# lookalikes: untouched
[ -e "$ROOT/backend/test_memo_shard1.db" ] || CASE14_OK=false
[ -e "$ROOT/backend/test_memo_shard2.canon.sql" ] || CASE14_OK=false
[ -e "$ROOT/backend/test_files_shard1" ] || CASE14_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE14_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-9_badtag" ] || CASE14_OK=false
[ -e "$ROOT/backend/test_memo_shard1_${ORPH14}${ORPH14}.db" ] || CASE14_OK=false
# log dirs: fresh orphan KEPT (grace), own KEPT
[ -d "$SHARD_LOGS_DIR/run-$ORPH14" ] || CASE14_OK=false
[ -d "$SHARD_LOGS_DIR/run-$OWN14" ] || CASE14_OK=false

# Invalid current tag shields NOTHING: resources of a lease-less tag die,
# the previously-own resources die too (nothing is "own"), stderr warns.
set +e
A14B_OUT=$(audit_orphan_tagged "ZZZZZZ" 2>"$WORK/case14b.err"); A14B_RC=$?
set -e
[ "$A14B_RC" -eq 0 ] || CASE14_OK=false
[ -z "$A14B_OUT" ] || CASE14_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${OWN14}.db" ] || CASE14_OK=false
grep -q 'audit_orphan_tagged' "$WORK/case14b.err" 2>/dev/null || CASE14_OK=false

if $CASE14_OK; then
  echo "PASS Case 14 (#317): orphan tag removed (3 families, no grace); lookalikes + own tag kept; fresh orphan log dir kept; invalid/empty-tag protection semantics pinned"
else
  echo "FAIL Case 14 (#317): rc=$A14_RC/$A14B_RC out='$A14_OUT/$A14B_OUT'"
  echo "── Case 14 audit stderr ──"
  cat "$WORK/case14.err" "$WORK/case14b.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 15 (#317 §3.3): tail audit — live lease shields; death clock ───────
echo "── Case 15 (#317 §3.3): live lease protected; log-dir death clock (stamp|mtime) + 24h grace ──"
fresh_root "case15"
SHARD_RUNS_DIR="$WORK/lease-runs-case15"
SHARD_LOGS_DIR="$WORK/logs-case15"
mkdir -p "$SHARD_RUNS_DIR" "$SHARD_LOGS_DIR"
source_lib
CASE15_OK=true

# LIVE lease (manual-stack shape: alive pid + fresh stamp): resources,
# log dir and the pid itself all survive.
LIVE15_TAG="dd1500"
LIVE15_PID="$(spawn_sleep_wrapper)"
register_pid "$LIVE15_PID"
set +e
write_run_lease "$LIVE15_TAG" "$LIVE15_PID" 29201 29202 29203 29204 2>/dev/null; W15_RC=$?
set -e
[ "$W15_RC" -eq 0 ] || CASE15_OK=false
mkdir -p "$ROOT/backend/test_files_shard1_$LIVE15_TAG" "$ROOT/frontend/admin/.next-shard-1_$LIVE15_TAG" \
         "$SHARD_LOGS_DIR/run-$LIVE15_TAG"
printf 'db' > "$ROOT/backend/test_memo_shard1_${LIVE15_TAG}.db"

# DEAD lease, FRESH stamp: file resources die immediately (no grace), but
# the log dir survives (death clock = started_epoch ≈ now) and the LEASE
# FILE itself is sweep's business — audit leaves it in place.
DEAD15_TAG="ee1510"
DEAD15_PID="$(spawn_dead_pid)"
if kill -0 "$DEAD15_PID" 2>/dev/null; then
  echo "FATAL: Case 15 dead-pid fixture is alive" >&2
  exit 1
fi
set +e
write_run_lease "$DEAD15_TAG" "$DEAD15_PID" 29211 29212 29213 29214 2>/dev/null; W15B_RC=$?
set -e
[ "$W15B_RC" -eq 0 ] || CASE15_OK=false
mkdir -p "$ROOT/backend/test_files_shard2_$DEAD15_TAG" "$SHARD_LOGS_DIR/run-$DEAD15_TAG"
printf 'db' > "$ROOT/backend/test_memo_shard2_${DEAD15_TAG}.db"

# DEAD lease, STALE stamp (24 h + 1 h ago): the log dir dies EVEN THOUGH its
# mtime is fresh — started_epoch of the dead lease WINS over mtime (the
# discriminating assert for the death-clock source).
STALE15_TAG="ff1520"
STALE15_PID="$(spawn_dead_pid)"
STALE15_STAMP=$(( $(date +%s) - SHARD_LEASE_MAX_AGE_S - 3600 ))
printf '%s %s %s %s %s %s %s %s\n' "$STALE15_PID" "$STALE15_TAG" \
  29221 29222 29223 29224 "$STALE15_STAMP" > "$SHARD_RUNS_DIR/$STALE15_TAG.run"
mkdir -p "$SHARD_LOGS_DIR/run-$STALE15_TAG"

# NO lease at all → mtime is the death clock: old-mtime dir dies,
# fresh-mtime dir lives.
mkdir -p "$SHARD_LOGS_DIR/run-0a1530" "$SHARD_LOGS_DIR/run-0b1540"
touch -t 202001010000 "$SHARD_LOGS_DIR/run-0a1530"
# hex-invalid / non-dir run-* entries — never audit targets.
mkdir -p "$SHARD_LOGS_DIR/run-12345" "$SHARD_LOGS_DIR/run-ABCDEF"
printf 'x' > "$SHARD_LOGS_DIR/run-$LIVE15_TAG.log"

set +e
A15_OUT=$(audit_orphan_tagged "" 2>"$WORK/case15.err"); A15_RC=$?
set -e

[ "$A15_RC" -eq 0 ] || CASE15_OK=false
[ -z "$A15_OUT" ] || CASE15_OK=false
# live lease: everything of it survives
[ -e "$ROOT/backend/test_memo_shard1_${LIVE15_TAG}.db" ] || CASE15_OK=false
[ -e "$ROOT/backend/test_files_shard1_$LIVE15_TAG" ] || CASE15_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-1_$LIVE15_TAG" ] || CASE15_OK=false
[ -d "$SHARD_LOGS_DIR/run-$LIVE15_TAG" ] || CASE15_OK=false
[ -e "$SHARD_RUNS_DIR/$LIVE15_TAG.run" ] || CASE15_OK=false
if kill -0 "$LIVE15_PID" 2>/dev/null; then :; else CASE15_OK=false; fi
# dead-fresh: files gone (no grace), log dir KEPT, lease file KEPT
[ ! -e "$ROOT/backend/test_memo_shard2_${DEAD15_TAG}.db" ] || CASE15_OK=false
[ ! -e "$ROOT/backend/test_files_shard2_$DEAD15_TAG" ] || CASE15_OK=false
[ -d "$SHARD_LOGS_DIR/run-$DEAD15_TAG" ] || CASE15_OK=false
[ -e "$SHARD_RUNS_DIR/$DEAD15_TAG.run" ] || CASE15_OK=false
# dead-stale: log dir REMOVED despite fresh mtime (stamp wins)
[ ! -d "$SHARD_LOGS_DIR/run-$STALE15_TAG" ] || CASE15_OK=false
# no-lease dirs: old mtime removed, fresh kept
[ ! -d "$SHARD_LOGS_DIR/run-0a1530" ] || CASE15_OK=false
[ -d "$SHARD_LOGS_DIR/run-0b1540" ] || CASE15_OK=false
# hex-invalid entries untouched
[ -d "$SHARD_LOGS_DIR/run-12345" ] || CASE15_OK=false
[ -d "$SHARD_LOGS_DIR/run-ABCDEF" ] || CASE15_OK=false
[ -e "$SHARD_LOGS_DIR/run-$LIVE15_TAG.log" ] || CASE15_OK=false

if $CASE15_OK; then
  echo "PASS Case 15 (#317): live lease shielded (files+log+pid); dead lease → files gone, lease kept; death clock stamp>mtime; mtime fallback; hex-invalid kept"
else
  echo "FAIL Case 15 (#317): rc=$A15_RC out='$A15_OUT'"
  echo "── Case 15 audit stderr ──"
  cat "$WORK/case15.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 16 (#317 Task 4): cleanup_shards releases the run's own lease ─────
echo "── Case 16 (#317 Task 4): cleanup removes own lease (presence guard); foreign kept; no-tag inert; kill_port_orphans gone ──"
fresh_root "case16"
SHARD_RUNS_DIR="$WORK/lease-runs-case16"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE16_OK=true

OWN16_TAG="1616af"
FOREIGN16_TAG="f0e1d2"

# (a) foreign lease (valid line, alien pid) — never cleanup's business.
set +e
write_run_lease "$FOREIGN16_TAG" 999999 29301 29302 29303 29304 2>/dev/null; W16F_RC=$?
set -e
[ "$W16F_RC" -eq 0 ] || CASE16_OK=false

# (b) pre-#317 caller shape (no SHARD_RUN_TAG): cleanup must not touch ANY
#     lease — the lifecycle belongs to the orchestrator that wrote it.
set +e
( unset SHARD_RUN_TAG
  cleanup_shards ) >/dev/null 2>&1; C16A_RC=$?
set -e
[ "$C16A_RC" -eq 0 ] || CASE16_OK=false
[ -e "$SHARD_RUNS_DIR/$FOREIGN16_TAG.run" ] || CASE16_OK=false

# (c) tagged run shape: own lease exists → removed; foreign lease kept
#     (US-6: the run's own trace, never a foreign one).
set +e
write_run_lease "$OWN16_TAG" $$ 29311 29312 29313 29314 2>/dev/null; W16O_RC=$?
set -e
[ "$W16O_RC" -eq 0 ] || CASE16_OK=false
SHARD_RUN_TAG="$OWN16_TAG"
set +e
cleanup_shards >/dev/null 2>&1; C16B_RC=$?
set -e
[ "$C16B_RC" -eq 0 ] || CASE16_OK=false
[ ! -e "$SHARD_RUNS_DIR/$OWN16_TAG.run" ] || CASE16_OK=false
[ -e "$SHARD_RUNS_DIR/$FOREIGN16_TAG.run" ] || CASE16_OK=false

# (d) own lease already gone (idempotent second cleanup): rc 0, no side
#     effects on the foreign lease.
set +e
cleanup_shards >/dev/null 2>&1; C16C_RC=$?
set -e
[ "$C16C_RC" -eq 0 ] || CASE16_OK=false
[ -e "$SHARD_RUNS_DIR/$FOREIGN16_TAG.run" ] || CASE16_OK=false
unset SHARD_RUN_TAG

# (e) kill_port_orphans must NOT be defined anymore (Task 4 removal): the
#     unmasked `lsof -ti :PORT | kill -9` ladder is banned by §3.3 —
#     startup cleaning is sweep_dead_runs' business (masked, lease-driven).
if declare -F kill_port_orphans >/dev/null 2>&1; then
  CASE16_OK=false
  echo "  (kill_port_orphans is still defined)"
fi

if $CASE16_OK; then
  echo "PASS Case 16 (#317 Task 4): own lease removed (guard by file presence); foreign kept; no-tag mode inert; kill_port_orphans absent"
else
  echo "FAIL Case 16 (#317 Task 4): write=$W16F_RC/$W16O_RC cleanup_rc=$C16A_RC/$C16B_RC/$C16C_RC own=$([ ! -e "$SHARD_RUNS_DIR/$OWN16_TAG.run" ] && echo gone || echo present) foreign=$([ -e "$SHARD_RUNS_DIR/$FOREIGN16_TAG.run" ] && echo kept || echo gone)"
  FAIL=1
fi

# ── Case 17 (#317 Task 7): legacy-ports gate — one lsof helper, fake holders ─
echo "── Case 17 (#317 Task 7): _legacy_ports_free — deterministic via fake holders ──"
fresh_root "case17"
source_lib
CASE17_OK=true
declare -F _legacy_ports_free >/dev/null 2>&1 || CASE17_OK=false
LG17_A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
LG17_B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A")"
LG17_C="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B")"
LG17_D="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B" "$LG17_C")"
SHARD_LEGACY_PORTS=("$LG17_A" "$LG17_B" "$LG17_C" "$LG17_D")
# (a) all four gate ports free → rc 0 (untagged removal allowed)
set +e; _legacy_ports_free; R17A=$?; set -e
[ "$R17A" -eq 0 ] || CASE17_OK=false
# (b) one fake holder on a gate port → rc 1 (live untagged stack blocks)
H17="$(spawn_plain_holder "$LG17_C")"
register_pid "$H17"
wait_holder_bound "$H17" "$LG17_C"
set +e; _legacy_ports_free; R17B=$?; set -e
[ "$R17B" -ne 0 ] || CASE17_OK=false
# (c) holder gone → rc 0 again (gate re-opens; LISTEN socket dies with pid)
kill -9 "$H17" 2>/dev/null || true
wait "$H17" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$H17/}")
set +e; _legacy_ports_free; R17C=$?; set -e
[ "$R17C" -eq 0 ] || CASE17_OK=false
# (d) #448 Task 2: the gate on the /proc fixture — attributed busy → rc≠0;
# lsof-INVISIBLE ownerless busy → rc≠0 (port_free proves lsof is blind —
# the #448 bug class; the resolver gate still closes); fixture-free → rc 0.
FIX17="$WORK/procfix-case17"
make_proc_fixture "$FIX17"
proc_fix_row   "$FIX17" tcp 93001 4E21 0A     # 20001: attributed LISTEN
proc_fix_owner "$FIX17" 6161 93001
proc_fix_row   "$FIX17" tcp 93002 0ABC 0A     # 2748: ownerless (invisible)
SHARD_LEGACY_PORTS=(20001 2748)
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX17"
set +e; _legacy_ports_free; R17D=$?; set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$R17D" -ne 0 ] || CASE17_OK=false
port_free 20001 || CASE17_OK=false            # busy to the resolver, free to lsof
port_free 2748  || CASE17_OK=false
SHARD_LEGACY_PORTS=(20009 20003)              # fixture-free ports → gate open
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX17"
set +e; _legacy_ports_free; R17E=$?; set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$R17E" -eq 0 ] || CASE17_OK=false
SHARD_LEGACY_PORTS=(3002 3003 8001 8002)
if $CASE17_OK; then
  echo "PASS Case 17 (#317+#448): legacy gate free → busy (holder on $LG17_C) → free; fixture: attributed+invisible busy → rc≠0, fixture-free → rc=0"
else
  echo "FAIL Case 17 (#317+#448): helper_defined=$(declare -F _legacy_ports_free >/dev/null 2>&1 && echo yes || echo no) rc=$R17A/$R17B/$R17C fixture=$R17D/$R17E"
  FAIL=1
fi

# ── Case 18 (#317 Task 7): wipe_shard_dirs — tag-scoped contract ────────────
echo "── Case 18 (#317 Task 7): wipe — own tag always; untagged gated by legacy ports; foreign tagged never ──"
CASE18_OK=true
OWN18="ab1899"
FOE18="f0e1d2"
mk18_fixtures() {
  mkdir -p "$ROOT/frontend/admin/.next-shard-1_$OWN18" \
           "$ROOT/frontend/admin/.next-shard-stale" \
           "$ROOT/frontend/admin/.next-shard-9_badtag" \
           "$ROOT/frontend/admin/.next-shard-2_$FOE18" \
           "$ROOT/frontend/admin/.next-shard-1"
  printf 'c' > "$ROOT/frontend/admin/.next-shard-1_$OWN18/x.js"
  printf 'c' > "$ROOT/frontend/admin/.next-shard-1/y.js"
  printf 'c' > "$ROOT/frontend/admin/.next-shard-stale/z.js"
  printf 'c' > "$ROOT/frontend/admin/.next-shard-9_badtag/w.js"
  printf 'c' > "$ROOT/frontend/admin/.next-shard-2_$FOE18/v.js"
}
LG18_A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B" "$LG17_C" "$LG17_D")"
LG18_B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B" "$LG17_C" "$LG17_D" "$LG18_A")"
LG18_C="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B" "$LG17_C" "$LG17_D" "$LG18_A" "$LG18_B")"
LG18_D="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG17_A" "$LG17_B" "$LG17_C" "$LG17_D" "$LG18_A" "$LG18_B" "$LG18_C")"

# (a) tagged wipe, legacy gate OPEN: own + untagged (legacy + lookalikes)
#     die; foreign tagged survives.
fresh_root "case18a"
SHARD_LEGACY_PORTS=("$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D")
source_lib
mk18_fixtures
SHARD_RUN_TAG="$OWN18"
set +e; W18A=$(wipe_shard_dirs 2>"$WORK/case18a.err"); W18A_RC=$?; set -e
[ "$W18A_RC" -eq 0 ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$OWN18" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-9_badtag" ] || CASE18_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-2_$FOE18" ] || CASE18_OK=false
unset SHARD_RUN_TAG

# (b) tagged wipe, legacy gate BUSY (fake holder): untagged survive, own
#     still dies, foreign survives, stderr names the busy gate.
fresh_root "case18b"
SHARD_LEGACY_PORTS=("$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D")
source_lib
mk18_fixtures
H18="$(spawn_plain_holder "$LG18_B")"
register_pid "$H18"
wait_holder_bound "$H18" "$LG18_B"
SHARD_RUN_TAG="$OWN18"
set +e; W18B=$(wipe_shard_dirs 2>"$WORK/case18b.err"); W18B_RC=$?; set -e
[ "$W18B_RC" -eq 0 ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$OWN18" ] || CASE18_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE18_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE18_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-9_badtag" ] || CASE18_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-2_$FOE18" ] || CASE18_OK=false
grep -q 'legacy ports busy' "$WORK/case18b.err" 2>/dev/null || CASE18_OK=false
unset SHARD_RUN_TAG
kill -9 "$H18" 2>/dev/null || true
wait "$H18" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$H18/}")

# (c) EMPTY tag → byte-identical legacy glob: EVERYTHING .next-shard-* dies
#     (incl. foreign-tagged and lookalikes) — the pre-#317 contract (US-7).
fresh_root "case18c"
SHARD_LEGACY_PORTS=(3002 3003 8001 8002)
source_lib
mk18_fixtures
set +e; W18C=$(wipe_shard_dirs 2>&1); W18C_RC=$?; set -e
[ "$W18C_RC" -eq 0 ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$OWN18" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-9_badtag" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-2_$FOE18" ] || CASE18_OK=false

# (d) INVALID tag → stderr warning + legacy fallback (unvalidated strings
#     never enter rm-globs; the behavior is the empty-tag one).
fresh_root "case18d"
source_lib
mk18_fixtures
SHARD_RUN_TAG="n0hex!"
set +e; W18D=$(wipe_shard_dirs 2>"$WORK/case18d.err"); W18D_RC=$?; set -e
[ "$W18D_RC" -eq 0 ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$OWN18" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-stale" ] || CASE18_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-2_$FOE18" ] || CASE18_OK=false
grep -q 'SHARD_RUN_TAG' "$WORK/case18d.err" 2>/dev/null || CASE18_OK=false
unset SHARD_RUN_TAG
SHARD_LEGACY_PORTS=(3002 3003 8001 8002)

if $CASE18_OK; then
  echo "PASS Case 18 (#317 Task 7): wipe — own always; untagged gated (free: removed / busy: kept); foreign tagged kept; empty/invalid tag → legacy glob"
else
  echo "FAIL Case 18 (#317 Task 7): rc=$W18A_RC/$W18B_RC/$W18C_RC/$W18D_RC"
  echo "── Case 18 stderr (a/b) ──"
  cat "$WORK/case18a.err" "$WORK/case18b.err" "$WORK/case18d.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 19 (#317 Task 7): cleanup_shards file tail — tag-scoped ────────────
echo "── Case 19 (#317 Task 7): cleanup tail — own tag + gated untagged; foreign kept; empty tag → today's masks ──"
CASE19_OK=true
OWN19="cd1976"
FOE19="f0e1d2"
mk19_fixtures() {
  mkdir -p "$ROOT/backend/test_files_shard1_$OWN19" \
           "$ROOT/backend/test_files_shard2_$FOE19" \
           "$ROOT/backend/test_files_shard1" \
           "$ROOT/frontend/admin/.next-shard-1_$OWN19" \
           "$ROOT/frontend/admin/.next-shard-2_$FOE19" \
           "$ROOT/frontend/admin/.next-shard-1"
  printf 'db'  > "$ROOT/backend/test_memo_shard1_${OWN19}.db"
  printf 'sql' > "$ROOT/backend/test_memo_shard2_${OWN19}.canon.sql"
  printf 'db'  > "$ROOT/backend/test_memo_shard1.db"
  printf 'db'  > "$ROOT/backend/test_memo_shard1_${FOE19}.db"
  printf 'f'   > "$ROOT/backend/test_files_shard1_${OWN19}/a.png"
  printf 'f'   > "$ROOT/backend/test_files_shard2_${FOE19}/b.png"
  printf 'c'   > "$ROOT/frontend/admin/.next-shard-1_${OWN19}/x.js"
  printf 'c'   > "$ROOT/frontend/admin/.next-shard-2_${FOE19}/y.js"
}
LG19_A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D")"
LG19_B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D" "$LG19_A")"
LG19_C="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D" "$LG19_A" "$LG19_B")"
LG19_D="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG18_A" "$LG18_B" "$LG18_C" "$LG18_D" "$LG19_A" "$LG19_B" "$LG19_C")"

# (a) tagged cleanup, legacy gate OPEN: own db+canon+photo+build+lease gone;
#     foreign files+lease kept; untagged db+photo gone; untagged BUILD dir
#     kept (cleanup never wipes build dirs — wipe's business).
fresh_root "case19a"
SHARD_RUNS_DIR="$WORK/lease-runs-case19a"
mkdir -p "$SHARD_RUNS_DIR"
SHARD_LEGACY_PORTS=("$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D")
source_lib
mk19_fixtures
write_run_lease "$OWN19" $$ 29401 29402 29403 29404 2>/dev/null
write_run_lease "$FOE19" 999999 29411 29412 29413 29414 2>/dev/null
SHARD_RUN_TAG="$OWN19"
SHARD_BACKEND_PIDS=()
set +e; C19A=$(cleanup_shards 2>"$WORK/case19a.err"); C19A_RC=$?; set -e
[ "$C19A_RC" -eq 0 ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${OWN19}.db" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard2_${OWN19}.canon.sql" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_files_shard1_$OWN19" ] || CASE19_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$OWN19" ] || CASE19_OK=false
[ ! -e "$SHARD_RUNS_DIR/$OWN19.run" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_memo_shard1_${FOE19}.db" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_files_shard2_$FOE19" ] || CASE19_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-2_$FOE19" ] || CASE19_OK=false
[ -e "$SHARD_RUNS_DIR/$FOE19.run" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1.db" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_files_shard1" ] || CASE19_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE19_OK=false
unset SHARD_RUN_TAG

# (b) tagged cleanup, legacy gate BUSY: own still removed; untagged db+photo
#     survive; foreign survives; stderr names the busy gate.
fresh_root "case19b"
SHARD_RUNS_DIR="$WORK/lease-runs-case19b"
mkdir -p "$SHARD_RUNS_DIR"
SHARD_LEGACY_PORTS=("$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D")
source_lib
mk19_fixtures
write_run_lease "$OWN19" $$ 29421 29422 29423 29424 2>/dev/null
H19="$(spawn_plain_holder "$LG19_C")"
register_pid "$H19"
wait_holder_bound "$H19" "$LG19_C"
SHARD_RUN_TAG="$OWN19"
SHARD_BACKEND_PIDS=()
set +e; C19B=$(cleanup_shards 2>"$WORK/case19b.err"); C19B_RC=$?; set -e
[ "$C19B_RC" -eq 0 ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${OWN19}.db" ] || CASE19_OK=false
[ ! -e "$SHARD_RUNS_DIR/$OWN19.run" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_memo_shard1.db" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_files_shard1" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_memo_shard1_${FOE19}.db" ] || CASE19_OK=false
grep -q 'legacy ports busy' "$WORK/case19b.err" 2>/dev/null || CASE19_OK=false
unset SHARD_RUN_TAG
kill -9 "$H19" 2>/dev/null || true
wait "$H19" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$H19/}")

# (c) EMPTY tag → masks EXACTLY as today: test_memo_shard*.db (canon.sql
#     and .db-journal survive; the glob spans tagged names too — pre-#317
#     semantics) + test_files_shard*; build dirs untouched; no lease side
#     effects (US-7 / DoD §7 (d)).
fresh_root "case19c"
SHARD_RUNS_DIR="$WORK/lease-runs-case19c"
mkdir -p "$SHARD_RUNS_DIR"
SHARD_LEGACY_PORTS=(3002 3003 8001 8002)
source_lib
mkdir -p "$ROOT/backend/test_files_shard1" "$ROOT/backend/test_files_shard2_$FOE19" \
         "$ROOT/frontend/admin/.next-shard-1"
printf 'db'  > "$ROOT/backend/test_memo_shard1.db"
printf 'sql' > "$ROOT/backend/test_memo_shard2.canon.sql"
printf 'db'  > "$ROOT/backend/test_memo_shard1_${FOE19}.db"
printf 'f'   > "$ROOT/backend/test_files_shard1/a.png"
write_run_lease "$FOE19" 999999 29431 29432 29433 29434 2>/dev/null
SHARD_BACKEND_PIDS=()
set +e; C19C=$(cleanup_shards 2>"$WORK/case19c.err"); C19C_RC=$?; set -e
[ "$C19C_RC" -eq 0 ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1.db" ] || CASE19_OK=false
[ -e "$ROOT/backend/test_memo_shard2.canon.sql" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${FOE19}.db" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_files_shard1" ] || CASE19_OK=false
[ ! -e "$ROOT/backend/test_files_shard2_$FOE19" ] || CASE19_OK=false
[ -e "$ROOT/frontend/admin/.next-shard-1" ] || CASE19_OK=false
[ -e "$SHARD_RUNS_DIR/$FOE19.run" ] || CASE19_OK=false
SHARD_LEGACY_PORTS=(3002 3003 8001 8002)

if $CASE19_OK; then
  echo "PASS Case 19 (#317 Task 7): cleanup tail — own tag (db/canon/photo/build/lease) removed; untagged gated; foreign kept; empty tag → today's masks (canon.sql + build dirs survive)"
else
  echo "FAIL Case 19 (#317 Task 7): rc=$C19A_RC/$C19B_RC/$C19C_RC"
  echo "── Case 19 stderr (a/b) ──"
  cat "$WORK/case19a.err" "$WORK/case19b.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 20 (#317 Task 7): frontend sweep keyed on ACTUAL dynamic ports ─────
echo "── Case 20 (#317 Task 7): dynamic-port frontend sweep — dev-form + title-form die; foreign-port argv twins survive ──"
fresh_root "case20"
F20A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D")"
F20B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D" "$F20A")"
I20A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D" "$F20A" "$F20B")"
I20B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG19_A" "$LG19_B" "$LG19_C" "$LG19_D" "$F20A" "$F20B" "$I20A")"
SHARD_FRONTEND_PORTS=("$F20A" "$F20B")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")
SHARD_BACKEND_PIDS=()
source_lib
# Own holders on the run's ACTUAL frontend ports — both mask forms.
H20A="$(spawn_named_holder "next dev -p $F20A" "$F20A")"
register_pid "$H20A"
wait_holder_bound "$H20A" "$F20A"
H20B="$(spawn_named_holder "next-server (v21.3.1-canary)" "$F20B")"
register_pid "$H20B"
wait_holder_bound "$H20B" "$F20B"
# Innocents: argv NAMES one of our ports but BINDS a foreign port — the
# port-hold discriminator (not the pgrep nomination) must spare them.
IN20A="$(spawn_named_holder "next dev -p $F20A" "$I20A")"
register_pid "$IN20A"
wait_holder_bound "$IN20A" "$I20A"
IN20B="$(spawn_named_holder "next-server (v20.0.0)" "$I20B")"
register_pid "$IN20B"
wait_holder_bound "$IN20B" "$I20B"
set +e; C20=$(cleanup_shards 2>&1); C20_RC=$?; set -e
CASE20_OK=true
[ "$C20_RC" -eq 0 ] || CASE20_OK=false
wait_pid_gone "$H20A" 5 || CASE20_OK=false
wait_pid_gone "$H20B" 5 || CASE20_OK=false
port_free "$F20A" || CASE20_OK=false
port_free "$F20B" || CASE20_OK=false
check_port_survivor "$I20A" "$IN20A" || CASE20_OK=false
check_port_survivor "$I20B" "$IN20B" || CASE20_OK=false
# 6.5: the innocents survived on purpose — finish them here (they are ours).
kill -9 "$IN20A" "$IN20B" 2>/dev/null || true
wait "$IN20A" 2>/dev/null || true
wait "$IN20B" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$IN20A/}")
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$IN20B/}")
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT")
if $CASE20_OK; then
  echo "PASS Case 20 (#317 Task 7): sweep killed dev-form + next-server holders on $F20A/$F20B; argv-twin holders on foreign ports survived"
else
  echo "FAIL Case 20 (#317 Task 7): rc=$C20_RC dev_form=$(kill -0 "$H20A" 2>/dev/null && echo alive || echo dead) title_form=$(kill -0 "$H20B" 2>/dev/null && echo alive || echo dead)"
  echo "── Case 20 output ──"
  printf '%s\n' "$C20"
  echo "─────────────────"
  FAIL=1
fi

# ── Case 21 (#317 Task 7, US-6): INT/TERM to a test-all-wired child runs the cleaner ──
echo "── Case 21 (#317 Task 7): trap INT/TERM → cleanup_shards — own trace removed, foreign intact ──"
CASE21_OK=true
OWN21="21ab37"
FOE21="f0e1d2"
F21A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F20A" "$F20B" "$I20A" "$I20B")"
F21B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F20A" "$F20B" "$I20A" "$I20B" "$F21A")"
B21A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F20A" "$F20B" "$I20A" "$I20B" "$F21A" "$F21B")"
B21B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F20A" "$F20B" "$I20A" "$I20B" "$F21A" "$F21B" "$B21A")"
LG21_A="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F21A" "$F21B" "$B21A" "$B21B")"
LG21_B="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F21A" "$F21B" "$B21A" "$B21B" "$LG21_A")"
LG21_C="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F21A" "$F21B" "$B21A" "$B21B" "$LG21_A" "$LG21_B")"
LG21_D="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$F21A" "$F21B" "$B21A" "$B21B" "$LG21_A" "$LG21_B" "$LG21_C")"

# Fixtures root + foreign resources survive BOTH child runs.
fresh_root "case21"
ROOT21="$ROOT"
RUNS21="$WORK/lease-runs-case21"
mkdir -p "$RUNS21" "$ROOT21/backend/test_files_shard2_$FOE21" \
         "$ROOT21/frontend/admin/.next-shard-2_$FOE21"
printf 'db' > "$ROOT21/backend/test_memo_shard1_${FOE21}.db"
printf 'f'  > "$ROOT21/backend/test_files_shard2_${FOE21}/b.png"
printf 'c'  > "$ROOT21/frontend/admin/.next-shard-2_${FOE21}/y.js"
printf '%s %s %s %s %s %s %s %s\n' 999999 "$FOE21" 29501 29502 29503 29504 "$(date +%s)" \
  > "$RUNS21/$FOE21.run"

# The child replicates test-all.sh's signal wiring (trap EXIT INT TERM →
# on_signal → cleanup_shards) against THIS library, with the run's own
# dynamic ports, tag and a real wrapper to TERM. Values come via C21_* env.
CHILD21="$WORK/case21-child.sh"
cat > "$CHILD21" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$C21_ROOT"
SHARD_RUNS_DIR="$C21_RUNS"
SHARD_RUN_TAG="$C21_TAG"
read -r -a SHARD_FRONTEND_PORTS <<< "$C21_FRONTS"
read -r -a SHARD_BACKEND_PORTS <<< "$C21_BACKS"
read -r -a SHARD_LEGACY_PORTS <<< "$C21_LEGACY"
source "$C21_LIB"
on_signal() {
  trap - EXIT
  cleanup_shards
  exit $((128 + $1))
}
trap 'cleanup_shards' EXIT
trap 'on_signal 2' INT
trap 'on_signal 15' TERM
sleep 60 &
WRAP=$!
SHARD_BACKEND_PIDS=("$WRAP")
printf '%s' "$WRAP" > "$C21_WRAPF"
write_run_lease "$SHARD_RUN_TAG" "$$" \
  "${SHARD_FRONTEND_PORTS[0]}" "${SHARD_BACKEND_PORTS[0]}" \
  "${SHARD_FRONTEND_PORTS[1]}" "${SHARD_BACKEND_PORTS[1]}"
touch "$C21_READY"
wait || true
EOF

run_case21_child() {
  local sig="$1" want_rc="$2"
  # Own + gate-open-untagged fixtures are consumed by each run — recreate.
  mkdir -p "$ROOT21/backend/test_files_shard1_$OWN21" \
           "$ROOT21/frontend/admin/.next-shard-1_$OWN21"
  printf 'db'  > "$ROOT21/backend/test_memo_shard1_${OWN21}.db"
  printf 'sql' > "$ROOT21/backend/test_memo_shard2_${OWN21}.canon.sql"
  printf 'f'   > "$ROOT21/backend/test_files_shard1_${OWN21}/a.png"
  printf 'c'   > "$ROOT21/frontend/admin/.next-shard-1_${OWN21}/x.js"
  printf 'db'  > "$ROOT21/backend/test_memo_shard1.db"
  rm -f "$WORK/case21.ready" "$WORK/case21.wrap"
  # Job control ON for the spawn: a non-interactive shell without -m
  # starts `&` children with SIGINT SIG_IGN (POSIX async-list rule), and a
  # signal ignored at exec entry cannot be trapped — the child's INT trap
  # would silently never fire and the case would hang for the wrapper's
  # full sleep. Real test-all.sh runs in the foreground (INT deliverable);
  # `set -m` gives the fixture the same default INT disposition.
  set -m
  C21_ROOT="$ROOT21" C21_RUNS="$RUNS21" C21_TAG="$OWN21" \
    C21_FRONTS="$F21A $F21B" C21_BACKS="$B21A $B21B" \
    C21_LEGACY="$LG21_A $LG21_B $LG21_C $LG21_D" \
    C21_LIB="$SHARD_LIB_UNDER_TEST" \
    C21_WRAPF="$WORK/case21.wrap" C21_READY="$WORK/case21.ready" \
    bash "$CHILD21" >/dev/null 2>&1 &
  local cpid=$!
  set +m
  register_pid "$cpid"
  wait_marker "$WORK/case21.ready" 10 || return 1
  local wrap
  wrap="$(cat "$WORK/case21.wrap" 2>/dev/null || true)"
  [ -n "$wrap" ] && register_pid "$wrap"
  kill -0 "$wrap" 2>/dev/null || return 1
  local t0 rc el
  t0=$(date +%s)
  kill -"$sig" "$cpid" 2>/dev/null || true
  set +e; wait "$cpid"; rc=$?; set -e
  el=$(( $(date +%s) - t0 ))
  # Signal path asserts: exit code, bounded time, wrapper TERM'd by the
  # cleaner, own trace gone, foreign trace intact.
  [ "$rc" -eq "$want_rc" ] || return 1
  [ "$el" -le 15 ] || return 1
  wait_pid_gone "$wrap" 5 || return 1
  [ ! -e "$RUNS21/$OWN21.run" ] || return 1
  [ ! -e "$ROOT21/backend/test_memo_shard1_${OWN21}.db" ] || return 1
  [ ! -e "$ROOT21/backend/test_memo_shard2_${OWN21}.canon.sql" ] || return 1
  [ ! -e "$ROOT21/backend/test_files_shard1_$OWN21" ] || return 1
  [ ! -e "$ROOT21/frontend/admin/.next-shard-1_$OWN21" ] || return 1
  [ ! -e "$ROOT21/backend/test_memo_shard1.db" ] || return 1
  [ -e "$RUNS21/$FOE21.run" ] || return 1
  [ -e "$ROOT21/backend/test_memo_shard1_${FOE21}.db" ] || return 1
  [ -e "$ROOT21/backend/test_files_shard2_$FOE21" ] || return 1
  [ -e "$ROOT21/frontend/admin/.next-shard-2_$FOE21" ] || return 1
  return 0
}

if run_case21_child INT 130; then
  echo "PASS Case 21 (#317 Task 7): SIGINT path — cleaner ran (exit 130): own tag+lease+gate-open untagged removed, wrapper TERM'd, foreign intact"
else
  echo "FAIL Case 21 (#317 Task 7): SIGINT child did not fulfil the cleaner contract"
  FAIL=1
fi
if run_case21_child TERM 143; then
  echo "PASS Case 21 (#317 Task 7): SIGTERM path — cleaner ran (exit 143), same contract"
else
  echo "FAIL Case 21 (#317 Task 7): SIGTERM child did not fulfil the cleaner contract"
  FAIL=1
fi

# ── Case 22 (#317 Task 7/Task 5): zero-port lease slots skip naturally ──────
echo "── Case 22 (#317 Task 7): dead manual lease (front back 0 0) — ladder skips zero slots ──"
fresh_root "case22"
SHARD_RUNS_DIR="$WORK/lease-runs-case22"
mkdir -p "$SHARD_RUNS_DIR"
source_lib
CASE22_OK=true
TAG22="0c22aa"
DEAD22_PID="$(spawn_dead_pid)"
if kill -0 "$DEAD22_PID" 2>/dev/null; then
  echo "FATAL: Case 22 dead-pid fixture is alive" >&2
  exit 1
fi
F22="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG21_A" "$LG21_B" "$LG21_C" "$LG21_D")"
B22="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG21_A" "$LG21_B" "$LG21_C" "$LG21_D" "$F22")"
U22="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B" "$LG21_A" "$LG21_B" "$LG21_C" "$LG21_D" "$F22" "$B22")"
write_run_lease "$TAG22" "$DEAD22_PID" "$F22" "$B22" 0 0 2>/dev/null
mkdir -p "$ROOT/backend/test_files_shard1_$TAG22" "$ROOT/frontend/admin/.next-shard-1_$TAG22"
printf 'db' > "$ROOT/backend/test_memo_shard1_${TAG22}.db"
printf 'f'  > "$ROOT/backend/test_files_shard1_${TAG22}/a.png"
printf 'c'  > "$ROOT/frontend/admin/.next-shard-1_${TAG22}/x.js"
# TERM-stubborn masked holder on the manual stack's REAL backend port →
# the kill -9 rung of the ladder; masked innocent on an UNRELATED port
# (not in the lease, and not 0) must survive — zero slots widen nothing.
H22="$(spawn_term_ignoring_uvicorn_holder "$B22" "test_memo_shard_$TAG22")"
register_pid "$H22"
wait_holder_bound "$H22" "$B22"
IN22="$(spawn_uvicorn_holder "$U22" -)"
register_pid "$IN22"
wait_holder_bound "$IN22" "$U22"
T22=$(date +%s)
set +e; SW22_OUT=$(sweep_dead_runs 2>"$WORK/case22.err"); SW22_RC=$?; set -e
EL22=$(( $(date +%s) - T22 ))
[ "$SW22_RC" -eq 0 ] || CASE22_OK=false
[ -z "$SW22_OUT" ] || CASE22_OK=false
wait_pid_gone "$H22" 15 || CASE22_OK=false
port_free "$B22" || CASE22_OK=false
check_port_survivor "$U22" "$IN22" || CASE22_OK=false
[ ! -e "$SHARD_RUNS_DIR/$TAG22.run" ] || CASE22_OK=false
[ ! -e "$ROOT/backend/test_memo_shard1_${TAG22}.db" ] || CASE22_OK=false
[ ! -e "$ROOT/backend/test_files_shard1_$TAG22" ] || CASE22_OK=false
[ ! -e "$ROOT/frontend/admin/.next-shard-1_$TAG22" ] || CASE22_OK=false
[ "$EL22" -le 25 ] || CASE22_OK=false
kill -9 "$IN22" 2>/dev/null || true
wait "$IN22" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$IN22/}")
if $CASE22_OK; then
  echo "PASS Case 22 (#317 Task 7): zero-port lease slots skipped naturally — real-port holder killed via the ladder (${EL22}s), unrelated masked holder untouched"
else
  echo "FAIL Case 22 (#317 Task 7): rc=$SW22_RC elapsed=${EL22}s out='$SW22_OUT' holder=$(kill -0 "$H22" 2>/dev/null && echo alive || echo dead)"
  echo "── Case 22 sweep stderr ──"
  cat "$WORK/case22.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 23 (#448 §3.1, US-1): listen_pairs on the /proc fixture ────────────
echo "── Case 23 (#448): listen_pairs — LISTEN/non-LISTEN, hex→dec, tcp6, unowned → «- port» ──"
fresh_root "case23"
source_lib
CASE23_OK=true
declare -F listen_pairs >/dev/null 2>&1 || CASE23_OK=false
FIX23="$WORK/procfix-case23"
make_proc_fixture "$FIX23"
# tcp: two owned LISTEN rows (4E21/4E22 → 20001/20002), one ESTABLISHED row
# (state 01 — never reported), one ownerless LISTEN row with an alpha-heavy
# hex port (0ABC → 2748) → fail-closed «- port» busy marker.
proc_fix_row   "$FIX23" tcp 90001 4E21 0A
proc_fix_owner "$FIX23" 4242 90001
proc_fix_row   "$FIX23" tcp 90002 4E22 0A
proc_fix_owner "$FIX23" 4343 90002
proc_fix_row   "$FIX23" tcp 90003 4E23 01
proc_fix_owner "$FIX23" 4242 90003
proc_fix_row   "$FIX23" tcp 90004 0ABC 0A
# tcp6: LISTEN row shared by TWO pids (fork shape — both keep the fd) and a
# TIME_WAIT row (state 06 — never reported).
proc_fix_row   "$FIX23" tcp6 90005 4E25 0A
proc_fix_owner "$FIX23" 4444 90005
proc_fix_owner "$FIX23" 4445 90005
proc_fix_row   "$FIX23" tcp6 90006 4E26 06
proc_fix_owner "$FIX23" 4444 90006
# duplicate fd of one owner (dup'd socket) must not duplicate output lines.
ln -sf "socket:[90001]" "$FIX23/4242/fd/90001x"

SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX23"
set +e
LP23=$(listen_pairs 2>"$WORK/case23.err"); LP23_RC=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT

[ "$LP23_RC" -eq 0 ] || CASE23_OK=false
LP23_SORTED="$(printf '%s\n' "$LP23" | sort)"
WANT23="$(printf '%s\n' \
  '4242 20001' \
  '4343 20002' \
  '- 2748' \
  '4444 20005' \
  '4445 20005' | sort)"
[ "$LP23_SORTED" = "$WANT23" ] || CASE23_OK=false
# non-LISTEN ports never appear in the sample
case "$LP23" in *20003*|*20006*) CASE23_OK=false ;; esac

# missing tcp6 is NOT an error: tcp rows still resolved, rc 0
rm -f "$FIX23/net/tcp6"
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX23"
set +e
LP23B=$(listen_pairs 2>"$WORK/case23b.err"); LP23B_RC=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$LP23B_RC" -eq 0 ] || CASE23_OK=false
LP23B_SORTED="$(printf '%s\n' "$LP23B" | sort)"
WANT23B="$(printf '%s\n' '4242 20001' '4343 20002' '- 2748' | sort)"
[ "$LP23B_SORTED" = "$WANT23B" ] || CASE23_OK=false

if $CASE23_OK; then
  echo "PASS Case 23 (#448): fixture sample — LISTEN attributed (tcp+tcp6, fork shape), non-LISTEN dropped, hex→dec, dup fd deduped, unowned → «- 2748»; missing tcp6 ok"
else
  echo "FAIL Case 23 (#448): rc=$LP23_RC/$LP23B_RC"
  echo "── Case 23 sample ──"
  printf '%s\n' "$LP23"
  echo "── want (sorted) ──"
  printf '%s\n' "$WANT23"
  cat "$WORK/case23.err" "$WORK/case23b.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 24 (#448 §3.1): non-Linux fallback + dryrun-gate inertness ─────────
echo "── Case 24 (#448): unreadable root → one warning + rc≠0; override honoured only in dryrun ──"
fresh_root "case24"
source_lib
CASE24_OK=true
FIX24="$WORK/procfix-case24"          # no net/ at all → net/tcp unreadable
mkdir -p "$FIX24"
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX24"
set +e
LP24=$(listen_pairs 2>"$WORK/case24.err"); LP24_RC=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$LP24_RC" -ne 0 ] || CASE24_OK=false            # callers (Task 2) keep the lsof path
[ -z "$LP24" ] || CASE24_OK=false                  # stdout empty on fallback
WARN24=$(wc -l < "$WORK/case24.err" 2>/dev/null || printf '0')
WARN24=$((WARN24))
[ "$WARN24" -eq 1 ] || CASE24_OK=false             # ONE warning, not a per-port storm
grep -q '⚠️ listen_pairs' "$WORK/case24.err" 2>/dev/null || CASE24_OK=false   # the LIB's warning (bash's «command not found» noise must not satisfy this)

# Production inertness: the root override is honoured ONLY in dryrun mode —
# without the flag the sample comes from the REAL /proc (or the non-Linux
# fallback); the fixture port must not leak into the output either way.
# NB: FIX23 still carries the 20001 LISTEN row — a wrongly honoured override
# would emit «4242 20001» and fail the absence assert (non-vacuous).
SHARD_PROC_ROOT="$FIX23"
set +e
LP24B=$(listen_pairs 2>/dev/null); LP24B_RC=$?
set -e
unset SHARD_PROC_ROOT
case "$LP24B" in *20001*) CASE24_OK=false ;; esac   # override inert without the flag

if $CASE24_OK; then
  echo "PASS Case 24 (#448): fallback rc≠0 + empty stdout + single warning; SHARD_PROC_ROOT inert without SHARD_PROC_DRYRUN (live rc=$LP24B_RC)"
else
  echo "FAIL Case 24 (#448): rc=$LP24_RC warnings=$WARN24 inert_out_has_20001=$(printf '%s' "$LP24B" | grep -c 20001 || true)"
  echo "── Case 24 stderr ──"
  cat "$WORK/case24.err" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 25 (#448 §3.2): _watch_interval_s normalizer ───────────────────────
echo "── Case 25 (#448): watch-interval normalizer — junk/0/neg/>600 → 5; 1..600 pass ──"
fresh_root "case25"
source_lib
CASE25_OK=true
declare -F _watch_interval_s >/dev/null 2>&1 || CASE25_OK=false
wi_check() {
  WI_LAST_IN="$1"; WI_LAST_WANT="$2"
  set +e
  WI_OUT=$(_watch_interval_s "$1" 2>/dev/null); WI_RC=$?
  set -e
  [ "$WI_RC" -eq 0 ] || return 1
  [ "$WI_OUT" = "$2" ] || return 1
  return 0
}
wi_check ''    5   || CASE25_OK=false
wi_check 'abc' 5   || CASE25_OK=false
wi_check '0'   5   || CASE25_OK=false
wi_check '-3'  5   || CASE25_OK=false
wi_check '601' 5   || CASE25_OK=false
wi_check '5.5' 5   || CASE25_OK=false
wi_check ' 5'  5   || CASE25_OK=false
wi_check '1'   1   || CASE25_OK=false
wi_check '5'   5   || CASE25_OK=false
wi_check '7'   7   || CASE25_OK=false
wi_check '007' 7   || CASE25_OK=false
wi_check '600' 600 || CASE25_OK=false
# caller shape (Tasks 3-4): the layers read the env and normalize through it
SHARD_STACK_WATCH_S=9
wi_check "${SHARD_STACK_WATCH_S:-}" 9 || CASE25_OK=false
unset SHARD_STACK_WATCH_S
if $CASE25_OK; then
  echo "PASS Case 25 (#448): normalizer — invalid/0/negative/601 → 5; 1..600 pass; env caller shape ok"
else
  echo "FAIL Case 25 (#448): last input '$WI_LAST_IN' → '$WI_OUT' (want '$WI_LAST_WANT', rc=$WI_RC)"
  FAIL=1
fi

# ── Case 26 (#448 §3.1, US-3): kill conjunction on real processes ───────────
echo "── Case 26 (#448): port+mask → kill; port without mask → spared; unattributable → busy, no kill ──"
fresh_root "case26"
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")
source_lib
CASE26_OK=true

# (a) порт + маска → убить: real uvicorn-argv holder on a backend port. The
# live-resolver attribution assert is Linux-only (non-Linux = the fallback
# contract of Case 24); the kill contract runs everywhere (lsof path today,
# resolver path after Task 2 — the conjunction is the consumer's, unchanged).
H26="$(spawn_uvicorn_holder "$TEST_BACKEND_PORT_A" -)"
register_pid "$H26"
wait_holder_bound "$H26" "$TEST_BACKEND_PORT_A"
if [ -r /proc/net/tcp ]; then
  set +e
  LP26=$(listen_pairs 2>/dev/null); LP26_RC=$?
  set -e
  [ "$LP26_RC" -eq 0 ] || CASE26_OK=false
  printf '%s\n' "$LP26" | grep -qx "$H26 $TEST_BACKEND_PORT_A" || CASE26_OK=false
else
  echo "  (non-Linux: live-resolver assert skipped — fallback contract is Case 24's)"
fi
_sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"
wait_pid_gone "$H26" 5 || CASE26_OK=false
port_free "$TEST_BACKEND_PORT_A" || CASE26_OK=false

# (b) порт без маски → не убивать: plain-argv holder survives the same sweep;
# the resolver still attributes the pair (the mask is the consumer's gate).
P26="$(spawn_plain_holder "$TEST_BACKEND_PORT_B")"
register_pid "$P26"
wait_holder_bound "$P26" "$TEST_BACKEND_PORT_B"
if [ -r /proc/net/tcp ]; then
  set +e
  LP26B=$(listen_pairs 2>/dev/null); LP26B_RC=$?
  set -e
  [ "$LP26B_RC" -eq 0 ] || CASE26_OK=false
  printf '%s\n' "$LP26B" | grep -qx "$P26 $TEST_BACKEND_PORT_B" || CASE26_OK=false
fi
_sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"
check_port_survivor "$TEST_BACKEND_PORT_B" "$P26" || CASE26_OK=false

# (c) неатрибутируемый → не убивать, порт занят: fixture row with an ownerless
# inode → the sample line is exactly «- <port>» (busy marker; «-» never
# matches a pgrep candidate — no kill) and no numeric pid claims the port.
FIX26="$WORK/procfix-case26"
make_proc_fixture "$FIX26"
proc_fix_row "$FIX26" tcp 91001 4E28 0A      # 20008 → busy, holder unknown
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX26"
set +e
LP26C=$(listen_pairs 2>"$WORK/case26.err"); LP26C_RC=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$LP26C_RC" -eq 0 ] || CASE26_OK=false
[ "$LP26C" = "- 20008" ] || CASE26_OK=false
# 6.5: the plain holder survived on purpose — finish it here (it is ours).
kill -9 "$P26" 2>/dev/null || true
wait "$P26" 2>/dev/null || true
TEST_OWN_PIDS=("${TEST_OWN_PIDS[@]/$P26/}")

if $CASE26_OK; then
  echo "PASS Case 26 (#448): masked holder killed (resolver-attributed on Linux); unmasked spared; unattributable → «- 20008» busy, no numeric pid"
else
  echo "FAIL Case 26 (#448): holder=$(kill -0 "$H26" 2>/dev/null && echo alive || echo dead) plain=$(kill -0 "$P26" 2>/dev/null && echo alive || echo dead) unattr='$LP26C' rc=$LP26C_RC"
  echo "─────────────────"
  FAIL=1
fi

# ── Case 27 (#448 Task 2, US-2): _listener_on — probe of legacy gate / ──────
# TOCTOU-recheck / .next-wipe guard — on the /proc fixture
echo "── Case 27 (#448): _listener_on — busy/free/invisible on fixture; legacy lsof fallback ──"
fresh_root "case27"
source_lib
CASE27_OK=true
declare -F _listener_on >/dev/null 2>&1 || CASE27_OK=false
FIX27="$WORK/procfix-case27"
make_proc_fixture "$FIX27"
proc_fix_row   "$FIX27" tcp 94001 4E22 0A     # 20002: attributed LISTEN
proc_fix_owner "$FIX27" 7171 94001
proc_fix_row   "$FIX27" tcp 94002 0ABC 0A     # 2748: ownerless (lsof-invisible)
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX27"
set +e
_listener_on 20002;           R27A=$?
_listener_on 2748;            R27B=$?
_listener_on 20007;           R27C=$?
_listener_on 20007 20009;     R27D=$?
_listener_on 20007 2748;      R27E=$?
_listener_on;                 R27F=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
[ "$R27A" -eq 0 ]  || CASE27_OK=false         # busy (attributed)
[ "$R27B" -eq 0 ]  || CASE27_OK=false         # busy-invisible (ownerless)
[ "$R27C" -ne 0 ]  || CASE27_OK=false         # free
[ "$R27D" -ne 0 ]  || CASE27_OK=false         # all-free arg set
[ "$R27E" -eq 0 ]  || CASE27_OK=false         # any-busy wins
[ "$R27F" -ne 0 ]  || CASE27_OK=false         # no args → not busy
# invisibility proof: lsof sees BOTH fixture-busy ports free (bug class #448)
port_free 20002 || CASE27_OK=false
port_free 2748  || CASE27_OK=false
# dryrun gate: without the flag the fixture is inert — the live /proc has
# nothing on the fixture ports → not busy
set +e
_listener_on 20002 2748; R27G=$?
set -e
[ "$R27G" -ne 0 ]  || CASE27_OK=false
# non-Linux fallback branch: unreadable root → the probe keeps the legacy
# per-port `lsof -ti` (PATH stub counts the calls; rc 0 = busy per the stub)
FIX27B="$WORK/procfix-case27b"
mkdir -p "$FIX27B"                            # no net/ at all
cat > "$STUBS/lsof" <<EOF
#!/bin/sh
printf 'x' >> "$STUBS/lsof27_calls"
exit 0
EOF
chmod +x "$STUBS/lsof"
rm -f "$STUBS/lsof27_calls"
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX27B"
set +e
P27H=$(PATH="$STUBS:$PATH" _listener_on 20002 2>&1); R27H=$?
set -e
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
C27=$(wc -c < "$STUBS/lsof27_calls" 2>/dev/null || printf '0')
C27=$((C27))
rm -f "$STUBS/lsof" "$STUBS/lsof27_calls"
[ "$R27H" -eq 0 ]  || CASE27_OK=false         # stub says busy
[ "$C27" -ge 1 ]   || CASE27_OK=false         # legacy lsof really called
if $CASE27_OK; then
  echo "PASS Case 27 (#448): _listener_on — busy/invisible-busy → rc 0, free/empty → rc≠0; fixture inert without dryrun; fallback lsof calls=$C27"
else
  echo "FAIL Case 27 (#448): rc A=$R27A B=$R27B C=$R27C D=$R27D E=$R27E F=$R27F G=$R27G H=$R27H fallback_calls=$C27"
  FAIL=1
fi

# ── Case 28 (#448 Task 2, US-2): allocator avoids fixture-busy ports, ───────
# including the lsof-INVISIBLE holder (ownerless row) — the main #448 scenario
echo "── Case 28 (#448): allocate_shard_ports — fixture-busy (incl. invisible) never returned ──"
fresh_root "case28"
source_lib
CASE28_OK=true
FIX28="$WORK/procfix-case28"
make_proc_fixture "$FIX28"
# phase 1 — pinned 4-port window, 20001 attributed-busy + 20002 ownerless-busy
# (BOTH lsof-free: fixture-only holders): only 2 usable ports remain → the
# bounded allocator must fail-fast (rc≠0). The old lsof path called all four
# free and happily «allocated» the invisible holder's port.
proc_fix_row   "$FIX28" tcp 95001 4E21 0A
proc_fix_owner "$FIX28" 8181 95001            # 20001
proc_fix_row   "$FIX28" tcp6 95002 4E22 0A    # 20002 ownerless → invisible
SHARD_PORT_WINDOW_LOW=20001
SHARD_PORT_WINDOW_HIGH=20004
SHARD_PROC_DRYRUN=1
SHARD_PROC_ROOT="$FIX28"
set +e
P28=$(allocate_shard_ports 2>&1); R28=$?
set -e
[ "$R28" -ne 0 ] || CASE28_OK=false
# phase 2 — wider 8-port window over the same fixture (6 usable): 4 distinct
# in-window ports, NEVER the fixture-busy ones; bounded coupon-collector retry.
SHARD_PORT_WINDOW_HIGH=20008
P28B="" R28B=1 RETRY28=0
while [ "$RETRY28" -lt 5 ]; do
  RETRY28=$((RETRY28 + 1))
  set +e
  P28B=$(allocate_shard_ports 2>&1); R28B=$?
  set -e
  [ "$R28B" -eq 0 ] && break
done
unset SHARD_PROC_DRYRUN SHARD_PROC_ROOT
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
if [ "$R28B" -eq 0 ]; then
  P28_N=$(printf '%s' "$P28B" | wc -w | tr -d ' ')
  P28_U=$(printf '%s\n' $P28B | sort -u | wc -l | tr -d ' ')
  [ "$P28_N" -eq 4 ] || CASE28_OK=false
  [ "$P28_U" -eq 4 ] || CASE28_OK=false
  for p28 in $P28B; do
    { [ "$p28" -ge 20001 ] && [ "$p28" -le 20008 ]; } || CASE28_OK=false
    [ "$p28" -ne 20001 ] || CASE28_OK=false   # attributed-busy avoided
    [ "$p28" -ne 20002 ] || CASE28_OK=false   # INVISIBLE-busy avoided
  done
else
  CASE28_OK=false
fi
# lsof is blind to both fixture holders — the discrimination was the resolver's
port_free 20001 || CASE28_OK=false
port_free 20002 || CASE28_OK=false
if $CASE28_OK; then
  echo "PASS Case 28 (#448): fully-busy 4-window → rc≠0; 8-window → 4 distinct ports avoiding fixture-busy 20001+20002 (lsof-free, invisible), tries=$RETRY28"
else
  echo "FAIL Case 28 (#448): phase1 rc=$R28 out='$P28'; phase2 rc=$R28B tries=$RETRY28 out='$P28B'"
  FAIL=1
fi

# ── Case 29 (#448 Task 4, US-4/US-5, rev4 hard form): wrapper death while ───
# both stages live → diagnosis + marker + TERM to BOTH stages (neighbor too)
echo "── Case 29 (#448 T4): wrapper death, stages live → marker + TERM BOTH stages ──"
fresh_root "case29"
LOG_DIR="$WORK/case29-logs"
mkdir -p "$LOG_DIR"
echo "[shard-1] ERROR: stack shard 1: backend died on :CASE29" > "$LOG_DIR/shard-stack-1.log"
source_lib
CASE29_OK=true
# Direct children (see the Task-4 stub note): call plainly, PID from $!.
spawn_sleep_wrapper >/dev/null; W29A=$!
register_pid "$W29A"
spawn_sleep_wrapper >/dev/null; W29B=$!
register_pid "$W29B"
spawn_term_logging_stage "$WORK/case29.stageA.term" >/dev/null; S29A=$!
register_pid "$S29A"
spawn_term_logging_stage "$WORK/case29.stageB.term" >/dev/null; S29B=$!
register_pid "$S29B"
P29F2="$(extra_free_port "$TEST_FRONTEND_PORT" "$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")"
SHARD_BACKEND_PIDS=("$W29A" "$W29B")
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT" "$P29F2")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A" "$TEST_BACKEND_PORT_B")
MARKER29="$LOG_DIR/stack-wrapper-died.marker"
TF29="$WORK/case29.term-pids"
XF29="$WORK/case29.exit-pids"
WD29_ERR="$WORK/case29.wd.err"
SHARD_RUN_WATCH_S=1 run_watchdog "$MARKER29" "$TF29" "$XF29" 2> "$WD29_ERR" &
WD29=$!
register_pid "$WD29"
# (a) pre-file phase (readiness window): stage lists NOT yet published — the
# watchdog must keep watching (no premature self-exit on an absent list).
sleep 2
kill -0 "$WD29" 2>/dev/null || CASE29_OK=false
[ ! -e "$MARKER29" ] || CASE29_OK=false
# (b) publish the stage lists (re-read every tick; production writes them
# atomically after the Playwright stages start).
printf '%s\n%s\n' "$S29A" "$S29B" > "$TF29"
printf '%s\n%s\n' "$S29A" "$S29B" > "$XF29"
sleep 2
kill -0 "$WD29" 2>/dev/null || CASE29_OK=false      # everything alive → still watching
[ ! -e "$MARKER29" ] || CASE29_OK=false             # no false verdict while alive
# (c) wrapper death: kill -9 + parent-side `wait` — the orchestrator-context
# reap that makes kill -0 fail for the watchdog sibling.
kill -9 "$W29A" 2>/dev/null || true
wait "$W29A" 2>/dev/null || true
wait_marker "$MARKER29" 10 || CASE29_OK=false
wait_marker "$WORK/case29.stageA.term" 10 || CASE29_OK=false   # own stage TERMed
wait_marker "$WORK/case29.stageB.term" 10 || CASE29_OK=false   # NEIGHBOR stage TERMed (rev4)
wait_pid_gone "$WD29" 15 || CASE29_OK=false
wait "$WD29" 2>/dev/null || true
kill -0 "$W29B" 2>/dev/null || CASE29_OK=false       # neighbor WRAPPER untouched (stages die, not stacks)
grep -q "stack shard 1" "$WD29_ERR" || CASE29_OK=false              # diagnosis: shard
grep -q ":$TEST_BACKEND_PORT_A" "$WD29_ERR" || CASE29_OK=false      # diagnosis: port
grep -q "stack log:" "$WD29_ERR" || CASE29_OK=false                 # diagnosis: log path line
grep -q "CASE29" "$WD29_ERR" || CASE29_OK=false                     # the capped tail itself
grep -q "shard=1" "$MARKER29" 2>/dev/null || CASE29_OK=false        # marker names the shard
if $CASE29_OK; then
  echo "PASS Case 29 (#448 T4): wrapper death → marker + TERM both stages (neighbor too); diagnosis shard/ports/log-tail; pre-file phase no premature exit"
else
  echo "FAIL Case 29 (#448 T4): wd=$(kill -0 "$WD29" 2>/dev/null && echo alive || echo dead) marker=$([ -e "$MARKER29" ] && echo yes || echo no) A=$([ -e "$WORK/case29.stageA.term" ] && echo term || echo no) B=$([ -e "$WORK/case29.stageB.term" ] && echo term || echo no) w2=$(kill -0 "$W29B" 2>/dev/null && echo alive || echo dead)"
  sed -n '1,10p' "$WD29_ERR" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 30 (#448 Task 4, US-6): wrapper death AFTER a stage finished → ─────
# marker still set (a green stage on a dead stack reds the run)
echo "── Case 30 (#448 T4): wrapper death after a stage finished → marker ──"
fresh_root "case30"
LOG_DIR="$WORK/case30-logs"
mkdir -p "$LOG_DIR"
: > "$LOG_DIR/shard-stack-1.log"
source_lib
CASE30_OK=true
spawn_sleep_wrapper >/dev/null; W30=$!
register_pid "$W30"
sleep 0.3 >/dev/null 2>&1 </dev/null &
S30A=$!                       # stage A: exits on its own (green) and is reaped
register_pid "$S30A"
wait "$S30A" 2>/dev/null || true
spawn_term_logging_stage "$WORK/case30.stageB.term" >/dev/null; S30B=$!
register_pid "$S30B"
SHARD_BACKEND_PIDS=("$W30")
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A")
MARKER30="$LOG_DIR/stack-wrapper-died.marker"
TF30="$WORK/case30.term-pids"
XF30="$WORK/case30.exit-pids"
WD30_ERR="$WORK/case30.wd.err"
printf '%s\n%s\n' "$S30A" "$S30B" > "$TF30"
printf '%s\n%s\n' "$S30A" "$S30B" > "$XF30"
SHARD_RUN_WATCH_S=1 run_watchdog "$MARKER30" "$TF30" "$XF30" 2> "$WD30_ERR" &
WD30=$!
register_pid "$WD30"
sleep 2
kill -0 "$WD30" 2>/dev/null || CASE30_OK=false   # one finished stage ≠ all-gone: B live → watching on
[ ! -e "$MARKER30" ] || CASE30_OK=false
kill -9 "$W30" 2>/dev/null || true
wait "$W30" 2>/dev/null || true
wait_marker "$MARKER30" 10 || CASE30_OK=false
wait_marker "$WORK/case30.stageB.term" 10 || CASE30_OK=false   # surviving stage TERMed
wait_pid_gone "$WD30" 15 || CASE30_OK=false
wait "$WD30" 2>/dev/null || true
grep -q "shard=1" "$MARKER30" 2>/dev/null || CASE30_OK=false
if $CASE30_OK; then
  echo "PASS Case 30 (#448 T4): death after a finished stage → marker + TERM the survivor; finished stage alone does not end the watch"
else
  echo "FAIL Case 30 (#448 T4): wd=$(kill -0 "$WD30" 2>/dev/null && echo alive || echo dead) marker=$([ -e "$MARKER30" ] && echo yes || echo no) B=$([ -e "$WORK/case30.stageB.term" ] && echo term || echo no)"
  sed -n '1,10p' "$WD30_ERR" 2>/dev/null || true
  echo "─────────────────"
  FAIL=1
fi

# ── Case 31 (#448 Task 4): no deaths → clean self-exit once all stages ──────
# gone, no marker, wrapper untouched
echo "── Case 31 (#448 T4): no deaths → self-exit, no marker ──"
fresh_root "case31"
LOG_DIR="$WORK/case31-logs"
mkdir -p "$LOG_DIR"
source_lib
CASE31_OK=true
spawn_sleep_wrapper >/dev/null; W31=$!
register_pid "$W31"
sleep 0.5 >/dev/null 2>&1 </dev/null &
S31A=$!
sleep 0.5 >/dev/null 2>&1 </dev/null &
S31B=$!
register_pid "$S31A"
register_pid "$S31B"
wait "$S31A" 2>/dev/null || true
wait "$S31B" 2>/dev/null || true
SHARD_BACKEND_PIDS=("$W31")
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A")
MARKER31="$LOG_DIR/stack-wrapper-died.marker"
TF31="$WORK/case31.term-pids"
XF31="$WORK/case31.exit-pids"
printf '%s\n%s\n' "$S31A" "$S31B" > "$TF31"
printf '%s\n%s\n' "$S31A" "$S31B" > "$XF31"
SHARD_RUN_WATCH_S=1 run_watchdog "$MARKER31" "$TF31" "$XF31" 2> "$WORK/case31.wd.err" &
WD31=$!
register_pid "$WD31"
wait_pid_gone "$WD31" 15 || CASE31_OK=false      # self-exit ≤ one interval + slack after stages gone
set +e
wait "$WD31" 2>/dev/null
RC31=$?
set -e
[ "$RC31" -eq 0 ] || CASE31_OK=false             # clean exit code
[ ! -e "$MARKER31" ] || CASE31_OK=false          # no marker
kill -0 "$W31" 2>/dev/null || CASE31_OK=false    # wrapper NOT signaled
if $CASE31_OK; then
  echo "PASS Case 31 (#448 T4): green shape — self-exit rc=0 after all stages gone; no marker; wrapper untouched"
else
  echo "FAIL Case 31 (#448 T4): wd_rc=$RC31 marker=$([ -e "$MARKER31" ] && echo yes || echo no) w=$(kill -0 "$W31" 2>/dev/null && echo alive || echo dead)"
  FAIL=1
fi

# ── Case 32 (#448 Task 4): stuck stage (TERM-ignoring) → escalation to ──────
# SIGKILL within the grace budget; marker set; watchdog exits
echo "── Case 32 (#448 T4): stuck stage → KILL rung within the grace budget ──"
fresh_root "case32"
LOG_DIR="$WORK/case32-logs"
mkdir -p "$LOG_DIR"
source_lib
CLEANUP_BUDGET_S=2   # shrink the ladder budget for a fast case (read at call time)
BUDGET32=$CLEANUP_BUDGET_S
CASE32_OK=true
spawn_sleep_wrapper >/dev/null; W32=$!
register_pid "$W32"
spawn_term_logging_stage "$WORK/case32.stageA.term" >/dev/null; S32A=$!
register_pid "$S32A"
spawn_term_ignoring_stage >/dev/null; S32B=$!
register_pid "$S32B"
SHARD_BACKEND_PIDS=("$W32")
SHARD_FRONTEND_PORTS=("$TEST_FRONTEND_PORT")
SHARD_BACKEND_PORTS=("$TEST_BACKEND_PORT_A")
MARKER32="$LOG_DIR/stack-wrapper-died.marker"
TF32="$WORK/case32.term-pids"
XF32="$WORK/case32.exit-pids"
WD32_ERR="$WORK/case32.wd.err"
printf '%s\n%s\n' "$S32A" "$S32B" > "$TF32"
printf '%s\n%s\n' "$S32B" "$S32A" > "$XF32"
SHARD_RUN_WATCH_S=1 run_watchdog "$MARKER32" "$TF32" "$XF32" 2> "$WD32_ERR" &
WD32=$!
register_pid "$WD32"
sleep 1.5
[ ! -e "$MARKER32" ] || CASE32_OK=false
kill -9 "$W32" 2>/dev/null || true
wait "$W32" 2>/dev/null || true
wait_marker "$MARKER32" 10 || CASE32_OK=false
T32A=$SECONDS
wait_marker "$WORK/case32.stageA.term" 10 || CASE32_OK=false   # normal stage: TERM rung
wait_pid_gone "$S32B" 10 || CASE32_OK=false                    # stuck stage DEAD → the KILL rung fired
T32B=$SECONDS
[ $((T32B - T32A)) -le $((BUDGET32 + 3)) ] || CASE32_OK=false  # within budget + poll slack
wait_pid_gone "$WD32" 15 || CASE32_OK=false
wait "$WD32" 2>/dev/null || true
grep -q "SIGKILL" "$WD32_ERR" || CASE32_OK=false               # the KILL rung announced itself
CLEANUP_BUDGET_S=10   # restore (source-time default)
if $CASE32_OK; then
  echo "PASS Case 32 (#448 T4): stuck stage ignored TERM → SIGKILL ≤ ${BUDGET32}s budget (+slack); normal stage TERMed; marker set"
else
  echo "FAIL Case 32 (#448 T4): marker=$([ -e "$MARKER32" ] && echo yes || echo no) A=$([ -e "$WORK/case32.stageA.term" ] && echo term || echo no) stuck=$(kill -0 "$S32B" 2>/dev/null && echo alive || echo dead) killtime=$((T32B - T32A))s (budget $BUDGET32)"
  sed -n '1,10p' "$WD32_ERR" 2>/dev/null || true
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
