# Test Workflow

> Brief overview of how tests are organized and run in this repo.
> For deep dives, see [CONTRIBUTING.md](../CONTRIBUTING.md) and the testing strategy specs.

## TL;DR

| Test type | Command | Working dir | What it tests |
|-----------|---------|-------------|---------------|
| Backend pytest | `cd backend && uv run pytest` | `backend/` | Backend API, models, services |
| Frontend unit (vitest) | `cd frontend/admin && pnpm test` | `frontend/admin/` | React components, hooks, contexts |
| Frontend e2e (Playwright) | `cd frontend/admin && pnpm test:e2e` | `frontend/admin/` | Full user flows in browser |
| Type check | `cd frontend/admin && pnpm type-check` | `frontend/admin/` | TypeScript validation |
| Lint | `pnpm lint` (from repo root) | repo root | ESLint via Turbo |
| **Full pre-push suite** | `pnpm test:all` (from repo root) | repo root | All of the above + visual compliance |
| Re-record visual baselines | `cd frontend/admin && pnpm run test:e2e:update` | `frontend/admin/` | Update visual regression baselines |

## Test environment

### Dev (interactive)
- Backend FastAPI on `:8000` (DB: `backend/memo.db`)
- Admin (Next.js) on `:3001` (when started with `--admin`)
- Started via `dev.sh`

### E2E (automated)
The pre-push hook uses **2 Playwright projects** (per `frontend/admin/playwright.config.ts`):
- `shard-schedule` (port 3002 / backend 8001) — services, schedule, records, activity-details-modal
- `shard-rest` (port 3003 / backend 8002) — everything else

Each shard stack is orchestrated by `scripts/test-all.sh`:
1. Master DB (`test_memo.db`) is seeded if missing or has <5 tables
2. Master DB is copied to per-shard DBs (`test_memo_shard{1,2}.db`)
3. Each shard's backend starts (uvicorn on `:8001` / `:8002`)
4. Backprop runs (maps API IDs to internal IDs) via shared `test_backprop.csv`
5. Each shard's frontend starts (Next.js on `:3002` / `:3003`)
6. Playwright runs with `reuseExistingServer: true` (skips the `webServer` config in shard mode — see the `SHARD_ID` conditional in `playwright.config.ts`)
7. Cleanup kills all background processes and removes shard DBs

Each shard's servers start via `scripts/e2e-shard-start.sh`:
- Sets `SHARD_ID`, `SHARD_PORT`, `BACKEND_PORT`, `TEST_DB_PATH`, `BACKEND_URL`, `NEXT_PUBLIC_API_URL`
- Backend starts in background, frontend in foreground
- Waits for backend health check (Alembic runs migrations automatically during startup)
- Seeds DB with test data (idempotent — skips if tables already exist)
- Waits for frontend to respond on its port

**reuseExistingServer pattern:** When `SHARD_ID` is set, `playwright.config.ts` omits the `webServer` block entirely. This avoids a Playwright edge case where `reuseExistingServer` health check fails under load, causing `EADDRINUSE` when Playwright tries to start a second Next.js on the same port.

**5-shard design (deferred):** The original `scripts/test-all.sh` was designed for 5 shards (services, schedule, records, clients, rest), but `playwright.config.ts` only declares 2. The 5-shard design spec lives in `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` and is deferred until the missing 3 projects are added to `playwright.config.ts`.

### DB conventions
- Backend tests use `:memory:` SQLite (per-fixture `DBManager`) — fast, isolated, no cleanup needed
- E2E tests use a shared `test_memo.db` master DB, copied to per-shard `test_memo_shard{1,2}.db`
- The master is re-seeded only if missing or has <5 tables (idempotent guard) — see `scripts/test-all.sh` for the exact check
- E2E tests query the DB directly via `frontend/admin/e2e/fixtures/db-query.ts` (uses `sqlite3` CLI on `TEST_DB_PATH`)

## How to run

### Quick (specific test type)
- Just backend: `cd backend && uv run pytest -k test_name -v`
- Just one frontend spec: `cd frontend/admin && pnpm exec playwright test spec_name.spec.ts`
- Just one vitest: `cd frontend/admin && pnpm test -- -t "test name"`
- Standalone Playwright (single server, not sharded):
  ```bash
  cd frontend/admin && pnpm exec playwright test --project=shard-rest
  ```
  This uses `webServer` in config to auto-start Next.js on `:3002` (reads `.env.test` defaults).

### Full (pre-push)
- `pnpm test:all` (from repo root) — runs `scripts/test-all.sh` which orchestrates all stages in parallel
- Typical runtime: ~10-15 minutes
- Skip visual compliance: `VISUAL_COMPLIANCE=0 pnpm test:all`
- Sequential mode (debugging): `SEQUENTIAL=1 pnpm test:all`

### Pre-push hook
- Source: `scripts/git-hooks/pre-push` → `scripts/test-all.sh`
- Auto-installed via `pnpm install` (postinstall)
- Re-install manually: `bash scripts/install-hooks.sh`
- Worktree-aware: uses `git rev-parse --show-toplevel` to find repo root
- Skip once (not recommended): `git push --no-verify`

### Parallelism in test-all.sh
The script runs stages concurrently using background processes and `wait`:

```
Backend pytest ───────────────┐
                              ├── wait for all
Lint + type-check + vitest ───┤   │
                              │   │
Playwright shard 1 (schedule) ─┤   │
Playwright shard 2 (rest) ─────┘   │
                                   │
Visual compliance (after all) ─────┘
```

- Backend pytest runs in parallel with frontend stages
- Lint, type-check, and vitest run in parallel with each other
- 2 Playwright shards run in parallel (each with its own server stack)
- Visual compliance runs last (needs admin dev server on `:3001`)
- 2 shards instead of 5 to avoid CPU contention on 4-core machines (5 parallel Next.js dev servers caused 30s+ page loads)

### Visual compliance check
- Script: `scripts/visual-compliance-check.sh`
- Loads each URL from `docs/specs/2026-06-19-current-user-scenarios.md` and checks for visual errors
- Runs after all other tests pass, against the running admin dev server on `:3001`
- URL for dev server can be overridden with `VISUAL_COMPLIANCE_URL`

## Visual regression

Visual regression tests use Playwright's `toHaveScreenshot` with committed PNG baselines.

**Baselines location:**
- `frontend/admin/e2e/week-view.spec.ts-snapshots/`
- `frontend/admin/e2e/visual-regression.spec.ts-snapshots/`
- `frontend/admin/e2e/wave6-status-snapshots.spec.ts-snapshots/`

**Update baselines when UI intentionally changes:**
- `cd frontend/admin && pnpm run test:e2e:update`
- Then commit the new PNG files

> **Note on baseline provenance:** All screenshot baselines in this repo
> (the snapshot directories listed above) are recorded in the CI environment
> via `.github/workflows/update-snapshots.yml`, deliberately — to avoid
> font/OS rendering drift between local and CI. This has a known consequence
> described under [Known caveats](#known-caveats) below.

**Date stability:**
- The 8 visual tests in `week-view.spec.ts` and `visual-regression.spec.ts` use `page.clock.install()` in `test.beforeEach` to mock browser time
- Combined with `WEEK_FIXED_START = datetime(2026, 6, 15)` in `seed.py`, this produces date-stable screenshots
- Baselines only need re-recording when the seed or UI intentionally changes, not when "today" rolls forward

## E2E test patterns

### `openModal()` / `openAddTab()` — date-independent
- `frontend/admin/e2e/fixtures/helpers.ts` exports `openModal` and `openAddTab`
- Both query the DB for the record's activity date via `resolveRecordDate()`
- Then navigate directly to that week via `navigateToWeek()` (uses `__memo-switch-to-week-view` event)
- **Source of truth is the DB**, not the wall clock — these helpers work regardless of when tests run

The flow:
1. `resolveRecordDate(recordId?)` runs raw SQL against the test DB:
   ```sql
   SELECT substr(a.start, 1, 10) AS d
   FROM records r
   JOIN activities a ON r.activity_id = a.id
   WHERE r.id = '...'
   ```
2. `navigateToWeek(page, date)` dispatches a custom DOM event:
   ```ts
   document.dispatchEvent(new CustomEvent('__memo-switch-to-week-view', { detail: { date } }));
   ```
3. Waits for `[data-testid^="activity-"]` to appear, then 300ms buffer

### `resolveRecordDate()` — DB as source of truth
- If no `recordId` given, finds the first active record (ORDER BY r.id ASC LIMIT 1)
- Returns ISO date string (`YYYY-MM-DD`) or `null`
- Used not only by `openModal`/`openAddTab` but also directly in tests that need to know "what week is this record in?"

### Direct DB queries
- Use `queryDBRow` / `queryDBRows` from `frontend/admin/e2e/fixtures/db-query.ts`
- Reads `TEST_DB_PATH` env var (set by `scripts/test-all.sh`)
- Polling pattern: `expect.poll(..., { timeout: 30_000, intervals: [200, 500, 1000] })`
- Known issue: some tests poll for DB writes after API success, and the writes aren't always visible to the `sqlite3` CLI (WAL mode race). These are tracked separately as flaky tests.

### Global setup / cleanup
- `frontend/admin/e2e/globalSetup.ts` runs before any Playwright test
- In shard mode (`SHARD_ID` set), it validates env vars and cleans stale test data
- `frontend/admin/e2e/fixtures/cleanTestData.ts` removes records created during tests to keep shard DBs idempotent across reruns

## CI vs local

The pre-push hook runs the same suite as local. CI on GitHub re-runs the same suite on push.

**Key insight:** Tests should be reproducible locally before pushing. The pre-push hook is designed to catch issues before CI.

In CI:
- `retries: 1` (vs 0 locally) — one automatic retry for flaky tests
- `workers: 1` (vs undefined locally) — sequential shard execution inside each project
- `forbidOnly: true` — `test.only` blocks CI from passing

## Known caveats

### Screenshot e2e can pixel-diff locally while CI is green

Screenshot-based e2e specs (`visual-regression.spec.ts`,
`wave6-status-snapshots.spec.ts`, the `toHaveScreenshot` part of
`visual-compliance-checks.spec.ts`, and the `week-view.spec.ts` snapshots)
use PNG baselines that were recorded **inside the CI runner** via
[`.github/workflows/update-snapshots.yml`](../.github/workflows/update-snapshots.yml).
This is intentional: rendering fonts/system UI depends on the host OS, and
recording baselines in CI keeps them consistent across machines.

Practical implications:

- **A local pixel-diff is not a code regression.** It is environment drift
  (different font metrics / OS subpixel rendering between your machine and
  the CI runner). Do not "fix" the code or re-record baselines locally to
  silence it.
- **CI is the source of truth for screenshot e2e.** If the `e2e-tests` jobs
  in `.github/workflows/test.yml` are green on `main` and on the PR, the
  visual specs are passing — full stop. Investigate other failure modes
  (logic, layout selector, etc.) before assuming a visual regression.
- **Re-recording baselines is a CI-only operation.** Always run
  `.github/workflows/update-snapshots.yml` to refresh snapshots; never run
  `pnpm run test:e2e:update` locally and commit the result. Local baselines
  will drift again on the next CI run.
- **Worktree runs amplify this.** Tests run in a fresh git worktree on a
  different host can show extra diffs; again, defer to CI.

Precedent: 2026-07-29 (IMPL #182) — 6 visual e2e failures appeared in a
local worktree run while the same commits' `e2e-tests` CI jobs on `main`
and the PR were green. Root cause was classified as environment drift,
not a code regression.

## See also

- `CONTRIBUTING.md` — local setup, pre-push hook, manual test commands
- `docs/specs/2026-06-19-testing-strategy-v2.md` — testing strategy (current)
- `docs/specs/2026-06-03-backend-testing.md` — backend testing handbook
- `docs/specs/2026-06-03-frontend-testing.md` — frontend testing handbook
- `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` — 5-shard design (deferred)
- `docs/specs/2026-06-18-optimize-backend-tests-design.md` — backend test perf optimization
- `.opencode/skills/dev-workflow/SKILL.md` — dev environment, ports, PTY rule
