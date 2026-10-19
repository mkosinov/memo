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
#
# Feature #317 (run tag + manual-stack lease, spec §3.1/§3.3):
#   → Untagged invariant: Cases 1-6 run with SHARD_RUNS_DIR pointed at an
#     isolated dir — an untagged run must NEVER write a lease (empty tag →
#     zero behavior change, CI path byte-identical). #415: Case 6's valid
#     loop is untagged too, so it is covered by the same check.
#   → Case 7 (§3.1/§3.3): a tagged run (SHARD_RUN_TAG=6 hex) uses tagged
#     resource names (NEXT_DIST_DIR=.next-shard-<id>_<tag>, FILES_DIR=
#     test_files_shard<id>_<tag>), exports SHARD_RUN_TAG to children, and
#     writes an 8-field manual lease `pid tag SHARD_PORT BACKEND_PORT 0 0
#     epoch` (PID = the script's own $$ == the pnpm stub's PPID; the two
#     unused port slots are zero-padded) which is REMOVED on script exit.
#   → Case 8 (§3.1): an invalid SHARD_RUN_TAG is fatal (exit 1 + clear
#     message) BEFORE any resource/dir creation — the provided DB file is
#     left byte-intact, no lease appears.
#   → Case 9 (§3.3): an ALIVE manual-style lease (2 real ports + two
#     zeros) consumed by sweep_dead_runs: its 2 REAL ports go to stdout
#     (busy-protection for the allocator; zeros ride along and are
#     filtered at the test-all.sh seam), NOTHING is swept — the lease
#     file survives. Pins existing lib semantics against regressions.
#   → Case 10 (Task 8): SHARD_RUN_TAG SET to the EMPTY string → fully
#     legacy names/wipe, no lease.
#   → Case 11 (Task 8): tagged SHARD_ID=2 → tagged shard-2 names + lease.
#   → Case 12 (Fix A): SHARD_MANAGED_STACK=1 (set by test-all.sh around
#     BOTH shard stacks it starts) → the orchestrator owns the tag's
#     4-port lease: the managed stack writes NO lease and removes NONE on
#     exit; a pre-existing orchestrator lease survives byte-intact.
#
# Feature #415 (CI native shards 1-4, spec §3.2):
#   → Case 6 rewritten table-driven: valid ids 1/2/3/4 (full STUBBED run —
#     rc=0 + reached next dev as positive control) and invalid
#     `rest 0 5 abc` (DIRECT call: the allowlist guard fires before any
#     machinery — rc=1 + `must be 1–4` on stderr).
#   → Case 13: export cases for the NEW ids 3/4, same assertion set as
#     Cases 3/4 (S1 NEXT_DIST_DIR + #317 legacy storage exports + empty
#     tag re-export), table-driven over the spec §3.2 port pairs
#     (3→3004/8003, 4→3005/8004).
#   Table form is deliberate: a future shard-count change extends
#   SHARD_ID_PORT_TABLE (and the Case 13 entry list), never a copy-pasted
#   case block (panel simplicity remark).
#
# ── #317 Task 8: assert matrix (tag × shard id × lease) ────────────────────
# Every cell carries a LIVE, EXACT assertion (case numbers refer to the
# blocks below); "names" = NEXT_DIST_DIR + FILES_DIR(=TEST_FILES_DIR) at
# the pnpm call site, byte-exact including the <root>/backend base-dir
# composition the product builds:
#
#   tag \ id          │ 1                           │ 2
#   ──────────────────┼─────────────────────────────┼────────────────────────────
#   unset            │ Case 3: legacy names;       │ Case 4: legacy names;
#                    │ no lease (group ck after    │ no lease (group ck after
#                    │ Case 5)                     │ Case 5)
#   "" (set-empty)   │ Case 10: legacy names +     │ — (note A)
#                    │ legacy wipe; no lease       │
#   valid 6-hex      │ Case 7: tagged names;       │ Case 11: tagged names +
#                    │ lease written (live poll,   │ lease written (log proof,
#                    │ 8-field content) + removed  │ note B) + removed
#   invalid non-hex  │ Case 8: fatal pre-resources; no lease; DB intact
#                    │ (tag validation is id-independent)
#
#   SHARD_RUN_TAG re-export is pinned in every names-cell: [<tag>] tagged,
#   [] (EMPTY string, set — not unset) untagged (Cases 3/4/10/11).
#   note A: set-empty vs unset only exercises bash "${VAR:-}" defaulting;
#   after the product's SHARD_RUN_TAG="${SHARD_RUN_TAG:-}" both spellings
#   are the same empty string, and the <id> interpolation is shared code —
#   one id per tag-mode covers the generators of the cross-product.
#   note B: write_run_lease failure is fatal BEFORE any server starts, so
#   reaching next dev (positive control) + the "Run lease:" log line prove
#   the write; the 8-field content/pid checks are id-independent (Case 7).
#
#   Managed-stack overlay (Fix A, #317 §3.3 lease ownership): with
#   SHARD_MANAGED_STACK=1 + a valid tag (how test-all.sh starts BOTH
#   shards) the lease is the ORCHESTRATOR's — Case 12: no lease written
#   while alive, none removed after (nothing existed), a pre-existing
#   4-port orchestrator lease SURVIVES byte-intact; tagged names/exports
#   unchanged (NEXT_DIST_DIR pinned). Flag absent → manual mode,
#   byte-identical (Cases 7/11 pin the manual lease lifecycle).
#
#   Exports NOT separately journaled, justified: SHARD_ID — lands inside
#   the asserted names (both ids pinned in both modes); DATABASE_URL /
#   BACKEND_PORT — pre-#317 surface, pinned via the uv stub + wipe log
#   (Case 1); TEST_DB_PATH — caller-provided, not composed by the script.

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
# #317: isolated run-lease dir — every run under test gets SHARD_RUNS_DIR
# pointed here, so lease writes/removals are observable and NEVER touch the
# real ${TMPDIR:-/tmp}/memo-shard-runs.
RUNS_DIR="$WORK/runs"

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
# #317: the script under test sources scripts/lib/shard-helpers.sh relative
# to its OWN root (write_run_lease/remove_run_lease) — stage the lib next to
# it, so the staged tree is self-contained.
mkdir -p "$STAGE/scripts/lib"
cp "$REPO_ROOT/scripts/lib/shard-helpers.sh" "$STAGE/scripts/lib/shard-helpers.sh"
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
# script exported (NEXT_DIST_DIR, SHARD_PORT; #317: SHARD_RUN_TAG + the
# stub's PPID == the script's own PID for lease-pid assertions; #317 Task 8:
# FILES_DIR + TEST_FILES_DIR — the FULL exported storage strings, pinned
# byte-exact by the assert matrix below). Fields are append-only so earlier
# substring greps stay stable. SHARD_RUN_TAG uses ${VAR-<fallback>}
# expansion (dash, NO colon): the product exports it unconditionally, so an
# untagged child must journal [] (EMPTY, set) — distinct from UNSET (a
# failed/missing export). Anything else: no-op. #317 Case 7: SHARD_DRYRUN_HOLD_S keeps the stub (the
# "foreground" frontend) alive so the harness can inspect the run lease
# while the script under test is still running.
cat > "$STUBS/pnpm" <<'EOF'
#!/bin/sh
case "$*" in
  *"exec next dev"*)
    printf 'PNPM_EXEC_NEXT_DEV argv=[%s] NEXT_DIST_DIR=[%s] SHARD_PORT=[%s] SHARD_RUN_TAG=[%s] PPID=[%s] FILES_DIR=[%s] TEST_FILES_DIR=[%s]\n' \
      "$*" "${NEXT_DIST_DIR:-unset}" "${SHARD_PORT:-unset}" \
      "${SHARD_RUN_TAG-UNSET}" "$PPID" \
      "${FILES_DIR:-unset}" "${TEST_FILES_DIR:-unset}" \
      >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    if [ -n "${SHARD_DRYRUN_HOLD_S:-}" ]; then
      sleep "$SHARD_DRYRUN_HOLD_S"
    fi
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

# python3 stub (GH #310): the canon generator would run against a DB that
# does not exist in the staged tree (uv is stubbed, nothing seeds it), so
# journal the invocation and succeed — the script-level contract under test
# is "canon generation runs right after seeding", not its SQL output.
cat > "$STUBS/python3" <<'EOF'
#!/bin/sh
printf 'PYTHON3: %s\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
exit 0
EOF

chmod +x "$STUBS/pnpm" "$STUBS/rm" "$STUBS/curl" "$STUBS/lsof" "$STUBS/python3"

FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────

# run_shard <log> <journal> <db> <shard_id> <shard_port> <backend_port>
# Sets LAST_RC to the run's exit code (#415: the allowlist table asserts
# rc=0 for every valid id; earlier callers ignore it).
run_shard() {
  local log="$1" journal="$2" db="$3" sid="$4" sport="$5" bport="$6"
  set +e
  SHARD_ID="$sid" SHARD_PORT="$sport" BACKEND_PORT="$bport" \
    TEST_DB_PATH="$db" \
    BACKEND_URL="http://127.0.0.1:$bport" \
    NEXT_PUBLIC_API_URL="http://127.0.0.1:$bport" \
    SHARD_DRYRUN_JOURNAL="$journal" \
    SHARD_RUNS_DIR="$RUNS_DIR" \
    PATH="$STUBS:$PATH" \
    timeout 15 bash "$SCRIPT_UNDER_TEST" > "$log" 2>&1
  LAST_RC=$?
  set -e
}

# is_uint S — true iff S is a non-empty unsigned integer (lease fields)
is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  return 0
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

# assert_storage_exports <journal> <sid> <sfx> <label> — #317 Task 8.
# Pins the FULL exported storage strings at the pnpm call site:
# FILES_DIR == TEST_FILES_DIR == <staged-root>/backend/test_files_shard<sid><sfx>
# — byte-exact, including the /backend base-dir composition the product
# builds (grep -F: no regex accidents). sfx is "" (legacy names) or
# "_<tag>" (tagged names). The closing ']' + field adjacency make the
# match exact — a suffixed/prefix lookalike cannot satisfy it.
assert_storage_exports() {
  local journal="$1" sid="$2" sfx="$3" label="$4"
  local want
  want="FILES_DIR=[$STAGE/backend/test_files_shard${sid}${sfx}] TEST_FILES_DIR=[$STAGE/backend/test_files_shard${sid}${sfx}]"
  if grep -Fq "$want" "$journal" 2>/dev/null; then
    echo "PASS $label: FILES_DIR=TEST_FILES_DIR=[backend/test_files_shard${sid}${sfx}] exported exact"
    return 0
  fi
  echo "FAIL $label: expected '$want' in the pnpm journal"
  return 1
}

# assert_tag_export <journal> <want> <label> — #317 Task 8. Pins the
# SHARD_RUN_TAG re-export at the pnpm call site: [<tag>] for a tagged run,
# [] (EMPTY string — set, not unset; the product defaults
# SHARD_RUN_TAG="${SHARD_RUN_TAG:-}" then exports unconditionally) for an
# untagged one. PPID=[ adjacency bounds the needle on the right.
assert_tag_export() {
  local journal="$1" want="$2" label="$3"
  if grep -Fq "SHARD_RUN_TAG=[$want] PPID=[" "$journal" 2>/dev/null; then
    echo "PASS $label: SHARD_RUN_TAG re-exported as [${want:-<empty string>}]"
    return 0
  fi
  echo "FAIL $label: expected 'SHARD_RUN_TAG=[$want] PPID=[' in the pnpm journal"
  return 1
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

# GH #310: the canon generator must run (right after the seed step) with the
# shard DB path and its .canon.sql output path.
if grep -q '^PYTHON3: .*gen_seed_canon\.py.*\.canon\.sql' "$CASE1_DIR/journal" 2>/dev/null; then
  echo "PASS Case 1 (#310): canon generator invoked for the shard DB"
else
  echo "FAIL Case 1 (#310): expected a gen_seed_canon.py invocation in the journal"
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
# #317 Task 8 (matrix: unset × id 1): full legacy storage exports + the
# empty-string tag re-export.
assert_storage_exports "$CASE3_DIR/journal" 1 "" "Case 3 (#317)" || FAIL=1
assert_tag_export "$CASE3_DIR/journal" "" "Case 3 (#317)" || FAIL=1
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
# #317 Task 8 (matrix: unset × id 2): full legacy storage exports + the
# empty-string tag re-export.
assert_storage_exports "$CASE4_DIR/journal" 2 "" "Case 4 (#317)" || FAIL=1
assert_tag_export "$CASE4_DIR/journal" "" "Case 4 (#317)" || FAIL=1
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

# ── Case 6 (#209/#415): SHARD_ID allowlist — table-driven ─────────────────
# A SHARD_ID typo (e.g. "rest") used to fall through to Playwright project
# resolution and CI reported "0 spec files" far from the root cause. The
# script must hard-fail before any machinery. #415 (spec §3.2): canonical
# shards are now 1-4; port pairs stay caller-provided (1→3002/8001,
# 2→3003/8002, 3→3004/8003, 4→3005/8004 — pinned here only as table data).
#   valid ids   → full STUBBED run (run_shard): rc=0 AND the positive
#                 control (reached next dev), so rc=0 is not vacuous;
#   invalid ids → DIRECT call, no stubs (the guard fires before uv/pnpm —
#                 nothing beyond it is reachable) → rc=1 + `must be 1–4`
#                 on stderr.
# Loop logs print on FAILURE only (a passing table needs no forensics;
# per-id artifacts remain under $WORK/case6 for CI debugging).
CASE6_DIR="$WORK/case6"; mkdir -p "$CASE6_DIR"
SHARD_ID_PORT_TABLE="1:3002:8001 2:3003:8002 3:3004:8003 4:3005:8004"
for entry in $SHARD_ID_PORT_TABLE; do
  sid="${entry%%:*}"; _ports="${entry#*:}"
  sport="${_ports%%:*}"; bport="${_ports#*:}"
  CASE6_DB="$CASE6_DIR/test_memo_shard${sid}.db"
  printf 'seed' > "$CASE6_DB"
  run_shard "$CASE6_DIR/run-$sid.log" "$CASE6_DIR/journal-$sid" "$CASE6_DB" "$sid" "$sport" "$bport"
  if [ "$LAST_RC" -eq 0 ] && grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE6_DIR/journal-$sid" 2>/dev/null; then
    echo "PASS Case 6 (#415): SHARD_ID=$sid accepted — rc=0, reached next dev (ports $sport/$bport)"
  else
    echo "FAIL Case 6 (#415): SHARD_ID=$sid rejected or never reached next dev (rc=$LAST_RC)"
    echo "── Case 6 id=$sid log ──"
    cat "$CASE6_DIR/run-$sid.log"
    echo "─────────────────"
    FAIL=1
  fi
done
for bad_id in rest 0 5 abc; do
  set +e
  SHARD_ID="$bad_id" SHARD_PORT=3002 BACKEND_PORT=8001 \
    BACKEND_URL=http://127.0.0.1:8001 \
    NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
    TEST_DB_PATH="$CASE6_DIR/test_memo_shard1.db" \
    timeout 5 bash "$SCRIPT_UNDER_TEST" \
    > "$CASE6_DIR/guard-$bad_id.out" 2> "$CASE6_DIR/guard-$bad_id.err"
  WHITELIST_EXIT=$?
  set -e
  if [ "$WHITELIST_EXIT" -eq 1 ] && grep -q "must be 1–4" "$CASE6_DIR/guard-$bad_id.err"; then
    echo "PASS Case 6 (#415): SHARD_ID=$bad_id rejected with exit 1 + allowlist diagnostic"
  else
    echo "FAIL Case 6 (#415): expected exit 1 + 'must be 1–4' on stderr for SHARD_ID=$bad_id"
    echo "  exit code: $WHITELIST_EXIT"
    echo "── Case 6 id=$bad_id stderr ──"
    cat "$CASE6_DIR/guard-$bad_id.err"
    echo "─────────────────"
    FAIL=1
  fi
done

# ── #317 untagged invariant: Cases 1-6 wrote NO lease ──────────────────────
# They ran untagged with SHARD_RUNS_DIR pointed at RUNS_DIR (incl. Case 6's
# valid-id loop, #415): an empty tag must produce ZERO lease side effects
# (spec §3.1 — CI path unchanged).
if [ -z "$(ls -A "$RUNS_DIR" 2>/dev/null || true)" ]; then
  echo "PASS (#317 untagged): untagged runs (Cases 1-6) wrote no run lease"
else
  echo "FAIL (#317 untagged): untagged runs must not write leases; $RUNS_DIR contains:"
  ls -A "$RUNS_DIR"
  FAIL=1
fi

# ── Case 7 (#317 §3.1/§3.3): tagged run — tagged names + manual lease ──────
# SHARD_RUN_TAG=ab12cd (valid 6-hex) must produce:
#   - NEXT_DIST_DIR=.next-shard-1_ab12cd at the pnpm call site;
#   - FILES_DIR/TEST_FILES_DIR=test_files_shard1_ab12cd (log line + the
#     wipe's RM journal line), never the untagged test_files_shard1;
#   - an 8-field manual lease `pid ab12cd 3002 8001 0 0 epoch` in
#     SHARD_RUNS_DIR — PID is the script's own $$ (== the pnpm stub's
#     PPID), the two unused port slots ZERO-padded (a manual stack has
#     only SHARD_PORT + BACKEND_PORT);
#   - SHARD_RUN_TAG exported (visible to the pnpm child);
#   - the lease REMOVED after the script exits (its trap).
# The pnpm stub holds the "foreground" for SHARD_DRYRUN_HOLD_S seconds so
# the lease can be inspected while the script is still alive.
CASE7_DIR="$WORK/case7"; mkdir -p "$CASE7_DIR"
CASE7_DB="$CASE7_DIR/test_memo_shard1_ab12cd.db"
printf 'seed' > "$CASE7_DB"
CASE7_TAG=ab12cd
CASE7_LEASE="$RUNS_DIR/${CASE7_TAG}.run"

set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$CASE7_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_RUN_TAG="$CASE7_TAG" \
  SHARD_DRYRUN_JOURNAL="$CASE7_DIR/journal" \
  SHARD_DRYRUN_HOLD_S=3 \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  bash "$SCRIPT_UNDER_TEST" > "$CASE7_DIR/run.log" 2>&1 &
CASE7_PID=$!
set -e

# Poll for the lease while the script is alive (write happens before any
# server start, so it appears ~instantly; the hold keeps the script up).
CASE7_LEASE_SEEN=false
for _i in $(seq 1 20); do
  if [ -f "$CASE7_LEASE" ]; then
    CASE7_LEASE_SEEN=true
    break
  fi
  sleep 0.2
done
if [ "$CASE7_LEASE_SEEN" = true ]; then
  echo "PASS Case 7 (#317): run lease written while the tagged stack is alive"
else
  echo "FAIL Case 7 (#317): no run lease appeared at $CASE7_LEASE while the script was alive"
  FAIL=1
fi

# Lease content: exactly 8 fields `pid tag front back 0 0 epoch`, fresh stamp.
if [ "$CASE7_LEASE_SEEN" = true ]; then
  LPID=""; LTAG=""; LP1=""; LP2=""; LP3=""; LP4=""; LSTAMP=""; LEXTRA=""
  if read -r LPID LTAG LP1 LP2 LP3 LP4 LSTAMP LEXTRA < "$CASE7_LEASE"; then
    CASE7_NOW="$(date +%s)"
    if [ "$LTAG" = "$CASE7_TAG" ] && [ "$LP1" = "3002" ] && [ "$LP2" = "8001" ] \
       && [ "$LP3" = "0" ] && [ "$LP4" = "0" ] && [ -z "$LEXTRA" ] \
       && [ "$LPID" = "$CASE7_PID" ] && is_uint "$LSTAMP" \
       && [ "$LSTAMP" -le "$CASE7_NOW" ] \
       && [ $(( CASE7_NOW - LSTAMP )) -lt 60 ]; then
      echo "PASS Case 7 (#317): lease line is exact 'pid tag front back 0 0 epoch' (pid=$LPID)"
    else
      echo "FAIL Case 7 (#317): bad lease content: '$LPID $LTAG $LP1 $LP2 $LP3 $LP4 $LSTAMP $LEXTRA'"
      FAIL=1
    fi
  else
    echo "FAIL Case 7 (#317): cannot read a lease line from $CASE7_LEASE"
    FAIL=1
  fi
fi

# Reap the run; the script must exit 0 (stubbed stack) and remove its lease.
set +e
wait "$CASE7_PID"
CASE7_RC=$?
set -e
echo "── Case 7 log ──"
cat "$CASE7_DIR/run.log"
echo "── Case 7 journal ──"
cat "$CASE7_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE7_RC" -eq 0 ]; then
  echo "PASS Case 7 (#317): tagged run exited 0"
else
  echo "FAIL Case 7 (#317): tagged run exited $CASE7_RC (expected 0)"
  FAIL=1
fi
if [ ! -e "$CASE7_LEASE" ]; then
  echo "PASS Case 7 (#317): lease removed on script exit"
else
  echo "FAIL Case 7 (#317): lease $CASE7_LEASE still exists after script exit"
  FAIL=1
fi

# Tagged resource names at the pnpm call site + tag export + lease pid ==
# the script's own pid (stub's PPID).
if grep -Fq "NEXT_DIST_DIR=[.next-shard-1_${CASE7_TAG}]" "$CASE7_DIR/journal" 2>/dev/null; then
  echo "PASS Case 7 (#317): NEXT_DIST_DIR=.next-shard-1_${CASE7_TAG} at pnpm call site"
else
  echo "FAIL Case 7 (#317): expected NEXT_DIST_DIR=[.next-shard-1_${CASE7_TAG}] in pnpm journal"
  FAIL=1
fi
if grep -Fq "SHARD_RUN_TAG=[${CASE7_TAG}]" "$CASE7_DIR/journal" 2>/dev/null; then
  echo "PASS Case 7 (#317): SHARD_RUN_TAG exported to the pnpm child"
else
  echo "FAIL Case 7 (#317): expected SHARD_RUN_TAG=[${CASE7_TAG}] in pnpm journal (export)"
  FAIL=1
fi
if grep -Fq "PPID=[${CASE7_PID}]" "$CASE7_DIR/journal" 2>/dev/null; then
  echo "PASS Case 7 (#317): pnpm child's PPID is the script pid (positive control)"
else
  echo "FAIL Case 7 (#317): expected PPID=[${CASE7_PID}] in pnpm journal"
  FAIL=1
fi

# FILES_DIR/TEST_FILES_DIR: tagged name used (log + wipe journal), untagged
# name never touched.
if grep -q "Files dir: .*test_files_shard1_${CASE7_TAG}\$" "$CASE7_DIR/run.log" 2>/dev/null; then
  echo "PASS Case 7 (#317): Files dir log line names test_files_shard1_${CASE7_TAG}"
else
  echo "FAIL Case 7 (#317): expected 'Files dir: ...test_files_shard1_${CASE7_TAG}' in run log"
  FAIL=1
fi
if grep -Fq -- "RM: -rf $STAGE/backend/test_files_shard1_${CASE7_TAG}" "$CASE7_DIR/journal" 2>/dev/null; then
  echo "PASS Case 7 (#317): wipe targeted the tagged files dir"
else
  echo "FAIL Case 7 (#317): expected 'RM: -rf .../test_files_shard1_${CASE7_TAG}' in journal"
  FAIL=1
fi
if grep -qE "RM: -rf .*test_files_shard1$" "$CASE7_DIR/journal" 2>/dev/null; then
  echo "FAIL Case 7 (#317): untagged test_files_shard1 was wiped by a tagged run"
  FAIL=1
else
  echo "PASS Case 7 (#317): untagged test_files_shard1 never touched"
fi
# #317 Task 8 (matrix: tag × id 1): the full tagged storage exports, pinned
# byte-exact at the child-process boundary (stronger than the log tail above).
assert_storage_exports "$CASE7_DIR/journal" 1 "_${CASE7_TAG}" "Case 7 (#317)" || FAIL=1

assert_reached_next_dev "$CASE7_DIR/journal" "Case 7 (positive control)" || FAIL=1
assert_no_default_next_rm "$CASE7_DIR/journal" "Case 7 (S5)" || FAIL=1
assert_fixture_intact "Case 7 (S5)" || FAIL=1

# ── Case 8 (#317 §3.1): invalid SHARD_RUN_TAG → fatal before resources ─────
# A tag that fails ^[0-9a-f]{6}$ must kill the run with exit 1 and a clear
# message BEFORE any resource/dir creation: the provided DB file stays
# byte-intact (no wipe), no lease appears.
CASE8_DIR="$WORK/case8"; mkdir -p "$CASE8_DIR"
CASE8_DB="$CASE8_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE8_DB"
set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$CASE8_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_RUN_TAG="n0hex!" \
  SHARD_DRYRUN_JOURNAL="$CASE8_DIR/journal" \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  timeout 5 bash "$SCRIPT_UNDER_TEST" > "$CASE8_DIR/run.log" 2>&1
CASE8_RC=$?
set -e

echo "── Case 8 log ──"
cat "$CASE8_DIR/run.log"
echo "─────────────────"

if [ "$CASE8_RC" -eq 1 ] && grep -q "SHARD_RUN_TAG" "$CASE8_DIR/run.log"; then
  echo "PASS Case 8 (#317): invalid tag rejected with exit 1 + diagnostic"
else
  echo "FAIL Case 8 (#317): expected exit 1 + SHARD_RUN_TAG diagnostic (got exit $CASE8_RC)"
  FAIL=1
fi
if [ "$(cat "$CASE8_DB" 2>/dev/null || true)" = "seed" ]; then
  echo "PASS Case 8 (#317): no resource touched — DB file byte-intact"
else
  echo "FAIL Case 8 (#317): DB file was modified/wiped before the tag check"
  FAIL=1
fi
if [ -z "$(ls -A "$RUNS_DIR" 2>/dev/null || true)" ]; then
  echo "PASS Case 8 (#317): no lease written for an invalid tag"
else
  echo "FAIL Case 8 (#317): $RUNS_DIR not empty after invalid-tag run"
  FAIL=1
fi

# ── Case 9 (#317 §3.3): alive manual-style lease — busy-protected ──────────
# A manual stack leases only SHARD_PORT + BACKEND_PORT, zero-padding the two
# unused slots (8-field format). Consumed by sweep_dead_runs (the REAL lib,
# sourced here): an ALIVE manual lease → its 2 REAL ports go to stdout (the
# busy-args contract — the allocator must bypass them; the zeros ride
# along and are filtered at the test-all.sh seam) and NOTHING is swept —
# the lease file survives untouched.
CASE9_RUNS="$WORK/case9-runs"
SHARD_RUNS_DIR="$CASE9_RUNS"
ROOT="$WORK/case9-root"
mkdir -p "$ROOT/backend" "$ROOT/frontend/admin"
source "$REPO_ROOT/scripts/lib/shard-helpers.sh"
if write_run_lease "c0ffee" "$$" 3002 8001 0 0; then
  echo "  → manual-style lease written: pid=$$ tag=c0ffee ports=3002 8001 0 0"
  CASE9_OUT="$(sweep_dead_runs)"
  if [ "$CASE9_OUT" = "3002 8001 0 0" ]; then
    echo "PASS Case 9 (#317): alive manual lease busy-protects its 2 real ports (stdout: '$CASE9_OUT')"
  else
    echo "FAIL Case 9 (#317): sweep stdout was '$CASE9_OUT' (want '3002 8001 0 0')"
    FAIL=1
  fi
  if [ -f "$CASE9_RUNS/c0ffee.run" ]; then
    echo "PASS Case 9 (#317): nothing swept — alive manual lease survives"
  else
    echo "FAIL Case 9 (#317): alive manual lease was removed/swept"
    FAIL=1
  fi
else
  echo "FAIL Case 9 (#317): write_run_lease refused the manual-style lease"
  FAIL=1
fi

# ── Case 10 (#317 Task 8): EXPLICITLY EMPTY tag → byte-identical legacy ────
# Matrix cell ("" × id 1). SHARD_RUN_TAG is SET to the empty string (Cases
# 1-5 leave it UNSET): after the product's SHARD_RUN_TAG="${SHARD_RUN_TAG:-}"
# defaulting both spellings are the same empty string, so the run must be
# FULLY legacy — exact legacy names for ALL THREE exports, legacy wipe
# target, DB wiped, NO lease.
CASE10_DIR="$WORK/case10"; mkdir -p "$CASE10_DIR"
CASE10_DB="$CASE10_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE10_DB"
set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$CASE10_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_RUN_TAG="" \
  SHARD_DRYRUN_JOURNAL="$CASE10_DIR/journal" \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  timeout 15 bash "$SCRIPT_UNDER_TEST" > "$CASE10_DIR/run.log" 2>&1
CASE10_RC=$?
set -e

echo "── Case 10 log ──"
cat "$CASE10_DIR/run.log"
echo "── Case 10 journal ──"
cat "$CASE10_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE10_RC" -eq 0 ]; then
  echo "PASS Case 10 (#317): set-empty tag run exited 0 (legacy path)"
else
  echo "FAIL Case 10 (#317): set-empty tag run exited $CASE10_RC (expected 0)"
  FAIL=1
fi
if grep -Fq "NEXT_DIST_DIR=[.next-shard-1] SHARD_PORT=[3002]" "$CASE10_DIR/journal" 2>/dev/null; then
  echo "PASS Case 10 (#317): NEXT_DIST_DIR=.next-shard-1 (exact legacy, no _suffix)"
else
  echo "FAIL Case 10 (#317): expected exact legacy NEXT_DIST_DIR=[.next-shard-1] in pnpm journal"
  FAIL=1
fi
assert_storage_exports "$CASE10_DIR/journal" 1 "" "Case 10 (#317)" || FAIL=1
assert_tag_export "$CASE10_DIR/journal" "" "Case 10 (#317)" || FAIL=1
# Wipe must target the LEGACY files dir — whole-line match (-Fx): a suffixed
# lookalike (test_files_shard1_<tag>) must NOT satisfy it.
if grep -Fxq -- "RM: -rf $STAGE/backend/test_files_shard1" "$CASE10_DIR/journal" 2>/dev/null; then
  echo "PASS Case 10 (#317): wipe targeted the legacy files dir (whole-line exact)"
else
  echo "FAIL Case 10 (#317): expected whole-line 'RM: -rf $STAGE/backend/test_files_shard1' in journal"
  FAIL=1
fi
if grep -q "FILE_ABSENT" "$CASE10_DIR/run.log" 2>/dev/null; then
  echo "PASS Case 10 (#317): legacy DB wipe still happened (uv saw FILE_ABSENT)"
else
  echo "FAIL Case 10 (#317): expected FILE_ABSENT — DB wipe missing on set-empty tag"
  FAIL=1
fi
if [ -z "$(ls -A "$RUNS_DIR" 2>/dev/null || true)" ]; then
  echo "PASS Case 10 (#317): set-empty tag wrote no lease"
else
  echo "FAIL Case 10 (#317): $RUNS_DIR not empty after set-empty-tag run:"
  ls -A "$RUNS_DIR"
  FAIL=1
fi
assert_reached_next_dev "$CASE10_DIR/journal" "Case 10 (positive control)" || FAIL=1
assert_no_default_next_rm "$CASE10_DIR/journal" "Case 10 (S5)" || FAIL=1
assert_fixture_intact "Case 10 (S5)" || FAIL=1

# ── Case 11 (#317 Task 8): tagged run, SHARD_ID=2 → tagged shard-2 names ───
# Matrix cell (tag × id 2): the CI matrix runs shard 2 too — pin the tagged
# naming for BOTH ids (Case 7 pins id 1; see note B in the header matrix for
# why the lease is proven via log + positive control instead of a live poll).
CASE11_DIR="$WORK/case11"; mkdir -p "$CASE11_DIR"
CASE11_TAG=feed42
CASE11_DB="$CASE11_DIR/test_memo_shard2.db"
printf 'seed' > "$CASE11_DB"
set +e
SHARD_ID=2 SHARD_PORT=3003 BACKEND_PORT=8002 \
  TEST_DB_PATH="$CASE11_DB" \
  BACKEND_URL=http://127.0.0.1:8002 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8002 \
  SHARD_RUN_TAG="$CASE11_TAG" \
  SHARD_DRYRUN_JOURNAL="$CASE11_DIR/journal" \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  timeout 15 bash "$SCRIPT_UNDER_TEST" > "$CASE11_DIR/run.log" 2>&1
CASE11_RC=$?
set -e

echo "── Case 11 log ──"
cat "$CASE11_DIR/run.log"
echo "── Case 11 journal ──"
cat "$CASE11_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE11_RC" -eq 0 ]; then
  echo "PASS Case 11 (#317): tagged shard-2 run exited 0"
else
  echo "FAIL Case 11 (#317): tagged shard-2 run exited $CASE11_RC (expected 0)"
  FAIL=1
fi
if grep -Fq "NEXT_DIST_DIR=[.next-shard-2_${CASE11_TAG}] SHARD_PORT=[3003]" "$CASE11_DIR/journal" 2>/dev/null; then
  echo "PASS Case 11 (#317): NEXT_DIST_DIR=.next-shard-2_${CASE11_TAG} (exact tagged)"
else
  echo "FAIL Case 11 (#317): expected NEXT_DIST_DIR=[.next-shard-2_${CASE11_TAG}] in pnpm journal"
  FAIL=1
fi
assert_storage_exports "$CASE11_DIR/journal" 2 "_${CASE11_TAG}" "Case 11 (#317)" || FAIL=1
assert_tag_export "$CASE11_DIR/journal" "$CASE11_TAG" "Case 11 (#317)" || FAIL=1
# Lease proof (note B): write failure is fatal before servers start, so the
# positive control below + this log line prove the write happened.
if grep -Fq "Run lease: $RUNS_DIR/${CASE11_TAG}.run" "$CASE11_DIR/run.log" 2>/dev/null; then
  echo "PASS Case 11 (#317): run lease written ($RUNS_DIR/${CASE11_TAG}.run — log line)"
else
  echo "FAIL Case 11 (#317): expected 'Run lease: $RUNS_DIR/${CASE11_TAG}.run' in run log"
  FAIL=1
fi
if [ ! -e "$RUNS_DIR/${CASE11_TAG}.run" ]; then
  echo "PASS Case 11 (#317): lease removed on script exit"
else
  echo "FAIL Case 11 (#317): lease $RUNS_DIR/${CASE11_TAG}.run still exists after script exit"
  FAIL=1
fi
if grep -Fxq -- "RM: -rf $STAGE/backend/test_files_shard2_${CASE11_TAG}" "$CASE11_DIR/journal" 2>/dev/null; then
  echo "PASS Case 11 (#317): wipe targeted the tagged files dir (whole-line exact)"
else
  echo "FAIL Case 11 (#317): expected whole-line 'RM: -rf $STAGE/backend/test_files_shard2_${CASE11_TAG}' in journal"
  FAIL=1
fi
if grep -qE "RM: -rf .*test_files_shard2$" "$CASE11_DIR/journal" 2>/dev/null; then
  echo "FAIL Case 11 (#317): untagged test_files_shard2 was wiped by a tagged run"
  FAIL=1
else
  echo "PASS Case 11 (#317): untagged test_files_shard2 never touched"
fi
assert_reached_next_dev "$CASE11_DIR/journal" "Case 11 (positive control)" || FAIL=1
assert_no_default_next_rm "$CASE11_DIR/journal" "Case 11 (S5)" || FAIL=1
assert_fixture_intact "Case 11 (S5)" || FAIL=1

# ── Case 12 (Fix A, #317 §3.3): SHARD_MANAGED_STACK=1 → the lease is the ────
# orchestrator's — a managed stack neither writes nor removes it. test-all.sh
# writes the 4-port lease for ITS tag, then starts both e2e-shard-start.sh
# stacks with SHARD_MANAGED_STACK=1; a managed stack writing its own 2-port
# lease would CLOBBER the orchestrator's (last-writer-wins) and shrink
# concurrent-run busy-protection from 4 ports to 2, and its exit trap must
# not remove the orchestrator's lease either. Two runs:
#   (a) NO pre-existing lease: while the stack is alive PAST the legacy
#       write point (poll the journal to the pnpm call site — the pre-fix
#       lease write is strictly BEFORE it, so absence there is decisive,
#       not timing luck) no lease file exists; after exit the runs dir is
#       still empty (nothing was created, nothing needed removing);
#   (b) a pre-existing ORCHESTRATOR lease for the tag (4 real ports, this
#       harness's alive pid): byte-intact through the whole lifecycle —
#       not clobbered while alive, not removed after exit.
# Manual mode (flag absent) stays byte-identical — Cases 7/11 pin it; the
# tagged NEXT_DIST_DIR grep in (a) pins that managed mode changes ONLY the
# lease lifecycle, never the resource naming.
CASE12_DIR="$WORK/case12"; mkdir -p "$CASE12_DIR"
CASE12_TAG=dec0de
CASE12_LEASE="$RUNS_DIR/${CASE12_TAG}.run"
CASE12_DB="$CASE12_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE12_DB"

set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$CASE12_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_RUN_TAG="$CASE12_TAG" \
  SHARD_MANAGED_STACK=1 \
  SHARD_DRYRUN_JOURNAL="$CASE12_DIR/journal" \
  SHARD_DRYRUN_HOLD_S=3 \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  bash "$SCRIPT_UNDER_TEST" > "$CASE12_DIR/run-a.log" 2>&1 &
CASE12A_PID=$!
set -e

# Deterministic "past the legacy write point": poll the journal until the
# pnpm call site fires (or the run dies — then every absence assert below
# would be vacuous, so treat it as a failure).
CASE12_REACHED=false
for _i in $(seq 1 50); do
  if grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE12_DIR/journal" 2>/dev/null; then
    CASE12_REACHED=true
    break
  fi
  if ! kill -0 "$CASE12A_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [ "$CASE12_REACHED" = true ] && [ ! -e "$CASE12_LEASE" ]; then
  echo "PASS Case 12 (Fix A): managed stack alive past the write point — no lease file created"
else
  echo "FAIL Case 12 (Fix A): reached=$CASE12_REACHED lease=$([ -e "$CASE12_LEASE" ] && echo present || echo absent) — a managed stack must not write a lease"
  FAIL=1
fi
if grep -Fq "NEXT_DIST_DIR=[.next-shard-1_${CASE12_TAG}]" "$CASE12_DIR/journal" 2>/dev/null; then
  echo "PASS Case 12 (Fix A): tagged build-dir name unchanged in managed mode"
else
  echo "FAIL Case 12 (Fix A): expected NEXT_DIST_DIR=[.next-shard-1_${CASE12_TAG}] in the managed run's journal"
  FAIL=1
fi

set +e
wait "$CASE12A_PID"
CASE12A_RC=$?
set -e
echo "── Case 12a log ──"
cat "$CASE12_DIR/run-a.log"
echo "── Case 12a journal ──"
cat "$CASE12_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE12A_RC" -eq 0 ] && [ -z "$(ls -A "$RUNS_DIR" 2>/dev/null || true)" ]; then
  echo "PASS Case 12 (Fix A): managed run exited 0; runs dir still empty after exit (nothing removed — there was nothing)"
else
  echo "FAIL Case 12 (Fix A): rc=$CASE12A_RC; runs dir after exit:"
  ls -A "$RUNS_DIR" 2>/dev/null || true
  FAIL=1
fi

# (b) pre-existing orchestrator lease survives byte-intact (alive + exit).
CASE12B_TAG=beef00
CASE12B_LEASE="$RUNS_DIR/${CASE12B_TAG}.run"
CASE12B_LINE="$(printf '%s %s 31101 31102 31103 31104 %s' "$$" "$CASE12B_TAG" "$(date +%s)")"
printf '%s\n' "$CASE12B_LINE" > "$CASE12B_LEASE"
CASE12B_DB="$CASE12_DIR/test_memo_shard1_b.db"
printf 'seed' > "$CASE12B_DB"

set +e
SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 \
  TEST_DB_PATH="$CASE12B_DB" \
  BACKEND_URL=http://127.0.0.1:8001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 \
  SHARD_RUN_TAG="$CASE12B_TAG" \
  SHARD_MANAGED_STACK=1 \
  SHARD_DRYRUN_JOURNAL="$CASE12_DIR/journal-b" \
  SHARD_DRYRUN_HOLD_S=3 \
  SHARD_RUNS_DIR="$RUNS_DIR" \
  PATH="$STUBS:$PATH" \
  bash "$SCRIPT_UNDER_TEST" > "$CASE12_DIR/run-b.log" 2>&1 &
CASE12B_PID=$!
set -e

CASE12B_REACHED=false
for _i in $(seq 1 50); do
  if grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE12_DIR/journal-b" 2>/dev/null; then
    CASE12B_REACHED=true
    break
  fi
  if ! kill -0 "$CASE12B_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [ "$CASE12B_REACHED" = true ] \
   && [ "$(cat "$CASE12B_LEASE" 2>/dev/null || true)" = "$CASE12B_LINE" ]; then
  echo "PASS Case 12 (Fix A): orchestrator lease byte-intact while the managed stack is alive (no clobber)"
else
  echo "FAIL Case 12 (Fix A): reached=$CASE12B_REACHED; lease while alive:"
  cat "$CASE12B_LEASE" 2>/dev/null || echo "(gone)"
  FAIL=1
fi

set +e
wait "$CASE12B_PID"
CASE12B_RC=$?
set -e
echo "── Case 12b log ──"
cat "$CASE12_DIR/run-b.log"
echo "── Case 12b journal ──"
cat "$CASE12_DIR/journal-b" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE12B_RC" -eq 0 ]; then
  echo "PASS Case 12 (Fix A): managed run over a pre-existing lease exited 0"
else
  echo "FAIL Case 12 (Fix A): managed run over a pre-existing lease exited $CASE12B_RC (expected 0)"
  FAIL=1
fi
if [ "$(cat "$CASE12B_LEASE" 2>/dev/null || true)" = "$CASE12B_LINE" ]; then
  echo "PASS Case 12 (Fix A): orchestrator lease SURVIVED the managed stack's exit byte-intact"
else
  echo "FAIL Case 12 (Fix A): orchestrator lease was removed/clobbered by the managed stack's exit"
  FAIL=1
fi
CASE12_DIRLIST="$(ls -A "$RUNS_DIR" 2>/dev/null || true)"
if [ "$CASE12_DIRLIST" = "${CASE12B_TAG}.run" ]; then
  echo "PASS Case 12 (Fix A): runs dir holds exactly the orchestrator's lease (no new files)"
else
  echo "FAIL Case 12 (Fix A): unexpected runs dir content: $CASE12_DIRLIST"
  FAIL=1
fi
assert_reached_next_dev "$CASE12_DIR/journal-b" "Case 12 (positive control)" || FAIL=1
assert_no_default_next_rm "$CASE12_DIR/journal-b" "Case 12 (S5)" || FAIL=1
assert_fixture_intact "Case 12 (S5)" || FAIL=1

# ── Case 13 (#415): export cases for the new ids 3/4 — after Cases 3/4 ────
# Same contract as Cases 3/4 (S1 build-dir isolation + the #317 matrix row
# "unset × id": legacy storage exports, EMPTY-string tag re-export, no
# default-.next rm, fixture intact), looped over the NEW shard ids so a
# future shard-count bump extends the entry list, not a copy-pasted block
# (panel remark). Ports per spec §3.2: 3→3004/8003, 4→3005/8004. Runs
# AFTER Case 12b (which deliberately leaves a lease in $RUNS_DIR), so no
# runs-dir emptiness assertion here — the untagged no-lease invariant for
# these ids is carried by assert_tag_export pinning the EMPTY tag.
CASE13_DIR="$WORK/case13"; mkdir -p "$CASE13_DIR"
for entry in 3:3004:8003 4:3005:8004; do
  sid="${entry%%:*}"; _ports="${entry#*:}"
  sport="${_ports%%:*}"; bport="${_ports#*:}"
  CASE13_SUB="$CASE13_DIR/id$sid"; mkdir -p "$CASE13_SUB"
  CASE13_DB="$CASE13_SUB/test_memo_shard${sid}.db"
  printf 'seed' > "$CASE13_DB"
  run_shard "$CASE13_SUB/run.log" "$CASE13_SUB/journal" "$CASE13_DB" "$sid" "$sport" "$bport"

  echo "── Case 13 (id=$sid) log ──"
  cat "$CASE13_SUB/run.log"
  echo "── Case 13 (id=$sid) journal ──"
  cat "$CASE13_SUB/journal" 2>/dev/null || echo "(empty)"
  echo "─────────────────"

  if grep -q "NEXT_DIST_DIR=\[\.next-shard-${sid}\]" "$CASE13_SUB/journal" 2>/dev/null; then
    echo "PASS Case 13 (S1): shard $sid exports NEXT_DIST_DIR=.next-shard-${sid} to pnpm exec next dev"
  else
    echo "FAIL Case 13 (S1): expected NEXT_DIST_DIR=[.next-shard-${sid}] in pnpm journal"
    FAIL=1
  fi
  # #317 matrix row (unset × new id): full legacy storage exports + the
  # empty-string tag re-export.
  assert_storage_exports "$CASE13_SUB/journal" "$sid" "" "Case 13 (#317 id=$sid)" || FAIL=1
  assert_tag_export "$CASE13_SUB/journal" "" "Case 13 (#317 id=$sid)" || FAIL=1
  assert_no_default_next_rm "$CASE13_SUB/journal" "Case 13 (S5 id=$sid)" || FAIL=1
  assert_fixture_intact "Case 13 (S5 id=$sid)" || FAIL=1
done

if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
