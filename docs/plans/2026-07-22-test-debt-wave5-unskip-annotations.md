# Wave 5 — Un-skip + Annotation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un-skip 4 E2E tests (#125, #159×2, #109) + clean 2 stale annotations, all in one PR.

**Architecture:** Recon confirmed all UI flows are implemented. #125 needs timing fix (waitForTimeout → response-based wait). #159 tests are stale annotations (test 9 same flow passes). #109 snapshot has baseline in repo. CI is decisive arbiter.

**Tech Stack:** Playwright E2E (TypeScript), pnpm, GitHub Actions CI shards.

---

## Behavioral Delta

- **Clients status filter** → selecting "Неактивные" narrows the client list, verified by API response (not blind timeout)
- **Records detail panel** → clicking a table row opens a detail panel with heading "Детали записи"; close button dismisses it
- **Records visual regression** → records page default state matches committed screenshot baseline
- **2 stale annotations cleaned** → no more `#XXX` placeholders in records.spec.ts and visual-regression.spec.ts

---

## File Structure

| File | Change |
|------|--------|
| `frontend/admin/e2e/clients.spec.ts` | Un-skip test 11, replace waitForTimeout with response-based wait |
| `frontend/admin/e2e/records.spec.ts` | Un-skip tests 8+10, delete stale comment block |
| `frontend/admin/e2e/visual-regression.spec.ts` | Un-skip test (fixme→test), replace #XXX→#109 |

---

## Task 1: Un-skip #125 + fix timing in clients.spec.ts

### Classification: small
### Required Docs
- `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md` — design context, #125 timing fix detail

### Task Description

**File:** `frontend/admin/e2e/clients.spec.ts`

**Change 1:** Line 328 — remove `test.skip`:
```typescript
// BEFORE:
  test('11. Status filter narrows results', async ({ page }) => {
    test.skip(true, '[flaky: status filter selector/timing, tracked in #125]');
    await waitForClientsReady(page);

// AFTER:
  test('11. Status filter narrows results', async ({ page }) => {
    await waitForClientsReady(page);
```

**Change 2:** Replace the fragile `waitForTimeout(1500)` after filter select with a deterministic wait. The current code (around lines 335-348):

```typescript
    // Select "Неактивные" status filter
    const statusSelect = page.locator('select:has(option:text("Все"))');
    await statusSelect.selectOption('false');
    await page.waitForTimeout(1500);

    // After filtering, the table should show different results
    const filteredCount = await page.locator('table tbody tr').count();
```

Replace with a response-based wait that waits for the filtered API response to arrive:

```typescript
    // Select "Неактивные" status filter — wait for filtered API response
    const statusSelect = page.locator('select:has(option:text("Все"))');
    const filterResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/clients') && resp.url().includes('is_active=false'),
      { timeout: 10_000 },
    );
    await statusSelect.selectOption('false');
    await filterResponse;

    // After filtering, the table should show different results
    const filteredCount = await page.locator('table tbody tr').count();
```

**Change 3:** Also fix the second `waitForTimeout(1500)` after "Сбросить фильтры" click (around line 348):

```typescript
    // BEFORE:
    await page.locator('text=Сбросить фильтры').click();
    await page.waitForTimeout(1500);
    const resetCount = await page.locator('table tbody tr').count();

    // AFTER:
    const resetResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/clients') && !resp.url().includes('is_active=false'),
      { timeout: 10_000 },
    );
    await page.locator('text=Сбросить фильтры').click();
    await resetResponse;
    const resetCount = await page.locator('table tbody tr').count();
```

**Edge case:** If there are 0 inactive clients, `filteredCount` could be 0 — that's fine, the test doesn't assert `filteredCount !== initialCount` strictly (it checks the flow, not exact counts). The comment says "Just verify the filter was applied — count changed or is 0". Keep the existing assertions as-is, only replace the waits.

**Steps:**
- [ ] Read `frontend/admin/e2e/clients.spec.ts` lines 325-360
- [ ] Remove `test.skip(true, ...)` line
- [ ] Replace first `waitForTimeout(1500)` with response-based wait (setup waitForResponse BEFORE selectOption)
- [ ] Replace second `waitForTimeout(1500)` with response-based wait (setup waitForResponse BEFORE click)
- [ ] Verify tsc clean: `cd frontend && npx tsc --noEmit`
- [ ] Commit: `git add frontend/admin/e2e/clients.spec.ts && git commit -m "test(#125): un-skip status filter test + replace waitForTimeout with response-based wait"`

### DoD
- `test.skip` removed
- 0 `waitForTimeout` remaining in test 11
- tsc --noEmit passes
- Committed

---

## Task 2: Un-skip #159 + delete stale comment in records.spec.ts

### Classification: small
### Required Docs
- `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md` — design context, #159 detail panel recon

### Task Description

**File:** `frontend/admin/e2e/records.spec.ts`

**Change 1 (B1):** Delete the stale comment block at lines 26-28:
```typescript
// Tests in this file are temporarily marked as test.fixme due to
// pre-existing flakes in the parallel-shard E2E setup. See GH issue
// #XXX (to be filed separately) for the proper fix.
```
These 3 lines + the blank line after them should be removed. Most tests in this file are already active `test(...)` — the comment is misleading.

**Change 2 (A2):** Line 218 — change `test.fixme` to `test`:
```typescript
// BEFORE:
  test.fixme('8. Click row — opens detail panel [deferred: pre-existing UI issue, see GH issue #XXX]', async ({ page, request }) => {

// AFTER:
  test('8. Click row — opens detail panel', async ({ page, request }) => {
```

**Change 3 (A3):** Line 286 — change `test.fixme` to `test`:
```typescript
// BEFORE:
  test.fixme('10. Detail panel close button dismisses panel [deferred: cascade from test 8 pre-existing UI issue, see GH issue #XXX]', async ({ page, request }) => {

// AFTER:
  test('10. Detail panel close button dismisses panel', async ({ page, request }) => {
```

**Recon context:** RecordsTable.tsx:303 has `onClick={() => setSelectedRecord(...)}` on `<tr>`. Line 484 renders `<h3>Детали записи</h3>`. Line 489 has `<button aria-label="Закрыть">`. Test 9 (same flow, already active) passes on CI. Tests 8+10 are stale.

**Steps:**
- [ ] Read `frontend/admin/e2e/records.spec.ts`
- [ ] Delete comment block at lines 26-28 (3 comment lines + trailing blank line)
- [ ] Change `test.fixme(...)` → `test(...)` at line 218, remove `[deferred: ...]` from title
- [ ] Change `test.fixme(...)` → `test(...)` at line 286, remove `[deferred: ...]` from title
- [ ] Verify tsc clean: `cd frontend && npx tsc --noEmit`
- [ ] Verify 0 `test.fixme` remaining: `grep 'test.fixme' frontend/admin/e2e/records.spec.ts` → expect 0 matches
- [ ] Commit: `git add frontend/admin/e2e/records.spec.ts && git commit -m "test(#159): un-skip 2 detail-panel tests + delete stale comment (#XXX→fixed, UI confirmed by recon)"`

### DoD
- 0 `test.fixme` in records.spec.ts
- Stale comment block deleted
- tsc --noEmit passes
- Committed

---

## Task 3: Un-skip #109 + fix annotation in visual-regression.spec.ts

### Classification: small
### Required Docs
- `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md` — design context, #109 snapshot

### Task Description

**File:** `frontend/admin/e2e/visual-regression.spec.ts`

**Change 1 (B2+C1):** Line 33 — change `test.fixme` to `test` and replace `#XXX` with `#109`:
```typescript
// BEFORE:
  test.fixme('records page default state [deferred: screenshot diff (seed state), see GH issue #XXX]', async ({ page }) => {

// AFTER:
  test('records page default state', async ({ page }) => {
```

Remove the `[deferred: ...]` annotation from the test title (it's now active, not deferred).

**Recon context:** Baseline `records-default-shard-rest-linux.png` exists in repo (committed Jul 5, `e40402c`). After #152 seed is stable. The test uses `maxDiffPixels: 5000` for tolerance. If CI shows diff → trigger `update-snapshots.yml` workflow_dispatch → commit new baseline → re-push.

**Steps:**
- [ ] Read `frontend/admin/e2e/visual-regression.spec.ts`
- [ ] Change `test.fixme(...)` → `test(...)` at line 33, remove `[deferred: ...]` from title
- [ ] Verify tsc clean: `cd frontend && npx tsc --noEmit`
- [ ] Verify 0 `test.fixme` remaining: `grep 'test.fixme' frontend/admin/e2e/visual-regression.spec.ts` → expect 0 matches
- [ ] Verify 0 `#XXX` remaining: `grep '#XXX' frontend/admin/e2e/visual-regression.spec.ts` → expect 0 matches
- [ ] Commit: `git add frontend/admin/e2e/visual-regression.spec.ts && git commit -m "test(#109): un-skip records page visual regression test + fix #XXX→#109 annotation"`

### DoD
- 0 `test.fixme` in visual-regression.spec.ts
- 0 `#XXX` in visual-regression.spec.ts
- tsc --noEmit passes
- Committed

---

## Task 4: Final verification

### Classification: trivial
### Required Docs
- Spec: `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md`

### Task Description

**Steps:**
- [ ] Run vitest: `cd frontend && npx vitest run` — expect 1194 pass, 0 regressions (these are E2E tests, vitest count unchanged)
- [ ] Run tsc: `cd frontend && npx tsc --noEmit` — expect clean
- [ ] Verify all un-skips: `grep -rn 'test.skip\|test.fixme' frontend/admin/e2e/clients.spec.ts frontend/admin/e2e/records.spec.ts frontend/admin/e2e/visual-regression.spec.ts` — expect 0 matches
- [ ] Verify no stale `#XXX`: `grep -rn '#XXX' frontend/admin/e2e/` — expect 0 matches

### DoD
- vitest green (0 regressions)
- tsc clean
- 0 `test.skip` / `test.fixme` / `#XXX` in the 3 target files
- Ready for doc commit + push + PR