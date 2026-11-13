#!/usr/bin/env bash
# test_auto_impl_watch_lock.sh — regression tests for the #539 stale-lock
# self-detection fix in auto_impl_watch.sh.
#
# Runs the watcher ONLY in --check-lock mode against temp locks: never enters
# the scan loop, never touches the production lock/log, never runs the watcher
# from its canonical path (the canonical string is used only as the cmdline
# fake for the guard's hardcoded comparison). Spec:
# docs/specs/2026-11-13-watcher-lock-self-pid-539-design.md §6.4/§7.
#
# Usage (inside the container):
#   WATCHER=/tmp/verify-539/auto_impl_watch.sh bash test_auto_impl_watch_lock.sh
set -euo pipefail

WATCHER="${WATCHER:?set WATCHER to the auto_impl_watch.sh copy under test}"
CANON="/root/workspace/memo/.opencode/scripts/auto_impl_watch.sh" # the guard's hardcoded string
TMP="$(mktemp -d /tmp/verify-539.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

expect_rc() { # name expected actual
    if [ "$3" = "$2" ]; then echo "ok: $1 (rc=$3)"; else echo "FAIL: $1 (rc=$3, expected $2)"; FAIL=1; fi
}
expect_marker() { # name marker file
    if grep -q "$2" "$3"; then echo "ok: $1"; else echo "FAIL: $1 ($2 marker missing in $3)"; FAIL=1; fi
}

# T1 (S1, the #539 incident shape): the lock holds the checker's own pid —
# exec preserves the pid, so the guard sees a live watcher-cmdline process
# that IS the checker itself. Old code: rc=1 ("already running"); fixed code:
# rc=0 + SELF-MATCH + lock rewritten.
T="$TMP/t1.lock"
rc=0
AUTO_IMPL_LOCK="$T" bash -c 'echo $$ > "$0"; exec bash "$1" --check-lock' "$T" "$WATCHER" >"$TMP/t1.out" 2>&1 || rc=$?
expect_rc "T1 self-match takeover" 0 "$rc"
expect_marker "T1 SELF-MATCH marker" "SELF-MATCH" "$TMP/t1.out"
grep -qE '^[0-9]+$' "$T" && echo "ok: T1 lock rewritten" || { echo "FAIL: T1 lock not rewritten"; FAIL=1; }

# T2 (S2, live duplicate): a dummy whose argv[0] fakes the canonical watcher
# path holds the lock; the checker runs as a child process (its own $$).
# 30s window + liveness assert so a slow run cannot turn this flaky.
T="$TMP/t2.lock"
bash -c 'exec -a "$0" sleep 30' "$CANON" & DUMMY=$!
echo "$DUMMY" > "$T"
rc=0
AUTO_IMPL_LOCK="$T" bash "$WATCHER" --check-lock >"$TMP/t2.out" 2>&1 || rc=$?
expect_rc "T2 duplicate refusal" 3 "$rc"
expect_marker "T2 DUPLICATE marker" "DUPLICATE" "$TMP/t2.out"
if [ "$(cat "$T")" = "$DUMMY" ]; then echo "ok: T2 lock untouched"; else echo "FAIL: T2 lock modified"; FAIL=1; fi
if kill -0 "$DUMMY" 2>/dev/null; then echo "ok: T2 dummy alive"; else echo "FAIL: T2 dummy died (window raced)"; FAIL=1; fi
kill "$DUMMY" 2>/dev/null || true
wait "$DUMMY" 2>/dev/null || true

# T3 (S3a, dead pid): pid of an already-finished short-lived process.
T="$TMP/t3.lock"
bash -c 'exit 0' & DEAD=$!
wait "$DEAD" || true
echo "$DEAD" > "$T"
rc=0
AUTO_IMPL_LOCK="$T" bash "$WATCHER" --check-lock >"$TMP/t3.out" 2>&1 || rc=$?
expect_rc "T3 dead-pid takeover" 0 "$rc"
expect_marker "T3 STALE marker" "STALE" "$TMP/t3.out"

# T4 (S3b, foreign live non-watcher pid): the test shell's own pid; the
# checker runs as a child so its $$ differs (no self-match confusion).
T="$TMP/t4.lock"
echo "$$" > "$T"
rc=0
AUTO_IMPL_LOCK="$T" bash "$WATCHER" --check-lock >"$TMP/t4.out" 2>&1 || rc=$?
expect_rc "T4 foreign-live-pid takeover" 0 "$rc"
expect_marker "T4 STALE marker" "STALE" "$TMP/t4.out"
if [ "$(cat "$T")" != "$$" ]; then echo "ok: T4 lock rewritten"; else echo "FAIL: T4 lock not rewritten"; FAIL=1; fi

# T5 (S4, absent lock): clean start.
T="$TMP/t5.lock"
rm -f "$T"
rc=0
AUTO_IMPL_LOCK="$T" bash "$WATCHER" --check-lock >"$TMP/t5.out" 2>&1 || rc=$?
expect_rc "T5 clean start" 0 "$rc"
expect_marker "T5 STALE marker" "STALE" "$TMP/t5.out"
grep -qE '^[0-9]+$' "$T" && echo "ok: T5 lock created" || { echo "FAIL: T5 lock not created"; FAIL=1; }

# Misuse guards: the check must refuse to run without AUTO_IMPL_LOCK and on
# unknown arguments (exit 2 — distinct from duplicate=3 and errors=1).
set +e
env -u AUTO_IMPL_LOCK bash "$WATCHER" --check-lock >/dev/null 2>&1; m1=$?
AUTO_IMPL_LOCK="$TMP/x.lock" bash "$WATCHER" --nonsense >/dev/null 2>&1; m2=$?
set -e
expect_rc "misuse: no AUTO_IMPL_LOCK" 2 "$m1"
expect_rc "misuse: unknown argument" 2 "$m2"

if [ "$FAIL" = 0 ]; then echo "ALL GREEN"; else echo "RED: $FAIL failure(s)"; exit 1; fi
