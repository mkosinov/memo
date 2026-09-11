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
| **Full local suite (on demand)** | `pnpm test:all` (from repo root) | repo root | All of the above + visual compliance |
| Re-record visual baselines | `cd frontend/admin && pnpm run test:e2e:update` | `frontend/admin/` | Update visual regression baselines |

## Test environment

### Dev (interactive)
- Backend FastAPI on `:8000` (DB: `backend/memo.db`)
- Admin (Next.js) on `:3001` (when started with `--admin`)
- Started via `dev.sh`

### E2E (automated)
The full local suite (`pnpm test:all` via `scripts/test-all.sh`) uses **2 Playwright projects** (per `frontend/admin/playwright.config.ts`):
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

### Full (on demand)
- `pnpm test:all` (from repo root) — runs `scripts/test-all.sh` which orchestrates all stages in parallel
- Typical runtime: ~10-15 minutes
- Skip visual compliance: `VISUAL_COMPLIANCE=0 pnpm test:all`
- Sequential mode (debugging): `SEQUENTIAL=1 pnpm test:all`

### Pre-push hook
- Source: `scripts/git-hooks/pre-push`
- Installed by `pnpm install` (postinstall via `scripts/install-hooks.sh`, which is worktree-aware), but **disabled — a no-op** (`exit 0`)
- Local pre-push checking is done by the container harness at G7 (fast suite: backend pytest + vitest + type-check + lint — see `finishing-a-development-branch` skill); full local runs are on demand (`pnpm test:all`)
- Re-install manually: `bash scripts/install-hooks.sh`
- Skip once (moot while the hook is a no-op): `git push --no-verify`

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
- `frontend/admin/e2e/globalSetup.ts` runs once per Playwright run: it resets the DB via the same canonical `RESET_SQL` as the per-test reset (single source of truth — `e2e/fixtures/seed-reset.ts`), then runs the #152 seed-contract checks (seed rows present, current-week activities non-empty), logs the seeded admin in via the backend API and saves the session cookie as the shard-scoped `storageState` (`frontend/test-results/.auth/admin-${SHARD_ID ?? 'standalone'}.json`; GH #247 T14), and runs the standalone route warmup.
- **Auth storageState (GH #247 T14):** both Playwright projects start authenticated as admin `+79990000001/admin12345`; the filename is shard-scoped via the shared `e2e/fixtures/auth-state.ts` helper (parallel shards have separate DBs — a foreign-DB token would mass-401), and `playwright.config.ts` pins the project default and the frontend `baseURL` to `http://127.0.0.1:{SHARD_PORT}` — pages and the API (`BACKEND_URL`) must be same-site for the HttpOnly SameSite=Lax `memo_session` cookie to flow (localhost would make every API fetch cross-site). Login-flow specs opt out with `test.use({ storageState: { cookies: [], origins: [] } })` — `undefined` does NOT override a project default. `RESET_SQL` deliberately never touches `users`/`sessions`, so the storageState session survives the per-test reset. Logout specs must establish their OWN session (API login + `context.addCookies`) — revoking the shard's stored token bounces every later spec to `/login`.
- The old manual `cleanTestData()` helper is deleted (GH #252) — per-test cleaning is now automatic, see below.

### Per-test seed reset (GH #252)

Every e2e test now starts from canonical seed state: the wrapper `test` (`e2e/fixtures/test.ts`) registers an auto test-scoped fixture that resets the DB **before every test, incl. retries** — nothing an earlier test (incl. a crashed one) left behind can leak into yours. This kills the shared-shard order-dependence flake class.

What a spec author must know:

- **Import `test` from `./fixtures/test` in every spec** (standing rule — grep check rides reviews; the wrapper re-exports `expect`). Importing from `@playwright/test` silently drops the reset. The reset runs `resetToSeed()` from `e2e/fixtures/seed-reset.ts` — ONE canonical `RESET_SQL`, shared verbatim with `globalSetup` (children-first DELETEs incl. visitors, prefix-filtered activities, `sort_order` CASE-restores, `PRAGMA busy_timeout`), so no drift is possible.
- **Never mutate or delete seed rows.** The reset deletes non-seed rows only — it does NOT restore seed rows (`seed.py` stays the single seed source). Untouchable: clients `c1–c5`, visitors `vis1–vis10`, records `r1–r6`, visits `v1–v10`, payments `p1–p6`, activities `ev_*`/`ev_fixed_*`, and the canonical `sort_order` of masters `m1–m5`/`m7` + locations `alpika`/`grand`/`p1389`. Build your own rows via `e2e/fixtures/factories.ts` (`createTestClient`, `createTestRecord`, `createTestVisit`, …); clean them up records-before-clients.
- **Reset does NOT heal corrupted seed rows.** Crashed/leaked non-seed data self-heals on the next reset, but a mutated/deleted seed row needs a reseed. From the repo root:
  ```bash
  rm backend/test_memo.db
  cd backend && DATABASE_URL="sqlite+aiosqlite:///$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed
  ```
  The next `test-all.sh` run re-copies the reseeded master to both shard DBs.
- **Local runs are serial.** `workers: 1` is pinned in `playwright.config.ts` (CI was already serial) and the fixture throws a labeled error when `workers > 1` — an accidental parallel override fails loudly instead of silently reintroducing reset races.
- **Retries snapshot the DB first.** When a test is retried (`testInfo.retry > 0`; CI sets `retries: 1`), the fixture saves a consistent pre-reset copy (`db-before-reset.sqlite`) into the test's output dir — the crashed state survives the reset as failure evidence.

## CI vs local

**Trigger scheme** (details in [the CI-triggers spec](specs/2026-09-07-ci-triggers-and-gates-split-design.md)):
- CI (`test.yml`) runs the full suite on `pull_request` + manual `workflow_dispatch` — pushes to main (incl. merges) start **nothing**; docs-only pushes run zero workflows.
- A newer commit pushed to an open PR cancels that PR's obsolete run (`concurrency` + `cancel-in-progress`); manual dispatches never cancel each other.
- Local pre-push checking is the G7 fast suite (see [Pre-push hook](#pre-push-hook) above), not the git hook. CI is the authoritative merge gate — especially for e2e.

**Key insight:** Tests should be reproducible locally before pushing. The G7 fast suite (backend pytest + vitest + type-check + lint) catches issues before CI; local e2e is an investigation tool, never a gate.

### Coverage map (test type × gate)

| Test type | G6 quality¹ | G4.5 visual² | G7 pre-push³ | CI Tests⁴ |
|---|---|---|---|---|
| backend unit | ✅ | — | ✅ | ✅ |
| backend api | ✅ | — | ✅ | ✅ |
| backend integration | ✅ | — | ✅ | ✅ |
| backend misc | ✅ | — | ✅ | ✅ |
| backend coverage (report) | — | — | — | ✅ |
| frontend vitest | ✅ | — | ✅ | ✅ (sharded — every file covered, no hand lists) |
| lint (ESLint, admin scope) | — | — | ✅ | ✅ (`frontend-checks`) |
| type-check (tsc, admin) | ~⁵ | — | ✅ | ✅ (`frontend-checks`) |
| e2e Playwright (2 shards) | — | — | forbidden⁶ | ✅ |
| visual compliance | ✅ (UI) | ✅ | — | ✅ (inside e2e) |

¹ G6: whole pytest / whole vitest by language; UI changes add playwright-visual (`test:all`). Mandatory only for Standard/Large tasks (review budget).
² G4.5: UI phases only, `visual-compliance-check.sh`, soft block.
³ G7: fast suite before every branch push. Policy, not mechanism — CI is the deterministic backstop.
⁴ CI Tests = `test.yml`: `pull_request` + `workflow_dispatch`; concurrency cancels obsolete PR runs, never dispatch runs.
⁵ Type-check is deliberately **not duplicated at G6**: its deterministic homes are the CI `frontend-checks` job and the G7 fast suite; frontend coders additionally keep `tsc --noEmit` green in their checklist.
⁶ Harness policy: local e2e is an investigation tool, never a gate; CI owns e2e.

In CI:
- `retries: 1` (vs 0 locally) — one automatic retry for flaky tests; a retry first snapshots the DB (see [Per-test seed reset](#per-test-seed-reset-gh-252))
- `workers: 1` everywhere (config-pinned since GH #252, not just CI) — per-test DB resets cannot race across workers; the fixture throws on `workers > 1`
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
