# Design: #152 — Seed staleness after calendar week rollover + E2E harness resilience

**Date:** 2026-07-20
**Type:** test-infra fix (E2E harness + seed semantics)
**Issue:** #152
**Related:** #123 (date-dependence in vitest — resolved via `vi.setSystemTime`), #126 (standalone warmup), #148 (globalSetup refactor + sqliteExecWithRetry), #124 (openModal — shares seed infra)

## Problem

`backend/src/seed/seed.py:47` derives `WEEK3_START = _get_week_monday(today)` at seed startup. Seed is idempotent on existence: `if await _exists(session, model, id_value): continue` skips rows that already exist. After a calendar week rollover, `ev_*` activities stay on the week they were first inserted into. The schedule default view shows the current week → empty → `waitForScheduleReady` waits 60s × 22 tests → all E2E schedule tests timeout in `beforeEach` every Monday-Tuesday.

Two related problems compound this:

1. **`waitForScheduleReady` has a 60s timeout per test.** When activities are absent, each of 22 tests burns a full minute silently before failing — ~22 minutes of silence for one bad run, and the error message ("waitForSelector timeout") gives no hint about the root cause.
2. **Manual `npx playwright test` bypasses `scripts/e2e-shard-start.sh`** — there is no protective layer that catches this. Whoever skips the shard-start script inherits whatever state the test DB is in, including last week's seed.

## Scope (user-approved 2026-07-20)

Five coupled changes, all in test-infra (no production code touched):

| # | Change | File | Why |
|---|--------|------|-----|
| A | `rm -f` the shard DB file before starting the backend | `scripts/e2e-shard-start.sh` | Clean-DB contract per stack-up. Eliminates FK-order reasoning — alembic recreates schema, seed reinserts everything into an empty DB. |
| B | `globalSetup.ts`: fail fast with a diagnostic if seed-muck is still present OR if `/api/v1/activities?date_from=…&date_to=…` returns empty for the current week | `frontend/admin/e2e/globalSetup.ts` | Protects against the manual-run bypass. If someone runs `npx playwright test` without the shard script, globalSetup sees leftover seed rows or missing current-week activities and stops the run with a human-readable message, instead of letting 22 tests burn 22 minutes. |
| C | `waitForScheduleReady` timeout: 60s → 10s. Stays as UI-render-sync (waits for React to render activities the API already returned). **Not** a data validator — that role moves to `globalSetup` (item B). | `frontend/admin/e2e/fixtures/helpers.ts` | Render sync needs only a short headroom. Data validation moved to globalSetup. |
| D | `seed.py`: remove `_exists()` helper and all `if await _exists(...): continue` branches. Seed now assumes an empty DB (held by invariant A + the existing alembic-creates-schema contract). | `backend/src/seed/seed.py` | After A, seed always runs on an empty DB. The idempotent guard becomes dead code that misleads readers into thinking seed is safe to re-run on populated DBs. |
| E | `cleanTestData()` in `helpers.ts` is left unchanged. | `frontend/admin/e2e/fixtures/helpers.ts` | Still needed for isolation between tests in the same run (delete UUID-length rows before each `beforeEach`). The seed-level rows (`ev_*`, `r1-r6`, etc.) are NOT deleted by `cleanTestData` — they are supposed to outlive individual test runs within the same shard. |

**Pre-condition for A to work** (`rm -f` is safe): each shard has its OWN DB file (`test_memo_shard{id}.db`), never shared between shards or with the main `memo.db` dev DB. Confirmed via `playwright.config.ts:22-27`, `globalSetup.ts:23-27`, and `e2e-shard-start.sh` param `TEST_DB_PATH`.

## Architecture: who owns what

| Layer | Owner | responsibility |
|-------|-------|-----------------|
| Stack-up | `e2e-shard-start.sh` | remove shard DB file → start backend (alembic runs) → seed runs on empty DB → start frontend → warmup routes |
| Pre-test | `globalSetup.ts` (playwright hook, before any worker starts) | assert DB is clean (no leftover seed rows) + assert API returns ≥1 activity on current week. If either fails → throw with diagnostic message, abort the whole run. |
| Pre-each-test | `cleanTestData()` in `helpers.ts` (`beforeEach` inside suites) | wipe UUID-length test-created rows (payments → visits → records → activities → clients) so each test sees the seed baseline |
| UI-wait-per-test | `waitForScheduleReady(page)` (`beforeEach` of schedule suites) | wait for React to render activity cards on the schedule page. Timeout 10s. NOT a data validator. |

This separation makes each layer's invariant explicit:
- **Stack-up** guarantees "fresh DB, clean seed, current week populated".
- **globalSetup** asserts the above invariant; never restores it. Fail = abort.
- **beforeEach** keeps tests isolated from each other (UUID cleanup).
- **waitForScheduleReady** only waits for UI, never for data.

## User Scenarios

This is test-infra, not user-facing. The "user" is a developer running E2E tests. The scenarios describe developer-facing tasks that the change enables or protect:

- **US-1 — CI Monday run is green.** On Monday morning CI starts a new shard stack with the current date. Seed populates `ev_*` activities for the week that the browser considers "current". All schedule-suite tests pass within normal time. Ranked: acceptance criterion for #152.

- **US-2 — Local Monday run is green.** Same as US-1 but on a developer's machine after `bash scripts/test-all.sh`. No extra steps (no manual re-seed). Requires that `e2e-shard-start.sh` wipes the DB before starting up.

- **US-3 — Manual-run bypass fails fast with diagnostic.** Developer runs `SHARD_ID=2 npx playwright test` directly (skipping `e2e-shard-start.sh`), inheriting an old shard DB. globalSetup detects leftover seed rows OR empty current-week activities and aborts within ~3s with a message: "Test DB is stale — rerun `scripts/e2e-shard-start.sh` (or `scripts/test-all.sh`) to wipe + reseed." Total time wasted: 3s, not 22min.

- **US-4 — Rendering still synchronises normally.** When the invariant holds (shard started via script, DB fresh, seed populated current week), `waitForScheduleReady` waits ≤10s for the schedule page to render the activity cards. Tests run as fast as before on happy paths.

- **US-5 — Seed code is honest.** A developer reading `seed.py` sees no `_exists` guard and no "idempotent — safe to run multiple times" docstring. The invariant "seed always runs on an empty DB" is enforced by the stack-up contract (item A) and asserted by globalSetup (item B), not by defensive code inside seed itself.

## Visual Compliance Checks

Not applicable for #152 (test-infra only — no UI changes). Verification is behaviour/cost, not visuals.

## Out of scope

- **`page.clock.install` mock-time approach** for schedule tests — explored and rejected (see ADR-1). Could be revisited if CI runners ever drift the system clock far from today, but current CI uses real UTC and the current design handles the Monday rollover without mocking.
- **#123 date flakes in vitest** (CalendarPopover/Menubar) — different layer (unit, not E2E), already resolved.
- **#124 openModal wrong-activity** — separate issue, tracked separately. Could overlap visually on failure modes, but the root causes are distinct.
- **Improving the seed data itself** (e.g., adding more activities, reorganising `ev_*` vs `ev_fixed_*`). `ev_fixed_*` and its records `r1-r6`/visits/payments stay untouched — they back the visual regression baselines with `page.clock.install('2026-06-15')` in `visual-regression.spec.ts` and `week-view.spec.ts`.
- **Removing `ev_fixed_*` or merging it with `ev_*`.** Considered, rejected — FK from `r1-r6` read these IDs at test time and visual baselines hardcode the layout. Safe option: keep both seed sections; only `ev_*` (the current-week section) moves. `ev_fixed_*` is created in the same fresh-DB seed run and survives exactly as today.
- **Hardening seed itself against concurrent invocations** — not needed: shard-start invokes seed exactly once, single-process. No lock contention in scope.
- **Migrating `ev_*` to date-relative creation** (i.e., seed computes dates from a frozen reference date instead of `today`) — would solve US-1 but won't solve US-3 (manual-run bypass). The wipe-and-reseed approach handles both.

## Architecture Decision Records

### ADR-1 — wipe + reseed vs. update-in-place

Two options considered for the core fix:

- **Option 1 (rejected): update-in-place.** In `seed.py:_seed_activities_for`, for the `ev` prefix only, treat `_exists` as "update `.start` to match the new week" instead of "skip". Pros: minimal change, FK from UUID test-records stays safe (ID unchanged). Cons: leaves the misleading `_exists`/`continue` pattern in place; doesn't solve the manual-run bypass (a script-not-running scenario has no seed re-run at all); still requires the FK-order reasoning if anybody ever wipes just ev_*. Net: solves the symptom but not the broader hygiene.
- **Option 2 (chosen): wipe DB file + reseed.** `e2e-shard-start.sh` removes the shard DB file before starting the backend. Backend's alembic recreates the schema from scratch. Seed runs on an empty DB and inserts everything fresh with the current date. Pros: zero FK-order reasoning (DB is physically empty); all seed rows including `ev_fixed_*` get recreated deterministically; globalSetup can do a cheap presence-check rather than schema-aware reconciliation; the `_exists` guard in seed becomes dead code and can be removed (item D). Cons: requires the stack-up script to actually run (mitigated by item B diagnostic fail-fast); alembic re-runs on every stack-up (already the case — no new cost).

### ADR-2 — diagnostic in globalSetup vs. in waitForScheduleReady

Two options considered for the fail-fast diagnostic:

- **Option A (rejected): API-check inside `waitForScheduleReady`.** Each `beforeEach` schedules an API call before waiting for the selector. Pros: closest to the failing test; the first test that fails points exactly at the symptom. Cons: 22 redundant API calls; the check happens N times instead of once; harder to distinguish "UI is slow" from "data is missing" in a single helper.
- **Option B (chosen): API-check once in `globalSetup`.** Before any worker starts, globalSetup hits `/api/v1/activities?date_from=…&date_to=…` and asserts non-empty for the current week. If empty → throw with diagnostic → abort the whole run. Pros: single check, single message, aborts before any test runs. `waitForScheduleReady` is left as pure UI-sync with a short timeout (10s).

## Test Strategy

Each change gets a unit/integration test:

| Change | Test | Layer |
|--------|------|-------|
| A — `rm -f` in shard-start | Shell-level: invoke `bash scripts/e2e-shard-start.sh` with dry-run stubs for backend/frontend, assert `.db` file absent before seed runs. Use a faked `uv`/`pnpm` on PATH to avoid actually starting servers. | scripts |
| B — globalSetup diagnostic | Vitest unit test on `globalSetup.ts`: mock `sqliteExecWithRetry` to report "non-empty" (seed rows left) → assert globalSetup throws with specific message. Second test: mock `fetch` on `/api/v1/activities` to return `[]` → assert throw with specific message. | frontend |
| C — `waitForScheduleReady` 10s timeout | Update existing Playwright-config-driven tests. Verify happy path still passes within 10s on warm backend. Document the 10s choice in code comment. | frontend |
| D — `_exists` removed | Backend unit test: seed runs cleanly on a fresh DB → DB has all expected rows (activities, clients, records, etc.). Reuses existing seed sanity tests if present, otherwise adds one. | backend |
| E — cleanTestData unchanged | No new test — existing coverage suffices. | frontend |

**DoD:** all four new tests green (A—D), existing schedule E2E suite green on a Monday (manual simulation: set server date to Monday, run test-all.sh). Total CI overhead ≤ +3s per run from the extra globalSetup check.

## Risks

- **Risk R-1: shard-start `rm -f` could delete the main dev `memo.db` if shard-start is misused.** Mitigation: the script already resolves `TEST_DB_PATH` to `test_memo_shard{id}.db` and the env-var is required. Add an explicit guard before the `rm`: `if [[ "$ABS_DB_PATH" != *test_memo* ]]; then echo "refusing to delete non-test DB: $ABS_DB_PATH"; exit 1; fi`. This accepts only paths containing `test_memo` (covers `test_memo.db`, `test_memo_shard1.db`, `test_memo_shard2.db`) and rejects the dev `memo.db` and any custom path.
- **Risk R-2: globalSetup's API-check could race with backend warmup.** If the backend hasn't fully started yet, `/api/v1/activities` could return 503. Mitigation: retry the API call with the existing pattern (5 attempts × 1s sleep). If still failing → throw, since a 503 at globalSetup time means a bigger problem.
- **Risk R-3: removing `_exists` could break developers who manually run `python -m seed.seed` on a populated DB.** With the guard gone, SQLite will raise `UNIQUE constraint failed` on the first duplicate insert. This is **intended fail-loud behaviour** — not a regression. Mitigation: document the "seed must run on empty DB" contract in `seed.py` module docstring. The error from SQLite is itself the diagnostic ("UNIQUE constraint failed: activities.id\n  Expected empty DB; run shard-start or `rm -f` the DB first"). No soft warning is added — item D removes the skip, R-3 confirms we do not re-introduce it in another form.
- **Risk R-4: visual-regression baselines could shift if `ev_fixed_*` reconstruction is not byte-identical.** Mitigation: `WEEK_FIXED_START = datetime(2026, 6, 15)` is a literal, the `_ACTIVITIES_RAW_FIXED` table is in-memory in seed — recreated identically every run. Existing visual-regression tests cover this — any drift fails the visual gate.
- **Risk R-5: dev DB (`memo.db`) gets touched by accident via shard-start.** Mitigation: same guard as R-1 (path must contain `test_memo`). The env-var requirement is already in place and unchanged.