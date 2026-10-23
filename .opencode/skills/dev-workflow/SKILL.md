---
name: dev-workflow
description: Development environment — dev.sh, test execution, pnpm, ports, PTY rules
---

# Dev Workflow

## dev.sh — Main entry point

```bash
./dev.sh           # Backend :8000 + Web :3000
./dev.sh --admin   # + Admin :3001
./dev.sh --restart # Kill existing + restart all
./dev.sh --admin --restart  # Both flags
```

### Services and ports

| Service | Port | Starts by default |
|---------|------|-------------------|
| Backend (FastAPI + uvicorn) | :8000 | ✅ |
| Web (Next.js) | :3000 | ✅ |
| Admin (Next.js) | :3001 | Only with `--admin` |
| API docs | :8000/docs | (with backend) |
| E2E shard stacks (local `test-all.sh`) | :28000-32700 window — 4 dynamic ports per run, tag-suffixed resources | On demand (`bash scripts/test-all.sh`) |
| E2E shard ports (legacy, fixed) | :3002/:3003 (front), :8001/:8002 (back) | CI / standalone Playwright only — never a local `test-all` run |

### Behavior
- Seeds DB if `backend/memo.db` doesn't exist
- Skips port if already in use (prints warning)
- Ctrl+C kills all services
- Uses `ENV_FILE=.env.dev` for backend

## Package manager: pnpm via corepack

In this container, pnpm is NOT globally installed. Use:

```bash
corepack enable && pnpm install
corepack enable && pnpm run dev
corepack enable && pnpm run build
```

Or export once:
```bash
export PATH="/root/.npm-global/bin:$PATH"
```

## Commit messages

Format: `type(#issue): summary` — e.g. `refactor(#138): …`, `docs(#139): …`.

## Test Execution

### CRITICAL: PTY Rule for Long Tests

**NEVER** run long test suites via `bash` tool with timeout. Use **PTY** instead.

```python
# CORRECT — no timeout, can read output anytime (heavy suites go under
# the lock — see "Heavy-run lock" below; the wrapper may queue, all the
# more reason for PTY)
pty_spawn(
    command="bash",
    args=["-c", "scripts/with-test-lock.sh bash -c 'cd frontend/admin && npm run test:all'"],
    description="Run frontend tests"
)

# WRONG — will timeout at 120s
bash(command="scripts/with-test-lock.sh bash -c 'cd frontend/admin && npm run test:all'", timeout=300)
```

### Why PTY?
- bash tool kills process after timeout (default 120s, max 300s)
- Large test suites (400+ tests) take 5-10 minutes
- PTY runs indefinitely, you can read output anytime
- PTY can be killed manually when done

### Test commands

Heavy whole-suite runs go under the heavy lock (next section); single
files/specs and quick checks run bare:

```bash
# HEAVY — whole suites, under the lock (see "Heavy-run lock" below)
scripts/with-test-lock.sh bash -c 'cd backend && uv run pytest'
scripts/with-test-lock.sh bash -c 'cd frontend/admin && pnpm run test'     # vitest only
scripts/with-test-lock.sh bash -c 'cd frontend/admin && npm run test:all'  # vitest + playwright (admin's test:all)

# LIGHT — no lock
cd backend && uv run pytest tests/test_foo.py        # single file
cd frontend/admin && pnpm test -- -t "test name"     # single test
```

The full orchestrated suite is `bash scripts/test-all.sh` — it self-acquires
the lock; never wrap it. (The root `pnpm test:all` is `turbo test:all`,
routing to admin's own `test:all` — NOT to `scripts/test-all.sh`.)

### Heavy-run lock (GH #472) — serialize heavy suites

Two heavy suites on one container CPU-starve each other into flaky timeouts.
Heavy entry points serialize on a machine-wide flock (`scripts/lib/test-lock.sh`):
the full suite self-acquires it, standalone heavy sets are launched through
the `scripts/with-test-lock.sh <command...>` wrapper.

**Heaviness is defined by the SET, not the invocation syntax.** The whole
suite is heavy however you spell it; a single file/spec is not:

| Heavy (under the lock) | Light (no lock) |
|---|---|
| `bash scripts/test-all.sh` — full run, lock is **self-acquired** (never wrap it) | single pytest file: `cd backend && uv run pytest tests/test_foo.py` |
| whole pytest: `scripts/with-test-lock.sh bash -c 'cd backend && uv run pytest'` | single vitest test: `cd frontend/admin && pnpm test -- -t "name"` |
| whole admin vitest: `scripts/with-test-lock.sh bash -c 'cd frontend/admin && pnpm run test'` | type-check / lint |
| admin vitest + playwright (`npm run test:all` in `frontend/admin` — NOT the root `test:all`): wrap the same way | standalone Playwright specs (investigation mode) |
| workspace sweep standalone: `scripts/with-test-lock.sh bash scripts/run-workspace-tests.sh` | |

Queue behavior: first try immediate; busy → a status line every
`MEMO_LOCK_POLL_S` (default 300 s), ceiling `MEMO_LOCK_WAIT_S` (default
3600 s) of actual wait → exit **75** («машина занята чужим тяжёлым прогоном
дольше 60 мин; перезапусти прогон позже»). Exit 75 ≠ test failure — rerun
later, don't debug. **The wrapper may WAIT (up to the ceiling) before the
command even starts — always launch it via PTY, never bash-with-timeout.**

Env seams: `MEMO_TEST_LOCK_PATH` (default
`/root/workspace/.memo-heavy-tests.lock`), `MEMO_LOCK_POLL_S`,
`MEMO_LOCK_WAIT_S`, `MEMO_TEST_LOCK_DISABLE=1` (bypass, one notice line —
also automatic when the lock dir is missing/not writable or `flock` is
absent; the notice is suppressed under real `CI=true`; the lock dir is never
created). A held run exports `MEMO_TEST_LOCK_HELD=1` — nested heavy calls
run through without re-acquiring.

**Session gate (fast suite) batch pattern:** ONE wrapper call for the whole
heavy batch beats per-command wrapping — no re-queue between pytest and
vitest:

```bash
scripts/with-test-lock.sh bash -c '(cd backend && uv run pytest) && (cd frontend/admin && pnpm run test)'
```

Per-command wrapping is also valid — it just serializes pytest→vitest inside
the session (+1–3 min). Lint/type-check stay outside the lock.

Not the seed lock: `test-all.sh` separately holds a short best-effort mkdir
lock around master-DB seeding (`${TMPDIR:-/tmp}/memo-testall-master-seed.lock`,
#317 §8) — a deliberately different idiom (short & soft vs strict & queued
for the whole run); do not unify.

### Reading PTY output
```python
# Read all output
pty_read(id="pty_xxx")

# Read with filter
pty_read(id="pty_xxx", pattern="FAIL|ERROR")

# Read last N lines (offset = totalLines - N)
pty_read(id="pty_xxx", offset=600, limit=100)
```

### Suite durations — SLA for the tester's timeout cap

The tester's timeout cap on a suite = `max(30 min, 2 × expected duration)`, where "expected" is
the table's WORST case, not the idle number — under concurrent suites a run slows down, and a
cap sized from the idle time kills a legitimate run (the timeout then masquerades as a test
failure). Keep this table updated after each run so legitimately long suites are never killed
by the cap:

| Suite | Command | Expected duration | Notes |
|---|---|---|---|
| Backend full (pytest) | `cd backend && uv run pytest` | ~30-40 min | 2026-09 observations: ~29 min under concurrent suites (#338 / PR #334), ~36 min idle (#382); the suite grows — re-measure after big waves; cap ≥ 1 h |
| Frontend unit (vitest) | `cd frontend/admin && pnpm run test` | ~1-3 min | |
| Frontend all (vitest + visual) | `cd frontend/admin && npm run test:all` | ~5-10 min | |
| E2E single/few specs (standalone) | `pnpm exec playwright test e2e/<spec>.ts` | ~2-5 min | + first-hit Next.js route compilation |
| E2E full suite (shard mode) | `bash scripts/test-all.sh` | ~15-30 min | 2 shards, 4 dynamic ports from the 28000-32700 window (run-tagged; see §3) |

Timings are estimates — update the table with measured values after full-suite runs; the cap is
2×, so a suite listed at 20 min gets a 40-min circuit-breaker, not a 30-min budget.
When several suites run on the same box at once (e.g. a full backend run plus vitest/e2e
shards), each runs slower than its idle number: size caps from the worst case and never treat
a slow-but-alive run as a hang (see the tester's stall probe). All rows except the standalone
spec are heavy sets — they serialize on the heavy lock (see "Heavy-run lock" above); the lock
queue time (up to 1 h) is NOT suite runtime, size the PTY/cap for the wait too.

### When PTY exits
- Process completes → `<pty_exited>` message arrives
- Check exit code: 0 = success, non-zero = failure
- Always verify exit code before proceeding

## Playwright E2E

### 1. Check before installing browsers — do NOT download blindly

Playwright browsers live in a GLOBAL cache at `~/.cache/ms-playwright/`, so they
survive across worktrees. A fresh worktree does NOT need a browser reinstall
(unless the playwright version bumped and needs a new chromium build).

**Before** running `npx playwright install`, verify the required browser exists:

```bash
cd frontend/admin && node -e "const{chromium}=require('@playwright/test');const fs=require('fs');const p=chromium.executablePath();console.log(fs.existsSync(p)?'BROWSER OK: '+p:'MISSING: '+p)"
```

- Prints `BROWSER OK: /root/.cache/ms-playwright/chromium-<build>/...` → ready, do nothing.
- Prints `MISSING: ...` → only THEN run `npx playwright install chromium`.

### 2. How E2E runs in this project

Two modes, controlled by the `SHARD_ID` env var (see `frontend/admin/playwright.config.ts`):

**Standalone mode** (`SHARD_ID` unset) — simplest for local single-spec runs:
- `baseURL` = `http://localhost:3002` (from `SHARD_PORT`, default `3002`).
- Playwright's `webServer` auto-starts `pnpm exec next dev -p 3002` with
  `reuseExistingServer: true` — so if a dev server is already on :3002 it reuses it,
  otherwise it starts one.
- The frontend still needs a BACKEND, and the backend URL is NOT defaulted:
  `e2e/lib/backend-url.ts` refuses a bare run unless BOTH `BACKEND_URL` and
  `NEXT_PUBLIC_API_URL` are exported with the SAME host (GH #387/#463 — a
  silent default could piggyback a foreign stack, and a `localhost` API
  origin against the `127.0.0.1` baseURL drops the SameSite=Lax session
  cookie). The full standalone recipe (stack + pinned run) is §4 below;
  canonical narrative: `docs/tests_workflow.md` ("How to run").

**Shard mode** (`SHARD_ID` set) — canonical CI/pre-push path via `scripts/test-all.sh`:
- Per-shard isolated stacks (`scripts/e2e-shard-start.sh`): per-shard SQLite DB
  (`test_memo_shard{N}.db`). CI runs 4 native shards on fixed ports (FastAPI
  :8001-8004, Next.js :3002-3005); a LOCAL `test-all.sh` run gets 2 shards with
  a 6-hex run tag + 4 dynamic ports from the 28000-32700 window (see §3).
- `webServer` config is SKIPPED (`...(process.env.SHARD_ID ? {} : {...})`);
  the shard stack pre-starts the server and Playwright connects to it.
- Run the whole suite: `bash scripts/test-all.sh` (it self-acquires the heavy lock — never wrap it; the root `pnpm test:all` routes through turbo to admin's `test:all`, not to `scripts/test-all.sh`).

### 3. Reusing an already-running stack — port ≠ identity

`reuseExistingServer: true` and "something listens on :3002/:3003" do NOT mean the
stack matches your run. A listening port is not identity — a leftover stack from a
different shard or an older config can silently serve wrong data (wrong DB, wrong
build dir). Before reusing a running stack, verify the owner process env:

```bash
# Find the owner PID, then inspect its environment
lsof -ti :3003                        # → PID
tr '\0' '\n' < /proc/<PID>/environ | grep -E '^(SHARD_ID|DATABASE_URL|NEXT_DIST_DIR)='
```

Check that `SHARD_ID`, `DATABASE_URL`, and `NEXT_DIST_DIR` match what YOUR run
expects (CI mapping: shard 1 → `test_memo_shard1.db`/:8001/:3002 … shard 4 →
`test_memo_shard4.db`/:8004/:3005). **When in any doubt — kill it and
start a fresh stack.** A 30-second restart is cheaper than debugging failures
caused by a stale stack.

This port check is for MANUAL stacks (standalone `:3002`, untagged
`e2e-shard-start.sh`). A `test-all.sh` run is identified by its run TAG, not
by ports (GH #317): ports are dynamic (28000-32700 window), so never guess
them — read the «тег/порты прогона» line the run printed at start
(`🏷 run tag: <tag> | shard 1 → front :P, back :P | shard 2 → … | logs: <dir>`)
or the lease file `/tmp/memo-shard-runs/<tag>.run`.

Starting a manual `e2e-shard-start.sh` NEXT to running test-all runs? Set your
own `SHARD_RUN_TAG` (6 lowercase hex, e.g. `SHARD_RUN_TAG=a1b2c3`): a tagged
stack writes a run lease, so parallel runs see it as alive and never touch its
ports or its tag-suffixed resources. Without a tag the stack holds no lease —
its untagged resources are protected only while the legacy ports
3002/3003/8001/8002 are busy (a test-all run finding them free wipes untagged
`.next-shard-*` dirs and shard DBs — conditional protection).

### 4. Run a SINGLE spec / a few specs locally (simplest reliable path)

Use standalone mode. Set the stack up ONCE per DB lifetime (redo after a week
rollover or a seed change), then run as many specs as you like:

```bash
# ── Stack (once per DB lifetime) ──────────────────────────────────────────
cd backend && rm -f test_memo.db test_memo.db-shm test_memo.db-wal
# new PTY, keep running — Alembic recreates the schema on boot:
ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn src.main:app --port 8000
# seed — EXPLICIT absolute DATABASE_URL (4 slashes): the seeder reads
# os.environ, not ENV_FILE, so a relative URL silently targets a wrong DB:
cd backend && DATABASE_URL="sqlite+aiosqlite:////$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed
# snapshot the canonical reset script (#310):
python3 scripts/gen_seed_canon.py backend/test_memo.db backend/test_memo.db.canon.sql

# ── Spec runs (repeatable) ─────────────────────────────────────────────────
# SHARD_PORT is REQUIRED and must be OFF the shard ports (3002/3003): the
# default :3002 belongs to shard 1, and a running full run would be silently
# reused (reuseExistingServer) with ITS baked API origin (GH #387).
# webServer auto-starts Next.js on the pinned port and reuses one already up.
cd frontend/admin && SHARD_PORT=3005 BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm exec playwright test e2e/<name>.spec.ts
```

Changed the API host between runs? Remove `frontend/admin/.next` first —
`NEXT_PUBLIC_API_URL` is baked into the bundle at compile time.

For the single `e2e` project: `pnpm exec playwright test --project=e2e --workers=1` (shard mode, pins come from the stack script); add `--shard=i/N` to limit the run to one native shard.

### 5. ALWAYS use PTY for E2E

E2E suites are long (Next.js compiles routes on first hit; full suite is minutes).
Run them via `pty_spawn`, never `bash`-with-timeout (see PTY rule above).

```python
pty_spawn(
    command="bash",
    args=["-c", "cd frontend/admin && SHARD_PORT=3005 BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm exec playwright test e2e/foo.spec.ts"],
    description="Run single E2E spec"
)
```

### 6. Visual snapshot regeneration

Visual baselines are recorded in the CI environment, never locally. Local
regeneration (`pnpm run test:e2e:update`) is for iteration ONLY — local PNGs
will pixel-diff on CI due to font/OS rendering drift.

**Canonical drill** (manual trigger; mirrors the CI shard-2 stack but runs the
WHOLE `e2e` project — no `--shard`):

1. Trigger the workflow: `gh workflow run update-snapshots.yml --ref <branch>`
   (`workflow_dispatch`, runs with `SHARD_ID=2` on `ubuntu-latest`).
2. Download the `updated-snapshots-e2e` artifact from the workflow run.
3. Copy the PNGs into `frontend/admin/e2e/**/*-snapshots/` (the spec's
   `-snapshots/` dirs).
4. Commit the new PNG files.

Local regeneration (step order: verify baseline dirs, run with
`--update-snapshots`) is acceptable ONLY for iterating on a visual test while
developing — do NOT commit locally recorded baselines as the final state.

`SHARD_ID` is from {1, 2, 3, 4} in CI (4 native shards of the single `e2e`
project) and {1, 2} in local `test-all.sh` runs.

**Full canon:** `docs/tests_workflow.md` ("Visual regression" + "Known
caveats" sections) is the single source of truth for snapshot provenance,
date stability, and why CI-only recording matters. This drill is a shortcut,
not a second canon.

### 7. Offline simulation: `setOffline` vs established SSE sockets

`context.setOffline(true)` blocks NEW requests but does NOT kill an
ESTABLISHED EventSource (SSE) socket (probe-verified on dev Chromium,
GH #330: 27s offline → zero `onerror` events — the "zombie channel" keeps
working). Asserting channel death after `setOffline` is vacuous. Same
for any established socket (WebSocket included; the app is SSE-only
today). When the scenario needs the channel DOWN, kill the connection
ESTABLISHMENT — cold-start abort registered BEFORE `page.goto`:

```ts
await ctx.route('**/api/v1/events', (r) => r.abort('connectionreset'));
```

The ES connect fails deterministically (`onerror`, `readyState 0`);
restore with `ctx.unroute(...)` → the reconnect fires `open`.
`navigator.onLine` stays TRUE — SPA navigation and plain fetches keep
working unless the abort pattern covers them.

`setOffline` is NOT banned: it is the right tool for offline HTTP traffic
(mutations/refetch — records.spec.ts S5), and it is per-context.

History: "route.abort does not reliably intercept EventSource" (#239
plan/spec §6) is about an ALREADY-ESTABLISHED socket; #330's plan S1/S2
`setOffline` recipe was superseded by the route.abort vehicle (PR #350).

## Git worktrees

```bash
# Create
git worktree add .worktrees/feat-name -b feat-name

# List
git worktree list

# Remove
git worktree remove .worktrees/feat-name
git branch -d feat-name
```

### Fresh worktree checklist

A fresh worktree has NO installed dependencies (node_modules, .venv are not
tracked by git). Before running tests, set up each side:

- [ ] **Backend** — install deps before pytest:
  `cd backend && uv sync --extra dev` (then `uv run pytest`)
- [ ] **Frontend** — enable corepack and install:
  `cd frontend/admin && corepack enable && pnpm install`
- [ ] **Playwright browsers** — do NOT reinstall blindly; the global cache at
  `~/.cache/ms-playwright/` survives across worktrees. Follow the
  "Check before installing browsers" section above.

## Quick checks

```bash
# Is backend running?
curl -s http://localhost:8000/api/v1/health

# Is admin running?
curl -s http://localhost:3001 > /dev/null && echo "Admin OK"

# Which port is in use?
lsof -i :8000
```
