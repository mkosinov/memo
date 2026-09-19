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

## Test Execution

### CRITICAL: PTY Rule for Long Tests

**NEVER** run long test suites via `bash` tool with timeout. Use **PTY** instead.

```python
# CORRECT — no timeout, can read output anytime
pty_spawn(
    command="bash",
    args=["-c", "cd frontend/admin && npm run test:all"],
    description="Run frontend tests"
)

# WRONG — will timeout at 120s
bash(command="cd frontend/admin && npm run test:all", timeout=300)
```

### Why PTY?
- bash tool kills process after timeout (default 120s, max 300s)
- Large test suites (400+ tests) take 5-10 minutes
- PTY runs indefinitely, you can read output anytime
- PTY can be killed manually when done

### Test commands

```bash
# Frontend (all)
cd frontend/admin && npm run test:all        # vitest + playwright visual
cd frontend/admin && pnpm run test            # vitest only

# Backend
cd backend && uv run pytest                   # all backend tests
cd backend && uv run pytest tests/test_foo.py # single file
```

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

The tester's timeout cap on a suite = `max(30 min, 2 × expected duration)`. Keep this table
updated after each run so legitimately long suites are never killed by the cap:

| Suite | Command | Expected duration | Notes |
|---|---|---|---|
| Backend full (pytest) | `cd backend && uv run pytest` | ~2-5 min | last observed: ~141s / 1138 tests |
| Frontend unit (vitest) | `cd frontend/admin && pnpm run test` | ~1-3 min | |
| Frontend all (vitest + visual) | `cd frontend/admin && npm run test:all` | ~5-10 min | |
| E2E single/few specs (standalone) | `pnpm exec playwright test e2e/<spec>.ts` | ~2-5 min | + first-hit Next.js route compilation |
| E2E full suite (shard mode) | `bash scripts/test-all.sh` | ~15-30 min | 2 shards, isolated stacks :8001-8002/:3002-3003 |

Timings are estimates — update the table with measured values after full-suite runs; the cap is
2×, so a suite listed at 20 min gets a 40-min circuit-breaker, not a 30-min budget.

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
- The frontend still needs a BACKEND. Standalone falls back to `.env.test`
  (backend :8000). Start the backend first: `cd backend && ENV_FILE=.env.test uv run uvicorn src.main:app --port 8000`.

**Shard mode** (`SHARD_ID` set) — canonical CI/pre-push path via `scripts/test-all.sh`:
- 2 isolated stacks (`scripts/e2e-shard-start.sh`): per-shard SQLite DB
  (`test_memo_shard{1,2}.db`), FastAPI :8001-8002, Next.js :3002-3003.
- `webServer` config is SKIPPED (`...(process.env.SHARD_ID ? {} : {...})`);
  the shard stack pre-starts the server and Playwright connects to it.
- Run the whole suite: `pnpm test:all` (or `bash scripts/test-all.sh`).

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
expects (see shard table above: shard 1 → `test_memo_shard1.db`/:8001/:3002,
shard 2 → `test_memo_shard2.db`/:8002/:3003). **When in any doubt — kill it and
start a fresh stack.** A 30-second restart is cheaper than debugging failures
caused by a stale stack.

### 4. Run a SINGLE spec / a few specs locally (simplest reliable path)

Use standalone mode. Start backend once, then let Playwright's webServer handle Next.js:

```bash
# terminal/PTY 1: backend on :8000 (leave running)
cd backend && ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn src.main:app --port 8000

# then run specs (webServer auto-starts Next.js on :3002, reuses if already up):
cd frontend/admin && pnpm exec playwright test e2e/<name>.spec.ts
cd frontend/admin && pnpm exec playwright test e2e/foo.spec.ts e2e/bar.spec.ts
cd frontend/admin && pnpm exec playwright test -g "test title substring"
```

For a specific shard project: `pnpm exec playwright test --project=shard-rest --workers=1`.

### 5. ALWAYS use PTY for E2E

E2E suites are long (Next.js compiles routes on first hit; full suite is minutes).
Run them via `pty_spawn`, never `bash`-with-timeout (see PTY rule above).

```python
pty_spawn(
    command="bash",
    args=["-c", "cd frontend/admin && pnpm exec playwright test e2e/foo.spec.ts"],
    description="Run single E2E spec"
)
```

### 6. Visual snapshot regeneration

Visual baselines are recorded in the CI environment, never locally. Local
regeneration (`pnpm run test:e2e:update`) is for iteration ONLY — local PNGs
will pixel-diff on CI due to font/OS rendering drift.

**Canonical drill** (manual trigger, shard 2 = `shard-rest` project):

1. Trigger the workflow: `gh workflow run update-snapshots.yml --ref <branch>`
   (`workflow_dispatch`, runs with `SHARD_ID=2` on `ubuntu-latest`).
2. Download the `updated-snapshots-shard-rest` artifact from the workflow run.
3. Copy the PNGs into `frontend/admin/e2e/**/*-snapshots/` (the spec's
   `-snapshots/` dirs).
4. Commit the new PNG files.

Local regeneration (step order: verify baseline dirs, run with
`--update-snapshots`) is acceptable ONLY for iterating on a visual test while
developing — do NOT commit locally recorded baselines as the final state.

`SHARD_ID` is always from {1, 2} (shard 1 = `shard-schedule`, shard 2 =
`shard-rest`).

**Full canon:** `docs/tests_workflow.md` ("Visual regression" + "Known
caveats" sections) is the single source of truth for snapshot provenance,
date stability, and why CI-only recording matters. This drill is a shortcut,
not a second canon.

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
