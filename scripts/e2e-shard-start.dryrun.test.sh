#!/usr/bin/env bash
# Shell-level dry-run test for e2e-shard-start.sh.
#
# Spec coverage:
#   - docs/specs/2026-07-20-seed-staleness-152-design.md (items A, R-1, R-5)
#     → Cases 1-2: shard-DB wipe before `uv` fires; path guard rejects
#       non-test DBs.
#   - Feature #122/#264 (shard build isolation):
#     → Case 3 (S1): SHARD_ID=1 run exports NEXT_DIST_DIR=".next-shard-1"
#       visible to the `pnpm exec next dev` call site.
#     → Case 4 (S1): SHARD_ID=2 run exports NEXT_DIST_DIR=".next-shard-2".
#     → Case 5 (S5): the script performs NO rm of the default `.next`
#       (any `.next` path that is not `.next-shard-*`) and the default
#       build dir fixture is left untouched. The wipe of the default
#       `.next` was removed entirely in #264 — the script must not wipe
#       it regardless of port state.
#
# Mechanics: we stub `uv`, `pnpm`, `curl`, `rm`, `lsof` on PATH so the
# script runs to completion without real backend/frontend/ports:
#   - `uv`    reports whether the DB file referenced by DATABASE_URL is
#             present at invocation time (AFTER the wipe → FILE_ABSENT).
#   - `pnpm`  on `exec next dev` appends argv + NEXT_DIST_DIR + SHARD_PORT
#             to the case journal.
#   - `rm`    appends its argv to the same journal, then performs the real
#             removal (/bin/rm) so wipe assertions stay truthful.
#   - `curl`  answers 200 instantly → ready-waits break on iteration 1,
#             warmup completes, `wait` on the backgrounded stubbed pnpm
#             returns → the run finishes in well under a second.
#   - `lsof`  reports every port free. Port state is therefore UNOBSERVABLE
#             to the script under test — Case 5's "no wipe regardless of
#             port state" invariant is carried by this stub plus the
#             journal assertion (the pre-#264 script, which consulted lsof
#             before wiping, fails exactly this setup; the #264 script
#             never wipes at all).
#
# Staging: each run copies the script under test into a run-scoped tree
#   $WORK/tree/scripts/e2e-shard-start.sh   (the copy)
#   $WORK/tree/backend/                     (empty; uv is stubbed)
#   $WORK/tree/frontend/admin/.next/marker.txt  (S5 fixture)
# The script resolves frontend/admin relative to ITSELF, so its "default
# .next" is the staged one — no dependency on the shared real tree, safe
# under parallel harness runs and real builds. Cleanup removes the whole
# stage; nothing outside $WORK/$STUBS is ever written.
#
# Case 0 is a meta-test of the journal assertion helper itself: a poisoned
# journal (fake `rm .next` line) must be detected, a clean journal must
# pass. This proves the S5 invariant actually detects violations (RED
# logic), independent of the script under test.
#
# RED/GREEN: SHARD_SCRIPT_UNDER_TEST may point at another copy of the
# shard script (used to demonstrate the new cases failing against the
# pre-#264 script, which still contained the default-.next wipe). The
# override must live inside the current repo root — it gets staged into
# $WORK/tree, so an outside path would leave the fixture checks inspecting
# the wrong tree.

set -euo pipefail

# Resolve script directory regardless of caller's cwd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Startup guards ─────────────────────────────────────────────────────────

# Guard: the script under test prepends /root/.npm-global/bin to PATH,
# AHEAD of our stub dir. If a real pnpm lives there, it would silently
# shadow the stub and every journal assertion would pass vacuously.
# Hard-fail with instructions instead of silently testing nothing.
if [ -x "/root/.npm-global/bin/pnpm" ]; then
  echo "FATAL: /root/.npm-global/bin/pnpm exists and would shadow the pnpm stub" >&2
  echo "       (e2e-shard-start.sh puts /root/.npm-global/bin first on PATH)." >&2
  echo "       Remove/rename it or run this harness on a host without it:" >&2
  echo "         mv /root/.npm-global/bin/pnpm /root/.npm-global/bin/pnpm.bak" >&2
  exit 1
fi

# Script under test: overridable (RED demonstration against pre-#264 copy)
SHARD_SCRIPT_SRC="${SHARD_SCRIPT_UNDER_TEST:-$REPO_ROOT/scripts/e2e-shard-start.sh}"
# The override must resolve INSIDE the repo root: the source is staged into
# $WORK/tree, and an outside file would make ROOT_DIR/fixture reasoning (and
# this guard's own failure mode) inspect the wrong tree.
case "$SHARD_SCRIPT_SRC" in
  "$REPO_ROOT"/*) ;;  # ok
  *)
    echo "FATAL: SHARD_SCRIPT_UNDER_TEST must be inside the repo root ($REPO_ROOT)" >&2
    echo "       got: $SHARD_SCRIPT_SRC" >&2
    exit 1
    ;;
esac
if [ ! -f "$SHARD_SCRIPT_SRC" ]; then
  echo "FATAL: shard script not found at $SHARD_SCRIPT_SRC" >&2
  exit 1
fi

# Per-run isolated work + stubs dirs
WORK="$(mktemp -d -t shard-dryrun-XXXXXX)"
STUBS="$(mktemp -d -t shard-stub-XXXXXX)"

# ── Run-scoped staged tree + S5 fixture ───────────────────────────────────
# Minimal tree the script under test expects relative to itself. The
# `.next` fixture marker is created per run inside the stage, so it can
# never race with parallel runs or a real build in the shared checkout.
STAGE="$WORK/tree"
SCRIPT_UNDER_TEST="$STAGE/scripts/e2e-shard-start.sh"
NEXT_MARKER="$STAGE/frontend/admin/.next/marker.txt"
mkdir -p "$STAGE/scripts" "$STAGE/backend" "$STAGE/frontend/admin/.next"
cp "$SHARD_SCRIPT_SRC" "$SCRIPT_UNDER_TEST"
chmod +x "$SCRIPT_UNDER_TEST"
printf 'dryrun-fixture-do-not-touch\n' > "$NEXT_MARKER"

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

# pnpm stub: journals the `exec next dev` call site with the env values the
# script exported (NEXT_DIST_DIR, SHARD_PORT). Anything else: no-op.
cat > "$STUBS/pnpm" <<'EOF'
#!/bin/sh
case "$*" in
  *"exec next dev"*)
    printf 'PNPM_EXEC_NEXT_DEV argv=[%s] NEXT_DIST_DIR=[%s] SHARD_PORT=[%s]\n' \
      "$*" "${NEXT_DIST_DIR:-unset}" "${SHARD_PORT:-unset}" \
      >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    ;;
esac
exit 0
EOF

# rm stub: journals every destructive call, then performs the REAL removal
# (/bin/rm — never the stub itself) so wipe behaviour stays observable.
cat > "$STUBS/rm" <<'EOF'
#!/bin/sh
printf 'RM: %s\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
exec /bin/rm "$@"
EOF

# curl stub: instant 200 → ready-waits break on the first iteration.
printf '#!/bin/sh\nprintf "200"\nexit 0\n' > "$STUBS/curl"

# lsof stub: every port looks free (never matches the real environment).
printf '#!/bin/sh\nexit 1\n' > "$STUBS/lsof"

chmod +x "$STUBS/pnpm" "$STUBS/rm" "$STUBS/curl" "$STUBS/lsof"

FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────

# run_shard <log> <journal> <db> <shard_id> <shard_port> <backend_port>
run_shard() {
  local log="$1" journal="$2" db="$3" sid="$4" sport="$5" bport="$6"
  set +e
  SHARD_ID="$sid" SHARD_PORT="$sport" BACKEND_PORT="$bport" \
    TEST_DB_PATH="$db" \
    BACKEND_URL="http://127.0.0.1:$bport" \
    NEXT_PUBLIC_API_URL="http://127.0.0.1:$bport" \
    SHARD_DRYRUN_JOURNAL="$journal" \
    PATH="$STUBS:$PATH" \
    timeout 15 bash "$SCRIPT_UNDER_TEST" > "$log" 2>&1 || true
  set -e
}

# journal_has_default_next_rm <journal>
# True (0) iff some `RM:` line targets the DEFAULT `.next` — i.e. a token
# that is exactly `.next`, ends with `/.next`, or lives inside it. Tokens
# like `.next-shard-1` never match (they don't END at `.next`).
journal_has_default_next_rm() {
  local journal="$1" line tok hit=0
  [ -f "$journal" ] || return 1
  while IFS= read -r line; do
    for tok in $line; do
      case "$tok" in
        -*) ;;                       # flags (-f, -rf, ...)
        .next|*/.next|\
        .next/*|*/.next/*) hit=1 ;;
      esac
    done
  done < <(grep '^RM:' "$journal" || true)
  [ "$hit" -eq 1 ]
}

# assert_no_default_next_rm <journal> <label> — dumps the journal on failure
assert_no_default_next_rm() {
  local journal="$1" label="$2"
  if journal_has_default_next_rm "$journal"; then
    echo "FAIL $label: journal contains an rm targeting the default .next:"
    grep '^RM:' "$journal" || true
    return 1
  fi
  return 0
}

# assert_reached_next_dev <journal> <label> — positive control: the shard
# actually got to `pnpm exec next dev`. Without it, the negative journal
# assertions could pass vacuously on an early-exited run (empty journal).
assert_reached_next_dev() {
  local journal="$1" label="$2"
  if grep -q '^PNPM_EXEC_NEXT_DEV ' "$journal" 2>/dev/null; then
    return 0
  fi
  echo "FAIL $label: shard never reached 'pnpm exec next dev' (empty/incomplete journal — negative assertions would be vacuous)"
  return 1
}

# assert_fixture_intact <label> — staged default build dir marker untouched
assert_fixture_intact() {
  local label="$1"
  if [ ! -f "$NEXT_MARKER" ] || ! grep -q 'dryrun-fixture-do-not-touch' "$NEXT_MARKER"; then
    echo "FAIL $label: default .next fixture was modified ($NEXT_MARKER)"
    return 1
  fi
  return 0
}

# ── Case 0: meta-test — journal invariant detects violations ──────────────
# Self-test of journal_has_default_next_rm with a poisoned and a clean
# journal. Guards the S5 detector against silent regressions.
POISON_J="$WORK/poison.journal"
cat > "$POISON_J" <<'EOF'
RM: -f /tmp/shard-case/backend/test_memo_shard1.db
RM: -rf /repo/frontend/admin/.next
EOF
CLEAN_J="$WORK/clean.journal"
cat > "$CLEAN_J" <<'EOF'
RM: -f /tmp/shard-case/backend/test_memo_shard1.db
PNPM_EXEC_NEXT_DEV argv=[exec next dev -p 3002] NEXT_DIST_DIR=[.next-shard-1] SHARD_PORT=[3002]
EOF
if journal_has_default_next_rm "$POISON_J" && ! journal_has_default_next_rm "$CLEAN_J"; then
  echo "PASS Case 0: journal invariant self-test (poison detected, clean passes)"
else
  echo "FAIL Case 0: journal invariant self-test is broken (detector wrong)"
  FAIL=1
fi

# ── Case 1: wipe removes the file before uv is invoked ────────────────────
CASE1_DIR="$WORK/case1"; mkdir -p "$CASE1_DIR"
TEST_DB="$CASE1_DIR/test_memo_dryrun.db"
printf 'old data' > "$TEST_DB"
[ -f "$TEST_DB" ] || { echo "FATAL: failed to seed test DB" >&2; exit 1; }

run_shard "$CASE1_DIR/run.log" "$CASE1_DIR/journal" "$TEST_DB" 1 3002 8001

echo "── Case 1 log ──"
cat "$CASE1_DIR/run.log"
echo "─────────────────"

if grep -q "FILE_ABSENT" "$CASE1_DIR/run.log"; then
  echo "PASS Case 1: wipe removed the file before uv was invoked"
else
  echo "FAIL Case 1: expected FILE_ABSENT in log; wipe did not happen or stub did not intercept"
  FAIL=1
fi

# ── Case 2: path guard rejects non-test DBs ───────────────────────────────
CASE2_DIR="$WORK/case2"; mkdir -p "$CASE2_DIR"
set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="/tmp/memo.db" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_DRYRUN_JOURNAL="$CASE2_DIR/journal" \
  PATH="$STUBS:$PATH" \
  timeout 5 bash "$SCRIPT_UNDER_TEST" > "$CASE2_DIR/guard.log" 2>&1
GUARD_EXIT=$?
set -e

echo "── Case 2 log ──"
cat "$CASE2_DIR/guard.log"
echo "─────────────────"

if [ "$GUARD_EXIT" -ne 0 ] && grep -q "refusing to delete non-test DB" "$CASE2_DIR/guard.log"; then
  echo "PASS Case 2: guard rejected non-test DB with diagnostic"
else
  echo "FAIL Case 2: expected non-zero exit + 'refusing to delete non-test DB' message"
  echo "  exit code: $GUARD_EXIT"
  FAIL=1
fi

# ── Case 3 (S1): SHARD_ID=1 → NEXT_DIST_DIR=.next-shard-1 at pnpm ────────
CASE3_DIR="$WORK/case3"; mkdir -p "$CASE3_DIR"
CASE3_DB="$CASE3_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE3_DB"
run_shard "$CASE3_DIR/run.log" "$CASE3_DIR/journal" "$CASE3_DB" 1 3002 8001

echo "── Case 3 log ──"
cat "$CASE3_DIR/run.log"
echo "── Case 3 journal ──"
cat "$CASE3_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if grep -q "NEXT_DIST_DIR=\[\.next-shard-1\]" "$CASE3_DIR/journal" 2>/dev/null; then
  echo "PASS Case 3 (S1): shard 1 exports NEXT_DIST_DIR=.next-shard-1 to pnpm exec next dev"
else
  echo "FAIL Case 3 (S1): expected NEXT_DIST_DIR=[.next-shard-1] in pnpm journal"
  FAIL=1
fi
assert_no_default_next_rm "$CASE3_DIR/journal" "Case 3 (S5)" || FAIL=1
assert_fixture_intact "Case 3 (S5)" || FAIL=1

# ── Case 4 (S1): SHARD_ID=2 → NEXT_DIST_DIR=.next-shard-2 at pnpm ────────
CASE4_DIR="$WORK/case4"; mkdir -p "$CASE4_DIR"
CASE4_DB="$CASE4_DIR/test_memo_shard2.db"
printf 'seed' > "$CASE4_DB"
run_shard "$CASE4_DIR/run.log" "$CASE4_DIR/journal" "$CASE4_DB" 2 3003 8002

echo "── Case 4 log ──"
cat "$CASE4_DIR/run.log"
echo "── Case 4 journal ──"
cat "$CASE4_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if grep -q "NEXT_DIST_DIR=\[\.next-shard-2\]" "$CASE4_DIR/journal" 2>/dev/null; then
  echo "PASS Case 4 (S1): shard 2 exports NEXT_DIST_DIR=.next-shard-2 to pnpm exec next dev"
else
  echo "FAIL Case 4 (S1): expected NEXT_DIST_DIR=[.next-shard-2] in pnpm journal"
  FAIL=1
fi
assert_no_default_next_rm "$CASE4_DIR/journal" "Case 4 (S5)" || FAIL=1
assert_fixture_intact "Case 4 (S5)" || FAIL=1

# ── Case 5 (S5): NO wipe of default .next, regardless of port state ──────
# No real listeners here on purpose: lsof is stubbed to "all free", so the
# script under test cannot observe port state either way — spawning
# listeners would be inert surface (and a port-collision risk). The
# pre-#264 script, whose wipe was gated on lsof, wipes in this exact
# setup (journal catches it); the #264 script contains no wipe at all.
# Positive control (reached next dev) keeps the negative assertions
# non-vacuous.
CASE5_DIR="$WORK/case5"; mkdir -p "$CASE5_DIR"
CASE5_DB="$CASE5_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE5_DB"

run_shard "$CASE5_DIR/run.log" "$CASE5_DIR/journal" "$CASE5_DB" 1 3002 8001

echo "── Case 5 log ──"
cat "$CASE5_DIR/run.log"
echo "── Case 5 journal ──"
cat "$CASE5_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if assert_reached_next_dev "$CASE5_DIR/journal" "Case 5 (S5: positive control)" \
    && assert_no_default_next_rm "$CASE5_DIR/journal" "Case 5 (S5: port busy)" \
    && assert_fixture_intact "Case 5 (S5: port busy)"; then
  echo "PASS Case 5 (S5): reached next dev; no rm of default .next regardless of port state; fixture untouched"
else
  echo "FAIL Case 5 (S5): default .next was wiped (or fixture modified), or the run never reached next dev"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
