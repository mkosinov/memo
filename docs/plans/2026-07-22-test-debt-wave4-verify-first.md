# Wave 4 — Cond-skip Verify-First Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 8 obsolete cond-skip guards across 3 E2E spec files, verify CI green, close #161 + #162 + #124-cascade row.

**Architecture:** All 8 tests share a guard pattern `if (cond) { test.skip(...); return; }`. Prior waves (#124 Wave-1 openModal fix, #152 seed stability, #155 @transactional) addressed the root causes that made these guards fire. Removing the guards lets the tests execute; CI is the decisive arbiter.

**Tech Stack:** Playwright E2E (TypeScript), pnpm, GitHub Actions CI shards.

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **8 previously-skipped E2E tests now execute** → tests that were silently skipped now run and pass on CI, proving the UI flows work end-to-end
- **Wave 6 record-status scenarios 1-4** → editing visit status, adding payment, editing anonym_visits, and adding visitor all verified as functional flows
- **Wave 6 StatusPicker shared scenarios** → StatusPicker is confirmed present and consistent in the activity modal ClientTab
- **ActivityDetails settings update** → service_id change via select persists to DB
- **No product code changes** → only test files modified; zero risk to user-facing behavior

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/admin/e2e/wave6-record-status-derived.spec.ts` | Wave 6 Sc1-4 (record status from visits) | Remove 5 guard blocks |
| `frontend/admin/e2e/wave6-status-shared.spec.ts` | Wave 6 Sc5 (StatusPicker shared) | Remove 2 guard blocks |
| `frontend/admin/e2e/activity-details-modal.spec.ts` | ActivityDetails Sc4 (settings update) | Remove 1 guard block |

Total: 3 files, ~-32 lines (8 × 4-line guard blocks).

---

## Task 1: Remove 4 cond-skip guards in wave6-record-status-derived.spec.ts (#161)

### Classification: trivial
### Required Docs
- `docs/test-debt-inventory.md` — rows #26-29 (scenarios 1-4, #161)
- `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md` — design context

### Task Description

Remove 4 `if (clientTabs.count() === 0) { test.skip(...); return; }` guard blocks from scenarios 1-4 in `wave6-record-status-derived.spec.ts`.

The guards are at lines ~26-29, ~74-78, ~107-111, ~136-140. Each block is:
```typescript
    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    if ((await clientTabs.count()) === 0) {
      test.skip(true, 'No client records on schedule');
      return;
    }
```

Remove the `if`/`test.skip`/`return` lines (keep the `const clientTabs` locator line — it's used later: `await clientTabs.first().click()`). After removal, the code goes directly from locator to `clientTabs.first().click()`.

**Steps:**
- [ ] Read `frontend/admin/e2e/wave6-record-status-derived.spec.ts`
- [ ] Remove guard block at line ~26 (scenario 1, "No client records on schedule")
- [ ] Remove guard block at line ~74 (scenario 2, same)
- [ ] Remove guard block at line ~107 (scenario 3, same)
- [ ] Remove guard block at line ~136 (scenario 4, same)
- [ ] Verify `const clientTabs = page.locator(...)` line is preserved (used by `clientTabs.first().click()`)
- [ ] Verify no syntax errors: `cd frontend && npx tsc --noEmit`
- [ ] Commit: `git add frontend/admin/e2e/wave6-record-status-derived.spec.ts && git commit -m "test(#161): un-skip 4 wave6-record-status cond-skip guards (openModal fixed in #124 Wave-1)"`

### DoD
- 4 guard blocks removed, `const clientTabs` preserved
- tsc --noEmit passes
- Committed

---

## Task 2: Remove cond-skip guard in wave6-record-status-derived.spec.ts scenario 4 (#162)

### Classification: trivial
### Required Docs
- `docs/test-debt-inventory.md` — row #30 (scenario 4 "Add visitor button not found", #162)
- `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md` — design context

### Task Description

Remove the `if (addBtn.count() === 0) { test.skip(true, 'Add visitor button not found'); return; }` guard block at line ~150-154 in `wave6-record-status-derived.spec.ts`.

The guard is:
```typescript
    const addBtn = page.locator('[data-testid="btn-add-visitor"]');
    if ((await addBtn.count()) === 0) {
      test.skip(true, 'Add visitor button not found');
      return;
    }
    await addBtn.click();
```

Remove the `if`/`test.skip`/`return` lines. Keep `const addBtn` and `await addBtn.click()`. After removal, the test clicks the button directly (if button is missing, the test fails with a clear assertion — which is the desired behavior).

**Steps:**
- [ ] Remove guard block at line ~150 (scenario 4, "Add visitor button not found")
- [ ] Verify `const addBtn` and `await addBtn.click()` preserved
- [ ] Verify no syntax errors: `cd frontend && npx tsc --noEmit`
- [ ] Commit: `git add frontend/admin/e2e/wave6-record-status-derived.spec.ts && git commit -m "test(#162): un-skip 'Add visitor button not found' cond-skip guard (#124 Wave-1 fixed openModal)"`

### DoD
- Guard block removed, `const addBtn` + `addBtn.click()` preserved
- tsc --noEmit passes
- Committed

---

## Task 3: Remove 2 cond-skip guards in wave6-status-shared.spec.ts (#161)

### Classification: trivial
### Required Docs
- `docs/test-debt-inventory.md` — rows #31-32 (scenarios 5b/5d, #161)
- `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md` — design context

### Task Description

Remove 2 `if (clientTabs.count() === 0) { test.skip(...); return; }` guard blocks from `wave6-status-shared.spec.ts`.

Guard at line ~49-53 ("No client records on schedule"):
```typescript
    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    if ((await clientTabs.count()) === 0) {
      test.skip(true, 'No client records on schedule');
      return;
    }
```

Guard at line ~89-93 ("No client records"):
```typescript
    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    if ((await clientTabs.count()) === 0) {
      test.skip(true, 'No client records');
      return;
    }
```

Remove the `if`/`test.skip`/`return` lines in both blocks. Keep `const clientTabs` (used by `clientTabs.first().click()`).

**Steps:**
- [ ] Read `frontend/admin/e2e/wave6-status-shared.spec.ts`
- [ ] Remove guard block at line ~49 (Scenario 5: status in activity modal)
- [ ] Remove guard block at line ~89 (Scenario 5: DOM structure consistent)
- [ ] Verify `const clientTabs` preserved in both tests
- [ ] Verify no syntax errors: `cd frontend && npx tsc --noEmit`
- [ ] Commit: `git add frontend/admin/e2e/wave6-status-shared.spec.ts && git commit -m "test(#161): un-skip 2 wave6-status-shared cond-skip guards (openModal fixed in #124 Wave-1)"`

### DoD
- 2 guard blocks removed, `const clientTabs` preserved
- tsc --noEmit passes
- Committed

---

## Task 4: Remove cond-skip guard in activity-details-modal.spec.ts (#124 cascade)

### Classification: trivial
### Required Docs
- `docs/test-debt-inventory.md` — row #1 (cascade-#124)
- `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md` — design context

### Task Description

Remove the `if (!activity) { test.skip(); return; }` guard block at line ~218-221 in `activity-details-modal.spec.ts`.

The guard is:
```typescript
    const activity = await openModal(page);
    if (!activity) {
      test.skip();
      return;
    }
```

Remove the `if`/`test.skip`/`return` lines. Keep `const activity = await openModal(page)` (used later: `(activity as any).id`).

After #124 Wave-1 fix, `openModal()` (without recordId) now deterministically returns a non-null activity (DB lookup → navigate → scan). If it returns null, the test should fail loudly, not silently skip.

**Steps:**
- [ ] Read `frontend/admin/e2e/activity-details-modal.spec.ts`
- [ ] Remove guard block at line ~218 (scenario 4, bare `test.skip()`)
- [ ] Verify `const activity = await openModal(page)` preserved
- [ ] Verify no syntax errors: `cd frontend && npx tsc --noEmit`
- [ ] Commit: `git add frontend/admin/e2e/activity-details-modal.spec.ts && git commit -m "test(#124): un-skip activity-details-modal Sc4 cond-skip guard (openModal fixed in #124 Wave-1)"`

### DoD
- Guard block removed, `const activity` preserved
- tsc --noEmit passes
- Committed

---

## Task 5: Verify + finish

### Classification: trivial
### Required Docs
- Spec: `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md`

### Task Description

Final verification before push.

**Steps:**
- [ ] Run vitest: `cd frontend && npm run test` — expect 0 regressions (E2E tests not covered locally)
- [ ] Run type-check: `cd frontend && npx tsc --noEmit` — expect clean
- [ ] Verify all 8 guard blocks are removed: `grep -rn 'test.skip' frontend/admin/e2e/wave6-record-status-derived.spec.ts frontend/admin/e2e/wave6-status-shared.spec.ts frontend/admin/e2e/activity-details-modal.spec.ts` — expect NO cond-skip guards (0 matches in these 3 files)
- [ ] Commit if any cleanup needed

### DoD
- vitest green (0 regressions)
- tsc clean
- 0 `test.skip` in the 3 target files
- Ready for doc commit + push + PR