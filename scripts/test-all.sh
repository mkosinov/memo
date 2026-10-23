#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.
#
# Parallelization strategy:
# - Backend pytest runs in parallel with frontend stages.
# - Lint, type-check, vitest all run in parallel.
# - 2 native Playwright shards (--shard=1/2 and --shard=2/2 of the single
#   e2e project, GH #415) run in PARALLEL, each with its own isolated stack:
#   * Its own SQLite DB (test_memo_shard{N}_${SHARD_RUN_TAG}.db)
#   * Its own FastAPI backend (dynamic port from the 28000-32700 window)
#   * Its own Next.js frontend (dynamic port from the same window)
#   No cross-shard interference.
#   2 shards instead of 5 to avoid CPU contention on 4-core machines
#   (5 parallel Next.js dev servers caused 30s+ page loads).
# - Visual compliance runs last (needs dev server on :3001).
# - Total runtime ≈ slowest shard setup + slowest shard tests.
#
# Run identity (#317, docs/specs/2026-10-09-shard-stack-dynamic-ports-317-design.md):
# every run gets a unique 6-hex tag; its 4 ports are allocated dynamically
# (below the kernel ephemeral range, clear of every repo service port), and
# all run resources (DBs, log dir, lease file) are named by the tag. Parallel
# runs never intersect by construction. The tag + ports + log dir are printed
# at startup — manual debugging always knows where each stack lives. The
# legacy fixed ports 3002/3003/8001/8002 are NEVER occupied or cleaned here.
#
# Env vars:
#   VISUAL_COMPLIANCE=0   Skip visual compliance check (default: 1, run it)
#   SEQUENTIAL=1          Run all stages sequentially (legacy, ~15 min).
#                         Used for debugging. Skips the whole tag/port
#                         machinery (no shards are started by it).
#   VISUAL_COMPLIANCE_URL Override dev server URL for visual compliance.
#   MEMO_TEST_LOCK_PATH   Heavy-run lock file (default:
#                         /root/workspace/.memo-heavy-tests.lock).
#   MEMO_LOCK_POLL_S      Lock queue retry interval (default: 300 s).
#   MEMO_LOCK_WAIT_S      Lock queue ceiling, wall time (default: 3600 s).
#   MEMO_TEST_LOCK_DISABLE=1  Run without the lock (bypass notice).
#
# Heavy-run lock (#472, spec «Механизм замка»): this script self-acquires
# the container's heavy lock at the very start — BEFORE the SEQUENTIAL
# branch, so both run shapes serialize. The lock fd (9) lives in THIS
# process: every spawned stage runs with 9>&- (background stages AND
# foreground children — a surviving orphan must never keep the lock after
# the owner dies; kill -9 of this script releases the lock instantly via
# the kernel). A busy machine queues this run with a status line per
# attempt; past the ceiling the run exits 75 («машина занята…») —
# distinguishable from test failures for automation. Bypass (no lock,
# one-line notice, suppressed under CI=true): lock dir missing/not
# writable, no flock binary, or MEMO_TEST_LOCK_DISABLE=1; the lock dir is
# never created. Nested heavy calls under this run skip re-acquiring via
# the exported MEMO_TEST_LOCK_HELD=1 (reentrancy guard, US-1).
#
# Readiness wait (#472, spec «Починка ожидания готовности»): the shards'
# readiness is NOT HTTP-polled here. Each stack wrapper
# (scripts/e2e-shard-start.sh) publishes a ready-marker file
# ($LOG_DIR/shard-stack-N.ready.marker) right after ITS frontend readiness
# poll succeeds (before its warmup); this script waits for both markers
# with the ceiling READY_ORCHESTRATOR_S (single source:
# scripts/lib/shard-helpers.sh — the wrapper budgets + 180 s pre-bind
# slack) and checks wrapper liveness on every tick (kill -0 + the #448
# watchdog death marker): a wrapper dying mid-wait fails the run within
# one tick with the stack-log tails; ceiling exhaustion fails with both
# tails. READY_BUDGET_BACKEND_S / READY_BUDGET_FRONTEND_S env-overrides
# flow into the derived ceiling.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Heavy-run lock: self-acquisition (#472, spec «Точки входа» п.1) ─────────
# Placed BEFORE `export CI=true` on purpose: the bypass notice must honor
# the REAL CI environment (GitHub sets CI=true → suppressed), not this
# script's own pnpm-TTY export (a local pre-push run still prints it).
# rc 75 (busy past the ceiling) aborts the run here via set -e.
source "$ROOT/scripts/lib/test-lock.sh"
heavy_test_lock_acquire

# Set CI=true so pnpm doesn't require TTY for module purge confirmation.
# Pre-push hook runs in non-TTY context (git push is not interactive).
export CI=true

# CI runners are UTC; local parity keeps date-sensitive tests deterministic.
export TZ=UTC

# LOG_DIR is defined after the run tag is generated below (#317 §3.1):
# each run logs into its own ${TMPDIR:-/tmp}/test-all-logs/run-<tag> dir
# (a shared dir made parallel runs overwrite each other's diagnostics).

# Allow forcing legacy sequential mode
if [ "${SEQUENTIAL:-0}" = "1" ]; then
  echo "🔍 Running local test suite (SEQUENTIAL mode)..."

  # Every child below runs with 9>&- (heavy-lock fd, #472): a surviving
  # orphan of a killed run must never keep the container lock held.
  echo "  → lint..."
  pnpm run lint 9>&-
  echo "  → type-check..."
  (cd frontend/admin && pnpm run type-check) 9>&-
  echo "  → type-check (api-client)..."
  (cd packages/api-client && pnpm run type-check) 9>&-
  echo "  → vitest..."
  (cd frontend/admin && pnpm run test) 9>&-
  echo "  → vitest (workspace packages)..."
  bash scripts/run-workspace-tests.sh 9>&-
  echo "  → playwright..."
  (cd frontend/admin && CI= pnpm exec playwright test --workers=1) 9>&-
  echo "  → backend pytest..."
  (cd backend && uv run pytest) 9>&-
  if [ "${VISUAL_COMPLIANCE:-1}" != "0" ]; then
    echo "  → visual-compliance-check..."
    # ... (same as below)
  fi
  echo "🚀 All checks passed."
  exit 0
fi

echo "🔍 Running local test suite (PARALLEL mode)..."

# ── Sourced helpers library ─────────────────────────────────────────────────
# Functions in the library read these globals (no arguments) — declared
# before the source and before any call into the library. The port arrays
# are filled by dynamic allocation below (#317 §3.2); they stay empty until
# then, and no library function that reads them is called before they are
# filled (cleanup_shards runs at trap time, after allocation).
# GH #415: SHARD_PROJECTS is gone — sharding is native (--shard=i/2 of the
# single Playwright project e2e), no project-name split remains.
SHARD_FRONTEND_PORTS=()
SHARD_BACKEND_PORTS=()
source "$ROOT/scripts/lib/shard-helpers.sh"

# ── Phase 1: startup-clean — sweep dead runs + tail audit (#317 §3.3) ──────
# Phase-order contract: startup-clean/audit → port allocation → lease write
# → stack start (the run's tagged files are created last). At audit time a
# brand-new foreign run has NEITHER a lease NOR tagged files, so the orphan
# audit can never mistake it for garbage — the race is excluded by
# construction. Legacy ports 3002/3003/8001/8002 are no longer occupied or
# cleaned by this run: a foreign listener there does not interfere with a
# dynamic-port run and is left alone (#317 §3.2/§3.3).
echo "  → start-cleanup: sweeping dead runs + auditing orphaned tagged files..."
# sweep_dead_runs stdout carries ONLY the live runs' ports — they go to the
# allocator as busy args (a live run's ports must never be reused).
LIVE_RUN_PORTS="$(sweep_dead_runs)"
# #317 Task 5: manual-stack leases (tagged e2e-shard-start.sh) zero-pad
# their two unused port slots to keep the 8-field lease format — a literal
# 0 must never reach the allocator's busy args.
_live_ports_filtered=""
for _p in $LIVE_RUN_PORTS; do
  [ "$_p" = "0" ] || _live_ports_filtered="$_live_ports_filtered $_p"
done
LIVE_RUN_PORTS="${_live_ports_filtered# }"
audit_orphan_tagged ""   # current tag does not exist yet — protect nothing

# ── Phase 2: run identity — tag + dynamic port allocation (#317 §3.1/§3.2) ─
# Failure flow: any failure here exits 1 BEFORE this run has created any
# resource (no lease, no tagged DBs, no log dir, no listeners) — spec §3.2.
echo "  → generating run tag + allocating 4 shard ports..."
if ! SHARD_RUN_TAG="$(gen_run_tag)"; then
  echo "❌ gen_run_tag failed — aborting before any run resources are created." >&2
  exit 1
fi
# NB: $LIVE_RUN_PORTS word-splitting is INTENTIONAL (busy-port args contract).
if ! ALLOC_PORTS="$(allocate_shard_ports $LIVE_RUN_PORTS)"; then
  echo "❌ allocate_shard_ports failed — aborting before any run resources are created." >&2
  exit 1
fi
# The allocator prints 4 ports in draw order; the pairing contract is
# front1 back1 front2 back2 (spec §3.2) — kept consistent with the per-shard
# env assembly and the lease line below.
read -r RUN_FRONT1 RUN_BACK1 RUN_FRONT2 RUN_BACK2 <<< "$ALLOC_PORTS"
for _port in "$RUN_FRONT1" "$RUN_BACK1" "$RUN_FRONT2" "$RUN_BACK2"; do
  case "$_port" in
    ''|*[!0-9]*)
      echo "❌ allocate_shard_ports returned a non-numeric port ('$_port') — aborting." >&2
      exit 1
      ;;
  esac
done
SHARD_FRONTEND_PORTS=("$RUN_FRONT1" "$RUN_FRONT2")
SHARD_BACKEND_PORTS=("$RUN_BACK1" "$RUN_BACK2")

# Per-run log directory (#317 §3.1): printed below — manual debugging always
# knows where each stack lives. The tail audit removes run-<tag> dirs of
# tags dead > 24 h; nothing else maintains this path.
LOG_DIR="${TMPDIR:-/tmp}/test-all-logs/run-${SHARD_RUN_TAG}"
mkdir -p "$LOG_DIR"

# The «тег/порты прогона» line — spec §3.1 requirement.
echo "🏷  run tag: $SHARD_RUN_TAG | shard 1 → front :${SHARD_FRONTEND_PORTS[0]}, back :${SHARD_BACKEND_PORTS[0]} | shard 2 → front :${SHARD_FRONTEND_PORTS[1]}, back :${SHARD_BACKEND_PORTS[1]} | logs: $LOG_DIR"

# ── Master-DB seed lock (#317 §8: mkdir-lock around check+seed) ────────────
# Two same-machine runs starting on an empty master DB would seed it twice
# concurrently. An atomic mkdir serializes the WHOLE critical section
# (check + seed + per-shard copies). Stale-lock safety: a lock older than
# 1 h is removed and retaken; a fresh lock is waited on (bounded 60 s),
# then we proceed with a warning — no worse than the pre-#317 status quo
# (best-effort serialization, not correctness machinery). Separate
# machines/containers have separate /tmp and never contend.
SEED_LOCK_DIR="${TMPDIR:-/tmp}/memo-testall-master-seed.lock"
SEED_LOCK_STALE_S=3600
SEED_LOCK_WAIT_S=60
SEED_LOCK_HELD=false
release_seed_lock() {
  if [ "$SEED_LOCK_HELD" = true ]; then
    rmdir "$SEED_LOCK_DIR" 2>/dev/null || true
    SEED_LOCK_HELD=false
  fi
}
acquire_seed_lock() {
  local waited=0 mtime="" age=""
  while :; do
    if mkdir "$SEED_LOCK_DIR" 2>/dev/null; then
      SEED_LOCK_HELD=true
      return 0
    fi
    mtime="$(_dir_mtime "$SEED_LOCK_DIR" 2>/dev/null || true)"
    case "$mtime" in
      ''|*[!0-9]*) ;;   # unknown clock → treat as fresh (safe side)
      *)
        age=$(( $(date +%s 2>/dev/null || printf '%s' 0) - mtime ))
        if [ "$age" -gt "$SEED_LOCK_STALE_S" ]; then
          echo "  ⚠️  removing stale master-DB seed lock (age ${age}s > ${SEED_LOCK_STALE_S}s)"
          rm -rf "$SEED_LOCK_DIR"   # fixed literal path, no globs/variables
          continue
        fi
        ;;
    esac
    if [ "$waited" -ge "$SEED_LOCK_WAIT_S" ]; then
      echo "  ⚠️  master-DB seed lock still held after ${SEED_LOCK_WAIT_S}s — proceeding WITHOUT it"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# ── Exit/signal hygiene (#317 §3.3: trap EXIT INT TERM) ────────────────────
# An untrapped SIGINT/SIGTERM used to kill the script WITHOUT the EXIT trap
# running, orphaning the stacks (US-6). INT/TERM run the same cleanup and
# then exit 128+sig; they clear the EXIT trap first so cleanup never runs
# twice. release_seed_lock is idempotent (flag-guarded) — it covers an
# interrupt inside the master-DB critical section below.
# #448 Task 4: stop_run_watchdog goes FIRST — a live watchdog during the
# wrapper-TERM teardown would see those orchestrator-caused deaths and
# plant a FALSE marker (no-op before the watchdog starts: RUN_WATCHDOG_PID
# is empty; idempotent after the normal-flow stop, which clears the PID).
SHARD_BACKEND_PIDS=()
on_signal() {
  trap - EXIT
  stop_run_watchdog
  cleanup_shards
  release_seed_lock
  exit $((128 + $1))
}
trap 'stop_run_watchdog; cleanup_shards; release_seed_lock' EXIT
trap 'on_signal 2' INT
trap 'on_signal 15' TERM

# ── Phase 3: run lease (#317 §3.3) ─────────────────────────────────────────
# Written right after successful allocation and BEFORE any stack start:
# this is what tells the NEXT run's startup-clean that we are alive (dead
# lease → our resources get swept). PID = this script's PID.
if ! write_run_lease "$SHARD_RUN_TAG" "$$" \
     "$RUN_FRONT1" "$RUN_BACK1" "$RUN_FRONT2" "$RUN_BACK2"; then
  echo "❌ write_run_lease failed (${SHARD_RUNS_DIR}/${SHARD_RUN_TAG}.run) — aborting." >&2
  exit 1
fi

# ── Remove stale shard build dirs (unconditional) ─────────────────────────
# Wipe BEFORE anything starts (spec §3.2: сироты → вайп → запуск) — every run
# compiles shards from scratch, no chunks inherited across runs. Each shard
# owns its .next-shard-N dir exclusively, so no port guard needed here
# (unlike the default-.next wipe below, which is shared with the dev stack).
wipe_shard_dirs

# ── Remove stale Next.js build dir (port-guarded) ─────────────────────────
# NEXT_PUBLIC_API_URL is baked into the Next.js client bundle at compile
# time. A stale frontend/admin/.next from an earlier stack (e.g. dev stack
# pointed at :8000) keeps serving the OLD baked URL → shard frontends talk
# to the wrong/dead backend → mass bogus e2e failures (wave #216: 57
# phantom failures; all gone after `rm -rf frontend/admin/.next`).
# Port guard: only wipe when NO Next.js dev server is live from
# frontend/admin. dev.sh admin mode serves :3001 from the SAME .next dir;
# deleting it under a running server corrupts that stack (same lesson as
# the port-guarded pkill above — never touch what a live stack owns).
# Busy probe (#448 Task 2): one _listener_on call = ONE /proc-resolver
# sample against the three ports — an lsof-INVISIBLE dev server (rewritten
# process.title, the #448 bug class) is seen and protects the dir; the
# non-Linux fallback inside _listener_on keeps the legacy per-port lsof.
NEXT_DIR_IN_USE=false
if _listener_on 3001 3002 3003; then
  NEXT_DIR_IN_USE=true
fi
if [ "$NEXT_DIR_IN_USE" = false ]; then
  echo "  → removing stale frontend/admin/.next (prevents baked NEXT_PUBLIC_API_URL poisoning)..."
  rm -rf frontend/admin/.next
else
  echo "  → skipping .next wipe — a Next.js dev server is live on :3001/:3002/:3003 (shared build dir)"
fi

# ── Shard-start dryrun test (stub-level, milliseconds) ─────────────────────
# Regression guard for scripts/e2e-shard-start.sh (S4): DB-wipe guard,
# SHARD_ID whitelist, NEXT_DIST_DIR export. GNU `timeout` may be missing on
# macOS without coreutils — skip with a warning instead of failing.
if command -v timeout >/dev/null; then
  echo "  → shard-start dryrun test..."
  bash "$ROOT/scripts/e2e-shard-start.dryrun.test.sh" 9>&-
else
  echo "  ⚠️  skip dryrun test (no timeout binary)"
fi

# ── Heavy-lock dryrun test (env-seam, small constants; #472 Task 4) ─────────
# Scenario suite for the lock itself: US-1 serialization (two competing
# runs) + nesting, US-2 holder death, US-3 ceiling rc 75, US-4 short-run-
# no-queue, US-7 bypass, F9 same-inode across two sessions. Runs on TEMP
# lock paths with small POLL/WAIT — the real lock held by THIS run is
# never touched, and the suite sanitizes the CI=/MEMO_TEST_LOCK_HELD=
# exports it inherits from this script. flock may be missing on non-Linux
# hosts — skip with a warning, like the timeout guard above.
if command -v flock >/dev/null; then
  echo "  → test-lock dryrun test..."
  bash "$ROOT/scripts/lib/test-lock.dryrun.test.sh" 9>&-
else
  echo "  ⚠️  skip test-lock dryrun test (no flock binary)"
fi

# ── Visual-compliance parser node-tests (env-free, milliseconds) ───────────
# Unit + fixture suite for scripts/visual-compliance-parser.js (GH #311,
# US-1/US-2): §10 checkbox parsing, { applicable, checks } contract, N/A
# grammar. Synchronous like the dryrun test above — a red suite aborts the
# run before any expensive stage starts.
echo "  → visual-compliance parser tests..."
node "$ROOT/scripts/test-visual-compliance-parser.js" 9>&-

# ── Visual-compliance smoke tests (env-free, no dev server) ────────────────
# Stage-order guard for scripts/visual-compliance-check.sh (GH #311, US-2/US-3):
# N/A-marker spec → exit 0 + «not applicable» BEFORE any server contact;
# missing/empty/prose-only section → exit 3. Both paths need no :3001 stack.
echo "  → visual-compliance smoke tests..."
bash "$ROOT/scripts/visual-compliance-check.smoke.test.sh" 9>&-

# Track all background PIDs for waiting
ALL_PIDS=()
# #448 Task 4: Playwright stage PIDs only (the stages bound to the shard
# stacks) — published to the fail-fast watchdog via a pid file after both
# stages start. Wrappers themselves are NEVER added to ALL_PIDS (§3.2:
# ввод обёрток в финальный wait повесил бы его — обёртка не завершается
# сама; их смерть видит watchdog, не wait).
PW_STAGE_PIDS=()

# ── Backend pytest (independent) ───────────────────────────────────────────
echo "  → backend pytest..."
(
  cd backend && uv run pytest > "$LOG_DIR/pytest.log" 2>&1
) 9>&- &
ALL_PIDS+=($!)

# ── Lint (turbo, cached) ──────────────────────────────────────────────────
echo "  → lint..."
pnpm run lint > "$LOG_DIR/lint.log" 2>&1 9>&- &
ALL_PIDS+=($!)

# ── Type-check (admin) ─────────────────────────────────────────────────────
echo "  → type-check..."
(
  cd frontend/admin && pnpm run type-check > "$LOG_DIR/typecheck.log" 2>&1
) 9>&- &
ALL_PIDS+=($!)

# ── Type-check (api-client) ────────────────────────────────────────────────
# admin's tsc checks api-client sources transitively (path-mapped imports)
# but never its test fixtures — they are imported by nothing. TS2345 in
# fixtures escaped every gate once (#286/PR #320); this stage closes that.
# The package tsconfig includes src/**/*, so tests inside src are covered.
echo "  → type-check (api-client)..."
(
  cd packages/api-client && pnpm run type-check > "$LOG_DIR/typecheck-api-client.log" 2>&1
) 9>&- &
ALL_PIDS+=($!)

# ── Vitest (admin unit tests) ──────────────────────────────────────────────
echo "  → vitest..."
(
  cd frontend/admin && pnpm run test > "$LOG_DIR/vitest.log" 2>&1
) 9>&- &
ALL_PIDS+=($!)

# ── Vitest (other workspace packages: domain, api-client, web) ─────────────
# GH #420: the local full suite must cover ALL tests, not just admin's.
# Same shared script as the CI workspace-tests job — the package list is
# derived from the workspace globs, no hand lists to go stale.
echo "  → vitest (workspace packages)..."
(
  bash scripts/run-workspace-tests.sh > "$LOG_DIR/vitest-workspace.log" 2>&1
) 9>&- &
ALL_PIDS+=($!)

# ── Playwright shards: per-shard DB + backend + frontend ───────────────────
# Each shard gets an isolated stack (all names carry the run tag, all ports
# come from this run's allocation — see the «тег/порты прогона» line above):
#   SHARD_ID=1 → DB: test_memo_shard1_${TAG}.db, backend: :${BACK1}, frontend: :${FRONT1}
#   SHARD_ID=2 → DB: test_memo_shard2_${TAG}.db, backend: :${BACK2}, frontend: :${FRONT2}
#
# 2 shards instead of 5 to avoid CPU contention on 4-core machines.
# Each stack runs via scripts/e2e-shard-start.sh which:
#   1. Seeds the DB (if empty)
#   2. Starts FastAPI on BACKEND_PORT
#   3. Starts Next.js on SHARD_PORT (foreground)
#
# Playwright connects via reuseExistingServer: true (safe on dynamic ports:
# no foreign server can be on them).

echo "  → preparing per-shard databases..."
# Ensure sqlite3 is available
if ! command -v sqlite3 &>/dev/null; then
  echo "❌ sqlite3 not found — required for per-shard DB setup" >&2
  exit 1
fi

# Critical section under the mkdir-lock (#317 §8): check + seed + copies.
# The copies stay inside the lock too — a copy taken while another run
# seeds the master would capture a half-seeded schema. acquire_seed_lock
# always returns (rc 1 = proceeded without the lock after a bounded wait).
acquire_seed_lock || true

# Create master DB with seed data (idempotent — only if missing or empty)
MASTER_DB="backend/test_memo.db"
if [ ! -f "$MASTER_DB" ] || [ "$(sqlite3 "$MASTER_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo 0)" -lt 5 ]; then
  echo "  → seeding master test DB..."
  (
    cd backend
    DATABASE_URL="sqlite+aiosqlite:///$(pwd)/test_memo.db" \
      PYTHONPATH=src uv run python -m seed.seed
  ) 9>&-
fi

# Create per-shard DB copies from master — tagged (#317 §3.1:
# test_memo_shard${N}_${TAG}.db; the bash DB guard in e2e-shard-start.sh
# and the canon generator take the path as a string/arg and inherit the
# tagged name automatically).
for i in $(seq 1 2); do
  SHARD_DB="backend/test_memo_shard${i}_${SHARD_RUN_TAG}.db"
  cp "$MASTER_DB" "$SHARD_DB"
done
release_seed_lock
echo "  → per-shard DBs ready (2 tagged copies of $MASTER_DB, tag $SHARD_RUN_TAG)"

# Start 2 shard stacks in parallel
echo "  → starting 2 shard stacks..."
for i in $(seq 0 1); do
  SHARD_NUM=$((i + 1))
  BACKEND_PORT="${SHARD_BACKEND_PORTS[$i]}"
  FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
  SHARD_DB="backend/test_memo_shard${SHARD_NUM}_${SHARD_RUN_TAG}.db"
  BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

  # Re-check BOTH ports immediately before THIS stack starts (#317 §3.2:
  # narrow the allocate→bind TOCTOU window). Busy here means someone bound
  # the port between the allocation check and now — fatal with a clear
  # message, no blind retry (spec §4). exit 1 → the trap cleans up.
  # Probe (#448 Task 2): _listener_on — the /proc-resolver sample sees
  # lsof-invisible holders too (rewritten process.title); non-Linux keeps
  # the legacy per-port `lsof -ti` inside the helper.
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    if _listener_on "$port"; then
      echo "❌ порт $port занят между проверкой и стартом; перезапусти test-all" >&2
      exit 1
    fi
  done

  (
    cd "$ROOT"
    # Fix A (#317 §3.3): SHARD_MANAGED_STACK=1 — the orchestrator owns the tag's 4-port lease; managed stacks neither write nor remove it.
    # #472: SHARD_READY_MARKER — the wrapper creates this file right after
    # its own frontend readiness poll succeeds (before warmup); the marker
    # wait below polls these files instead of duplicating the HTTP probing.
    SHARD_ID="$SHARD_NUM" \
    SHARD_RUN_TAG="$SHARD_RUN_TAG" \
    SHARD_PORT="$FRONTEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    TEST_DB_PATH="$ROOT/$SHARD_DB" \
    BACKEND_URL="$BACKEND_URL" \
    NEXT_PUBLIC_API_URL="$BACKEND_URL" \
    SHARD_READY_MARKER="$LOG_DIR/shard-stack-${SHARD_NUM}.ready.marker" \
    SHARD_MANAGED_STACK=1 \
      bash scripts/e2e-shard-start.sh
  ) 9>&- > "$LOG_DIR/shard-stack-${SHARD_NUM}.log" 2>&1 &

  # Track the backend PID (parent of the startup script's children)
  # The startup script runs backend in background, frontend in foreground.
  # We need the backend PID for cleanup. Since the startup script backgrounds
  # the backend, we capture it from the log after a short delay.
  # For now, we kill the entire process group on cleanup.
  SHARD_BACKEND_PIDS+=($!)
done

# ── #448 Task 4: orchestrator fail-fast watchdog ────────────────────────────
# Background loop (scripts/lib/shard-helpers.sh, spec §3.2), started right
# after the stack wrappers and BEFORE the readiness waits — an early-dying
# stack cannot slip through. Each SHARD_RUN_WATCH_S tick it kill-0-probes
# SHARD_BACKEND_PIDS (direct children of THIS shell). A dead wrapper →
# diagnosis (shard, ports, capped stack-log tail) + marker file in $LOG_DIR
# + TERM to BOTH Playwright stages with the TERM→grace→KILL escalation
# (rev4 hard form — the neighbor stops too); the marker turns the run red
# even if every stage was green (US-6). Stage pid lists are published later
# (atomic mv, after both stages start): a missing file means «stages not
# started yet» to the watchdog — it keeps watching the wrappers alone.
RUN_WATCHDOG_MARKER="$LOG_DIR/stack-wrapper-died.marker"
RUN_TERM_STAGES="$LOG_DIR/watchdog-term-stages.list"
RUN_EXIT_STAGES="$LOG_DIR/watchdog-exit-stages.list"
run_watchdog "$RUN_WATCHDOG_MARKER" "$RUN_TERM_STAGES" "$RUN_EXIT_STAGES" 9>&- &
RUN_WATCHDOG_PID=$!

# ── Wait for both shards' readiness MARKERS (#472) ─────────────────────────
# No duplicate HTTP polling: each wrapper publishes readiness by creating
# the SHARD_READY_MARKER we handed it — right after ITS own frontend poll
# succeeds, before its warmup (overlap semantics preserved: stages start on
# readiness, warmup runs in parallel, the 30 s buffer below stays). This
# wait polls file EXISTENCE with the ceiling READY_ORCHESTRATOR_S (single
# source: scripts/lib/shard-helpers.sh — backend + frontend budgets + 180 s
# pre-bind slack; derived, no duplicate literals). EVERY tick also checks:
#   - wrapper liveness, kill -0 (#448 seam; a reaped wrapper answers
#     ESRCH): a wrapper dying mid-wait fails the run WITHIN ONE TICK with
#     the dead stack's log tail — the ceiling is never burned on a dead
#     wrapper (US-5, orchestrator layer);
#   - the #448 run-watchdog death marker (belt and braces: the watchdog's
#     own tick may catch the death first and it has already TERMed stages).
# Ceiling exhaustion (wrapper alive, marker never came) → fail with BOTH
# stack-log tails + the EADDRINUSE diagnosis carried over from the legacy
# failure path (#317 §3.2 — a port grabbed in the allocate→bind TOCTOU
# window is still the most likely shape of a never-ready stack).
READY_MARKER_1="$LOG_DIR/shard-stack-1.ready.marker"
READY_MARKER_2="$LOG_DIR/shard-stack-2.ready.marker"
echo "  → waiting for shard readiness markers (ceiling ${READY_ORCHESTRATOR_S}s)..."
_rdy_deadline=$(( SECONDS + READY_ORCHESTRATOR_S ))
_rdy_fail=""
while :; do
  if [ -e "$READY_MARKER_1" ] && [ -e "$READY_MARKER_2" ]; then
    echo "    both shards ready (markers shard-stack-{1,2}.ready.marker in $LOG_DIR)"
    break
  fi
  if [ "$SECONDS" -ge "$_rdy_deadline" ]; then
    _rdy_fail="ceiling"
    break
  fi
  # liveness on every tick — wrapper death beats the ceiling (US-5)
  for _i in 0 1; do
    if ! kill -0 "${SHARD_BACKEND_PIDS[$_i]}" 2>/dev/null; then
      _rdy_fail="wrapper-$(( _i + 1 ))"
      break
    fi
  done
  if [ -n "$_rdy_fail" ]; then break; fi
  if [ -e "$RUN_WATCHDOG_MARKER" ]; then
    _rdy_fail="watchdog"
    break
  fi
  # tick truncated to the remaining ceiling (cadence 1 s)
  _rdy_rem=$(( _rdy_deadline - SECONDS ))
  if [ "$_rdy_rem" -gt 1 ]; then
    sleep 1
  else
    sleep "$_rdy_rem"
  fi
done
if [ -n "$_rdy_fail" ]; then
  case "$_rdy_fail" in
    wrapper-1|wrapper-2)
      _n="${_rdy_fail#wrapper-}"
      _i=$(( _n - 1 ))
      echo "" >&2
      echo "❌ stack wrapper shard $_n died during the readiness wait (frontend :${SHARD_FRONTEND_PORTS[$_i]}, backend :${SHARD_BACKEND_PORTS[$_i]}) — stopping the run" >&2
      _capped_log_tail "$LOG_DIR/shard-stack-$_n.log" >&2
      ;;
    watchdog)
      echo "" >&2
      echo "❌ run watchdog reported a dead stack wrapper during the readiness wait — stopping the run" >&2
      echo "   Marker: $RUN_WATCHDOG_MARKER (see the watchdog diagnosis above)" >&2
      _capped_log_tail "$LOG_DIR/shard-stack-1.log" >&2
      _capped_log_tail "$LOG_DIR/shard-stack-2.log" >&2
      ;;
    *)
      echo "" >&2
      echo "❌ shard readiness markers not present after the ${READY_ORCHESTRATOR_S}s ceiling — frontend(s) never became ready" >&2
      _capped_log_tail "$LOG_DIR/shard-stack-1.log" >&2
      _capped_log_tail "$LOG_DIR/shard-stack-2.log" >&2
      ;;
  esac
  # EADDRINUSE diagnosis (#317 §3.2, preserved from the legacy failure
  # path): Node prints `... EADDRINUSE: address already in use 0.0.0.0:PORT`
  # — the trailing :PORT segment names the port; fallback names both of
  # the shard's. Checked on every failure mode (cheap, additive).
  for _n in 1 2; do
    _sl="$LOG_DIR/shard-stack-$_n.log"
    _cl="$(grep 'EADDRINUSE' "$_sl" 2>/dev/null | tail -1 || true)"
    if [ -n "$_cl" ]; then
      _cp="${_cl##*:}"
      case "$_cp" in
        ''|*[!0-9]*)
          _cp="${SHARD_FRONTEND_PORTS[$(( _n - 1 ))]} (или ${SHARD_BACKEND_PORTS[$(( _n - 1 ))]})"
          ;;
      esac
      echo "❌ порт $_cp занят между проверкой и стартом; перезапусти test-all" >&2
    fi
  done
  exit 1
fi

# Extra buffer for Next.js compilation to stabilize
echo "  → waiting 30s for Next.js compilation to stabilize..."
sleep 30

# Run 2 native Playwright shards in parallel, each against its own frontend.
# GH #415: single e2e project + --shard=i/2 (deterministic spec-file split).
# Both shards run in PARALLEL from the SAME cwd (frontend/admin) — per-shard
# E2E_RESULTS_JSON / E2E_REPORT_DIR keep them from overwriting each other's
# results.json and playwright-report/ (see playwright.config.ts reporters).
echo "  → running 2 Playwright shards in parallel..."
for i in $(seq 0 1); do
  SHARD_NUM=$((i + 1))
  FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
  BACKEND_PORT="${SHARD_BACKEND_PORTS[$i]}"
  BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
  SHARD_DB="backend/test_memo_shard${SHARD_NUM}_${SHARD_RUN_TAG}.db"

  (
    cd frontend/admin
    SHARD_ID="$SHARD_NUM" \
    SHARD_RUN_TAG="$SHARD_RUN_TAG" \
    SHARD_PORT="$FRONTEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    TEST_DB_PATH="$ROOT/$SHARD_DB" \
    BACKEND_URL="$BACKEND_URL" \
    NEXT_PUBLIC_API_URL="$BACKEND_URL" \
    E2E_RESULTS_JSON="results-shard${SHARD_NUM}.json" \
    E2E_REPORT_DIR="playwright-report-shard${SHARD_NUM}" \
    CI= pnpm exec playwright test --project=e2e --shard=${SHARD_NUM}/2 --workers=1 \
      > "$LOG_DIR/pw-shard-${SHARD_NUM}.log" 2>&1
  ) 9>&- &
  ALL_PIDS+=($!)
  PW_STAGE_PIDS+=($!)
done

# #448 Task 4: publish the stage lists for the watchdog. Atomic mv (tmp in
# the same dir): the watchdog re-reads these every tick, and a torn line
# could TERM a wrong pid. TERM list = the 2 Playwright stages only (the
# stages bound to the stacks); EXIT list = every parallel stage — the
# watchdog must live until the END of the final wait (§3.2), not just until
# the Playwright stages finish.
printf '%s\n' ${PW_STAGE_PIDS[@]+"${PW_STAGE_PIDS[@]}"} > "$RUN_TERM_STAGES.tmp" \
  && mv -f "$RUN_TERM_STAGES.tmp" "$RUN_TERM_STAGES"
printf '%s\n' ${ALL_PIDS[@]+"${ALL_PIDS[@]}"} > "$RUN_EXIT_STAGES.tmp" \
  && mv -f "$RUN_EXIT_STAGES.tmp" "$RUN_EXIT_STAGES"

# ── Wait for all parallel stages ───────────────────────────────────────────
FAIL=0
for pid in "${ALL_PIDS[@]}"; do
  if ! wait "$pid"; then
    FAIL=1
  fi
done

# ── #448 Task 4: hard termination order ─────────────────────────────────────
# final stage waits → STOP the watchdog → marker check → verdict. The stop
# precedes BOTH the check and the EXIT-trap teardown: teardown TERMs the
# wrappers, and a still-live watchdog would see those (orchestrator-caused)
# deaths and plant a FALSE marker in a green run. Wrapper deaths observed
# BEFORE this point — including after an already-green stage (US-6: a run
# that rode green on a dead stack) — are real and red the run here.
stop_run_watchdog
if [ -e "$RUN_WATCHDOG_MARKER" ]; then
  echo ""
  echo "❌ Stack wrapper died mid-run — the run is red even if all stages were green (US-6)."
  echo "   Marker: $RUN_WATCHDOG_MARKER (see the watchdog diagnosis above and the stack log tail)."
  FAIL=1
fi

if [ $FAIL -ne 0 ]; then
  echo ""
  echo "❌ One or more test stages failed. Failed PIDs:"
  # Just list all log files — the exit codes already tell us which failed
  for log in "$LOG_DIR"/*.log; do
    echo "  → $(basename "$log")"
  done
  exit 1
fi

# ── Visual compliance (needs dev server, runs after parallel stages) ──────
if [ "${VISUAL_COMPLIANCE:-1}" != "0" ]; then
  echo "  → visual-compliance-check..."
  SPEC_FILE="$ROOT/docs/specs/2026-06-19-current-user-scenarios.md"
  if [ ! -f "$SPEC_FILE" ]; then
    echo "  ⚠️  $SPEC_FILE not found; skipping visual compliance"
  elif [ -x "$ROOT/scripts/visual-compliance-check.sh" ]; then
    VISUAL_COMPLIANCE_URL="${VISUAL_COMPLIANCE_URL:-http://localhost:3001}"
    "$ROOT/scripts/visual-compliance-check.sh" \
      "$VISUAL_COMPLIANCE_URL" \
      "$SPEC_FILE" \
      /tmp/visual-compliance \
      mobile 9>&- || {
        echo "❌ Visual compliance failed. See /tmp/visual-compliance/report.md"
        exit 1
      }
  else
    echo "  ⚠️  visual-compliance-check.sh not found; skipping"
  fi
else
  echo "  ⊘ visual-compliance-check: skipped (VISUAL_COMPLIANCE=0)"
fi

echo "🚀 All checks passed."
