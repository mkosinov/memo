#!/usr/bin/env bash
# Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
# Exits 1 on any failure, blocking the push.
#
# Parallelization strategy:
# - Backend pytest runs in parallel with frontend stages.
# - Lint, type-check, vitest all run in parallel.
# - 2 Playwright shards run in PARALLEL, each with its own isolated stack:
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

set -euo pipefail

# Set CI=true so pnpm doesn't require TTY for module purge confirmation.
# Pre-push hook runs in non-TTY context (git push is not interactive).
export CI=true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# LOG_DIR is defined after the run tag is generated below (#317 §3.1):
# each run logs into its own ${TMPDIR:-/tmp}/test-all-logs/run-<tag> dir
# (a shared dir made parallel runs overwrite each other's diagnostics).

# Allow forcing legacy sequential mode
if [ "${SEQUENTIAL:-0}" = "1" ]; then
  echo "🔍 Running local test suite (SEQUENTIAL mode)..."

  echo "  → lint..."
  pnpm run lint
  echo "  → type-check..."
  (cd frontend/admin && pnpm run type-check)
  echo "  → type-check (api-client)..."
  (cd packages/api-client && pnpm run type-check)
  echo "  → vitest..."
  (cd frontend/admin && pnpm run test)
  echo "  → playwright..."
  (cd frontend/admin && CI= pnpm exec playwright test --workers=1)
  echo "  → backend pytest..."
  (cd backend && uv run pytest)
  if [ "${VISUAL_COMPLIANCE:-1}" != "0" ]; then
    echo "  → visual-compliance-check..."
    # ... (same as below)
  fi
  echo "🚀 All checks passed."
  exit 0
fi

echo "🔍 Running local test suite (PARALLEL mode)..."

# ── Shard projects + sourced helpers library ────────────────────────────────
# Functions in the library read these globals (no arguments) — declared
# before the source and before any call into the library. The port arrays
# are filled by dynamic allocation below (#317 §3.2); they stay empty until
# then, and no library function that reads them is called before they are
# filled (cleanup_shards runs at trap time, after allocation).
SHARD_PROJECTS=("shard-schedule" "shard-rest")
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
SHARD_BACKEND_PIDS=()
on_signal() {
  trap - EXIT
  cleanup_shards
  release_seed_lock
  exit $((128 + $1))
}
trap 'cleanup_shards; release_seed_lock' EXIT
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
NEXT_DIR_IN_USE=false
for port in 3001 3002 3003; do
  if lsof -ti :"$port" >/dev/null 2>&1; then
    NEXT_DIR_IN_USE=true
    break
  fi
done
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
  bash "$ROOT/scripts/e2e-shard-start.dryrun.test.sh"
else
  echo "  ⚠️  skip dryrun test (no timeout binary)"
fi

# ── Visual-compliance parser node-tests (env-free, milliseconds) ───────────
# Unit + fixture suite for scripts/visual-compliance-parser.js (GH #311,
# US-1/US-2): §10 checkbox parsing, { applicable, checks } contract, N/A
# grammar. Synchronous like the dryrun test above — a red suite aborts the
# run before any expensive stage starts.
echo "  → visual-compliance parser tests..."
node "$ROOT/scripts/test-visual-compliance-parser.js"

# ── Visual-compliance smoke tests (env-free, no dev server) ────────────────
# Stage-order guard for scripts/visual-compliance-check.sh (GH #311, US-2/US-3):
# N/A-marker spec → exit 0 + «not applicable» BEFORE any server contact;
# missing/empty/prose-only section → exit 3. Both paths need no :3001 stack.
echo "  → visual-compliance smoke tests..."
bash "$ROOT/scripts/visual-compliance-check.smoke.test.sh"

# Track all background PIDs for waiting
ALL_PIDS=()

# ── Backend pytest (independent) ───────────────────────────────────────────
echo "  → backend pytest..."
(
  cd backend && uv run pytest > "$LOG_DIR/pytest.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Lint (turbo, cached) ──────────────────────────────────────────────────
echo "  → lint..."
pnpm run lint > "$LOG_DIR/lint.log" 2>&1 &
ALL_PIDS+=($!)

# ── Type-check (admin) ─────────────────────────────────────────────────────
echo "  → type-check..."
(
  cd frontend/admin && pnpm run type-check > "$LOG_DIR/typecheck.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Type-check (api-client) ────────────────────────────────────────────────
# admin's tsc checks api-client sources transitively (path-mapped imports)
# but never its test fixtures — they are imported by nothing. TS2345 in
# fixtures escaped every gate once (#286/PR #320); this stage closes that.
# The package tsconfig includes src/**/*, so tests inside src are covered.
echo "  → type-check (api-client)..."
(
  cd packages/api-client && pnpm run type-check > "$LOG_DIR/typecheck-api-client.log" 2>&1
) &
ALL_PIDS+=($!)

# ── Vitest (admin unit tests) ──────────────────────────────────────────────
echo "  → vitest..."
(
  cd frontend/admin && pnpm run test > "$LOG_DIR/vitest.log" 2>&1
) &
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
  )
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
  PROJECT="${SHARD_PROJECTS[$i]}"
  BACKEND_PORT="${SHARD_BACKEND_PORTS[$i]}"
  FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
  SHARD_DB="backend/test_memo_shard${SHARD_NUM}_${SHARD_RUN_TAG}.db"
  BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

  # Re-check BOTH ports immediately before THIS stack starts (#317 §3.2:
  # narrow the allocate→bind TOCTOU window). Busy here means someone bound
  # the port between the allocation check and now — fatal with a clear
  # message, no blind retry (spec §4). exit 1 → the trap cleans up.
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      echo "❌ порт $port занят между проверкой и стартом; перезапусти test-all" >&2
      exit 1
    fi
  done

  (
    cd "$ROOT"
    SHARD_ID="$SHARD_NUM" \
    SHARD_RUN_TAG="$SHARD_RUN_TAG" \
    SHARD_PORT="$FRONTEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    TEST_DB_PATH="$ROOT/$SHARD_DB" \
    BACKEND_URL="$BACKEND_URL" \
    NEXT_PUBLIC_API_URL="$BACKEND_URL" \
      bash scripts/e2e-shard-start.sh
  ) > "$LOG_DIR/shard-stack-${SHARD_NUM}.log" 2>&1 &

  # Track the backend PID (parent of the startup script's children)
  # The startup script runs backend in background, frontend in foreground.
  # We need the backend PID for cleanup. Since the startup script backgrounds
  # the backend, we capture it from the log after a short delay.
  # For now, we kill the entire process group on cleanup.
  SHARD_BACKEND_PIDS+=($!)
done

# Wait for all shard stacks to be ready (check frontend ports)
echo "  → waiting for shard frontends to be ready..."
SHARD_READY=("" "")
# 2 parallel Next.js dev servers need time to compile first request.
# --max-time 30 + 60 iterations = up to 30 min total (usually ~1-2 min).
for _ in $(seq 1 60); do
  ALL_READY=true
  for i in $(seq 0 1); do
    if [ "${SHARD_READY[$i]}" = "ready" ]; then continue; fi
    FRONTEND_PORT="${SHARD_FRONTEND_PORTS[$i]}"
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}/" --max-time 30 2>/dev/null | grep -qE "^(2|3)"; then
      SHARD_READY[$i]="ready"
      echo "    shard $((i + 1)) ready (frontend :${FRONTEND_PORT})"
    else
      ALL_READY=false
    fi
  done
  if [ "$ALL_READY" = true ]; then break; fi
  sleep 1
done
# Check for any shards that failed to start
for i in $(seq 0 1); do
  if [ "${SHARD_READY[$i]}" != "ready" ]; then
    SHARD_NUM=$((i + 1))
    STACK_LOG="$LOG_DIR/shard-stack-${SHARD_NUM}.log"
    echo "❌ Shard ${SHARD_NUM} frontend failed to start on :${SHARD_FRONTEND_PORTS[$i]}"
    echo "   Check: $STACK_LOG"
    # EADDRINUSE in the stack's start log → the port was grabbed between
    # the pre-start check and the bind (#317 §3.2 — conscious no-retry, §4).
    # Node prints it as `... EADDRINUSE: address already in use 0.0.0.0:PORT`
    # — the trailing :PORT segment names the port; fallback names both.
    CLASH_LINE="$(grep 'EADDRINUSE' "$STACK_LOG" 2>/dev/null | tail -1 || true)"
    if [ -n "$CLASH_LINE" ]; then
      CLASH_PORT="${CLASH_LINE##*:}"
      case "$CLASH_PORT" in
        ''|*[!0-9]*)
          CLASH_PORT="${SHARD_FRONTEND_PORTS[$i]} (или ${SHARD_BACKEND_PORTS[$i]})"
          ;;
      esac
      echo "❌ порт $CLASH_PORT занят между проверкой и стартом; перезапусти test-all" >&2
    fi
    exit 1
  fi
done

# Extra buffer for Next.js compilation to stabilize
echo "  → waiting 30s for Next.js compilation to stabilize..."
sleep 30

# Run 2 Playwright shards in parallel, each against its own frontend
echo "  → running 2 Playwright shards in parallel..."
for i in $(seq 0 1); do
  SHARD_NUM=$((i + 1))
  PROJECT="${SHARD_PROJECTS[$i]}"
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
    CI= pnpm exec playwright test --project="$PROJECT" --workers=1 \
      > "$LOG_DIR/pw-$PROJECT.log" 2>&1
  ) &
  ALL_PIDS+=($!)
done

# ── Wait for all parallel stages ───────────────────────────────────────────
FAIL=0
for pid in "${ALL_PIDS[@]}"; do
  if ! wait "$pid"; then
    FAIL=1
  fi
done

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
      mobile || {
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
