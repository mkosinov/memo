# Wave 5 — Un-skip + Annotation Cleanup (A+B+C, 6 правок)

> Date: 2026-07-22
> Type: test-debt cleanup (verify-first + annotation cleanup)
> Issues: #125 (1 test), #159 (2 tests), #109 (1 test + annotation), stale comments (2)
> Product code changes: NONE (test files only: *.spec.ts)
> Visual Compliance Gate: N/A

## Context

Test-debt campaign ongoing. 23 of 33 inventory rows closed (Waves 0-4). This wave addresses Groups A (un-skip), B (annotation cleanup), C (snapshot un-skip) in a single PR.

Prior waves fixed root causes:
- **#124 Wave-1** (PR #154): openModal DB lookup fix
- **#152** (PR #153): seed staleness fix
- **#155** (PR #168): @transactional commit boundary
- **Wave 4** (PR #169): 8 cond-skip guards removed — all PASS on CI

**Recon completed** (2 explore agents):
- #125: selector `select:has(option:text("Все"))` is STILL VALID (native `<select>`, not migrated). Skip reason = timing (`waitForTimeout(1500)` is fragile). Fix: replace with `expect`.
- #159: detail panel flow is FULLY IMPLEMENTED. `h3:has-text("Детали записи")` at RecordsTable.tsx:484, `button[aria-label="Закрыть"]` at :489, row onClick at :303. Test 9 (same flow, NOT fixme) already PASSES. Tests 8+10 are stale annotations.

## Tasks

### Group A — Verify-first un-skip (3 tests)

| # | File | Line | Current | Action | Issue |
|---|------|------|---------|--------|-------|
| A1 | clients.spec.ts | 328 | `test.skip(true, '[flaky: status filter selector/timing, tracked in #125]')` | Change to `test` + replace `waitForTimeout(1500)` with `expect` pattern | #125 |
| A2 | records.spec.ts | 218 | `test.fixme('8. Click row — opens detail panel [deferred: ...]')` | Change to `test('8. Click row — opens detail panel')` | #159 |
| A3 | records.spec.ts | 286 | `test.fixme('10. Detail panel close button dismisses panel [deferred: ...]')` | Change to `test('10. Detail panel close button dismisses panel')` | #159 |

### Group B — Annotation cleanup (2 trivial edits)

| # | File | Line | Current | Action |
|---|------|------|---------|--------|
| B1 | records.spec.ts | 26-28 | Stale comment "Tests in this file are temporarily marked as test.fixme due to pre-existing flakes... See GH issue #XXX" | Delete comment block (3 lines) — most tests in file are active, #XXX never filed |
| B2 | visual-regression.spec.ts | 33 | `#XXX` placeholder in fixme annotation | Replace `#XXX` → `#109` |

### Group C — Visual regression un-skip (1 test)

| # | File | Line | Current | Action | Issue |
|---|------|------|---------|--------|-------|
| C1 | visual-regression.spec.ts | 33 | `test.fixme('records page default state [deferred: screenshot diff (seed state), see GH issue #XXX]')` | Change to `test('records page default state')` with `#109` annotation | #109 |

Baseline `records-default-shard-rest-linux.png` exists in repo (Jul 5). After #152 seed is stable. CI will compare — if diff, trigger `update-snapshots.yml` workflow_dispatch.

### #125 timing fix detail

Current (fragile):
```typescript
test.skip(true, '[flaky: status filter selector/timing, tracked in #125]');
// ...
await statusSelect.selectOption('false');
await page.waitForTimeout(1500);
const filteredCount = await page.locator('table tbody tr').count();
```

Fixed (robust):
```typescript
// (no skip — test runs)
// ...
await statusSelect.selectOption('false');
// Wait for table to update after filter applied
await expect(page.locator('table tbody tr')).not.toHaveCount(initialCount, { timeout: 10_000 });
const filteredCount = await page.locator('table tbody tr').count();
```

Wait — there's a subtlety: if there are 0 inactive clients, the count might not change (or could change to 0). The `expect` should handle this: if filteredCount === initialCount AND that's correct (no inactive clients exist), the `expect` would fail even though the filter works. Need a more tolerant approach:

```typescript
await statusSelect.selectOption('false');
// Wait for either row count change or a loading state to clear
await page.waitForTimeout(500); // brief buffer for React re-render
// Then just verify filter was applied — don't assert count change
// (inactive clients could be 0, making count unchanged)
```

Actually simplest robust approach: wait for the network response to the filtered query:

```typescript
const filterResponse = page.waitForResponse(
  (resp) => resp.url().includes('/api/v1/clients') && resp.url().includes('is_active=false'),
  { timeout: 10_000 }
);
await statusSelect.selectOption('false');
await filterResponse; // wait for API response
await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });
```

Hmm — but the filter might return 0 rows. Let the implementer decide the best wait strategy. The KEY point: replace `waitForTimeout(1500)` with a deterministic wait (response-based or expect-based). Document the 0-inactive-clients edge case.

## Risk Analysis

| Test | Risk | Mitigation |
|------|------|-----------|
| #125 (status filter) | Low — selector valid, timing fix applied | If fails: check 0-inactive edge case, adjust assertion |
| #159 T8 (detail panel open) | Very low — test 9 (same flow) already passes | If fails: compare with test 9 differences |
| #159 T10 (detail panel close) | Very low — close button exists at :489 | If fails: check aria-label exact match |
| #109 (snapshot) | Medium — baseline from Jul 5, seed may have drifted | If fails: workflow_dispatch regen → commit new baseline → re-push |

## Verification

- **Local:** `cd frontend && npx tsc --noEmit` (syntax check)
- **CI:** both E2E shards — green = all tests pass. Red on #109 → trigger snapshot regen.
- **No `npm run test:all` locally** (E2E shard env too flaky). CI is decisive.

## User Scenarios

| # | Scenario | Asserts | Test file:line |
|---|----------|---------|----------------|
| 1 | Clients: status filter narrows results | Filter applied, row count changes or 0 | clients.spec.ts:327 |
| 2 | Records: click row opens detail panel | `h3:has-text("Детали записи")` visible | records.spec.ts:218 |
| 3 | Records: close button dismisses detail panel | `h3:has-text("Детали записи")` not visible | records.spec.ts:286 |
| 4 | Visual regression: records page default state matches baseline | Screenshot matches `records-default.png` | visual-regression.spec.ts:33 |

## GH Issue Closure Plan

- **CI green (all pass):** close #125 + #159. #109 stays open until snapshot confirmed stable.
- **CI red on #125:** investigate timing/assertion, fix or re-skip with updated annotation
- **CI red on #159:** compare with test 9 (passing), investigate difference
- **CI red on #109:** trigger `update-snapshots.yml` workflow_dispatch, commit new baseline, re-push

## Out of Scope

- #124 item3 visitor PATCH 422 (backend, separate package)
- 7 cond-skip guards in unified-rows.spec.ts (legit, not debt)