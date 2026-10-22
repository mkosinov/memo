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
#             warmup completes instantly. #448 Task 3: the run no longer
#             ENDS with the frontend pin — stub pins model LIVE servers
#             and the harness TERMs the script (orchestrator teardown
#             semantics; see the #448 block below).
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
# Feature #448 Task 3 (fail-fast stack layer, spec §3.2):
#   The final `wait "$FRONTEND_PID"` block is replaced by a kill -0 watch
#   over BOTH server pins: either death → `stack shard N: backend|frontend
#   died on :PORT` + the ALWAYS-printed stack-log path + a capped tail
#   (last 20 lines, case-insensitive filter suppressing lines with cookie/
#   authorization/auth-token/api-key/bearer/password/secret/token) →
#   exit 1; the exit trap still releases the lease, and the trap now also
#   sweeps masked grandchild holders of THIS stack's ports (_sweep_masked;
#   the /proc resolver makes re-titled next-server workers visible).
#
#   Teardown model change: the uv stub's uvicorn branch and the pnpm stub
#   now model LIVE servers (sleep by default), so every full run is ended
#   by the HARNESS TERMing the script — orchestrator teardown semantics —
#   and the expected exit code becomes 143 (signal-aware trap exits
#   128+15; a handler that merely RETURNS would resume the watch loop and
#   turn every normal teardown into a bogus "died" verdict).
#   → Case 14: backend pin death (REAL background child dying) → rc=1 +
#     the addressed verdict; 14a pins the capped+filtered fixture tail
#     and the always-printed path, 14b the missing-file «log not created»
#     line, 14c the fd-1 readlink default (path == the run's own log).
#   → Case 15: frontend pin death → rc=1 + the addressed verdict.
#   → Case 16: trap grandchild sweep — a REAL masked holder (rewritten
#     argv, live LISTEN) of the stack's frontend port is killed by the
#     trap; an UNMASKED holder of the stack's backend port survives
#     (mask ∧ port conjunction). Ports are bind-probed with bounded
#     retries — no coupon-collector flakiness.
#   Watch intervals are env-overridden (SHARD_STACK_WATCH_S=1) to keep
#   the suite tight; stub children are real background processes.
#
# Feature #483 Task 8 (enabled notify e2e stack, spec §3.5):
#   NOTIFY_E2E_ENABLED=1 + SHARD_ID=notify switches the script from a
#   numbered shard to THE enabled notify stack: own port pair (defaults
#   backend 8005 / web 3006, outside the shard ranges, overridable via
#   NOTIFY_E2E_BACKEND_PORT / NOTIFY_E2E_SHARD_PORT), an OWN derived
#   SHARD_RUN_TAG + manual run lease (no collision with shards), the
#   required URL vars pointed at the own pair, NOTIFY_ENABLED=true,
#   REDIS_URL ONLY from an explicitly passed value (else a local ephemeral
#   redis-server child on NOTIFY_E2E_REDIS_PORT, default 6380 — never
#   6379), and the dispatcher as a child process (.venv/bin/python with
#   exec, dev.sh precedent — no worker skeleton in the e2e stack).
#   Trap cleanup is extended to the new children.
#   → Case 17a: enabled defaults + EXPLICIT REDIS_URL — no redis child;
#     derived ports/tag/URLs; lease `pid 001f45 3006 8005 0 0 epoch`
#     written + removed; dispatcher spawned with NOTIFY_ENABLED=[true],
#     ENV_FILE=[.env.test], the explicit REDIS_URL and the stack DB; DB
#     wipe happened (TEST_DB_PATH contains test_memo → guard passes);
#     dispatcher killed by the trap (DISPATCHER-TERMED).
#   → Case 17b: local-redis mode + custom port pair — redis-server stub
#     spawned with --save/--appendonly no on NOTIFY_E2E_REDIS_PORT, the
#     dispatcher sees REDIS_URL pointed at it; tag derives from the
#     CUSTOM port; BOTH children killed by the trap (TERMED lines).
#   → Case 17c: guard negatives (direct calls): enabled×shard-id, notify
#     id×default mode, garbage flag value, both shard-range port
#     collisions, non-numeric NOTIFY_E2E_REDIS_PORT — each exit 1 with
#     its diagnostic BEFORE any machinery. Plus a bespoke missing-binary
#     guard call (PATH emptied for the child; bash invoked by absolute
#     path — env resolves the command via the NEW environment).
#   → Case 17e: BUSY redis port (a REAL listener on NOTIFY_E2E_REDIS_PORT)
#     — the guard fires BEFORE the lease write and the wipes: exit 1 +
#     diagnostic, NO lease in the runs dir, the provided DB file
#     byte-intact.
#   → Case 17d (S2): default-mode control — REDIS_URL in the env is
#     ignored, NO redis-server / dispatcher child is ever spawned; the
#     legacy run (names, lease-less, wipe) is byte-identical.
#   Harness additions: a `redis-server` stub and a staged
#   backend/.venv/bin/python stub (the dispatcher spawn is a PATH-FREE
#   file call) journal their argv/env and model LIVE children with
#   TERM-journaling traps; the uv stub additionally journals the
#   uvicorn call site's BACKEND_URL/NEXT_PUBLIC_API_URL/DATABASE_URL
#   (additive — no existing assertion inspects its absence).
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

# uv stub: two call sites reach it.
#   1. the SERVER start (`uv run uvicorn src.main:app ...`) — under the
#      #448 Task 3 fail-fast watch this pin must model a LIVE backend:
#      sleep SHARD_DRYRUN_BACKEND_HOLD_S (default 30) so the kill -0 poll
#      keeps seeing it alive. SHARD_DRYRUN_BACKEND_DIE_S (death cases)
#      makes it a real dying child: sleep N, last words, exit 1.
#   2. the SEED step (`uv run python -m seed.seed`) — foreground; keeps
#      the original DATABASE_URL/DB-file journal behaviour (Case 1).
# Both branches first report DB-file presence at invocation time (AFTER
# the wipe → FILE_ABSENT).
cat > "$STUBS/uv" <<'EOF'
#!/bin/sh
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
case "$*" in
  *uvicorn*)
    # #483 Case 17: journal the SERVER call site's URL env — the enabled
    # stack must point BACKEND_URL/NEXT_PUBLIC_API_URL/DATABASE_URL at
    # its OWN pair/DB (additive line; no legacy case inspects it).
    printf 'UVICORN argv=[%s] BACKEND_URL=[%s] NEXT_PUBLIC_API_URL=[%s] DATABASE_URL=[%s]\n' \
      "$*" "${BACKEND_URL:-unset}" "${NEXT_PUBLIC_API_URL:-unset}" \
      "${DATABASE_URL:-unset}" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    if [ -n "${SHARD_DRYRUN_BACKEND_DIE_S:-}" ]; then
      sleep "$SHARD_DRYRUN_BACKEND_DIE_S"
      echo "UVICORN-PIN: backend pin final words (die-branch)"
      exit 1
    fi
    # Hold as a LIVE pin; the TERM trap reaps the inner sleep so the
    # script-under-test's teardown (TERM to this sh) never orphans a
    # sleep-600 child (#448 review iteration 1 — 600 s holding pins).
    sleep "${SHARD_DRYRUN_BACKEND_HOLD_S:-30}" &
    _s=$!
    trap 'kill "$_s" 2>/dev/null; exit 0' TERM INT
    wait "$_s"
    ;;
esac
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
# failed/missing export). Anything else: no-op. #317 Case 7:
# SHARD_DRYRUN_HOLD_S keeps the stub (the "foreground" frontend) alive so
# the harness can inspect the run lease while the script under test is
# still running. #448 Task 3: the DEFAULT is now a live-server hold (30s)
# — under the fail-fast watch a pin that exits instantly would read as
# "frontend died"; runs are ended by the harness TERMing the script.
# SHARD_DRYRUN_FRONTEND_DIE_S (death cases) makes it a real dying child:
# sleep N, last words, exit 1.
cat > "$STUBS/pnpm" <<'EOF'
#!/bin/sh
case "$*" in
  *"exec next dev"*)
    printf 'PNPM_EXEC_NEXT_DEV argv=[%s] NEXT_DIST_DIR=[%s] SHARD_PORT=[%s] SHARD_RUN_TAG=[%s] PPID=[%s] FILES_DIR=[%s] TEST_FILES_DIR=[%s]\n' \
      "$*" "${NEXT_DIST_DIR:-unset}" "${SHARD_PORT:-unset}" \
      "${SHARD_RUN_TAG-UNSET}" "$PPID" \
      "${FILES_DIR:-unset}" "${TEST_FILES_DIR:-unset}" \
      >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
    if [ -n "${SHARD_DRYRUN_FRONTEND_DIE_S:-}" ]; then
      sleep "$SHARD_DRYRUN_FRONTEND_DIE_S"
      echo "PNPM-PIN: frontend pin final words (die-branch)"
      exit 1
    fi
    # Hold as a LIVE pin; the TERM trap reaps the inner sleep (see the uv
    # stub) so teardown never orphans a sleep child.
    if [ -n "${SHARD_DRYRUN_HOLD_S:-}" ]; then
      _h="$SHARD_DRYRUN_HOLD_S"
    else
      _h=30
    fi
    sleep "$_h" &
    _s=$!
    trap 'kill "$_s" 2>/dev/null; exit 0' TERM INT
    wait "$_s"
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

# redis-server stub (#483 Case 17): journals the spawn argv, then models
# a LIVE ephemeral child (the enabled stack's local redis). TERM/INT →
# journal line + exit (the trap-kill assertion reads it). Never execs a
# real redis — CI runners have none, and the /dev/tcp port probe of the
# script under test is unaffected by the stub's existence.
cat > "$STUBS/redis-server" <<'EOF'
#!/bin/sh
printf 'REDIS-SERVER argv=[%s]\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
sleep 600 &
_s=$!
trap 'kill "$_s" 2>/dev/null; printf "REDIS-SERVER-TERMED\n" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"; exit 0' TERM INT
wait "$_s"
EOF

# python3 stub (GH #310): the canon generator would run against a DB that
# does not exist in the staged tree (uv is stubbed, nothing seeds it), so
# journal the invocation and succeed — the script-level contract under test
# is "canon generation runs right after seeding", not its SQL output.
cat > "$STUBS/python3" <<'EOF'
#!/bin/sh
printf 'PYTHON3: %s\n' "$*" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
exit 0
EOF

chmod +x "$STUBS/pnpm" "$STUBS/rm" "$STUBS/curl" "$STUBS/lsof" "$STUBS/python3" "$STUBS/redis-server"

# Dispatcher stub (#483 Case 17): the enabled stack spawns the dispatcher
# via the FILE PATH backend/.venv/bin/python (dev.sh precedent: exec so
# $! is the real process) — not PATH-resolved, so the stub must live at
# the staged path. Journals the spawn env (NOTIFY_ENABLED / REDIS_URL /
# ENV_FILE / DATABASE_URL — the contract Case 17a pins), then models a
# LIVE child; TERM → journal line (the trap-kill assertion reads it).
mkdir -p "$STAGE/backend/.venv/bin"
cat > "$STAGE/backend/.venv/bin/python" <<'EOF'
#!/bin/sh
printf 'DISPATCHER-SPAWN argv=[%s] NOTIFY_ENABLED=[%s] REDIS_URL=[%s] ENV_FILE=[%s] DATABASE_URL=[%s]\n' \
  "$*" "${NOTIFY_ENABLED:-unset}" "${REDIS_URL:-unset}" "${ENV_FILE:-unset}" \
  "${DATABASE_URL:-unset}" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"
sleep 600 &
_s=$!
trap 'kill "$_s" 2>/dev/null; printf "DISPATCHER-TERMED\n" >> "${SHARD_DRYRUN_JOURNAL:-/dev/null}"; exit 0' TERM INT
wait "$_s"
EOF
chmod +x "$STAGE/backend/.venv/bin/python"

FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────

# ── Run helpers (#448 Task 3 teardown model) ────────────────────────────────
# Stub pins model LIVE servers (see the stub headers), so a full run is
# ended by the HARNESS TERMing the script — orchestrator teardown
# semantics. RUN_EXTRA_ENV: space-joined K=V pairs (no spaces in values)
# prepended via `env` for case-specific knobs (SHARD_STACK_LOG, *_DIE_S).
# REAP_DEADLINE_S: bounded TERM→exit wait before kill -9 escalation, so
# the suite can never hang on a stuck run (rc then reports 137 and the
# callers' rc assertions fail loudly). Generous on purpose: a legit TERM
# teardown = at most one watch sleep (interval 1s) + trap work (kills,
# pgrep sweep, lease removal), but a loaded CI box (parallel suites)
# stretches that beyond a naive 2× margin — a too-tight deadline once
# kill -9'd a healthy teardown and cascaded its leftover lease into the
# runs-dir emptiness asserts of later cases.
RUN_EXTRA_ENV="${RUN_EXTRA_ENV:-}"
REAP_DEADLINE_S="${REAP_DEADLINE_S:-15}"

# shard_launch <log> <journal> <db> <shard_id> <shard_port> <backend_port>
# Launches the stubbed stack in the background; sets SHARD_LAUNCH_PID.
shard_launch() {
  local log="$1" journal="$2" db="$3" sid="$4" sport="$5" bport="$6"
  # shellcheck disable=SC2086
  SHARD_ID="$sid" SHARD_PORT="$sport" BACKEND_PORT="$bport" \
    TEST_DB_PATH="$db" \
    BACKEND_URL="http://127.0.0.1:$bport" \
    NEXT_PUBLIC_API_URL="http://127.0.0.1:$bport" \
    SHARD_DRYRUN_JOURNAL="$journal" \
    SHARD_RUNS_DIR="$RUNS_DIR" \
    SHARD_STACK_WATCH_S="${SHARD_STACK_WATCH_S:-1}" \
    PATH="$STUBS:$PATH" \
    env $RUN_EXTRA_ENV bash "$SCRIPT_UNDER_TEST" > "$log" 2>&1 &
  SHARD_LAUNCH_PID=$!
}

# term_and_reap PID [JOURNAL] — orchestrator-style teardown of a bespoke
# background run: TERM, bounded reap, kill -9 escalation. Sets LAST_RC.
# With JOURNAL: first bounded-poll for the pnpm call-site line — NEVER TERM
# a just-forked child (the fork race: TERM can land before the child has
# performed its output redirection — the run log then never exists and the
# script dies before the behavior under test); the journal line proves the
# redirection is done and the run has reached the watch phase.
term_and_reap() {
  local pid="$1" journal="${2:-}" rc=0 i
  if [ -n "$journal" ]; then
    for i in $(seq 1 100); do
      if grep -q '^PNPM_EXEC_NEXT_DEV ' "$journal" 2>/dev/null; then break; fi
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
  fi
  kill -TERM "$pid" 2>/dev/null || true
  for i in $(seq 1 $((REAP_DEADLINE_S * 5))); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || rc=$?
  LAST_RC=$rc
}

# run_shard <log> <journal> <db> <shard_id> <shard_port> <backend_port>
# Launch, wait (bounded) for the pnpm call-site journal line — the
# positive control that the run reached the watch phase — then TERM teardown.
# LAST_RC = the run's real exit code: 143 = normal TERM teardown
# (signal-aware trap exits 128+15); 137 = kill -9 escalation (never
# reached pnpm, or ignored TERM — always a failure downstream); anything
# else is the script's own verdict and fails the rc=143 assertions.
run_shard() {
  local log="$1" journal="$2" db="$3" sid="$4" sport="$5" bport="$6"
  local reached=false i rc=0
  shard_launch "$log" "$journal" "$db" "$sid" "$sport" "$bport"
  local pid="$SHARD_LAUNCH_PID"
  for i in $(seq 1 100); do
    if grep -q '^PNPM_EXEC_NEXT_DEV ' "$journal" 2>/dev/null; then
      reached=true
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if [ "$reached" = true ]; then
    kill -TERM "$pid" 2>/dev/null || true
  else
    kill -9 "$pid" 2>/dev/null || true
  fi
  for i in $(seq 1 $((REAP_DEADLINE_S * 5))); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || rc=$?
  LAST_RC=$rc
}

# run_shard_raw <log> <journal> <db> <shard_id> <shard_port> <backend_port>
# Launch like run_shard but NO harness teardown: waits (bounded,
# RAW_WAIT_S) for the script to exit BY ITSELF — the fail-fast verdict
# under test — then escalates kill -9 (LAST_RC=137 fails rc=1 assertions,
# never hangs the suite).
RAW_WAIT_S="${RAW_WAIT_S:-15}"
run_shard_raw() {
  local log="$1" journal="$2" db="$3" sid="$4" sport="$5" bport="$6"
  local i rc=0
  shard_launch "$log" "$journal" "$db" "$sid" "$sport" "$bport"
  local pid="$SHARD_LAUNCH_PID"
  for i in $(seq 1 $((RAW_WAIT_S * 5))); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || rc=$?
  LAST_RC=$rc
}

# enabled_launch <log> <journal> <db> (#483 Case 17) — launch the ENABLED
# notify stack: SHARD_ID=notify + NOTIFY_E2E_ENABLED=1, NO port/URL vars —
# the script must derive the own pair (and the URL vars from it) itself.
# Extra knobs ride RUN_EXTRA_ENV (same `env` mechanism as shard_launch).
# Sets SHARD_LAUNCH_PID.
enabled_launch() {
  local log="$1" journal="$2" db="$3"
  # shellcheck disable=SC2086
  SHARD_ID=notify NOTIFY_E2E_ENABLED=1 \
    TEST_DB_PATH="$db" \
    SHARD_DRYRUN_JOURNAL="$journal" \
    SHARD_RUNS_DIR="$RUNS_DIR" \
    SHARD_STACK_WATCH_S="${SHARD_STACK_WATCH_S:-1}" \
    PATH="$STUBS:$PATH" \
    env $RUN_EXTRA_ENV bash "$SCRIPT_UNDER_TEST" > "$log" 2>&1 &
  SHARD_LAUNCH_PID=$!
}

# enabled_run <log> <journal> <db> — launch + harness TERM teardown (the
# run_shard lifecycle for the enabled mode). LAST_RC = the real exit code.
enabled_run() {
  local log="$1" journal="$2" db="$3"
  local reached=false i rc=0 pid
  enabled_launch "$log" "$journal" "$db"
  pid="$SHARD_LAUNCH_PID"
  for i in $(seq 1 100); do
    if grep -q '^PNPM_EXEC_NEXT_DEV ' "$journal" 2>/dev/null; then
      reached=true
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if [ "$reached" = true ]; then
    kill -TERM "$pid" 2>/dev/null || true
  else
    kill -9 "$pid" 2>/dev/null || true
  fi
  for i in $(seq 1 $((REAP_DEADLINE_S * 5))); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || rc=$?
  LAST_RC=$rc
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
#   valid ids   → full STUBBED run (run_shard): rc=143 (#448 Task 3:
#                 harness TERM teardown — signal-aware trap exits 128+15)
#                 AND the positive control (reached next dev), so rc=143
#                 is not vacuous;
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
  if [ "$LAST_RC" -eq 143 ] && grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE6_DIR/journal-$sid" 2>/dev/null; then
    echo "PASS Case 6 (#415): SHARD_ID=$sid accepted — rc=143 (TERM teardown), reached next dev (ports $sport/$bport)"
  else
    echo "FAIL Case 6 (#415): SHARD_ID=$sid rc=$LAST_RC (want 143) or never reached next dev"
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
# The pnpm stub holds the "foreground" (live-server default hold) so the
# lease can be inspected while the script is still alive; #448 Task 3:
# the run is then ended by term_and_reap (harness TERM → rc 143).
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
  SHARD_RUNS_DIR="$RUNS_DIR" \
  SHARD_STACK_WATCH_S=1 \
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

# Reap the run via harness TERM (orchestrator teardown); the script must
# exit 143 (#448 Task 3 signal-aware trap) and remove its lease.
term_and_reap "$CASE7_PID" "$CASE7_DIR/journal"
CASE7_RC=$LAST_RC
set -e
echo "── Case 7 log ──"
cat "$CASE7_DIR/run.log"
echo "── Case 7 journal ──"
cat "$CASE7_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE7_RC" -eq 143 ]; then
  echo "PASS Case 7 (#317): tagged run torn down by TERM with rc=143"
else
  echo "FAIL Case 7 (#317): tagged run teardown rc=$CASE7_RC (expected 143)"
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
  SHARD_STACK_WATCH_S=1 \
  PATH="$STUBS:$PATH" \
  bash "$SCRIPT_UNDER_TEST" > "$CASE10_DIR/run.log" 2>&1 &
CASE10_PID=$!
term_and_reap "$CASE10_PID" "$CASE10_DIR/journal"
CASE10_RC=$LAST_RC
set -e

echo "── Case 10 log ──"
cat "$CASE10_DIR/run.log"
echo "── Case 10 journal ──"
cat "$CASE10_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE10_RC" -eq 143 ]; then
  echo "PASS Case 10 (#317): set-empty tag run torn down by TERM, rc=143 (legacy path)"
else
  echo "FAIL Case 10 (#317): set-empty tag teardown rc=$CASE10_RC (expected 143)"
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
  SHARD_STACK_WATCH_S=1 \
  PATH="$STUBS:$PATH" \
  bash "$SCRIPT_UNDER_TEST" > "$CASE11_DIR/run.log" 2>&1 &
CASE11_PID=$!
term_and_reap "$CASE11_PID" "$CASE11_DIR/journal"
CASE11_RC=$LAST_RC
set -e

echo "── Case 11 log ──"
cat "$CASE11_DIR/run.log"
echo "── Case 11 journal ──"
cat "$CASE11_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE11_RC" -eq 143 ]; then
  echo "PASS Case 11 (#317): tagged shard-2 run torn down by TERM, rc=143"
else
  echo "FAIL Case 11 (#317): tagged shard-2 teardown rc=$CASE11_RC (expected 143)"
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
  SHARD_RUNS_DIR="$RUNS_DIR" \
  SHARD_STACK_WATCH_S=1 \
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
term_and_reap "$CASE12A_PID" "$CASE12_DIR/journal"
CASE12A_RC=$LAST_RC
set -e
echo "── Case 12a log ──"
cat "$CASE12_DIR/run-a.log"
echo "── Case 12a journal ──"
cat "$CASE12_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE12A_RC" -eq 143 ] && [ -z "$(ls -A "$RUNS_DIR" 2>/dev/null || true)" ]; then
  echo "PASS Case 12 (Fix A): managed run torn down by TERM (rc=143); runs dir still empty after exit (nothing removed — there was nothing)"
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
  SHARD_RUNS_DIR="$RUNS_DIR" \
  SHARD_STACK_WATCH_S=1 \
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
term_and_reap "$CASE12B_PID" "$CASE12_DIR/journal-b"
CASE12B_RC=$LAST_RC
set -e
echo "── Case 12b log ──"
cat "$CASE12_DIR/run-b.log"
echo "── Case 12b journal ──"
cat "$CASE12_DIR/journal-b" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE12B_RC" -eq 143 ]; then
  echo "PASS Case 12 (Fix A): managed run over a pre-existing lease torn down by TERM (rc=143)"
else
  echo "FAIL Case 12 (Fix A): managed run over a pre-existing lease teardown rc=$CASE12B_RC (expected 143)"
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

# ── Case 14 (#448 Task 3): backend pin death → rc=1 + addressed verdict ────
# REAL background children: the uv stub's uvicorn branch sleeps DIE_S then
# exits 1 (a dying backend pin) while the pnpm pin holds (live frontend).
# The holding pin is IMMORTAL-IN-BOUNDS (HOLD_S=600): with a short hold the
# discriminating window is only hold−die seconds — under load the watch
# loop's deciding look can slip past the holder's natural death, both pins
# are then dead and the documented backend-first tie-break misattributes
# the verdict (review iteration 1). 600 s cannot leak: the verdict's own
# EXIT trap TERMs both pins, and RAW_WAIT_S bounds the case regardless.
# The watch loop must notice within one interval (SHARD_STACK_WATCH_S=1),
# print `stack shard 1: backend died on :8011`, ALWAYS print the stack-log
# path, then the capped tail. Sub-cases:
#   14a — SHARD_STACK_LOG → fixture (25 benign + 5 secret lines): the tail
#         is capped at 20 (fixture lines 11..30 → benign 11..25 = 15 lines
#         echoed; line 10 absent, line 11 = boundary present) and the
#         secret-bearing lines are suppressed case-insensitively;
#   14b — SHARD_STACK_LOG → missing file: «log not created» line (path is
#         still printed);
#   14c — no SHARD_STACK_LOG: the path defaults to the run's OWN log
#         (readlink of fd 1 — exactly what the orchestrator's redirect
#         produces in CI).
# The verdict section is scoped (sed from the verdict line to EOF) so the
# echoed tail is inspected separately from the run's own chatter.
CASE14_DIR="$WORK/case14"; mkdir -p "$CASE14_DIR"
case14_fixture() {
  local f="$1" i
  : > "$f"
  for i in $(seq 1 25); do printf 'FX line %02d\n' "$i" >> "$f"; done
  for i in 1 2 3 4 5; do printf 'Authorization: Bearer SECRETMARKER-%d (token)\n' "$i" >> "$f"; done
}

# 14a — capped + filtered fixture tail, path always printed.
CASE14_FIX="$CASE14_DIR/stack-a.log"
case14_fixture "$CASE14_FIX"
CASE14A_DB="$CASE14_DIR/test_memo_shard1.db"; printf 'seed' > "$CASE14A_DB"
RUN_EXTRA_ENV="SHARD_DRYRUN_BACKEND_DIE_S=2 SHARD_DRYRUN_HOLD_S=600 SHARD_STACK_LOG=$CASE14_FIX"
RAW_WAIT_S=12
run_shard_raw "$CASE14_DIR/run-a.log" "$CASE14_DIR/journal-a" "$CASE14A_DB" 1 3011 8011
RUN_EXTRA_ENV=""
RAW_WAIT_S=15
echo "── Case 14a log ──"
cat "$CASE14_DIR/run-a.log"
echo "─────────────────"
sed -n '/stack shard 1: backend died on :8011/,$p' "$CASE14_DIR/run-a.log" > "$CASE14_DIR/section-a" || true

if [ "$LAST_RC" -eq 1 ] && grep -q 'stack shard 1: backend died on :8011' "$CASE14_DIR/section-a"; then
  echo "PASS Case 14a (#448): backend pin death → rc=1 + addressed verdict"
else
  echo "FAIL Case 14a (#448): expected rc=1 + 'stack shard 1: backend died on :8011' (got rc=$LAST_RC)"
  FAIL=1
fi
if grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE14_DIR/journal-a" 2>/dev/null; then
  echo "PASS Case 14a (#448): positive control — the run reached the watch phase"
else
  echo "FAIL Case 14a (#448): run never reached next dev (rc=1 could be vacuous)"
  FAIL=1
fi
if grep -Fq "stack log: $CASE14_FIX" "$CASE14_DIR/section-a"; then
  echo "PASS Case 14a (#448): stack-log path ALWAYS printed"
else
  echo "FAIL Case 14a (#448): expected 'stack log: $CASE14_FIX' in the verdict section"
  FAIL=1
fi
CASE14_TAILN="$(grep -c '^FX line ' "$CASE14_DIR/section-a" || true)"
if [ "$CASE14_TAILN" -eq 15 ] && grep -q '^FX line 11$' "$CASE14_DIR/section-a" \
   && ! grep -q '^FX line 10$' "$CASE14_DIR/section-a" && grep -q '^FX line 25$' "$CASE14_DIR/section-a"; then
  echo "PASS Case 14a (#448): tail capped at 20 (15 benign echoed, boundary line 11 in / line 10 out)"
else
  echo "FAIL Case 14a (#448): cap wrong — echoed FX lines: $CASE14_TAILN (want 15; line 11 in, line 10 out)"
  FAIL=1
fi
if ! grep -q 'SECRETMARKER' "$CASE14_DIR/section-a"; then
  echo "PASS Case 14a (#448): secret-bearing lines suppressed (case-insensitive filter)"
else
  echo "FAIL Case 14a (#448): SECRETMARKER leaked into the verdict tail"
  FAIL=1
fi

# 14b — missing log file → «log not created» (path still printed).
CASE14B_DB="$CASE14_DIR/test_memo_shard1_b.db"; printf 'seed' > "$CASE14B_DB"
RUN_EXTRA_ENV="SHARD_DRYRUN_BACKEND_DIE_S=2 SHARD_DRYRUN_HOLD_S=600 SHARD_STACK_LOG=$CASE14_DIR/nope-b.log"
RAW_WAIT_S=12
run_shard_raw "$CASE14_DIR/run-b.log" "$CASE14_DIR/journal-b" "$CASE14B_DB" 1 3011 8011
RUN_EXTRA_ENV=""
RAW_WAIT_S=15
echo "── Case 14b log ──"
cat "$CASE14_DIR/run-b.log"
echo "─────────────────"
sed -n '/stack shard 1: backend died on :8011/,$p' "$CASE14_DIR/run-b.log" > "$CASE14_DIR/section-b" || true
if [ "$LAST_RC" -eq 1 ] && grep -Fq "stack log: $CASE14_DIR/nope-b.log" "$CASE14_DIR/section-b" \
   && grep -q 'log not created' "$CASE14_DIR/section-b"; then
  echo "PASS Case 14b (#448): missing log → path printed + «log not created»"
else
  echo "FAIL Case 14b (#448): expected rc=1 + path line + 'log not created' (got rc=$LAST_RC)"
  FAIL=1
fi

# 14c — no SHARD_STACK_LOG: the path defaults to the run's own log file
# (fd-1 readlink; the same shape the orchestrator's redirect produces).
CASE14C_DB="$CASE14_DIR/test_memo_shard1_c.db"; printf 'seed' > "$CASE14C_DB"
RUN_EXTRA_ENV="SHARD_DRYRUN_BACKEND_DIE_S=2 SHARD_DRYRUN_HOLD_S=600"
RAW_WAIT_S=12
run_shard_raw "$CASE14_DIR/run-c.log" "$CASE14_DIR/journal-c" "$CASE14C_DB" 1 3011 8011
RUN_EXTRA_ENV=""
RAW_WAIT_S=15
echo "── Case 14c log ──"
cat "$CASE14_DIR/run-c.log"
echo "─────────────────"
sed -n '/stack shard 1: backend died on :8011/,$p' "$CASE14_DIR/run-c.log" > "$CASE14_DIR/section-c" || true
if [ "$LAST_RC" -eq 1 ] && grep -Fq "stack log: $CASE14_DIR/run-c.log" "$CASE14_DIR/section-c"; then
  echo "PASS Case 14c (#448): default stack-log path = the run's own log (fd-1 readlink)"
else
  echo "FAIL Case 14c (#448): expected rc=1 + 'stack log: $CASE14_DIR/run-c.log' (got rc=$LAST_RC)"
  FAIL=1
fi

# ── Case 15 (#448 Task 3): frontend pin death → rc=1 + addressed verdict ───
# Mirror of Case 14 with the dying pin on the frontend side (pnpm die
# branch); the backend pin holds IMMORTAL-IN-BOUNDS (600 s — same
# tie-break-race hardening as Case 14; the verdict's EXIT trap TERMs it).
# Shard 2 + distinct ports so the grep is addressed, not accidental.
CASE15_DIR="$WORK/case15"; mkdir -p "$CASE15_DIR"
CASE15_DB="$CASE15_DIR/test_memo_shard2.db"; printf 'seed' > "$CASE15_DB"
RUN_EXTRA_ENV="SHARD_DRYRUN_FRONTEND_DIE_S=2 SHARD_DRYRUN_BACKEND_HOLD_S=600"
RAW_WAIT_S=12
run_shard_raw "$CASE15_DIR/run.log" "$CASE15_DIR/journal" "$CASE15_DB" 2 3012 8012
RUN_EXTRA_ENV=""
RAW_WAIT_S=15
echo "── Case 15 log ──"
cat "$CASE15_DIR/run.log"
echo "─────────────────"
if [ "$LAST_RC" -eq 1 ] && grep -q 'stack shard 2: frontend died on :3012' "$CASE15_DIR/run.log" \
   && grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE15_DIR/journal" 2>/dev/null; then
  echo "PASS Case 15 (#448): frontend pin death → rc=1 + addressed verdict (run reached watch phase)"
else
  echo "FAIL Case 15 (#448): expected rc=1 + 'stack shard 2: frontend died on :3012' + positive control (got rc=$LAST_RC)"
  FAIL=1
fi

# ── Case 16 (#448 Task 3): trap grandchild sweep — masked holder dies, ──────
# unmasked survives. REAL holders: python3 listeners, one with a REWRITTEN
# argv (exec -a) that carries the next-server title mask and holds the
# stack's FRONTEND port, one plain python3 holding the stack's BACKEND
# port. On TERM teardown the script's exit trap must _sweep_masked the
# masked one (mask ∧ LISTEN-on-our-port conjunction; the /proc resolver
# sees the re-titled holder — the #448 bug class) and spare the unmasked
# one (no uvicorn mask → no nomination). Ports are picked with bounded
# retries via the REAL resolver (_listener_on, sourced at Case 9) and
# holder readiness is polled — no coupon-collector flakiness.
CASE16_DIR="$WORK/case16"; mkdir -p "$CASE16_DIR"
PY3="$(command -v python3)"
CASE16_HOLDER="$CASE16_DIR/holder.py"
cat > "$CASE16_HOLDER" <<'EOF'
import socket, sys, time
port = int(sys.argv[1])
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port))
s.listen(1)
print("HOLDER-READY %d" % port, flush=True)
time.sleep(600)
EOF

case16_holder_up() {  # <pid> <log> <port> → rc 0 iff listening & alive
  local pid="$1" log="$2" port="$3" i
  for i in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    if grep -q "HOLDER-READY $port" "$log" 2>/dev/null && _listener_on "$port"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

CASE16_P1=""; CASE16_P2=""; CASE16_MASKED_PID=""; CASE16_PLAIN_PID=""
for _try in $(seq 1 25); do
  _c1=$((29170 + (_try * 37) + (RANDOM % 211)))
  _c2=$((_c1 + 1))
  if _listener_on "$_c1" "$_c2"; then continue; fi   # busy → next candidate
  # masked holder: rewritten argv — what a re-titled next-server grandchild
  # looks like to pgrep -f / ps args / the /proc resolver.
  ( exec -a "next-server (v99.9) #448-dryrun-holder" "$PY3" "$CASE16_HOLDER" "$_c1" ) \
    > "$CASE16_DIR/masked.log" 2>&1 &
  CASE16_MASKED_PID=$!
  # plain holder: no mask anywhere in its argv → must survive the sweep.
  "$PY3" "$CASE16_HOLDER" "$_c2" > "$CASE16_DIR/plain.log" 2>&1 &
  CASE16_PLAIN_PID=$!
  if case16_holder_up "$CASE16_MASKED_PID" "$CASE16_DIR/masked.log" "$_c1" \
     && case16_holder_up "$CASE16_PLAIN_PID" "$CASE16_DIR/plain.log" "$_c2"; then
    CASE16_P1="$_c1"; CASE16_P2="$_c2"
    break
  fi
  # bind race (candidate taken between probe and bind) → retry next pair
  kill -9 "$CASE16_MASKED_PID" "$CASE16_PLAIN_PID" 2>/dev/null || true
  wait "$CASE16_MASKED_PID" 2>/dev/null || true
  wait "$CASE16_PLAIN_PID" 2>/dev/null || true
  CASE16_MASKED_PID=""; CASE16_PLAIN_PID=""
done

if [ -n "$CASE16_P1" ]; then
  echo "  → Case 16 holders up: masked=:$CASE16_P1 (pid $CASE16_MASKED_PID), plain=:$CASE16_P2 (pid $CASE16_PLAIN_PID)"
  CASE16_DB="$CASE16_DIR/test_memo_shard1.db"; printf 'seed' > "$CASE16_DB"
  run_shard "$CASE16_DIR/run.log" "$CASE16_DIR/journal" "$CASE16_DB" 1 "$CASE16_P1" "$CASE16_P2"
  echo "── Case 16 log ──"
  cat "$CASE16_DIR/run.log"
  echo "─────────────────"

  # Masked holder must be gone shortly after teardown (bounded poll).
  CASE16_MASKED_GONE=false
  for _i in $(seq 1 25); do
    if ! kill -0 "$CASE16_MASKED_PID" 2>/dev/null; then CASE16_MASKED_GONE=true; break; fi
    sleep 0.2
  done
  if [ "$LAST_RC" -eq 143 ]; then
    echo "PASS Case 16 (#448): stack torn down by TERM (rc=143)"
  else
    echo "FAIL Case 16 (#448): teardown rc=$LAST_RC (expected 143)"
    FAIL=1
  fi
  if [ "$CASE16_MASKED_GONE" = true ]; then
    echo "PASS Case 16 (#448): masked holder of :$CASE16_P1 swept by the exit trap"
  else
    echo "FAIL Case 16 (#448): masked holder (pid $CASE16_MASKED_PID) survived the trap sweep"
    FAIL=1
  fi
  if kill -0 "$CASE16_PLAIN_PID" 2>/dev/null; then
    echo "PASS Case 16 (#448): unmasked holder of :$CASE16_P2 spared (mask ∧ port conjunction)"
  else
    echo "FAIL Case 16 (#448): unmasked holder (pid $CASE16_PLAIN_PID) was killed by the sweep"
    FAIL=1
  fi
  # Harness cleanup — the survivors are OUR processes, always reaped.
  kill -9 "$CASE16_MASKED_PID" "$CASE16_PLAIN_PID" 2>/dev/null || true
  wait "$CASE16_MASKED_PID" 2>/dev/null || true
  wait "$CASE16_PLAIN_PID" 2>/dev/null || true
else
  echo "FAIL Case 16 (#448): could not obtain a free port pair for holders (25 tries)"
  FAIL=1
fi

# ── Case 17 (#483 Task 8, spec §3.5): enabled notify e2e stack ─────────────

# 17a — defaults + EXPLICIT REDIS_URL: own port pair derived (3006/8005),
# own tag derived from the backend port (8005 → 001f45), URL vars derived
# to the own pair, lease written+removed, dispatcher spawned with the
# explicit REDIS_URL (NO local redis child), DB wiped (test_memo guard
# passes), dispatcher killed by the extended trap.
CASE17_DIR="$WORK/case17"; mkdir -p "$CASE17_DIR"
CASE17A_DB="$CASE17_DIR/test_memo_notify_e2e.db"
printf 'seed' > "$CASE17A_DB"
CASE17A_TAG=001f45
CASE17A_LEASE="$RUNS_DIR/${CASE17A_TAG}.run"
# Explicit REDIS_URL (CI service-container shape) — the enabled stack must
# NOT spawn a local redis-server child.
RUN_EXTRA_ENV="REDIS_URL=redis://127.0.0.1:6399/0"
enabled_launch "$CASE17_DIR/run.log" "$CASE17_DIR/journal" "$CASE17A_DB"
CASE17A_PID="$SHARD_LAUNCH_PID"
CASE17A_LEASE_SEEN=false
for _i in $(seq 1 20); do
  if [ -f "$CASE17A_LEASE" ]; then CASE17A_LEASE_SEEN=true; break; fi
  sleep 0.2
done
RUN_EXTRA_ENV=""
if [ "$CASE17A_LEASE_SEEN" = true ]; then
  echo "PASS Case 17a (#483): enabled stack wrote its own run lease while alive"
else
  echo "FAIL Case 17a (#483): no lease at $CASE17A_LEASE while the enabled stack was alive"
  FAIL=1
fi
if [ "$CASE17A_LEASE_SEEN" = true ]; then
  LPID=""; LTAG=""; LP1=""; LP2=""; LP3=""; LP4=""; LSTAMP=""; LEXTRA=""
  if read -r LPID LTAG LP1 LP2 LP3 LP4 LSTAMP LEXTRA < "$CASE17A_LEASE" \
     && [ "$LTAG" = "$CASE17A_TAG" ] && [ "$LP1" = "3006" ] && [ "$LP2" = "8005" ] \
     && [ "$LP3" = "0" ] && [ "$LP4" = "0" ] && [ -z "$LEXTRA" ] \
     && [ "$LPID" = "$CASE17A_PID" ] && is_uint "$LSTAMP"; then
    echo "PASS Case 17a (#483): lease is 'pid $CASE17A_TAG 3006 8005 0 0 epoch' (own ports, own tag)"
  else
    echo "FAIL Case 17a (#483): bad lease content: '$LPID $LTAG $LP1 $LP2 $LP3 $LP4 $LSTAMP $LEXTRA'"
    FAIL=1
  fi
fi
term_and_reap "$CASE17A_PID" "$CASE17_DIR/journal"
CASE17A_RC=$LAST_RC

echo "── Case 17a log ──"
cat "$CASE17_DIR/run.log"
echo "── Case 17a journal ──"
cat "$CASE17_DIR/journal" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$CASE17A_RC" -eq 143 ]; then
  echo "PASS Case 17a (#483): enabled stack torn down by TERM, rc=143"
else
  echo "FAIL Case 17a (#483): enabled stack teardown rc=$CASE17A_RC (expected 143)"
  FAIL=1
fi
assert_reached_next_dev "$CASE17_DIR/journal" "Case 17a (positive control)" || FAIL=1
if grep -Fq "NEXT_DIST_DIR=[.next-shard-notify_${CASE17A_TAG}] SHARD_PORT=[3006]" "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): derived web port 3006 + tagged build dir .next-shard-notify_${CASE17A_TAG}"
else
  echo "FAIL Case 17a (#483): expected NEXT_DIST_DIR=[.next-shard-notify_${CASE17A_TAG}] SHARD_PORT=[3006] in journal"
  FAIL=1
fi
assert_storage_exports "$CASE17_DIR/journal" notify "_${CASE17A_TAG}" "Case 17a (#483)" || FAIL=1
assert_tag_export "$CASE17_DIR/journal" "$CASE17A_TAG" "Case 17a (#483)" || FAIL=1
if grep -Fq "BACKEND_URL=[http://127.0.0.1:8005] NEXT_PUBLIC_API_URL=[http://127.0.0.1:8005]" "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): URL vars derived to the own backend pair (:8005)"
else
  echo "FAIL Case 17a (#483): expected UVICORN line with BACKEND_URL/NEXT_PUBLIC_API_URL http://127.0.0.1:8005"
  FAIL=1
fi
if grep -Fq "DATABASE_URL=[sqlite+aiosqlite:///$CASE17A_DB]" "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): backend DATABASE_URL points at the enabled stack's test DB"
else
  echo "FAIL Case 17a (#483): expected DATABASE_URL=[sqlite+aiosqlite:///$CASE17A_DB] in journal"
  FAIL=1
fi
if grep -q "FILE_ABSENT" "$CASE17_DIR/run.log" 2>/dev/null; then
  echo "PASS Case 17a (#483): DB wipe happened (TEST_DB_PATH contains test_memo — path guard passed)"
else
  echo "FAIL Case 17a (#483): expected FILE_ABSENT — DB wipe missing or the test_memo guard rejected the path"
  FAIL=1
fi
if grep -Fq "RM: -rf $STAGE/backend/test_files_shardnotify_${CASE17A_TAG}" "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): files wipe targeted the notify-scoped storage dir"
else
  echo "FAIL Case 17a (#483): expected 'RM: -rf .../test_files_shardnotify_${CASE17A_TAG}' in journal"
  FAIL=1
fi
if grep -q '^REDIS-SERVER ' "$CASE17_DIR/journal" 2>/dev/null; then
  echo "FAIL Case 17a (#483): explicit REDIS_URL must suppress the local redis-server child"
  FAIL=1
else
  echo "PASS Case 17a (#483): explicit REDIS_URL — no redis-server child spawned"
fi
if grep -Fq "DISPATCHER-SPAWN argv=[-m src.notify.dispatcher] NOTIFY_ENABLED=[true] REDIS_URL=[redis://127.0.0.1:6399/0] ENV_FILE=[.env.test]" "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): dispatcher spawned with NOTIFY_ENABLED=true + the explicit REDIS_URL + .env.test"
else
  echo "FAIL Case 17a (#483): expected DISPATCHER-SPAWN line (NOTIFY_ENABLED=[true], explicit REDIS_URL, ENV_FILE=[.env.test])"
  FAIL=1
fi
if grep -q '^DISPATCHER-TERMED$' "$CASE17_DIR/journal" 2>/dev/null; then
  echo "PASS Case 17a (#483): extended trap killed the dispatcher child"
else
  echo "FAIL Case 17a (#483): dispatcher child survived the trap (no DISPATCHER-TERMED line)"
  FAIL=1
fi
if [ ! -e "$CASE17A_LEASE" ]; then
  echo "PASS Case 17a (#483): lease removed on script exit"
else
  echo "FAIL Case 17a (#483): lease $CASE17A_LEASE still exists after exit"
  FAIL=1
fi
assert_no_default_next_rm "$CASE17_DIR/journal" "Case 17a (S5)" || FAIL=1
assert_fixture_intact "Case 17a (S5)" || FAIL=1

# 17b — local-redis mode + CUSTOM port pair: no REDIS_URL → the script
# spawns its own ephemeral redis-server child on NOTIFY_E2E_REDIS_PORT and
# points REDIS_URL at it; the tag derives from the CUSTOM backend port
# (8105 → 001fa9); BOTH new children are killed by the trap.
CASE17B_DB="$CASE17_DIR/test_memo_notify_e2e_b.db"
printf 'seed' > "$CASE17B_DB"
CASE17B_TAG=001fa9
CASE17B_LEASE="$RUNS_DIR/${CASE17B_TAG}.run"
RUN_EXTRA_ENV="NOTIFY_E2E_BACKEND_PORT=8105 NOTIFY_E2E_SHARD_PORT=3106 NOTIFY_E2E_REDIS_PORT=6390"
enabled_run "$CASE17_DIR/run-b.log" "$CASE17_DIR/journal-b" "$CASE17B_DB"
RUN_EXTRA_ENV=""

echo "── Case 17b log ──"
cat "$CASE17_DIR/run-b.log"
echo "── Case 17b journal ──"
cat "$CASE17_DIR/journal-b" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$LAST_RC" -eq 143 ] && grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): custom-pair enabled stack torn down by TERM (rc=143, reached next dev)"
else
  echo "FAIL Case 17b (#483): rc=$LAST_RC or never reached next dev"
  FAIL=1
fi
if grep -Fq "REDIS-SERVER argv=[--bind 127.0.0.1 --port 6390 --save" "$CASE17_DIR/journal-b" 2>/dev/null \
   && grep -Fq -- "--appendonly no]" "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): local ephemeral redis-server spawned on NOTIFY_E2E_REDIS_PORT (--save/--appendonly no)"
else
  echo "FAIL Case 17b (#483): expected REDIS-SERVER spawn line (--port 6390, --save, --appendonly no)"
  FAIL=1
fi
if grep -Fq "DISPATCHER-SPAWN argv=[-m src.notify.dispatcher] NOTIFY_ENABLED=[true] REDIS_URL=[redis://localhost:6390/0]" "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): dispatcher REDIS_URL points at the spawned local redis"
else
  echo "FAIL Case 17b (#483): expected dispatcher REDIS_URL=[redis://localhost:6390/0]"
  FAIL=1
fi
if grep -Fq "NEXT_DIST_DIR=[.next-shard-notify_${CASE17B_TAG}] SHARD_PORT=[3106]" "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): custom web port 3106 honored; tag derives from the CUSTOM backend port (${CASE17B_TAG})"
else
  echo "FAIL Case 17b (#483): expected NEXT_DIST_DIR=[.next-shard-notify_${CASE17B_TAG}] SHARD_PORT=[3106]"
  FAIL=1
fi
if grep -Fq "BACKEND_URL=[http://127.0.0.1:8105] NEXT_PUBLIC_API_URL=[http://127.0.0.1:8105]" "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): URL vars follow the CUSTOM backend port (:8105)"
else
  echo "FAIL Case 17b (#483): expected UVICORN line with the custom :8105 URL pair"
  FAIL=1
fi
if grep -q '^DISPATCHER-TERMED$' "$CASE17_DIR/journal-b" 2>/dev/null \
   && grep -q '^REDIS-SERVER-TERMED$' "$CASE17_DIR/journal-b" 2>/dev/null; then
  echo "PASS Case 17b (#483): extended trap killed BOTH children (dispatcher + redis)"
else
  echo "FAIL Case 17b (#483): expected DISPATCHER-TERMED and REDIS-SERVER-TERMED lines (trap cleanup)"
  FAIL=1
fi
if [ ! -e "$CASE17B_LEASE" ]; then
  echo "PASS Case 17b (#483): custom-pair lease removed on exit"
else
  echo "FAIL Case 17b (#483): lease $CASE17B_LEASE still exists after exit"
  FAIL=1
fi

# 17c — guard negatives (direct calls; the guards fire before machinery).
# Each spec line: label ␠ midds (space-joined K=V for `env`) ␠ want-stderr.
# '+' in the want stands for a space (the messages carry spaces; literal
# underscores must survive) — "requires+SHARD_ID=notify".
# The enabled DB path is pre-provided so a REJECTED run can only be the
# guard's verdict — the machinery (wipe/uv/pnpm) is unreachable past it.
for spec in \
  "enabled-shard-id NOTIFY_E2E_ENABLED=1 SHARD_ID=1 requires+SHARD_ID=notify" \
  "notify-no-flag SHARD_ID=notify requires+NOTIFY_E2E_ENABLED=1" \
  "bad-flag NOTIFY_E2E_ENABLED=yes SHARD_ID=notify NOTIFY_E2E_ENABLED+must+be" \
  "web-port-collision NOTIFY_E2E_ENABLED=1 SHARD_ID=notify NOTIFY_E2E_SHARD_PORT=3003 collides" \
  "backend-port-collision NOTIFY_E2E_ENABLED=1 SHARD_ID=notify NOTIFY_E2E_BACKEND_PORT=8002 collides" \
  "redis-port-non-numeric NOTIFY_E2E_ENABLED=1 SHARD_ID=notify NOTIFY_E2E_REDIS_PORT=6380x NOTIFY_E2E_REDIS_PORT+must+be+a+number"
do
  _label="${spec%% *}"; _rest="${spec#* }"
  _want="${_rest##* }"
  _mids="${_rest% *}"
  _want_pat="${_want//+/ }"   # '+' → spaces (underscores stay literal)
  set +e
  # shellcheck disable=SC2086
  env $_mids TEST_DB_PATH="$CASE17_DIR/test_memo_notify_e2e.db" \
    bash "$SCRIPT_UNDER_TEST" > "$CASE17_DIR/guard-$_label.out" 2>&1
  _grc=$?
  set -e
  if [ "$_grc" -eq 1 ] && grep -q "$_want_pat" "$CASE17_DIR/guard-$_label.out"; then
    echo "PASS Case 17c (#483): $_label rejected (exit 1 + diagnostic)"
  else
    echo "FAIL Case 17c (#483): $_label — expected exit 1 + '$_want_pat' (got rc=$_grc)"
    cat "$CASE17_DIR/guard-$_label.out"
    FAIL=1
  fi
done

# 17c-2 — redis-server MISSING from PATH (a CI runner without redis): the
# binary guard must fire LOUDLY (a background spawn of a missing binary
# would fail silently under set -e → degraded stack). PATH is emptied for
# the CHILD, so the child bash must be invoked by absolute path — env(1)
# resolves the command via the NEW environment. Everything before the
# guard is builtin-only (flag guards, port defaults, tag derivation).
CASE17_EMPTY_PATH="$CASE17_DIR/empty-path"; mkdir -p "$CASE17_EMPTY_PATH"
set +e
env PATH="$CASE17_EMPTY_PATH" NOTIFY_E2E_ENABLED=1 SHARD_ID=notify \
  TEST_DB_PATH="$CASE17_DIR/test_memo_notify_e2e.db" \
  /bin/bash "$SCRIPT_UNDER_TEST" > "$CASE17_DIR/guard-redis-missing.out" 2>&1
_grc=$?
set -e
if [ "$_grc" -eq 1 ] && grep -q "redis-server not found" "$CASE17_DIR/guard-redis-missing.out"; then
  echo "PASS Case 17c-2 (#483): missing redis-server binary rejected (exit 1 + diagnostic)"
else
  echo "FAIL Case 17c-2 (#483): expected exit 1 + 'redis-server not found' (got rc=$_grc)"
  cat "$CASE17_DIR/guard-redis-missing.out"
  FAIL=1
fi

# 17e — BUSY redis port: a REAL listener holds NOTIFY_E2E_REDIS_PORT; the
# guard must abort BEFORE the lease write and the wipes — exit 1 +
# diagnostic, NO lease in the runs dir (the derived tag 001f45.run from
# the default backend port 8005), the provided DB file byte-intact.
# Holder pattern of Case 16: bind-probed port, bounded retries, readiness
# polled; the holder is harness-owned and always reaped.
CASE17_HOLDER="$CASE17_DIR/holder.py"
cat > "$CASE17_HOLDER" <<'EOF'
import socket, sys, time
port = int(sys.argv[1])
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port))
s.listen(1)
print("HOLDER-READY %d" % port, flush=True)
time.sleep(600)
EOF
PY3="$(command -v python3)"
CASE17E_PORT=""; CASE17E_HOLDER_PID=""
for _try in $(seq 1 25); do
  _p=$((29370 + (_try * 41) + (RANDOM % 199)))
  if _listener_on "$_p"; then continue; fi   # busy → next candidate
  "$PY3" "$CASE17_HOLDER" "$_p" > "$CASE17_DIR/holder-e.log" 2>&1 &
  CASE17E_HOLDER_PID=$!
  for _i in $(seq 1 50); do
    if ! kill -0 "$CASE17E_HOLDER_PID" 2>/dev/null; then break; fi
    if grep -q "HOLDER-READY $_p" "$CASE17_DIR/holder-e.log" 2>/dev/null && _listener_on "$_p"; then
      CASE17E_PORT="$_p"; break
    fi
    sleep 0.2
  done
  [ -n "$CASE17E_PORT" ] && break
  # bind race (candidate taken between probe and bind) → retry next port
  kill -9 "$CASE17E_HOLDER_PID" 2>/dev/null || true
  wait "$CASE17E_HOLDER_PID" 2>/dev/null || true
  CASE17E_HOLDER_PID=""
done

if [ -n "$CASE17E_PORT" ]; then
  echo "  → Case 17e holder up on :$CASE17E_PORT (pid $CASE17E_HOLDER_PID)"
  CASE17E_DB="$CASE17_DIR/test_memo_notify_e2e_busy.db"
  printf 'seed' > "$CASE17E_DB"
  set +e
  NOTIFY_E2E_ENABLED=1 SHARD_ID=notify NOTIFY_E2E_REDIS_PORT="$CASE17E_PORT" \
    TEST_DB_PATH="$CASE17E_DB" \
    PATH="$STUBS:$PATH" \
    bash "$SCRIPT_UNDER_TEST" > "$CASE17_DIR/guard-redis-busy.out" 2>&1
  _grc=$?
  set -e
  if [ "$_grc" -eq 1 ] && grep -q "already in use" "$CASE17_DIR/guard-redis-busy.out"; then
    echo "PASS Case 17e (#483): busy redis port rejected (exit 1 + diagnostic)"
  else
    echo "FAIL Case 17e (#483): expected exit 1 + 'already in use' (got rc=$_grc)"
    cat "$CASE17_DIR/guard-redis-busy.out"
    FAIL=1
  fi
  if [ ! -e "$RUNS_DIR/001f45.run" ]; then
    echo "PASS Case 17e (#483): no lease left behind (guard fires BEFORE the lease write)"
  else
    echo "FAIL Case 17e (#483): lease $RUNS_DIR/001f45.run leaked by the busy-port exit"
    FAIL=1
  fi
  if [ "$(cat "$CASE17E_DB" 2>/dev/null || true)" = "seed" ]; then
    echo "PASS Case 17e (#483): storage untouched — DB file byte-intact (guard fires BEFORE the wipes)"
  else
    echo "FAIL Case 17e (#483): DB file was modified/wiped before the busy-port guard"
    FAIL=1
  fi
  kill -9 "$CASE17E_HOLDER_PID" 2>/dev/null || true
  wait "$CASE17E_HOLDER_PID" 2>/dev/null || true
else
  echo "FAIL Case 17e (#483): could not obtain a free port for the holder (25 tries)"
  FAIL=1
fi

# 17d (S2) — default-mode control: REDIS_URL in the env is IGNORED, no
# notify children, legacy names/lease-less run byte-identical.
CASE17D_DB="$CASE17_DIR/test_memo_shard1.db"
printf 'seed' > "$CASE17D_DB"
RUN_EXTRA_ENV="REDIS_URL=redis://127.0.0.1:6399/0"
run_shard "$CASE17_DIR/run-d.log" "$CASE17_DIR/journal-d" "$CASE17D_DB" 1 3002 8001
RUN_EXTRA_ENV=""

echo "── Case 17d log ──"
cat "$CASE17_DIR/run-d.log"
echo "── Case 17d journal ──"
cat "$CASE17_DIR/journal-d" 2>/dev/null || echo "(empty)"
echo "─────────────────"

if [ "$LAST_RC" -eq 143 ] && grep -q '^PNPM_EXEC_NEXT_DEV ' "$CASE17_DIR/journal-d" 2>/dev/null \
   && ! grep -q '^REDIS-SERVER ' "$CASE17_DIR/journal-d" 2>/dev/null \
   && ! grep -q '^DISPATCHER-SPAWN ' "$CASE17_DIR/journal-d" 2>/dev/null \
   && grep -Fq "BACKEND_URL=[http://127.0.0.1:8001] NEXT_PUBLIC_API_URL=[http://127.0.0.1:8001]" "$CASE17_DIR/journal-d" 2>/dev/null; then
  echo "PASS Case 17d (S2): default mode ignores REDIS_URL — no notify children, caller URLs untouched"
else
  echo "FAIL Case 17d (S2): default mode changed (rc=$LAST_RC, notify children, or URL derivation leaked)"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
