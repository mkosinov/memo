#!/usr/bin/env bash
# Orchestrator-level dryrun suite for scripts/test-all.sh (#472 Task 2).
#
# What is under test: the orchestrator's readiness wait — MARKER-based
# (#472), not HTTP-based. test-all.sh hands each stack wrapper a
# SHARD_READY_MARKER path, then waits for BOTH marker files with the
# ceiling READY_ORCHESTRATOR_S (single source: scripts/lib/shard-helpers.sh,
# derived from the wrapper budgets + 180 s pre-bind slack). Every tick of
# the wait checks wrapper liveness (kill -0 + the #448 run-watchdog death
# marker): a wrapper dying mid-wait fails the run WITHIN ONE TICK with the
# stack-log tail — the ceiling is never burned on a dead wrapper (US-5,
# orchestrator layer). A frontend that opens its port late does not make
# the orchestrator give up before the stack's own budgets do (US-6).
#
# Harness model (deterministic, no real servers): the REAL test-all.sh and
# the REAL e2e-shard-start.sh are staged into a temp tree; every binary
# child the orchestrator spawns is a PATH stub (pnpm/uv/curl/sqlite3/node/
# python3). The stack wrappers therefore run the REAL wrapper script with
# stub pins — readiness/death/delay are driven by the same SHARD_DRYRUN_*
# knobs as scripts/e2e-shard-start.dryrun.test.sh (die branches, curl
# fail/hang, plus the one-shot SHARD_DRYRUN_CURL_DELAY_S pre-bind delay
# introduced here). The suite children the orchestrator runs inline
# (e2e-shard-start.dryrun.test.sh, visual-compliance smoke, workspace
# vitest) are staged as `exit 0` stubs — the nested harness suites are
# THAT suite's business, not this run's. Everything the inner run creates
# (logs dir, run leases, master DB) is isolated via TMPDIR/SHARD_RUNS_DIR
# into the per-case temp dir; the REAL /tmp/memo-shard-runs is never read
# or written. Port allocation samples /proc LISTEN tables (the #448
# resolver) — no sockets are opened by this suite; the forbidden dev/CI
# ports (3000/3001/3002/3003/8000-8002/8101/3100/3101) are never touched.
#
# → Case US-5 (#472): both wrappers' frontend pins die at 3 s inside the
#   wrapper's own readiness window (curl refuses the frontend URL, die
#   branch) → each wrapper exits 1 with the addressed verdict within
#   seconds; the orchestrator's marker wait notices the dead wrapper
#   within ONE tick and fails the whole run with the stack-log tail —
#   elapsed ≪ any ceiling burn. The pre-#472 orchestrator HTTP-polled
#   here: 60 refused iterations ≈ 60 s before the verdict — this case
#   pins BOTH the verdict text and the elapsed-time contract (< 45 s).
# → Case US-6 (#472): the frontend URL is dead for 8 s, then answers
#   (one-shot delay knob — the pre-bind mode, scaled down from 90 s via
#   env constants, budgets 3/9 → ceiling 192): the orchestrator must NOT
#   give up before the stack's own budgets — it waits for BOTH markers
#   (assert: the ceiling line prints the DERIVED 192 — the env override
#   flows through the lib into the consumer, no duplicate literals), the
#   run goes green end-to-end (all stages are green stubs), and the
#   markers carry the diagnostic line. Also asserts the legacy HTTP-poll
#   lines are GONE (no duplicate readiness probing).
#
# Not covered here (by design): the ceiling-exhaustion branch — with the
# lib constants the minimum ceiling is 1+1+180 = 182 s of real waiting;
# a 3-minute suite case is not worth the wire. The branch shares the
# failure-reporting path (_capped_log_tail tails) with the wrapper-death
# verdict that US-5 pins. Full-scale 90 s/360 s timings are Task 5's
# real-stack verification (results recorded in issue #472).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Startup guards ─────────────────────────────────────────────────────────
# Same guard as e2e-shard-start.dryrun.test.sh: the staged WRAPPER prepends
# /root/.npm-global/bin to PATH — a real pnpm there would shadow the stub
# and spawn REAL Next.js dev servers.
if [ -x "/root/.npm-global/bin/pnpm" ]; then
  echo "FATAL: /root/.npm-global/bin/pnpm exists and would shadow the pnpm stub" >&2
  echo "       (e2e-shard-start.sh puts /root/.npm-global/bin first on PATH)." >&2
  echo "         mv /root/.npm-global/bin/pnpm /root/.npm-global/bin/pnpm.bak" >&2
  exit 1
fi

# Scripts under test (real copies, staged into an isolated tree)
TESTALL_SRC="$REPO_ROOT/scripts/test-all.sh"
SHARD_SRC="$REPO_ROOT/scripts/e2e-shard-start.sh"
LIB_SRC="$REPO_ROOT/scripts/lib/shard-helpers.sh"
for f in "$TESTALL_SRC" "$SHARD_SRC" "$LIB_SRC"; do
  if [ ! -f "$f" ]; then
    echo "FATAL: script under test not found: $f" >&2
    exit 1
  fi
done

WORK="$(mktemp -d -t testall-dryrun-XXXXXX)"
STUBS="$WORK/stubs"
STAGE="$WORK/tree"
mkdir -p "$STUBS" "$STAGE/scripts/lib" "$STAGE/backend" \
  "$STAGE/frontend/admin" "$STAGE/packages/api-client"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

cp "$TESTALL_SRC" "$STAGE/scripts/test-all.sh"
cp "$SHARD_SRC" "$STAGE/scripts/e2e-shard-start.sh"
cp "$LIB_SRC" "$STAGE/scripts/lib/shard-helpers.sh"

# Inline suite children of the orchestrator → `exit 0` stubs (this run's
# business is the readiness wait, not re-running the wrapper-level suites).
printf '#!/usr/bin/env bash\n# stubbed for the orchestrator dryrun (#472)\nexit 0\n' \
  > "$STAGE/scripts/e2e-shard-start.dryrun.test.sh"
printf '#!/usr/bin/env bash\n# stubbed for the orchestrator dryrun (#472)\nexit 0\n' \
  > "$STAGE/scripts/visual-compliance-check.smoke.test.sh"
printf '#!/usr/bin/env bash\n# stubbed for the orchestrator dryrun (#472)\nexit 0\n' \
  > "$STAGE/scripts/run-workspace-tests.sh"
chmod +x "$STAGE/scripts/"*.test.sh "$STAGE/scripts/run-workspace-tests.sh"

# Master test DB fixture: pre-created so the (stubbed) sqlite3 table-count
# probe reports a seeded DB and the real seed branch is skipped; per-shard
# copies are plain `cp`s of this file.
printf 'stub-master-test-db\n' > "$STAGE/backend/test_memo.db"

# ── Stubs ──────────────────────────────────────────────────────────────────
# uv: the SERVER call site models a live backend pin (hold) or a dying one
# (SHARD_DRYRUN_BACKEND_DIE_S); the SEED call site is a fast no-op. TERM
# traps reap the inner sleep so a TERMed wrapper never orphans sleep
# children (same model as e2e-shard-start.dryrun.test.sh).
cat > "$STUBS/uv" <<'EOF'
#!/bin/sh
case "$*" in
  *uvicorn*)
    printf 'UVICORN argv=[%s]\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    if [ -n "${SHARD_DRYRUN_BACKEND_DIE_S:-}" ]; then
      sleep "$SHARD_DRYRUN_BACKEND_DIE_S"
      echo "UVICORN-PIN: backend pin final words (die-branch)"
      exit 1
    fi
    sleep "${SHARD_DRYRUN_BACKEND_HOLD_S:-30}" &
    _s=$!
    trap 'kill "$_s" 2>/dev/null; exit 0' TERM INT
    wait "$_s"
    ;;
esac
exit 0
EOF

# pnpm: `exec next dev` models the frontend pin (hold/die); every other
# call site (lint / type-check / vitest / playwright) is a green no-op.
cat > "$STUBS/pnpm" <<'EOF'
#!/bin/sh
case "$*" in
  *"exec next dev"*)
    printf 'PNPM_EXEC_NEXT_DEV argv=[%s] SHARD_PORT=[%s] PPID=[%s]\n' \
      "$*" "${SHARD_PORT:-unset}" "$PPID" \
      >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    if [ -n "${SHARD_DRYRUN_FRONTEND_DIE_S:-}" ]; then
      sleep "$SHARD_DRYRUN_FRONTEND_DIE_S"
      echo "PNPM-PIN: frontend pin final words (die-branch)"
      exit 1
    fi
    sleep "${SHARD_DRYRUN_HOLD_S:-30}" &
    _s=$!
    trap 'kill "$_s" 2>/dev/null; exit 0' TERM INT
    wait "$_s"
    ;;
esac
exit 0
EOF

# curl: default instant 200. Knobs (URL matched by ':<port>' substring —
# the wrapper readiness URLs are http://localhost:$BACKEND_PORT/docs and
# http://localhost:$SHARD_PORT/):
#   SHARD_DRYRUN_CURL_FAIL=backend|frontend — matching URL → 000, exit 1
#     (connection-refused shape);
#   SHARD_DRYRUN_CURL_DELAY=frontend + SHARD_DRYRUN_CURL_DELAY_S=N — the
#     FIRST call against the matching port sleeps N (the pre-bind window:
#     the port answers nothing until it suddenly answers), then 200; every
#     later call answers instantly (one-shot state file). One-shot matters:
#     warmup hits the same URLs right after readiness and must not stretch
#     the teardown by N × routes.
cat > "$STUBS/curl" <<'EOF'
#!/bin/sh
_mode=""
_kind=""
case "${SHARD_DRYRUN_CURL_FAIL:-}" in
  backend|frontend) _mode="$SHARD_DRYRUN_CURL_FAIL" _kind="fail" ;;
esac
case "${SHARD_DRYRUN_CURL_DELAY:-}" in
  backend|frontend) _mode="$SHARD_DRYRUN_CURL_DELAY" _kind="delay" ;;
esac
if [ -n "$_mode" ]; then
  _port="${BACKEND_PORT:-}"
  if [ "$_mode" = "frontend" ]; then
    _port="${SHARD_PORT:-}"
  fi
  case " $* " in
    *":$_port"*)
      if [ "$_kind" = "fail" ]; then
        printf '000'
        exit 1
      fi
      # delay (one-shot per port)
      _once="${SHARD_DRYRUN_CURL_STATE_DIR:-}/$_port.first-done"
      if [ -n "${SHARD_DRYRUN_CURL_STATE_DIR:-}" ] && [ ! -f "$_once" ]; then
        : > "$_once"
        sleep "${SHARD_DRYRUN_CURL_DELAY_S:-5}"
      fi
      printf '200'
      exit 0
      ;;
  esac
fi
printf '200'
exit 0
EOF

# sqlite3: the orchestrator's master-DB table-count probe must see a
# "seeded" DB (≥ 5 tables) so the real seed branch is skipped.
cat > "$STUBS/sqlite3" <<'EOF'
#!/bin/sh
printf '10\n'
exit 0
EOF

# node: the visual-compliance parser stage is a green no-op.
cat > "$STUBS/node" <<'EOF'
#!/bin/sh
exit 0
EOF

# python3: the wrapper's seed-canon generator runs against a stub DB —
# journal and succeed (same reason as the wrapper-level suite).
cat > "$STUBS/python3" <<'EOF'
#!/bin/sh
printf 'PYTHON3: %s\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
exit 0
EOF

# lsof: every port looks free (non-Linux fallback path only; on Linux the
# /proc resolver is used and lsof is never reached).
printf '#!/bin/sh\nexit 1\n' > "$STUBS/lsof"

chmod +x "$STUBS/uv" "$STUBS/pnpm" "$STUBS/curl" "$STUBS/sqlite3" \
  "$STUBS/node" "$STUBS/python3" "$STUBS/lsof"

FAIL=0

# ── Inner-run launcher ─────────────────────────────────────────────────────
# launch_test_all <case-dir> — starts the REAL test-all.sh in the staged
# tree with stub-only children, isolated TMPDIR (logs, master seed lock)
# and SHARD_RUNS_DIR (leases). Case knobs ride INNER_EXTRA_ENV (the
# `env $VAR` word-split idiom; values must not contain spaces). Sets
# INNER_PID and INNER_LOG.
INNER_EXTRA_ENV="${INNER_EXTRA_ENV:-}"
INNER_LOG=""
INNER_PID=""
launch_test_all() {
  local cdir="$1"
  mkdir -p "$cdir/tmp" "$cdir/runs" "$cdir/curl-state"
  INNER_LOG="$cdir/test-all.log"
  (
    cd "$STAGE"
    # shellcheck disable=SC2086
    env \
      PATH="$STUBS:$PATH" \
      TMPDIR="$cdir/tmp" \
      SHARD_RUNS_DIR="$cdir/runs" \
      VISUAL_COMPLIANCE=0 \
      SHARD_STACK_WATCH_S=1 \
      SHARD_RUN_WATCH_S=2 \
      SHARD_DRYRUN_HOLD_S=120 \
      SHARD_DRYRUN_BACKEND_HOLD_S=120 \
      SHARD_DRYRUN_CURL_STATE_DIR="$cdir/curl-state" \
      SHARD_DRYRUN_JOURNAL="$cdir/stubs.journal" \
      $INNER_EXTRA_ENV \
      bash scripts/test-all.sh
  ) > "$INNER_LOG" 2>&1 &
  INNER_PID=$!
}

# reap_test_all <budget-s> — bounded wait for the inner run's OWN exit;
# kill -9 escalation only for a stuck run (rc then reports 137 and the
# rc assertions fail loudly — the suite can never hang). Sets LAST_RC.
reap_test_all() {
  local budget="$1" i rc=0
  for i in $(seq 1 $((budget * 5))); do
    kill -0 "$INNER_PID" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$INNER_PID" 2>/dev/null || true
  wait "$INNER_PID" 2>/dev/null || rc=$?
  LAST_RC=$rc
}

# markers_in <case-dir> — stdout: the run's shard ready markers, if any.
markers_in() {
  find "$1/tmp/test-all-logs" -type f -name 'shard-stack-*.ready.marker' \
    2>/dev/null | sort
}

# ── Case US-5: wrapper death during the marker wait → one-tick verdict ─────
echo "── Case US-5 (#472): wrapper dies mid-wait — orchestrator fails within one tick ──"
US5_DIR="$WORK/us5"
INNER_EXTRA_ENV="SHARD_DRYRUN_FRONTEND_DIE_S=3 SHARD_DRYRUN_CURL_FAIL=frontend"
US5_T0=$SECONDS
launch_test_all "$US5_DIR"
reap_test_all 60
US5_ELAPSED=$(( SECONDS - US5_T0 ))
INNER_EXTRA_ENV=""
echo "── Case US-5 inner log (tail 60) ──"
tail -n 60 "$US5_DIR/test-all.log" || true
echo "─────────────────"

if [ "$LAST_RC" -eq 1 ]; then
  echo "PASS US-5 (#472): orchestrator failed the run on wrapper death (rc=1, own verdict)"
else
  echo "FAIL US-5 (#472): expected rc=1 (verdict during readiness wait), got rc=$LAST_RC"
  FAIL=1
fi
if grep -q 'died during the readiness wait' "$US5_DIR/test-all.log" 2>/dev/null; then
  echo "PASS US-5 (#472): addressed verdict — wrapper death named in the readiness wait"
else
  echo "FAIL US-5 (#472): no 'died during the readiness wait' verdict in the log"
  FAIL=1
fi
if grep -q 'PNPM-PIN: frontend pin final words' "$US5_DIR/test-all.log" 2>/dev/null \
   && grep -q 'stack log:' "$US5_DIR/test-all.log" 2>/dev/null; then
  echo "PASS US-5 (#472): dead stack's tail surfaced (die-branch last words + ALWAYS stack-log path)"
else
  echo "FAIL US-5 (#472): expected the wrapper's die-branch last words + stack-log path in the orchestrator log"
  FAIL=1
fi
if grep -q '^UVICORN ' "$US5_DIR/stubs.journal" 2>/dev/null \
   && grep -q '^PNPM_EXEC_NEXT_DEV ' "$US5_DIR/stubs.journal" 2>/dev/null; then
  echo "PASS US-5 (#472): positive control — wrappers really started both pins"
else
  echo "FAIL US-5 (#472): no UVICORN/PNPM journal lines — the verdict could be vacuous"
  FAIL=1
fi
# The pre-#472 shape burned the whole (default 360 s / legacy 60-iteration)
# budget before failing; the one-tick contract is elapsed ≈ death (3 s) +
# tick (1 s) + teardown. 45 s is a loaded-box ceiling, still ≪ any burn.
if [ "$US5_ELAPSED" -ge 3 ] && [ "$US5_ELAPSED" -lt 45 ]; then
  echo "PASS US-5 (#472): verdict within one tick of the death (${US5_ELAPSED}s; ceiling burn would be 60s+)"
else
  echo "FAIL US-5 (#472): elapsed ${US5_ELAPSED}s — want ≥3 (after the 3s death) and <45 (no ceiling burn)"
  FAIL=1
fi
if [ -z "$(markers_in "$US5_DIR")" ]; then
  echo "PASS US-5 (#472): no ready markers from dying wrappers (readiness never reached)"
else
  echo "FAIL US-5 (#472): unexpected ready markers: $(markers_in "$US5_DIR")"
  FAIL=1
fi

# ── Case US-6: late frontend port (pre-bind mode) → marker waited out ──────
echo "── Case US-6 (#472): frontend answers only at 8 s — orchestrator waits for the markers ──"
US6_DIR="$WORK/us6"
# Budgets 3/9 → derived ceiling 3+9+180=192 (env override flows through the
# lib into the orchestrator's wait line — no duplicate literals); the 8 s
# pre-bind delay sits INSIDE the wrapper's frontend budget (9 s): the stack
# still becomes ready, the orchestrator must not give up first (scaled from
# 90 s/120 s/360 s — full scale is Task 5's real-stack run).
INNER_EXTRA_ENV="SHARD_DRYRUN_CURL_DELAY=frontend SHARD_DRYRUN_CURL_DELAY_S=8 READY_BUDGET_BACKEND_S=3 READY_BUDGET_FRONTEND_S=9"
US6_T0=$SECONDS
launch_test_all "$US6_DIR"
reap_test_all 90
US6_ELAPSED=$(( SECONDS - US6_T0 ))
INNER_EXTRA_ENV=""
echo "── Case US-6 inner log (tail 40) ──"
tail -n 40 "$US6_DIR/test-all.log" || true
echo "── Case US-6 markers ──"
for _m in $(markers_in "$US6_DIR"); do echo "$_m: $(cat "$_m")"; done
echo "─────────────────"

if [ "$LAST_RC" -eq 0 ] && grep -q 'All checks passed' "$US6_DIR/test-all.log" 2>/dev/null; then
  echo "PASS US-6 (#472): late-port stack went green end-to-end (rc=0)"
else
  echo "FAIL US-6 (#472): expected rc=0 + 'All checks passed' (got rc=$LAST_RC)"
  FAIL=1
fi
if grep -q 'waiting for shard readiness markers (ceiling 192s)' "$US6_DIR/test-all.log" 2>/dev/null; then
  echo "PASS US-6 (#472): marker wait with the DERIVED ceiling 192s (3+9+180 — env override flows, single source)"
else
  echo "FAIL US-6 (#472): no 'waiting for shard readiness markers (ceiling 192s)' line in the log"
  FAIL=1
fi
US6_MARKERS="$(markers_in "$US6_DIR")"
US6_MARKER_COUNT="$(printf '%s\n' "$US6_MARKERS" | grep -c . || true)"
if [ "$US6_MARKER_COUNT" -eq 2 ]; then
  echo "PASS US-6 (#472): both shards published ready markers"
else
  echo "FAIL US-6 (#472): expected 2 ready markers, found $US6_MARKER_COUNT ($US6_MARKERS)"
  FAIL=1
fi
if printf '%s\n' "$US6_MARKERS" | grep -q 'shard-stack-1\.ready\.marker' \
   && printf '%s\n' "$US6_MARKERS" | grep -q 'shard-stack-2\.ready\.marker' \
   && grep -hq '^shard=1 ' $(printf '%s\n' "$US6_MARKERS" | grep 'shard-stack-1\.') 2>/dev/null \
   && grep -hq '^shard=2 ' $(printf '%s\n' "$US6_MARKERS" | grep 'shard-stack-2\.') 2>/dev/null; then
  echo "PASS US-6 (#472): markers named per shard with the diagnostic line (shard=N …)"
else
  echo "FAIL US-6 (#472): marker files missing or without the shard=N diagnostic line"
  FAIL=1
fi
# The wait really outlasted the 8 s pre-bind window (markers cannot exist
# before the stub first answers) and did not burn anywhere near the ceiling.
# Upper bound 85: the untouched 30 s stabilization buffer + stages + teardown
# ride inside the elapsed time too (~45 s idle); a ceiling burn would be
# 192 s+ and gets reaped at 90 → rc=137 → this assert fails loudly.
if [ "$US6_ELAPSED" -ge 8 ] && [ "$US6_ELAPSED" -lt 85 ]; then
  echo "PASS US-6 (#472): waited out the late port (${US6_ELAPSED}s ≥ 8s delay; no ceiling burn)"
else
  echo "FAIL US-6 (#472): elapsed ${US6_ELAPSED}s — want ≥8 (delay waited out) and <85"
  FAIL=1
fi
# No duplicate HTTP readiness probing: the legacy per-shard poll lines are
# gone from the orchestrator's log.
if grep -q 'waiting for shard frontends to be ready' "$US6_DIR/test-all.log" 2>/dev/null \
   || grep -Eq 'shard [0-9] ready \(frontend' "$US6_DIR/test-all.log" 2>/dev/null; then
  echo "FAIL US-6 (#472): legacy HTTP-poll readiness lines still present (duplicate probing)"
  FAIL=1
else
  echo "PASS US-6 (#472): no legacy HTTP-poll readiness lines (marker wait only)"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
