# GH #252 — Per-test seed reset for E2E (kill shared-DB order dependence)

> Rev 2 (2026-09-09): 5-reviewer panel findings folded — merged RESET_SQL (sort_order + visitors), PRAGMA busy_timeout for the live-backend regime, narrowed guarantee (seed-row mutations forbidden → S4), `cleanTestData` migration + removal, J1 workers-guard, J2 retry-snapshot, honest runtime numbers.

## 1. Context & Problem (what the evidence says, not what the issue assumed)

#252 was filed as: `unified-rows.spec.ts` is order-dependent on the shared shard DB, and there is no cleanup-order convention (records before clients). The live tree (scout recon at df0e205, panel-verified) corrects and extends this:

- **Shard topology**: 2 shards (`frontend/admin/playwright.config.ts:87-105`), one seeded SQLite DB per shard — `scripts/test-all.sh:139-179` wipes + reseeds the master DB and copies it to `backend/test_memo_shard{1,2}.db` before the stacks start. `globalSetup.ts:34-40` removes non-seed rows (children-first) **once per run**, then asserts the seed contract (#152 protection, `:56-79`). Nothing re-seeds or cleans *between* specs or tests: intra-run isolation rests entirely on per-spec cleanup discipline, which is enforced nowhere.
- **unified-rows.spec.ts (997 lines, 22 tests) is order-dependent internally**, not only via siblings: it deletes a seed visit on r2 (`:235`), patches a seed visitor name by direct SQL (`:115-117`), and adds visits/payments to seed r1 in tests 9a/11/13/14 (`:294-318`, `:442-474`, `:523-557`, `:561-586`) with no restore; 12+ tests read seed r1/r2/r3 directly. The standalone-flake lines cited in the issue are confirmed: `:47`, `:98`, `:150`, `:385`, `:400`.
- **The issue's fix location is wrong**: the records-before-clients cleanup from PR #251 lives in `client-phone-typeahead.spec.ts:26-37` (`cleanupClientAndRecords` with a DB re-check), not in `fixtures/helpers.ts` — the helpers.ts change in df0e205 is `phoneMaskDisplay`. Commit 6168367 does not exist on main (PR #251 was squash-merged as df0e205).
- **Two divergent cleanup-SQL variants already exist**: `globalSetup.ts:34-40` (length-based activities filter, no attribute restores) and `helpers.ts cleanTestData()` (prefix-based filter, stricter, plus `UPDATE masters/locations SET sort_order = CASE …` restores for dayview-column-reorder's permanent reorder writes). Callers of the latter: `visual-regression.spec.ts` (×3) and `week-view.spec.ts` (×4).
- **Audit beyond the issue**: `wave5-x-cards-blurred.spec.ts` creates data via factories and has no cleanup at all; unified-rows leaks its created activities. Every other spec cleans records→clients correctly — wave5 is the sole exception.
- **CI is already serial**: `--workers=1` is forced in `test.yml:198` (config: `workers: CI?1:undefined`, `playwright.config.ts:48`). Only local runs parallelize.
- **Backend DB regime**: WAL + `busy_timeout=5000` are set on every backend DBAPI connection (`backend/src/db/database.py` engine listener), but a raw `sqlite3` CLI subprocess gets neither — a lock-risk regime globalSetup never faced (it writes *before* the backend starts); per-test reset writes *while the backend is live*.

Root cause: one shared mutable DB per shard per run, with no reset boundary between tests. Hygiene conventions cannot fix this class of flake — they can only be violated. Mapping the issue's DoD onto this design: bullet 1 (3× standalone + shard green) is kept as-is; bullet 2 (enforced cleanup-order rule) is superseded by the reset guarantee (D5); bullet 3 (audit of other specs) is superseded by "full suite green under reset" — any hidden order-coupling turns RED and gets fixed (S4).

## 2. Locked decisions (G1a user-approved 2026-09-09; panel fixes folded same day)

- **D1 — Per-test reset, not per-group.** Reset is cheap SQL; a "group = one seed" boundary is bookkeeping we don't need. (At G1a the user chose infra-reset over full data-isolation and per-worker stacks; "cut tests into groups" was considered and dropped.)
- **D2 — Reset = clean-to-seed via ONE merged canonical SQL.** A single `RESET_SQL` merges both existing variants: children-first DELETEs of non-seed rows (payments → visits → records → activities → **visitors** → clients; the visitors DELETE is new — orphaned visitor rows accumulate today and are never cleaned anywhere), the *stricter* prefix-based activities filter from `cleanTestData`, and its `sort_order` CASE-restores for masters/locations. `globalSetup`, the wrapper fixture, and today's `cleanTestData` callers all consume this one module — drift becomes impossible, `cleanTestData` is deleted.
- **D3 — Honest guarantee, narrowed.** Reset guarantees: (a) non-seed rows created by any earlier test (including crashed ones) are invisible; (b) restorable attributes (masters/locations sort_order) are back to canonical; (c) orphaned non-seed visitors are removed. Reset does NOT restore edited or deleted **seed rows** (no TS-side re-seed — duplicating `seed.py` data invites drift). Therefore: **tests must not mutate or delete seed rows**; the known violators (the 5 seed-mutating unified-rows tests incl. the r2-visit DELETE and the scenario-5 visitor-name UPDATE) are rewritten to own data in S4. Any further seed-mutator found by the RED run joins that list.
- **D4 — `workers: 1` unconditionally** (`playwright.config.ts:48`). CI is already serial — no speed change there; local runs give up parallelism (with reset overhead, local e2e becomes noticeably slower — see runtime note in §3.1; accepted price). Playwright's docs prefer isolation over serial mode; we choose serial deliberately because per-worker isolation was rejected at G1a (variant W: port/process multiplication, shard-script rewrite). `fullyParallel: true` stays (inert at workers=1).
- **D5 — Delivery: wrapper `test` + fail-fast guard.** Playwright `test.extend` with an `auto: true` test-scoped fixture (the standard mechanism for cross-cutting per-test setup — config-level beforeEach does not exist in Playwright). All 45 spec files (all flat in `e2e/`) switch to `import { test, expect } from './fixtures/test'`. The fixture throws immediately if `testInfo.config.workers > 1` — an accidental `--workers=N` override fails loudly instead of silently reintroducing reset races.
- **D6 — No CI cleanup checker, no enforced cleanup-order rule.** Reset erases violations before any sibling can observe them; the issue's "rule enforced (helper and/or lint)" DoD is superseded. Existing per-spec cleanup calls stay where they are (harmless, good hygiene); globalSetup remains the boot-time safety net.
- **D7 — Forensics: retry-snapshot, then wipe.** A failed test's DB state is wiped by the next test's beforeEach — accepted, with one mitigation: on a retry attempt (`testInfo.retry > 0`) the fixture first saves a consistent DB snapshot (`sqlite3 <db> ".backup <testInfo.outputDir>/db-before-reset.sqlite"` — consistent under WAL) which Playwright attaches as a failure artifact. Traces/screenshots/videos remain the primary surface.
- **D8 — Reset failure = loud test failure.** If the reset SQL exhausts its lock-retry budget, the fixture throws and the test fails with a labeled error. Never skip-with-warning: a silently skipped reset is exactly the stale-state pollution this spec exists to kill. (Rejects the panel's "non-blocking skip" suggestion.)

## 3. Mechanism (binding)

### 3.1 Shared reset module
`frontend/admin/e2e/fixtures/seed-reset.ts`:
- exports `RESET_SQL` — the merged canonical statement:
  ```sql
  PRAGMA busy_timeout=5000;
  DELETE FROM payments  WHERE length(id) > 3;
  DELETE FROM visits     WHERE length(id) > 3;
  DELETE FROM records    WHERE length(id) > 3;
  DELETE FROM activities WHERE id NOT LIKE 'ev\_%' ESCAPE '\' AND id NOT LIKE 'ev_fixed_%';
  DELETE FROM visitors   WHERE length(id) > 5;
  DELETE FROM clients    WHERE length(id) > 3;
  UPDATE masters   SET sort_order = CASE id WHEN 'm1' THEN 0 WHEN 'm2' THEN 1 WHEN 'm3' THEN 2 WHEN 'm4' THEN 3 WHEN 'm5' THEN 4 WHEN 'm7' THEN 5 ELSE sort_order END WHERE id IN ('m1','m2','m3','m4','m5','m7');
  UPDATE locations SET sort_order = CASE id WHEN 'alpika' THEN 0 WHEN 'grand' THEN 1 WHEN 'p1389' THEN 2 ELSE sort_order END WHERE id IN ('alpika','grand','p1389');
  ```
  (sort_order CASE values copied verbatim from `helpers.ts cleanTestData()`; the `PRAGMA busy_timeout=5000` prefix gives the CLI subprocess the same lock patience as backend connections — the live-backend regime globalSetup never faced. Delete order is children-first incl. visitors **before** clients, respecting `visitors → clients` FK.)
- `resetToSeed()` — resolves the DB path **at call time** (same rules as `globalSetup.ts:23-27`: SHARD_ID → `test_memo_shard{id}.db`, else `TEST_DB_PATH`, else `test_memo.db`; never at module load) and executes RESET_SQL via the existing `sqliteExecWithRetry` (`fixtures/sqlite-exec.ts`).
- `snapshotDb(testInfo)` — `sqlite3 <db> ".backup …"` into `testInfo.outputDir` (D7).
- Runtime note (honest): ~300 tests × ~50–100 ms per CLI spawn ≈ **+15–30 s per run**; combined with local serial mode, local e2e gets noticeably slower. CI unchanged in shape (already serial). The plan measures the actual delta and records it in CHANGELOG.

### 3.2 Wrapper test fixture
`frontend/admin/e2e/fixtures/test.ts`:

```ts
import { test as base, expect } from '@playwright/test';
import { resetToSeed, snapshotDb } from './seed-reset';

export const test = base.extend<{ seedReset: void }>({   // test scope — runs before EVERY test, incl. retries
  seedReset: [async ({}, use, testInfo) => {
    if ((testInfo.config.workers ?? 1) > 1)
      throw new Error('[seed-reset] workers>1 is unsupported: reset races across workers (config pins workers: 1)');
    if (testInfo.retry > 0) await snapshotDb(testInfo);
    await resetToSeed();
    await use();
  }, { auto: true, scope: 'test' }],
});
export { expect };
```

Every spec file (all 45, all flat in `e2e/`): `import { test, expect } from './fixtures/test'` — identical relative path for every file. Retry semantics: the auto fixture re-runs on retries, so a retried test starts from canonical seed (intended). Serial/stateful `describe` chains that *intentionally* carry state are broken by design — they surface in the RED run and join the S4 rewrite list.

### 3.3 Config
`playwright.config.ts:48`: `workers: process.env.CI ? 1 : undefined` → `workers: 1`. No other config changes. (#246 touches the `expect.toHaveScreenshot` stylePath block in the same file — different lines, trivial merge; no ordering constraint between #246 and #252.)

### 3.4 globalSetup refactor
`globalSetup.ts` consumes `RESET_SQL` from the shared module (its inline SQL is deleted) and **retains both #152 seed-contract checks verbatim** — leftover-seed-rows assert and current-week-activities API assert — plus the standalone warmup. Boot-time behavior is otherwise unchanged.

### 3.5 cleanTestData migration
`helpers.ts cleanTestData()` is deleted; its callers (`visual-regression.spec.ts` ×3, `week-view.spec.ts` ×4) drop the manual calls — the auto fixture supersedes them (calling both would double-clean harmlessly, but the manual calls are dead weight). Any other file that registers Playwright hooks must import the wrapper `test` — the DoD grep covers specs AND `fixtures/`+`helpers/` (type-only imports of `expect`/`Page`/`Locator` from `@playwright/test` stay legitimate).

## 4. User Scenarios (each maps to an E2E check)

- **S1**: Dev runs unified-rows standalone (via `e2e-shard-start.sh`) with `--repeat-each=3` — stable green, no sibling pre-run needed. → standalone run ×3.
- **S2**: unified-rows inside the full shard-rest run is green 3× in a row regardless of sibling order or sibling leaks. → shard run ×3 (CI or `test-all.sh`).
- **S3**: A mutating test starts from canonical state: non-seed rows from earlier tests (incl. crashed ones) are invisible, sort_order is canonical. → delivered by the suite run itself; the previously order-coupled unified-rows test pairs are the live canary.
- **S4**: A test that secretly depended on sibling leftovers — or mutated seed rows (the 5 unified-rows seed-mutators incl. the r2-visit DELETE `:235` and the scenario-5 visitor UPDATE `:115-117`, plus anything the RED run adds) — turns RED once reset lands and is rewritten to create its own data; the final list is recorded. → migration task, RED→GREEN per fixed test.
- **S5**: Seed-only specs (schedule*, week-view, statuses-russian…) always render canonical state — sibling tails no longer distort what they see. → full suite green.

## 5. Out of scope / constraints (binding)

- No per-worker stacks or per-worker DBs (variant W rejected at G1a: port/process multiplication, shard-script rewrite, a new flake surface).
- No mass refactor of unified-rows (or any other spec) to factory-owned data — only the tests S4 exposes as order-coupled/seed-mutating get rewritten.
- No TS-side re-seed of seed rows (no duplication of `seed.py` data — D3's narrowed guarantee instead).
- No CI cleanup checker, no exempt lists, no warn-only mode (D6). No non-blocking reset-skip (D8).
- Seed generation, seed dates, and the #152 seed-contract checks: unchanged. Calendar-week rollover mid-run keeps today's behavior.
- Backend statefulness assumption: SQLAlchemy session per request (no cross-request cache layer today — #239 not yet implemented); the reset is therefore visible to subsequent requests. The RED run confirms this empirically; if a cache ever lands (#239), the reset design must be revisited alongside it.
- Visual-overlay determinism stays with #246 (different root cause).
- Local parallel e2e runs are not supported by design (D4/D5).

## 6. Definition of Done

- [ ] `seed-reset.ts` (merged RESET_SQL incl. PRAGMA busy_timeout + visitors + sort_order restores, call-time path resolution, `snapshotDb`) + wrapper `test` (workers-guard, retry-snapshot) live; globalSetup consumes RESET_SQL and keeps both #152 checks
- [ ] All 45 spec files import the wrapper test; grep-clean across specs AND fixtures/helpers: no Playwright test-hook registration outside the wrapper
- [ ] `cleanTestData()` deleted; visual-regression (×3) and week-view (×4) manual calls removed
- [ ] `workers: 1` pinned in `playwright.config.ts`
- [ ] S4 list (seed-mutators + order-coupled tests found by the first RED run) rewritten to own data; final list recorded in the plan/CHANGELOG
- [ ] unified-rows: standalone 3× green AND in-shard 3× green
- [ ] Full suite green ×3
- [ ] Runtime delta measured (before/after) and recorded in CHANGELOG
