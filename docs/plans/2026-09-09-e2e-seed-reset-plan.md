# Plan: #252 — e2e per-test seed reset

## Goal
Kill the shared-DB order-dependence class of e2e flakes (#252): every e2e test starts from canonical seed state via a global auto-fixture reset; seed-mutating tests are rewritten to own data. Spec: `docs/specs/2026-09-09-e2e-seed-reset-design.md` (rev 2 — canonical).

## Architecture
- New `frontend/admin/e2e/fixtures/seed-reset.ts`: `RESET_SQL` (merged globalSetup + cleanTestData canon, PRAGMA busy_timeout prefix, visitors DELETE, sort_order CASE-restores), call-time DB-path resolution, `snapshotDb()`.
- New `frontend/admin/e2e/fixtures/test.ts`: wrapper `test` — auto test-scoped fixture: workers-guard → retry-snapshot → `resetToSeed()`.
- `globalSetup.ts` consumes RESET_SQL; both #152 seed-contract checks and warmup stay verbatim.
- `playwright.config.ts`: `workers: 1`.
- All 45 specs switch to the wrapper import; `cleanTestData()` deleted, its callers migrated.

## Tech Stack
TypeScript, Playwright Test (`test.extend` auto fixtures), sqlite3 CLI via the existing `sqliteExecWithRetry` wrapper. No new dependencies.

## Behavioral Delta
No UI changes — developer-observable behavior only:
1. e2e determinism: every test starts from canonical seed regardless of siblings, order, or crashes (spec S1–S3, S5).
2. Seed-row mutations by tests are forbidden; violators rewritten to factory-owned data (S4).
3. Local e2e runs become serial (`workers: 1`) plus reset overhead (~+15–30 s/run); CI shape unchanged (already serial).
4. `workers > 1` fails loudly with a labeled guard message instead of silently reintroducing races.
5. A retry attempt saves a DB snapshot (`db-before-reset.sqlite`) into test artifacts before resetting.
6. `helpers.cleanTestData()` disappears; visual-regression and week-view no longer clean manually.

## Task 1: seed-reset module + globalSetup refactor
### Classification: standard
### Required Docs
- Spec §3.1 (RESET_SQL verbatim incl. `PRAGMA busy_timeout=5000` prefix, call-time path resolution rules, `snapshotDb` via `sqlite3 "<db>" ".backup …"`), §3.4 (globalSetup keeps both #152 checks + warmup verbatim)
- `docs/tests_workflow.md` (shard start conventions)

Steps: create `fixtures/seed-reset.ts` — export `RESET_SQL` copied verbatim from spec §3.1 (sort_order CASE values are the live `helpers.ts` ones: masters m1–m5,m7 → 0–5; locations alpika/grand/p1389 → 0/1/2); `resetToSeed()` resolves the DB path at call time (SHARD_ID → `test_memo_shard{id}.db`, else `TEST_DB_PATH`, else `test_memo.db` — mirror of `globalSetup.ts:23-27`) and executes via `sqliteExecWithRetry`; `snapshotDb(testInfo)` runs `sqlite3 "<db>" ".backup '<testInfo.outputDir>/db-before-reset.sqlite'"`. Refactor `globalSetup.ts` to import RESET_SQL (inline SQL deleted; diff must show checks `:56-79` and warmup untouched).

Verify: `bash scripts/test-all.sh` boots both shards; globalSetup log shows «Seed contract verified»; after a run `sqlite3 backend/test_memo_shard1.db "SELECT COUNT(*) FROM clients WHERE length(id)>3"` → 0 (boot-state smoke — the per-test reset itself is proven by the Task 6 suite runs, not here).

## Task 2: wrapper test + workers:1 + all 45 spec imports
### Classification: standard
### Required Docs
- Spec §3.2 (wrapper code verbatim: guard `testInfo.config.workers > 1` → throw labeled error; `testInfo.retry > 0` → snapshotDb; then resetToSeed; `{ auto: true, scope: 'test' }`), §3.3 (workers line)

Steps: create `fixtures/test.ts` per spec §3.2; `playwright.config.ts:48` `workers: process.env.CI ? 1 : undefined` → `workers: 1`; switch the `test` import in all 45 `e2e/*.spec.ts` files from `@playwright/test` to `./fixtures/test` (all files are flat in `e2e/` — identical relative path everywhere; type-only imports of `expect`/`Page`/`Locator` elsewhere stay untouched). Batch-edit discipline: scripted replace with grep asserts after.

Verify: grep asserts — zero `import { test` … `from '@playwright/test'` left in `*.spec.ts`; exactly 45 spec files touched; `pnpm exec playwright test --list` resolves all files. Suite may be RED at this point — expected; the authoritative failure list is compiled in Task 4. Guard smoke: a `--workers=2` invocation fails with the guard message.

DoD: scenario S3 infrastructure live (every test starts from canonical state).

## Task 3: cleanTestData removal + caller migration
### Classification: small
### Required Docs
- Spec §3.5

Steps: delete `cleanTestData()` from `fixtures/helpers.ts`; remove its calls and imports — `visual-regression.spec.ts` (`:32`, `:84`, `:519`) and `week-view.spec.ts` (`:20`, `:35`, `:45`, `:59`). The auto fixture (Task 2) is a superset of what these calls did.

Verify: `grep -rn cleanTestData frontend/admin` → 0 hits; visual-regression and week-view pass standalone.

## Task 4: first RED run — compile the S4 list
### Classification: standard
### Required Docs
- Spec §2 D3 (narrowed guarantee: seed rows untouchable), §4 S4

Steps: run the full suite (`bash scripts/test-all.sh`) with the reset live; collect every failure caused by order-coupling or seed mutation; compile the authoritative S4 rewrite list. Known candidates: unified-rows seed-mutators (`:235` r2-visit DELETE, `:294-318` 9a, `:442-474` 11, `:523-557` 13, `:561-586` 14), scenario-5 direct `UPDATE visitors` (`:115-117`), any intentional serial/stateful describes found in the run. Record the final list (test → reason → fix sketch) in the CHANGELOG draft.

Verify: the list is finite, every entry references a failure trace.

DoD: scenario S4 RED evidence captured (the list).

## Task 5: rewrite S4 tests to factory-owned data
### Classification: large
### Required Docs
- Spec §4 S4, §2 D3; existing factories (`e2e/fixtures/factories.ts`: `createTestClient`, `createTestActivity`, `createTestRecord`, visit/payment factories)

Steps: per S4 entry — replace seed-row reads/mutations with factory-built data and assertions by own ids: the r2-visit DELETE test deletes its own visit; 9a/11/13/14 build their own record instead of seed r1; scenario-5's `UPDATE visitors` targets a factory visitor. Cleanup for the new data via the existing `finally` pattern (records-before-clients).

Verify/DoD: E2E test for scenario S4 passes — each rewritten test RED (on Task 4 state) → GREEN → refactor; `unified-rows.spec.ts` green standalone.

## Task 6: verification matrix + runtime delta + CHANGELOG
### Classification: standard
### Required Docs
- Spec §6 (DoD checklist), `docs/tests_workflow.md`

Steps (run in the container — host has no node_modules):
- S1: `SHARD_ID=1 SHARD_PORT=3002 BACKEND_PORT=8001 bash scripts/e2e-shard-start.sh` + `pnpm exec playwright test unified-rows --repeat-each=3` — 3 consecutive green standalone runs.
- S2 + S5: `bash scripts/test-all.sh` ×3 — unified-rows green inside shard-rest, full suite green.
- Runtime delta: time a full run before (pre-branch baseline) vs after; record in CHANGELOG.
- CHANGELOG entry: determinism guarantee, serial local runs, workers-guard, retry-snapshot, cleanTestData removal, runtime delta.

Verify: every checkbox of spec §6 ticked with evidence links.

DoD: E2E tests for scenarios S1, S2, S5 pass (3× green in each mode).

## Cross-task constraints
- Anchors are never renumbered after commit.
- #246 shares `playwright.config.ts` (stylePath block vs our workers line — different lines, trivial merge, no ordering constraint).
- #247 (auth IMPL) will add login e2e flows later: its new specs must import the wrapper `test` (grep check rides the review; the Task 2 grep assert is the standing rule).
- No domain-rules or design-system changes — this plan touches test infrastructure only.
