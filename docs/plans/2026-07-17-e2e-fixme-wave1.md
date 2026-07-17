# E2E fixme cleanup — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable 13 E2E tests that were disabled due to now-CLOSED blockers (#84, #127), restoring an honest green baseline with zero product-code changes.

**Architecture:** Pure un-disable. Convert `test.fixme(` → `test(` in 3 spec files, remove stale `#XXX` deferral comments. Verify in shard mode locally (parallelism-timing) before merge. No product code, no assertion changes — the diagnostic (frontend-coder ses_08ee2c379ffe) confirmed all 13 pass as-is.

**Tech Stack:** Playwright E2E, `frontend/admin/e2e/`, shard-mode via per-shard playwright projects.

---

## Behavioral Delta

How this behaves for the developer/CI relying on the suite (Wave 1 changes NO product behavior — it restores coverage that already passes):

- **US-1 (occupied count coverage)** → `occupied-calc.spec.ts` US-S03 now runs in CI instead of being skipped; a regression to the old "count of records" bug would turn CI red.
- **US-2 (capacity error coverage)** → `error-messages.spec.ts` "Недостаточно мест" now runs; a regression that swallows the capacity error is caught.
- **US-3 (clients CRUD coverage)** → 11 clients-page tests (create/view/edit/delete/search/modal/record-tab/status/payment/save/cancel) now run; clients-page regressions turn CI red instead of being silently skipped.
- **US-4 (honest green baseline)** → after this wave, "CI green" means these 13 flows are verified, not skipped.

---

## Task 1: Re-enable occupied-calc + error-messages (2 tests)

### Classification: small
### Required Docs
- `docs/specs/2026-07-17-e2e-fixme-wave1-design.md` — scope, IN/OUT lists, verification rule.
- `.opencode/skills/dev-workflow/SKILL.md` — how to run a single E2E spec (standalone mode, PTY rule).

### Task Description
Un-disable two self-contained tests whose blockers are CLOSED.

**File 1: `frontend/admin/e2e/occupied-calc.spec.ts`**
- Line 7: change `test.fixme(` → `test(`.
- Update the title: remove the trailing `— pending bug #84 fix` (bug #84 is CLOSED). New title:
  `'US-S03: occupied = sum of visits for active records (excludes cancelled)'`
- If there is a leading comment block above line 7 mentioning "pending bug #84" / "Marked fixme", delete it (it no longer applies). Keep any comment that documents WHAT the test verifies.

**File 2: `frontend/admin/e2e/error-messages.spec.ts`**
- Line 55: change `test.fixme(` → `test(`.
- Update the title: remove the `[deferred: activity card stale cache, see GH issue #XXX]` suffix. New title:
  `'full activity shows "Недостаточно мест" when creating a record'`
- Lines ~50-54: delete the stale comment block `// Tests in this file are temporarily marked as test.fixme due to // pre-existing flakes in the parallel-shard E2E setup. See GH issue // #XXX (to be filed separately) for the proper fix.` — it no longer applies (only one test was fixme'd and it now passes). Do NOT touch the 5 other tests in the file.

### Steps
- [ ] Edit `occupied-calc.spec.ts` line 7: `test.fixme(` → `test(`, clean title, remove stale #84 comment.
- [ ] Edit `error-messages.spec.ts` line 55: `test.fixme(` → `test(`, clean title; delete stale comment block at ~50-54.
- [ ] Run type-check: `cd frontend/admin && pnpm exec tsc --noEmit` → expect clean (no new errors).
- [ ] Run the two specs standalone (PTY — see dev-workflow). Start backend once:
      `cd backend && ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn src.main:app --port 8000`
      then:
      `cd frontend/admin && pnpm exec playwright test e2e/occupied-calc.spec.ts e2e/error-messages.spec.ts --workers=1`
- [ ] Expect: `occupied-calc` 1/1 pass, `error-messages` 6/6 pass, 0 failures.
- [ ] Commit: `git add -A && git commit -m "test(e2e): re-enable occupied-calc + error-messages (#121, blockers #84 closed)"`

### Definition of Done
- Both files: `test.fixme` → `test`, stale `#XXX`/`#84` comments removed.
- tsc clean.
- Standalone run: occupied-calc 1/1, error-messages 6/6, zero failures.
- US-1 (occupied) + US-2 (capacity error) E2E now execute and pass.
- Committed.

---

## Task 2: Re-enable clients cascade (11 tests)

### Classification: small
### Required Docs
- `docs/specs/2026-07-17-e2e-fixme-wave1-design.md` — scope, which clients tests are IN (all fixme) vs OUT (test 11 #125).
- `.opencode/skills/dev-workflow/SKILL.md` — single-spec E2E run.

### Task Description
Un-disable the 11 `test.fixme` tests in `frontend/admin/e2e/clients.spec.ts` (blocker #127 cache unification is CLOSED). Leave `test.skip(true, '... #125 ...')` at line 332 (test 11 status filter) ALONE — that is a real product bug, out of scope.

**File: `frontend/admin/e2e/clients.spec.ts`** — change `test.fixme(` → `test(` at these 11 lines, and strip the `[deferred: ... #XXX]` suffix from each title:
- L103 — `4. Create and view a new client`
- L138 — `5. Click row opens client card modal`
- L175 — `6. Edit client name and save`
- L227 — `7. Delete client via client card`
- L304 — `10. Search input filters client list`
- L359 — `12. Client card modal closes via backdrop click`
- L447 — `13. Record tab shows all fields`
- L498 — `14. Change visit status via dropdown`
- L526 — `15. Add payment to record`
- L557 — `16. Save button activates on change`
- L584 — `17. Cancel resets changes`

For each: title becomes just the leading `N. <description>` with the `[deferred: ...]` bracket removed. Example L103 title →
`'4. Create and view a new client'`.

Also delete the stale file-level comment block at ~L44 (`// Tests in this file are temporarily marked as test.fixme due to ...`) since after this task only test 11 (#125) remains skipped, tracked by a real issue — so the blanket "#XXX to be filed" comment is wrong. If test 11's own inline `test.skip(true, '... #125 ...')` reason is the only remaining disable, that is correctly documented in-line; no file-level comment needed.

**Do NOT touch:** line 332 `test.skip(true, '[flaky: status filter selector/timing, tracked in #125]')`, and tests 1/2/3/8/9 (never disabled).

### Steps
- [ ] Edit `clients.spec.ts`: 11× `test.fixme(` → `test(` at the lines above, strip `[deferred: ... #XXX]` from each title.
- [ ] Delete stale file-level comment block (~L44).
- [ ] Verify test 11 (L332 `test.skip(true, ... #125 ...)`) is UNCHANGED.
- [ ] Type-check: `cd frontend/admin && pnpm exec tsc --noEmit` → clean.
- [ ] Run standalone (backend already up from Task 1, else start it):
      `cd frontend/admin && pnpm exec playwright test e2e/clients.spec.ts --workers=1`
- [ ] Expect: 16 passed, 1 skipped (test 11), 0 failures.
- [ ] Commit: `git add -A && git commit -m "test(e2e): re-enable clients cascade 11 tests (#121, blocker #127 closed)"`

### Definition of Done
- 11 tests: `test.fixme` → `test`, `[deferred #XXX]` suffixes removed.
- Test 11 (#125) left skipped; tests 1/2/3/8/9 untouched.
- Stale file-level comment removed.
- tsc clean.
- Standalone: clients 16 passed / 1 skipped / 0 failed.
- US-3 (clients CRUD) E2E now execute and pass.
- Committed.

---

## Task 3: Shard-mode verification gate + issue hygiene

### Classification: small
### Required Docs
- `docs/specs/2026-07-17-e2e-fixme-wave1-design.md` — verification gate + fallback rule.
- `.opencode/skills/dev-workflow/SKILL.md` — shard mode (`SHARD_ID`, `scripts/test-all.sh`, per-shard playwright projects).

### Task Description
The diagnostic ran standalone. Run the 3 affected spec files in **shard mode** (parallel, per-shard DB) to catch parallelism-timing flakes before merge. This is the gate defined in the spec.

Run the affected specs under the shard stack. Simplest reliable path:
- Start the shard stack: `bash scripts/e2e-shard-start.sh` (or use `scripts/test-all.sh` scoped as configured).
- Run the 3 specs against a shard project, e.g.:
  `cd frontend/admin && SHARD_ID=1 pnpm exec playwright test e2e/occupied-calc.spec.ts e2e/error-messages.spec.ts e2e/clients.spec.ts --project=shard-rest --workers=1`
  (adjust project name to match `playwright.config.ts`; consult dev-workflow §2-3 for the exact shard invocation).

**Interpreting results:**
- **All 13 pass (0 flake):** gate PASS. Proceed.
- **Any test flakes** (passes solo, fails/flakes under shard): apply the spec's **fallback rule** — revert THAT specific test back to `test.fixme`, and replace its `#XXX` placeholder comment with a reference to a real GH issue describing the timing root cause. Report which test(s) were reverted so the architect files the issue.

**Issue hygiene (after gate PASS):**
- Report a summary for GH issue #121: 13 tests re-enabled (occupied-calc 1, error-messages 1, clients 11), blockers #84/#127 confirmed closed; ~27 disabled tests remain for future waves. The architect will post/update #121 (implementer does not touch GH).

### Steps
- [ ] Start shard stack (per dev-workflow §2). Confirm shard backends + Next.js are up.
- [ ] Run the 3 specs under a shard project with `--workers=1` per shard.
- [ ] Read results. Note any test that fails or only passes on retry.
- [ ] If a flake appears → revert that single test to `test.fixme` with a real-issue comment; commit `test(e2e): keep <test> fixme — shard flake, see #<n>`; report it.
- [ ] If all green → no code change; report the pass summary + the #121 update text for the architect.
- [ ] Kill shard stack / PTY sessions when done.

### Definition of Done
- 3 specs executed in shard mode.
- Either: all 13 green under shard (gate PASS), OR any flaky test reverted to fixme + real issue referenced + reported.
- Summary text for #121 returned to architect.
- No lingering shard/PTY processes.

---

## Self-Review

**Spec coverage:**
- Un-disable 13 tests (occupied 1 + error-messages 1 + clients 11) → Tasks 1+2. ✅
- No product-code changes → confirmed by diagnostic; tasks are edit-title-only. ✅
- Shard-mode verification gate + fallback rule → Task 3. ✅
- Issue hygiene (#121 update, #XXX cleanup) → Task 2 (remove #XXX comments) + Task 3 (report #121 text). ✅
- OUT-of-scope tests (test 11 #125, #124, column-mode, etc.) explicitly untouched → stated in Tasks 1-2. ✅

**Placeholder scan:** No TBD/TODO. `#XXX` referenced only as strings-to-remove. ✅

**Type consistency:** N/A (test-title edits only, no type signatures). ✅

**Required Docs check:** Each task has `### Required Docs`. ✅

**Classification realism:** All 3 tasks are `small` — pure test-marker edits + verification, no logic, single-file-family, <50 lines net. Task 3 has a conditional revert branch but still small. ✅
