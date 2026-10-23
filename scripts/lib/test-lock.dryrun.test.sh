#!/usr/bin/env bash
# Mechanism-level dryrun suite for the container heavy-run lock (GH #472 Task 3).
#
# What is under test: scripts/lib/test-lock.sh (the shared acquire library)
# and scripts/with-test-lock.sh (the CLI wrapper). Everything runs against a
# TEMP lock path with small constants (MEMO_LOCK_POLL_S / MEMO_LOCK_WAIT_S),
# the same env-seam model as the sibling dryrun suites — no real servers,
# no repo ports, the default /root/workspace lock path is never touched.
#
# → Case L1: free lock → immediate acquisition (flock -n first try), the
#   command runs to completion under the wrapper, its exit code propagates,
#   and the lock is RELEASED after the wrapper exits (a fresh probe
#   acquires instantly).
# → Case L2 (US-1 reentrancy): the command of a holder sees
#   MEMO_TEST_LOCK_HELD=1 exported; a NESTED wrapper invocation under the
#   same lock path does NOT queue behind its own parent — passthrough with
#   a one-line note, instantly. Lib-level: acquire() under a preset
#   MEMO_TEST_LOCK_HELD=1 takes no lock at all (the lock file is not even
#   created).
# → Case L3 (US-2 holder death): holder wrapper killed with kill -9 → the
#   waiter acquires within ≤ one poll interval (POLL=1); the orphaned
#   command child keeps running WITHOUT holding the lock (fd not
#   inherited).
# → Case L4 (US-3 ceiling): lock held longer than MEMO_LOCK_WAIT_S → the
#   waiter exits with code 75 and the spec message «машина занята чужим
#   тяжёлым прогоном дольше 60 мин; перезапусти прогон позже»; the failure
#   lands on the ceiling (elapsed ≥ WAIT), tolerance one poll interval.
# → Case L5 (US-7 bypass): MEMO_TEST_LOCK_DISABLE=1, a missing lock dir,
#   and a flock-less PATH each run WITHOUT the lock with a one-line notice;
#   CI=true suppresses the notice; the lock dir is never created.
#
# Not covered here: the orchestrator-level self-acquisition inside
# scripts/test-all.sh (staged-tree coverage lives in
# scripts/test-all.dryrun.test.sh) and full-scale 300/3600 timings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WRAP_SRC="$REPO_ROOT/scripts/with-test-lock.sh"
LIB_SRC="$REPO_ROOT/scripts/lib/test-lock.sh"

FAIL=0
pass() { echo "PASS $1"; }
flunk() { echo "FAIL $1" >&2; FAIL=1; }

# Missing implementation = loud RED (the suite's whole point).
for _f in "$WRAP_SRC" "$LIB_SRC"; do
  if [ ! -f "$_f" ]; then
    echo "FATAL: script under test not found: $_f" >&2
    exit 1
  fi
done

WORK="$(mktemp -d -t testlock-dryrun-XXXXXX)"
# Orphan sleep markers are their DURATIONS (3003/3004): exec drops a `#`
# comment from the final cmdline, so a comment marker is invisible on the
# orphaned sleep. pgrep/pkill use the [N] bracket form — a literal pattern
# would self-match the probing shell's own argv and kill the suite.
cleanup() {
  pkill -f 'sleep 300[3]' 2>/dev/null || true
  pkill -f 'sleep 300[4]' 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# lock_free <path> — rc 0 iff an exclusive non-blocking flock succeeds NOW.
lock_free() {
  ( flock -n 9 ) 9>>"$1" 2>/dev/null
}

# ── Case L1: free lock → immediate acquire, rc propagation, release ─────────
echo "── Case L1: free lock — immediate acquisition + release ──"
L1_DIR="$WORK/l1"; mkdir -p "$L1_DIR"
L1_LOCK="$L1_DIR/heavy.lock"
L1_T0=$SECONDS
set +e
env MEMO_TEST_LOCK_PATH="$L1_LOCK" MEMO_LOCK_POLL_S=1 MEMO_LOCK_WAIT_S=10 \
  bash "$WRAP_SRC" bash -c 'sleep 1; echo INNER-DONE' \
  > "$L1_DIR/w.log" 2>&1
L1_RC=$?
env MEMO_TEST_LOCK_PATH="$L1_LOCK" \
  bash "$WRAP_SRC" bash -c 'exit 42' \
  > "$L1_DIR/w42.log" 2>&1
L1_RC42=$?
set -e
L1_ELAPSED=$(( SECONDS - L1_T0 ))

if [ "$L1_RC" -eq 0 ] && grep -q 'INNER-DONE' "$L1_DIR/w.log"; then
  pass "L1: command ran to completion under the wrapper (rc=0)"
else
  flunk "L1: expected rc=0 with INNER-DONE, got rc=$L1_RC (log: $(tail -5 "$L1_DIR/w.log" 2>/dev/null | tr '\n' ' '))"
fi
if grep -q '\[lock\] замок захвачен' "$L1_DIR/w.log"; then
  pass "L1: acquisition status line printed"
else
  flunk "L1: no '[lock] замок захвачен' line in $(basename "$L1_DIR/w.log")"
fi
if grep -q 'занят, ожидание' "$L1_DIR/w.log"; then
  flunk "L1: unexpected busy-wait line on a FREE lock"
else
  pass "L1: no busy-wait line (first flock -n succeeded)"
fi
if [ "$L1_RC42" -eq 42 ]; then
  pass "L1: command exit code propagates through the wrapper (42)"
else
  flunk "L1: expected rc=42 propagated, got $L1_RC42"
fi
if [ -e "$L1_LOCK" ]; then
  pass "L1: lock file exists (created once, never removed)"
else
  flunk "L1: lock file missing after run: $L1_LOCK"
fi
if lock_free "$L1_LOCK"; then
  pass "L1: lock released after wrapper exit (fresh probe acquires)"
else
  flunk "L1: lock still held after wrapper exit"
fi

# ── Case L2 (US-1): reentrancy — no self-queueing behind the parent ─────────
echo "── Case L2 (US-1): nested wrapper does not queue behind its holder ──"
L2_DIR="$WORK/l2"; mkdir -p "$L2_DIR"
L2_LOCK="$L2_DIR/heavy.lock"
set +e
env MEMO_TEST_LOCK_PATH="$L2_LOCK" MEMO_LOCK_POLL_S=1 MEMO_LOCK_WAIT_S=15 \
  bash "$WRAP_SRC" bash -c '
    printf "%s" "${MEMO_TEST_LOCK_HELD:-unset}" > "'"$L2_DIR"'/held.flag"
    _t0=$SECONDS
    env MEMO_TEST_LOCK_PATH="'"$L2_LOCK"'" MEMO_LOCK_POLL_S=1 MEMO_LOCK_WAIT_S=15 \
      bash "'"$WRAP_SRC"'" bash -c "echo NESTED-DONE" > "'"$L2_DIR"'/nested.log" 2>&1
    _rc=$?
    echo "$_rc" > "'"$L2_DIR"'/nested.rc"
    echo "$(( SECONDS - _t0 ))" > "'"$L2_DIR"'/nested.elapsed"
    exit 0
  ' > "$L2_DIR/outer.log" 2>&1
L2_RC=$?
set -e
L2_HELD="$(cat "$L2_DIR/held.flag" 2>/dev/null || echo missing)"
L2_NRC="$(cat "$L2_DIR/nested.rc" 2>/dev/null || echo missing)"
L2_NEL="$(cat "$L2_DIR/nested.elapsed" 2>/dev/null || echo 999)"

if [ "$L2_RC" -eq 0 ]; then
  pass "L2: outer holder command completed (rc=0)"
else
  flunk "L2: outer holder rc=$L2_RC (log: $(tail -5 "$L2_DIR/outer.log" 2>/dev/null | tr '\n' ' '))"
fi
if [ "$L2_HELD" = "1" ]; then
  pass "L2: holder command sees MEMO_TEST_LOCK_HELD=1 exported"
else
  flunk "L2: MEMO_TEST_LOCK_HELD inside command = '$L2_HELD', want '1'"
fi
if [ "$L2_NRC" = "0" ] && grep -q 'NESTED-DONE' "$L2_DIR/nested.log" 2>/dev/null; then
  pass "L2: nested wrapper ran the command (rc=0, NESTED-DONE)"
else
  flunk "L2: nested run rc=$L2_NRC without NESTED-DONE"
fi
if grep -q 'MEMO_TEST_LOCK_HELD=1' "$L2_DIR/nested.log" 2>/dev/null; then
  pass "L2: nested acquire printed the reentrancy skip note"
else
  flunk "L2: no reentrancy skip note in nested.log"
fi
if grep -q 'занят, ожидание' "$L2_DIR/nested.log" 2>/dev/null; then
  flunk "L2: nested wrapper QUEUED behind its own parent (deadlock by design?)"
else
  pass "L2: nested wrapper did not queue behind the parent holder"
fi
if [ "$L2_NEL" -le 2 ] 2>/dev/null; then
  pass "L2: nested wrapper returned instantly (${L2_NEL}s)"
else
  flunk "L2: nested wrapper took ${L2_NEL}s — expected instant passthrough"
fi

# Lib-level reentrancy: a preset MEMO_TEST_LOCK_HELD=1 must not even OPEN
# the lock file (no lock taken → an independent holder acquires freely).
L2B_LOCK="$L2_DIR/held-no-open.lock"
set +e
(
  export MEMO_TEST_LOCK_HELD=1
  export MEMO_TEST_LOCK_PATH="$L2B_LOCK"
  # shellcheck disable=SC1090
  source "$LIB_SRC"
  heavy_test_lock_acquire
) > "$L2_DIR/l2b.log" 2>&1
L2B_RC=$?
set -e
if [ "$L2B_RC" -eq 0 ] && [ ! -e "$L2B_LOCK" ]; then
  pass "L2b: lib acquire under HELD=1 is a no-op (lock file not even created)"
else
  flunk "L2b: rc=$L2B_RC, lock file created: $([ -e "$L2B_LOCK" ] && echo yes || echo no) — want no-op"
fi

# ── Case L3 (US-2): kill -9 the holder → instant release, orphan lockless ───
echo "── Case L3 (US-2): kill -9 holder — waiter in ≤1 poll, orphan lockless ──"
L3_DIR="$WORK/l3"; mkdir -p "$L3_DIR"
L3_LOCK="$L3_DIR/heavy.lock"
# Holder: pidfile pid == the WRAPPER pid (exec chain), command = marked sleep.
# NB: $BASHPID, not $$ — inside a subshell $$ still reports the SUITE's
# pid; killing that would kill the suite itself.
(
  echo "$BASHPID" > "$L3_DIR/holder.pid"
  exec env MEMO_TEST_LOCK_PATH="$L3_LOCK" \
    bash "$WRAP_SRC" bash -c 'exec sleep 3003'
) > "$L3_DIR/holder.log" 2>&1 &
L3_HOLDER_BG=$!
disown "$L3_HOLDER_BG" 2>/dev/null || true   # no job-control "Killed" noise
# Wait until the holder really owns the lock (≤5 s).
L3_HELD=false
for _i in $(seq 1 10); do
  if ! lock_free "$L3_LOCK" 2>/dev/null; then L3_HELD=true; break; fi
  sleep 0.5
done
if [ "$L3_HELD" = true ]; then
  pass "L3: positive control — holder acquired the lock"
else
  flunk "L3: holder never acquired the lock (setup broken)"
fi
# Waiter: polls every 1 s, ceiling generous.
env MEMO_TEST_LOCK_PATH="$L3_LOCK" MEMO_LOCK_POLL_S=1 MEMO_LOCK_WAIT_S=60 \
  bash "$WRAP_SRC" bash -c 'echo WAITER-DONE' \
  > "$L3_DIR/waiter.log" 2>&1 &
L3_WAITER_BG=$!
sleep 2   # waiter tries once, prints a busy status
L3_HOLDER_PID="$(cat "$L3_DIR/holder.pid")"
kill -9 "$L3_HOLDER_PID" 2>/dev/null || true
L3_TK=$SECONDS
L3_WAIT_RC=0
for _i in $(seq 1 40); do
  kill -0 "$L3_WAITER_BG" 2>/dev/null || break
  sleep 0.25
done
if kill -0 "$L3_WAITER_BG" 2>/dev/null; then
  kill -9 "$L3_WAITER_BG" 2>/dev/null || true
  wait "$L3_WAITER_BG" 2>/dev/null || L3_WAIT_RC=$?
  flunk "L3: waiter still alive 10 s after holder kill — release is NOT instant"
else
  wait "$L3_WAITER_BG" 2>/dev/null || L3_WAIT_RC=$?
fi
L3_AFTER=$(( SECONDS - L3_TK ))
if [ "$L3_WAIT_RC" -eq 0 ] && grep -q 'WAITER-DONE' "$L3_DIR/waiter.log"; then
  pass "L3: waiter completed after holder death (rc=0)"
else
  flunk "L3: waiter rc=$L3_WAIT_RC (log: $(tail -5 "$L3_DIR/waiter.log" 2>/dev/null | tr '\n' ' '))"
fi
if grep -q 'занят, ожидание' "$L3_DIR/waiter.log" && grep -q 'захвачен' "$L3_DIR/waiter.log"; then
  pass "L3: waiter printed a busy status, then acquired (queue → ownership handover)"
else
  flunk "L3: waiter log lacks the busy→acquired sequence"
fi
if [ "$L3_AFTER" -le 4 ]; then
  pass "L3: waiter acquired within ≤1 poll interval of the kill (${L3_AFTER}s, POLL=1)"
else
  flunk "L3: waiter took ${L3_AFTER}s after kill — expected ≤4 s (POLL=1 + margin)"
fi
# The orphaned sleep child must still be ALIVE (kill -9 hit only the holder)
# and must NOT hold the lock (the waiter already proved it, but pin both).
if kill -0 "$L3_HOLDER_PID" 2>/dev/null; then
  flunk "L3: holder pid still alive after kill -9?!"
else
  pass "L3: holder is dead (kill -9 delivered)"
fi
if pgrep -f 'sleep 300[3]' >/dev/null 2>&1; then
  pass "L3: orphaned command child still running (lock released by kernel, not by child death)"
  pkill -f 'sleep 300[3]' 2>/dev/null || true
else
  flunk "L3: orphan died with the holder — could not demonstrate lockless orphan"
fi
lock_free "$L3_LOCK" && pass "L3: lock free after everything" || flunk "L3: lock stuck"

# ── Case L4 (US-3): ceiling exhaustion → rc 75 + spec message ────────────────
echo "── Case L4 (US-3): busy past the ceiling — rc 75 + «машина занята…» ──"
L4_DIR="$WORK/l4"; mkdir -p "$L4_DIR"
L4_LOCK="$L4_DIR/heavy.lock"
(
  exec env MEMO_TEST_LOCK_PATH="$L4_LOCK" \
    bash "$WRAP_SRC" bash -c 'exec sleep 3004'
) > "$L4_DIR/holder.log" 2>&1 &
L4_HOLDER_BG=$!
disown "$L4_HOLDER_BG" 2>/dev/null || true   # no job-control noise on kill
for _i in $(seq 1 10); do
  lock_free "$L4_LOCK" 2>/dev/null || break
  sleep 0.5
done
L4_T0=$SECONDS
set +e
env MEMO_TEST_LOCK_PATH="$L4_LOCK" MEMO_LOCK_POLL_S=2 MEMO_LOCK_WAIT_S=4 \
  bash "$WRAP_SRC" bash -c 'echo SHOULD-NOT-RUN' \
  > "$L4_DIR/waiter.log" 2>&1
L4_RC=$?
set -e
L4_ELAPSED=$(( SECONDS - L4_T0 ))
# Holder teardown: the wrapper first (its argv), then the orphaned sleep
# by its marker duration — both bracket-guarded against self-match.
kill "$L4_HOLDER_BG" 2>/dev/null || true
pkill -f 'sleep 300[4]' 2>/dev/null || true

if [ "$L4_RC" -eq 75 ]; then
  pass "L4: ceiling exhaustion exits with code 75 (got $L4_RC)"
else
  flunk "L4: expected rc=75, got $L4_RC"
fi
if grep -q 'машина занята чужим тяжёлым прогоном дольше 60 мин; перезапусти прогон позже' "$L4_DIR/waiter.log"; then
  pass "L4: spec message printed verbatim"
else
  flunk "L4: spec message missing (log: $(tail -5 "$L4_DIR/waiter.log" 2>/dev/null | tr '\n' ' '))"
fi
if grep -q 'занят, ожидание' "$L4_DIR/waiter.log"; then
  pass "L4: busy status line printed during the wait"
else
  flunk "L4: no busy status line before the ceiling verdict"
fi
if [ "$L4_ELAPSED" -ge 4 ] && [ "$L4_ELAPSED" -le 8 ]; then
  pass "L4: failed ON the ceiling (${L4_ELAPSED}s, WAIT=4, tolerance one POLL=2)"
else
  flunk "L4: elapsed ${L4_ELAPSED}s — want 4..8 (ceiling 4 + one poll 2 + slack)"
fi
if grep -q 'SHOULD-NOT-RUN' "$L4_DIR/waiter.log"; then
  flunk "L4: the command RAN despite the ceiling failure"
else
  pass "L4: command never ran after the ceiling failure"
fi

# ── Case L5 (US-7): bypass — no lock, one-line notice, CI suppression ───────
echo "── Case L5 (US-7): bypass paths — notice, CI suppression, no mkdir ──"
# (a) MEMO_TEST_LOCK_DISABLE=1
L5_DIR="$WORK/l5"; mkdir -p "$L5_DIR"
L5A_LOCK="$L5_DIR/disable.lock"
set +e
env MEMO_TEST_LOCK_PATH="$L5A_LOCK" MEMO_TEST_LOCK_DISABLE=1 \
  bash "$WRAP_SRC" bash -c 'echo BYPASS-DONE' > "$L5_DIR/a.log" 2>&1
L5A_RC=$?
set -e
if [ "$L5A_RC" -eq 0 ] && grep -q 'BYPASS-DONE' "$L5_DIR/a.log" \
   && grep -q 'обход без замка' "$L5_DIR/a.log"; then
  pass "L5a: MEMO_TEST_LOCK_DISABLE=1 — runs without lock + notice"
else
  flunk "L5a: rc=$L5A_RC, notice/log wrong (log: $(tail -3 "$L5_DIR/a.log" 2>/dev/null | tr '\n' ' '))"
fi
if [ ! -e "$L5A_LOCK" ]; then
  pass "L5a: lock file untouched in bypass"
else
  flunk "L5a: lock file created despite bypass"
fi
# (b) lock dir missing (and never created)
L5B_LOCK="$WORK/l5/no-such-dir/heavy.lock"
set +e
env MEMO_TEST_LOCK_PATH="$L5B_LOCK" \
  bash "$WRAP_SRC" bash -c 'echo BYPASS-DONE' > "$L5_DIR/b.log" 2>&1
L5B_RC=$?
set -e
if [ "$L5B_RC" -eq 0 ] && grep -q 'обход без замка' "$L5_DIR/b.log"; then
  pass "L5b: missing lock dir — runs without lock + notice"
else
  flunk "L5b: rc=$L5B_RC (log: $(tail -3 "$L5_DIR/b.log" 2>/dev/null | tr '\n' ' '))"
fi
if [ ! -d "$WORK/l5/no-such-dir" ]; then
  pass "L5b: lock dir NOT created (never mkdir)"
else
  flunk "L5b: lock dir was created by the wrapper — forbidden"
fi
# (c) no flock binary on PATH (stub PATH: wrapper's own bootstrap needs
#     bash/dirname/env; the lib itself is pure-bash by design)
L5C_STUBS="$L5_DIR/stubs-noflock"; mkdir -p "$L5C_STUBS"
ln -s "$(command -v bash)" "$L5C_STUBS/bash"
ln -s "$(command -v sleep)" "$L5C_STUBS/sleep"
ln -s "$(command -v env)" "$L5C_STUBS/env"
ln -s "$(command -v dirname)" "$L5C_STUBS/dirname"
L5C_LOCK="$L5_DIR/noflock.lock"
set +e
env PATH="$L5C_STUBS" MEMO_TEST_LOCK_PATH="$L5C_LOCK" \
  bash "$WRAP_SRC" bash -c 'echo BYPASS-DONE' > "$L5_DIR/c.log" 2>&1
L5C_RC=$?
set -e
if [ "$L5C_RC" -eq 0 ] && grep -q 'обход без замка' "$L5_DIR/c.log"; then
  pass "L5c: no flock binary — runs without lock + notice"
else
  flunk "L5c: rc=$L5C_RC (log: $(tail -3 "$L5_DIR/c.log" 2>/dev/null | tr '\n' ' '))"
fi
if [ ! -e "$L5C_LOCK" ]; then
  pass "L5c: lock file untouched in the no-flock bypass"
else
  flunk "L5c: lock file created despite the no-flock bypass"
fi
# (d) CI=true suppresses the notice
set +e
env MEMO_TEST_LOCK_PATH="$L5A_LOCK" MEMO_TEST_LOCK_DISABLE=1 CI=true \
  bash "$WRAP_SRC" bash -c 'echo BYPASS-DONE' > "$L5_DIR/d.log" 2>&1
L5D_RC=$?
set -e
if [ "$L5D_RC" -eq 0 ] && grep -q 'BYPASS-DONE' "$L5_DIR/d.log"; then
  pass "L5d: CI=true bypass still runs the command"
else
  flunk "L5d: rc=$L5D_RC — command did not run"
fi
if grep -q 'обход без замка' "$L5_DIR/d.log"; then
  flunk "L5d: notice printed under CI=true — must be suppressed"
else
  pass "L5d: notice suppressed under CI=true"
fi

echo "──"
if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
