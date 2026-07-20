# #152 Seed staleness + E2E harness resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Monday-Tuesday E2E shard blockage caused by stale seed activities on past calendar weeks; add fail-fast diagnostics so future degradation is caught in seconds, not 22 minutes.

**Architecture:** Wipe + reseed on every stack-up (`scripts/e2e-shard-start.sh` `rm -f` shard DB → backend alembic recreates schema → seed populates with current-week dates). Remove `_exists` guard from seed — seed assumes empty DB by contract, fails loud on UNIQUE violation if contract is violated. `globalSetup.ts` asserts the contract (seed data exists AND current week has activities) and aborts with diagnostic message before any test runs. `waitForScheduleReady` stays as UI-render-sync only, timeout reduced 60s → 10s (data validation lives in globalSetup, not here).

**Tech Stack:** Bash (`e2e-shard-start.sh`), Python (`seed.py`, SQLAlchemy async), Vitest + jsdom (`globalSetup.diagnostic.test.ts`), Playwright (existing schedule suites), pytest existing test_seed.py.

---

## Behavioral Delta

How this feature behaves for the developer running E2E tests, mapped to spec acceptance criteria:

- **US-1 (CI Monday run is green)** → Developer pushes on Monday morning. CI starts fresh shard stacks, seed populates `ev_*` activities for the current calendar week, all schedule E2E tests pass within normal time.
- **US-2 (Local Monday run is green)** → Developer runs `bash scripts/test-all.sh` locally on Monday morning. Both shards pass without any manual re-seed step. Same outcome as US-1, local path.
- **US-3 (Manual-run bypass fails fast with diagnostic)** → Developer runs `SHARD_ID=2 npx playwright test` directly (no shard script). Playwright globalSetup aborts within ~3 seconds with one message: "Test DB is stale — rerun `scripts/e2e-shard-start.sh` or `scripts/test-all.sh` to wipe + reseed." Total wasted time: 3s, not 22min.
- **US-4 (Rendering still synchronises normally)** → On happy paths (shard started via script, DB fresh, seed populated current week), `waitForScheduleReady` waits ≤10s for schedule page to render activity cards. Tests run as fast as before.
- **US-5 (Seed code is honest)** → Developer reading `seed.py` sees no `_exists`/skip idempotent guard. Module docstring states "seed assumes empty DB; SQLite UNIQUE violation is intended fail-loud diagnostic." Existing tests passing on empty in-memory DBs confirm no regression.

---

## File Map

- `scripts/e2e-shard-start.sh` — modified (Task 1). Adds `rm -f "$ABS_DB_PATH"` after variable resolution + path guard, before backend startup.
- `backend/src/seed/seed.py` — modified (Task 2). Removes `_exists()` function + all `if await _exists(...): continue` branches (14 occurrences). Updates module docstring to document empty-DB contract.
- `frontend/admin/e2e/globalSetup.ts` — modified (Task 3). Adds two diagnostic branches after existing UUID cleanup: (a) leftover seed rows (ev_*, r1-r6, etc.) trigger fail-loud throw with "rerun shard-start" message; (b) `/api/v1/activities?date_from=…&date_to=…` for current week returns empty array → throw with "seed did not populate current week" message. Both with 5×1s retry on transient 503.
- `frontend/admin/e2e/fixtures/helpers.ts` — modified (Task 4). `waitForScheduleReady` timeout: `60_000` → `10_000`. Comment updated to clarify "UI render sync, not data validation; data check is in globalSetup".
- New tests:
  - `scripts/e2e-shard-start.dryrun.test.sh` — new shell test (Task 1). Stubs `uv`/`pnpm` on PATH, invokes shard-start in dry-run (env vars set), asserts `.db` file absent before seed command runs.
  - `backend/tests/test_seed.py` — extended (Task 2). New test asserting that running `seed_data()` twice on the same DB raises `IntegrityError` (proves `_exists` is removed and UNIQUE contract works).
  - `frontend/admin/__tests__/globalSetup.diagnostic.test.ts` — new vitest (Task 3). Two RED tests: (a) mocks leftover seed rows → globalSetup throws; (b) mocks empty activities response → globalSetup throws. Verifies diagnostic messages.

---

## Task ordering and dependencies

```
T1 (shard-start rm -f) → T2 (seed _exists removal)
                       ↘
                         T3 (globalSetup diagnostic) → T4 (helper timeout)
```

- T1 must land first: establishes "empty DB on stack-up" contract that T2 relies on.
- T2 must land before T3: globalSetup's diagnostic depends on seed's fail-loud behavior being meaningful (otherwise UNIQUE failures in T2 mask diagnostic logic).
- T3 and T4 are independent but sequenced to keep one frontend-coder dispatch focused.
- All four are **small or trivial** except T3 (standard — diagnostic logic with retry + multiple throw conditions).

## Classifications

| Task | Tier | Review pipeline |
|------|------|------------------|
| T1 `rm -f` + path guard + shell test | Small | Spec only |
| T2 remove `_exists`, update docstring, add UNIQUE test | Small | Spec only |
| T3 globalSetup diagnostic with retry + 2 throw branches + vitest | Standard | Spec + quality |
| T4 `waitForScheduleReady` timeout 60→10s | Trivial | Architect spot-check |

---

## Task 1: shard-start `rm -f` + path guard

### Classification: small
### Required Docs

- Spec: `docs/specs/2026-07-20-seed-staleness-152-design.md` — items A, R-1, R-5 (guard), ADR-1
- `scripts/e2e-shard-start.sh` (full file) — current `set -euo pipefail`, `ABS_DB_PATH` resolution at ~line 55, cleanup `trap` setup

### Task Description

Modify `scripts/e2e-shard-start.sh` to remove the shard DB file before starting the backend, so alembic recreates the schema and seed populates with current-week dates.

**Specific changes:**

1. After `export DATABASE_URL="sqlite+aiosqlite:///$ABS_DB_PATH"` (around line 56 in current script) and BEFORE the `# ── Start FastAPI backend ──` section, insert:

   ```bash
   # #152: wipe shard DB so seed runs on an empty schema. alembic recreates
   # the schema on backend startup; seed then populates with current-week
   # dates. Without this, idempotent seed skip leaves ev_* on past weeks.
   # Guard: refuse to delete non-test DBs (e.g. dev memo.db).
   if [[ "$ABS_DB_PATH" != *"test_memo"* ]]; then
     echo "[shard-$SHARD_ID] ERROR: refusing to delete non-test DB: $ABS_DB_PATH" >&2
     echo "[shard-$SHARD_ID]        TEST_DB_PATH must contain 'test_memo' (e.g. backend/test_memo_shard1.db)" >&2
     exit 1
   fi
   rm -f "$ABS_DB_PATH"
   echo "[shard-$SHARD_ID] Wiped shard DB: $ABS_DB_PATH"
   ```

   Exact insertion point: between `echo "[shard-$SHARD_ID] Starting stack..."` (around line 57) and `# ── Start FastAPI backend ──` (around line 60).

2. No other changes to `e2e-shard-start.sh` — the seed invocation at line ~99 stays as is. It now runs on a freshly wiped DB (alembic recreated schema during backend startup).

### TDD steps

- [ ] **RED:** Write `scripts/e2e-shard-start.dryrun.test.sh` (new file, chmod +x) that:
  - Stubs `uv`, `pnpm`, `curl` on PATH via `mkdir -p /tmp/shard-stub && printf '#!/bin/sh\nexit 0\n' > /tmp/shard-stub/uv && ... ; chmod +x /tmp/shard-stub/*`. The `curl` stub is needed to short-circuit the backend-ready wait loop (it issues `curl ... --max-time 10` up to 60 times); without stubbing curl, the success-path test hangs ≥60s.
  - The `uv` stub is special — its body reads the state of the target DB and prints "FILE_ABSENT" if the file does not exist OR "FILE_PRESENT: <contents>" if it does, then exits 0. This intercepts the `uv run uvicorn ...` call site after the wipe and reports whether the wipe happened.
  - Creates a fake DB file at `$FAKE_DB_PATH` (containing text "old data")
  - **Runs `e2e-shard-start.sh` as a subprocess** (NOT `source` — the script uses `set -euo pipefail` + `exit 1` in guards, so sourcing would terminate the test shell). Use: `bash scripts/e2e-shard-start.sh > /tmp/shard-run.log 2>&1 ; echo "EXIT=$?" >> /tmp/shard-run.log`. Then read the log and assert.
  - Also wrap the subprocess in `timeout 10` to bound test runtime: `timeout 10 bash scripts/e2e-shard-start.sh > /tmp/shard-run.log 2>&1 || true` — the test must terminate even if curl stub is wrong.
  - Asserts log output contains "FILE_ABSENT" (RED before fix: stub sees the file because `rm -f` not yet added; GREEN after fix).
  - Asserts guard rejects a non-test path: set `TEST_DB_PATH="/tmp/memo.db"` (no `test_memo` substring), run the subprocess (also timeout 10), expect non-zero exit code AND log contains "refusing to delete non-test DB".
- [ ] Run: `bash scripts/e2e-shard-start.dryrun.test.sh` — RED (assertion fails because no `rm -f` yet, so log contains "FILE_PRESENT").
- [ ] **GREEN:** Apply changes 1+2 above to `scripts/e2e-shard-start.sh`.
- [ ] Run: `bash scripts/e2e-shard-start.dryrun.test.sh` — GREEN (stubs see FILE_ABSENT; guard rejects non-test path).
- [ ] Verify no real stack run regression (optional, manual): `SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 TEST_DB_PATH=backend/test_memo_shard1.db BACKEND_URL=http://127.0.0.1:8001 NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 bash scripts/e2e-shard-start.sh` — start stack, confirm fresh DB created. Kill after warmup.
- [ ] Commit: `fix(#152): wipe shard DB before seed in e2e-shard-start.sh + path guard`

### DoD

- `scripts/e2e-shard-start.dryrun.test.sh` passes (file-absent assertion + guard rejection).
- `e2e-shard-start.sh` shows "Wiped shard DB" log line on real run; seed creates `ev_*` with current-week dates.
- No regression: shard-rest and shard-schedule E2E that were already passing still pass (verified via `bash scripts/test-all.sh` once the full plan lands — final verification at end of plan).

---

## Task 2: seed.py remove `_exists` + update docstring

### Classification: small
### Required Docs

- Spec: `docs/specs/2026-07-20-seed-staleness-152-design.md` — items D, R-3 (fail-loud = feature), ADR-1
- `backend/src/seed/seed.py` (full file, 551 lines) — particularly:
  - `_exists()` definition at lines 175-178
  - 13 call sites (excluding the definition): lines 195, 209, 245, 282, 290, 315, 343, 361, 375, 393, 407, 473, 499 (each in `if not await _exists(...)` or `if await _exists(...)` pattern). Plus the definition at line 175, making 14 total references to the name `_exists`.
  - Module docstring at lines 1-7
  - `seed_data()` function docstring around line 510 (currently: "Idempotent — safe to run multiple times" — MUST also be updated, see Step 5 below)
- `backend/tests/test_seed.py` (423 lines) — existing pattern: uses `DBManager("sqlite+aiosqlite:///:memory:")` fixture, calls `seed_data()`, asserts row counts. Use this pattern for new test.

### Task Description

Remove the idempotent guard from `seed.py`, establishing the "seed assumes empty DB" contract backed by Task 1's wipe and alembic's schema creation. Fail-loud on UNIQUE violation is intended diagnostic.

**Specific changes:**

1. Delete the `_exists` helper function (lines 175-178):

   ```python
   async def _exists(session, model, id_value: str) -> bool:
       """Return True if a row with the given primary key exists."""
       result = await session.execute(select(model).where(model.id == id_value))
       return result.scalar_one_or_none() is not None
   ```

2. Remove the `from sqlalchemy import select` import at line 15 ONLY if zero `select(...)` uses remain after step 1. **Verified:** the three join-table existence checks at lines ~425, 446, 481 (in `_seed_service_tags`, `_seed_activity_tags`, `_seed_photos`) use `select(service_tags).where(...)`, `select(activity_tags).where(...)`, `select(photo_tags).where(...)` patterns and DO depend on `select`. **Keep the `from sqlalchemy import select` import — confirmed by spec-reviewer, see `grep -n "select(" backend/src/seed/seed.py` (4 hits: 1 in `_exists` (deleted by step 1) + 3 in join-table checks (retained)). Step 2 of the plan effectively becomes a no-op — leave it documented for the implementer that the import must NOT be removed.

3. Remove every `if not await _exists(session, Model, id):` guard in the 13 PK-based seed functions (`_seed_masters`, `_seed_locations`, `_seed_services`, `_seed_tariffs`, `_seed_tags`, `_seed_activities_for`, `_seed_clients`, `_seed_visitors`, `_seed_records`, `_seed_visits`, `_seed_payments`, `_seed_photos`, `_seed_materials`). The pattern is consistently:

   ```python
   for x in collection:
       if not await _exists(session, Model, x["id"]):
           session.add(Model(**x))
   ```

   Replace with:

   ```python
   for x in collection:
       session.add(Model(**x))
   ```

   For `_seed_activities_for` (line 311-316), the pattern is slightly different:

   ```python
   for day, master, start_h, dur_h, svc_name, loc, cap, is_priv in activities:
       activity_id = f"{id_prefix}_{idx}"
       idx += 1
       if await _exists(session, Activity, activity_id):
           continue
       ...
       session.add(Activity(...))
   ```

   Replace by removing the `if await _exists(...): continue` block entirely (3 lines):

   ```python
   for day, master, start_h, dur_h, svc_name, loc, cap, is_priv in activities:
       activity_id = f"{id_prefix}_{idx}"
       idx += 1
       ...
       session.add(Activity(...))
   ```

4. Update module docstring (lines 1-7). Current:

   ```python
   """Seed script — populates the database with mock data for development.

   Usage:
       uv run python -m seed.seed          # direct module
       uv run python -m seed               # via __main__
       DATABASE_URL=sqlite+aiosqlite:///./memo.db uv run python -m seed
   """
   ```

   Replace with:

   ```python
   """Seed script — populates the database with mock data for development.

   Contract: seed assumes an EMPTY database. Running on a populated DB
   raises SQLAlchemy IntegrityError on the first duplicate primary key —
   this is intended fail-loud behaviour. Test stacks (`scripts/e2e-shard-start.sh`)
   wipe the DB file before starting the backend, so alembic recreates the
   schema and seed runs on empty.

   Usage:
       uv run python -m seed.seed          # direct module
       uv run python -m seed               # via __main__
       DATABASE_URL=sqlite+aiosqlite:///./memo.db uv run python -m seed
   """
   ```

5. **Also** update the `seed_data()` function docstring (around line 510):

   Current:
   ```python
   async def seed_data(manager: DBManager) -> None:
       """Seed the database with mock development data.

       Idempotent — safe to run multiple times.
       """
   ```

   Replace with:
   ```python
   async def seed_data(manager: DBManager) -> None:
       """Seed the database with mock development data.

       Contract: assumes an EMPTY database — see module docstring.
       Running on a populated DB raises IntegrityError (intended fail-loud).
       """
   ```

6. **Replace existing test `test_seed_is_idempotent`** at `backend/tests/test_seed.py:251-265`. The current test calls `seed_data()` twice and asserts no duplication — this asserted the old idempotency contract which T2 abolishes. After removing `_exists`, the second `seed_data()` call raises `IntegrityError`, so this test WILL FAIL if left in place. Replace the test with the new "raises on populated DB" assertion (per spec-reviewer Finding 1, CRITICAL):

   **Delete the existing test body:**
   ```python
   async def test_seed_is_idempotent(db_manager: DBManager) -> None:
       """Running seed twice does not duplicate data."""
       from src.seed.seed import seed_data

       await seed_data(db_manager)
       await seed_data(db_manager)

       async with db_manager.async_session() as session:
           result = await session.execute(text("SELECT COUNT(*) FROM masters"))
           assert result.scalar() == 6

           result = await session.execute(text("SELECT COUNT(*) FROM activities"))
           assert result.scalar() == 55
   ```

   **Replace with** the new test (note: TDD RED phase below uses this same assertion as the new test definition — so the RED phase actually replaces this test).

### TDD steps

- [ ] **RED:** In `backend/tests/test_seed.py`, **replace** the existing `test_seed_is_idempotent` test (at line 251-265) which currently asserts the OLD idempotency contract (calling `seed_data()` twice and asserting no duplication) with the new contract asserted below. **This test currently passes under code WITH `_exists`** because the guard skips duplicates on the second call; under T2 the new contract will REPLACE it (the old test WILL FAIL once `_exists` is removed, so deleting + replacing is mandatory, not optional):

   ```python
   async def test_seed_raises_on_populated_db(db_manager: DBManager) -> None:
       """Seed is NOT idempotent: running twice on the same DB raises IntegrityError.

       Contract: seed assumes empty DB (see module docstring). E2E test stacks
       wipe the DB before re-seeding. UNIQUE violation is the diagnostic.

       Replaces the old test_seed_is_idempotent which asserted skip-on-exists
       (a contract abolished in #152).
       """
       from src.seed.seed import seed_data
       from sqlalchemy.exc import IntegrityError

       await seed_data(db_manager)  # first run: OK on empty DB

       with pytest.raises(IntegrityError):
           await seed_data(db_manager)  # second run: raises on duplicate PK
   ```

   Delete the old `test_seed_is_idempotent` body entirely — it can no longer pass once `_exists` is removed.

- [ ] Run: `cd backend && uv run pytest tests/test_seed.py::test_seed_raises_on_populated_db -xvs` — RED status depends on current state:
   - If running before T2's `_exists` removal AND old test still in place: skip (the new test doesn't exist yet).
   - If running AFTER adding the new test but BEFORE removing `_exists`: the new test FAILS (seed does NOT raise because `_exists` skips duplicates — `with pytest.raises` block's "raised expected" assertion fails).
   - If running AFTER removing `_exists`: GREEN.
   - **Expected RED:** with new test added, old test deleted, but `_exists` removal NOT yet applied → run, expect FAIL.
- [ ] **GREEN:** Apply changes 1-6 above (delete `_exists`, remove 13 skip branches, update module + function docstrings). Run the same test — GREEN (UNIQUE raised on second `seed_data` call).
- [ ] Run full `backend/tests/test_seed.py` to ensure no regression: `cd backend && uv run pytest tests/test_seed.py -q` — all remaining tests green. Specifically verify:
   - `test_seed_populates_*` (count-based tests) — still green because they run seed once on empty DB
   - `test_seed_creates_fixed_week_activities`, `test_seed_fixed_week_dates_in_range` — still green
   - Any tests that previously depended on idempotency — now deleted or rewritten per change 6
- [ ] Run rest of backend to be safe: `cd backend && uv run pytest -q` — green.
- [ ] Commit: `fix(#152): remove idempotent _exists guard from seed; empty-DB contract`

### DoD

- New test `test_seed_raises_on_populated_db` passes (seed raises IntegrityError on second run).
- Old test `test_seed_is_idempotent` is **deleted** (no longer applicable to the new contract — see Step 6 above).
- All remaining `test_seed.py` tests pass (run once on empty in-memory DB — no impact from removing _exists).
- Module docstring AND `seed_data()` function docstring updated as shown in steps 4 and 5.
- `grep -n "_exists\|await _exists" backend/src/seed/seed.py` returns zero matches for the deleted function; only `select` join-table checks (lines currently at 424, 443, 479) remain — `from sqlalchemy import select` import KEPT.

---

## Task 3: globalSetup diagnostic — fail fast on stale or empty seed

### Classification: standard
### Required Docs

- Spec: `docs/specs/2026-07-20-seed-staleness-152-design.md` — items B, B' (two diagnostic branches), R-2 (API retry), ADR-2
- `frontend/admin/e2e/globalSetup.ts` (full file, 69 lines) — current structure: resolve dbPath → DELETE UUID rows (existing try/catch) → warmup routes (shard-only skip)
- `frontend/admin/__tests__/sqlite-exec.test.ts` — existing vitest pattern for mocking `child_process.execSync` and the `sqliteExecWithRetry` function
- `frontend/admin/__tests__/CalendarPopover.test.tsx` — vitest pattern for `vi.mock`, `vi.useFakeTimers`, `beforeEach`/`afterEach`
- Playwright docs: `page.clock`, `fetch` global. globalSetup runs in Node context — `fetch` is available globally.

### Task Description

Add two diagnostic branches to `frontend/admin/e2e/globalSetup.ts` after the existing UUID-cleanup block, asserting the "DB is fresh and seed populated current week" contract. Fail fast with diagnostic messages.

**Specific changes:**

1. After the existing UUID-cleanup `try { ... } catch (err) { ... }` block (around line 54, before the `if (!process.env.SHARD_ID) {` warmup block), insert:

   ```typescript
   // #152: diagnostic — assert seed contract before tests run. Two checks:
   // (a) reject if leftover seed rows exist (ev_*, r1-r6, etc.) — means the DB
   //     was not wiped + reseeded by scripts/e2e-shard-start.sh, likely a
   //     manual `npx playwright test` bypass. Abort with diagnostic.
   // (b) assert API returns ≥1 activity for the current week. Empty = seed
   //     did not populate (e.g., seed failure, week rollover against stale
   //     data, missing seed subprocess). Abort with diagnostic.

   // (a) Leftover seed rows check
   const SEED_PREFIXES = ["ev_", "ev_fixed_", "r", "v", "p"];
   let leftoverSeedRows = 0;
   try {
     const result = sqliteExecWithRetry(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM (SELECT 1 FROM activities WHERE id LIKE 'ev_%' OR id LIKE 'ev_fixed_%' UNION SELECT 1 FROM records WHERE id IN ('r1','r2','r3','r4','r5','r6') UNION SELECT 1 FROM visits WHERE id IN ('v1','v2','v3','v4','v5','v6','v7','v8','v9','v10') UNION SELECT 1 FROM payments WHERE id IN ('p1','p2','p3','p4','p5','p6'))"`);
     leftoverSeedRows = parseInt(result, 10) || 0;
   } catch (err: any) {
     const msg = String(err?.stderr || err?.message || '');
     if (msg.includes('no such table') || msg.includes('no such file')) {
       // DB missing → probably first run, shard-start hasn't run yet. Fail loud too.
       throw new Error(`[#152] Test DB not initialized at ${dbPath}. The shard stack was not started via scripts/e2e-shard-start.sh. Run \`bash scripts/test-all.sh\` (CI/local) or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\` (standalone), then retry playwright. Original error: ${msg.trim()}`);
     }
     throw err;
   }
   if (leftoverSeedRows === 0) {
     throw new Error(`[#152] Seed data is missing from ${dbPath}. Expected ev_*/ev_fixed_*/r1-r6/v1-v10/p1-p6 rows. The shard stack was not started via scripts/e2e-shard-start.sh (which wipes + reseeds the DB). Run \`bash scripts/test-all.sh\` or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\`, then retry playwright.`);
   }

   // (b) Current-week activities check (with 5×1s retry for 503 race)
   const port = process.env.SHARD_PORT || process.env.BACKEND_PORT || '8001';
   const today = new Date();
   const monday = new Date(today);
   monday.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Mon=0
   monday.setHours(0, 0, 0, 0);
   const sunday = new Date(monday);
   sunday.setDate(monday.getDate() + 6);
   sunday.setHours(23, 59, 59, 999);
   const fmt = (d: Date) => d.toISOString().slice(0, 10);
   const activitiesUrl = `http://localhost:${port}/api/v1/activities?date_from=${fmt(monday)}&date_to=${fmt(sunday)}`;

   let activitiesResponse: Response | null = null;
   let lastErr: any = null;
   for (let attempt = 0; attempt < 5; attempt++) {
     try {
       activitiesResponse = await fetch(activitiesUrl, { signal: AbortSignal.timeout(5000) });
       if (activitiesResponse.ok) break;
     } catch (err: any) {
       lastErr = err;
     }
     await new Promise(r => setTimeout(r, 1000));
   }

   if (!activitiesResponse || !activitiesResponse.ok) {
     throw new Error(`[#152] Backend /api/v1/activities not responding at ${activitiesUrl} after 5 retries. Last error: ${lastErr?.message || 'HTTP ' + activitiesResponse?.status}. Backend not started? Run \`bash scripts/test-all.sh\` to start the full stack.`);
   }
   const activitiesJson = await activitiesResponse.json() as any[];
   if (activitiesJson.length === 0) {
     throw new Error(`[#152] No activities for the current week (${fmt(monday)} to ${fmt(sunday)}) at ${dbPath}. Seed did not populate — likely a stale DB or calendar week rollover without re-seed. Run \`bash scripts/test-all.sh\` or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\` to wipe+reseed, then retry.`);
   }
   console.log(`[globalSetup] Seed contract verified: ${leftoverSeedRows} seed rows + ${activitiesJson.length} activities for current week.`);
   ```

2. No other changes to globalSetup.ts. The existing warmup block (`if (!process.env.SHARD_ID) { ... }`) stays after the new diagnostic; it runs as before on standalone mode.

### TDD steps

- [ ] **RED:** Create `frontend/admin/__tests__/globalSetup.diagnostic.test.ts`:

   ```typescript
   // @vitest-environment node
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

   vi.mock('../e2e/fixtures/sqlite-exec', () => ({
     sqliteExecWithRetry: vi.fn(),
   }));
   vi.mock('../e2e/fixtures/warmup-routes', () => ({ WARMUP_ROUTES: [] }));

   import { sqliteExecWithRetry } from '../e2e/fixtures/sqlite-exec';
   import globalSetupFunc from '../e2e/globalSetup';

   describe('globalSetup #152 diagnostics', () => {
     beforeEach(() => {
       vi.mocked(sqliteExecWithRetry).mockReset();
       // Avoid polluting env between tests
       vi.stubEnv('SHARD_ID', '2');
       vi.stubEnv('SHARD_PORT', '3003');
       vi.stubEnv('BACKEND_PORT', '8002');
       // Silence console
       vi.spyOn(console, 'log').mockImplementation(() => {});
       vi.spyOn(console, 'warn').mockImplementation(() => {});
       vi.spyOn(console, 'error').mockImplementation(() => {});
     });

     afterEach(() => {
       vi.unstubAllEnvs();
       vi.restoreAllMocks();
       vi.useRealTimers();
     });

     it('throws when seed rows are missing (manual-run bypass)', async () => {
       // First sqliteExecWithRetry call (UUID cleanup, current code) returns ''
       vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('');
       // Second sqliteExecWithRetry call (seed-rows check) returns '0'
       vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('0');

       await expect(globalSetupFunc()).rejects.toThrow(/Seed data is missing/);
     });

     it('throws when current-week activities API returns empty', async () => {
       vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('').mockReturnValueOnce('30'); // cleanup OK, seed rows present
       const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
         ok: true,
         json: async () => [],
       } as any);

       await expect(globalSetupFunc()).rejects.toThrow(/No activities for the current week/);
       expect(fetchMock).toHaveBeenCalled();
     });

     it('passes when seed rows present and activities API non-empty', async () => {
       vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('').mockReturnValueOnce('30');
       vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
         ok: true,
         json: async () => [{ id: 'ev_0' }],
       } as any);

       await expect(globalSetupFunc()).resolves.toBeUndefined();
     });
   });
   ```

- [ ] Run: `cd frontend/admin && npx vitest run __tests__/globalSetup.diagnostic.test.ts` — RED (current globalSetup has no diagnostic, no throws; tests asserting "rejects.toThrow" fail because globalSetupFunc does not throw).
- [ ] **GREEN:** Apply change 1 above to `globalSetup.ts`. Run the same test — GREEN.
- [ ] Run full vitest admin suite for regression: `cd frontend/admin && pnpm run test` — 0 new failures (baseline: known #123 CalendarPopover/Menubar flake may still flake).
- [ ] Run type-check: `cd frontend/admin && pnpm run type-check` — clean.
- [ ] Commit: `fix(#152): fail-fast diagnostics in globalSetup for stale DB + missing current-week activities`

### DoD

- New vitest `globalSetup.diagnostic.test.ts` passes all 3 assertions (3 tests, including happy path).
- Existing `sqlite-exec.test.ts` still passes (we didn't change `sqliteExecWithRetry`).
- Type-check clean.
- Manual smoke (optional, before final E2E run): set `SHARD_ID=2` and run globalSetup against a deliberately corrupted DB → confirm diagnostic message format. Skip if TDD sufficiently covers.

---

## Task 4: `waitForScheduleReady` timeout 60→10s

### Classification: trivial
### Required Docs

- Spec: `docs/specs/2026-07-20-seed-staleness-152-design.md` — item C, ADR-2
- `frontend/admin/e2e/fixtures/helpers.ts` (lines 106-110, the function body)

### Task Description

Reduce `waitForScheduleReady` timeout from 60s to 10s. This is now pure UI-render-sync — data validation moved to globalSetup (Task 3). 10s is plenty of headroom against CI CPU contention; if cards don't render in 10s something is genuinely broken, and fast failure is preferable to silent wait.

**Specific change:**

```typescript
// BEFORE (helpers.ts, lines 106-110):
export async function waitForScheduleReady(page: Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 60_000 });
}

// AFTER:
export async function waitForScheduleReady(page: Page) {
  await page.goto('/schedule');
  // 10s is UI-render-sync only — data validation (#152) lives in
  // globalSetup.ts (asserts /api/v1/activities non-empty before any
  // worker starts). If cards don't appear in 10s, the bug is real, not
  // a warmup race; fast failure is preferable to 60s of silence.
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 10_000 });
}
```

### Steps

- [ ] Apply the edit shown above (`60_000` → `10_000`, add 4-line comment).
- [ ] Spot-check: `grep -n "waitForScheduleReady\|timeout: 60_000\|timeout: 10_000" frontend/admin/e2e/fixtures/helpers.ts` — confirm exactly one change site for `waitForScheduleReady`; the other helpers (`waitForServicesReady`, `waitForLocationsReady`) keep their 60s timeouts (they're unchanged per spec).
- [ ] Commit: `fix(#152): waitForScheduleReady timeout 60→10s; UI sync only, data validation moved to globalSetup`

### DoD

- `waitForScheduleReady` uses `timeout: 10_000` with the explanatory comment.
- No new test for trivial timeout change (Architect spot-check per workflow §4d trivial pipeline).

---

## Final Verification (after all 4 tasks land)

Once all 4 tasks are complete on the feature branch:

1. **Backend regression:** `cd backend && uv run pytest -q` — all green (no `_exists` removal regressions).
2. **Frontend vitest:** `cd frontend/admin && pnpm run test` — 0 new failures (baseline: #123 may still flake).
3. **Type-check:** `cd frontend/admin && pnpm run type-check` — clean.
4. **Lint:** `pnpm run lint` — clean.
5. **Manual simulation of Monday scenario:**
   - Kill any running shard stacks on ports 8001-8002, 3002-3003.
   - Set system date to next Monday (or use real date if today is Sunday/Monday):
     `sudo date -s "next Monday"` (skip if not feasible; alternative: manually set `WEEK3_START` test value).
   - Run: `bash scripts/test-all.sh` — asserts full shard run passes the schedule suite.
   - Restore real date.
6. **Manual US-3 simulation:**
   - With shard-start NOT running (no backend on :8002), run: `SHARD_ID=2 SHARD_PORT=3003 BACKEND_PORT=8002 TEST_DB_PATH=backend/test_memo_shard2.db BACKEND_URL=http://127.0.0.1:8002 NEXT_PUBLIC_API_URL=http://127.0.0.1:8002 npx playwright test --project shard-rest`
   - Expect: playwright aborts within ~5s with `[#152]` prefix diagnostic. Approximately 5s instead of 22min.

---

## Self-Review

**Spec coverage** — every spec item maps to a task:

| Spec item | Task |
|-----------|------|
| A (rm -f shard DB + guard) | T1 |
| B (globalSetup diagnostic: leftover seed rows) | T3 (branch a) |
| B' (globalSetup diagnostic: empty current week) | T3 (branch b) |
| C (waitForScheduleReady 10s) | T4 |
| D (seed.py remove _exists) | T2 |
| E (cleanTestData unchanged) | none (defensive: confirmed "unchanged" by absence in tasks) |
| R-1 (path guard) | T1 inline |
| R-2 (API retry) | T3 inline (5×1s) |
| R-3 (fail-loud UNIQUE) | T2 RED test asserts IntegrityError raised |
| R-4 (visual baselines) | final verification — visual-regression.spec.ts unaffected; ev_fixed_* still created identically |
| R-5 (dev DB guard) | T1 inline (same guard as R-1) |
| ADR-1 (wipe vs update-in-place) | T1 chooses wipe |
| ADR-2 (globalSetup vs helper) | T3 chooses globalSetup |

**Placeholder scan:** no TBD, TODO, "implement later". All commands are concrete.

**Type/fn consistency:** `sqliteExecWithRetry` signature unchanged (TS test mocks it as `vi.fn()` returning string). `seed_data` signature unchanged. `globalSetup` default export signature unchanged (`() => Promise<void>`).

**Required Docs:** all 4 tasks have `### Required Docs` sections listing the spec + relevant source files.

**Scope check:** 1 plan, 4 tasks, 1 cohesive subsystem (test-infra resilience). No splitting needed.

**Classification re-check:**
- T1: 1 file, ~10 lines added, 1 new shell test. ✓ Small.
- T2: 1 file, ~15 line removals + docstring, 1 new test. ✓ Small.
- T3: 1 file, ~50 lines added, 1 new vitest with 3 cases. ✓ Standard (multiple logic branches, retry, API mock).
- T4: 1 file, 1 line change + 4-line comment. ✓ Trivial.

**Plan-execution estimate:** 4 sequential dispatches, each 3-6 minutes TDD cycle. Total impl time ~25-35 minutes including reviews.