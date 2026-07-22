# Wave 4 — Cond-skip Verify-First Bundle (8 tests, 3 files)

> Date: 2026-07-22
> Type: test-debt cleanup (verify-first pattern)
> Issues: #161 (6 tests), #162 (1 test), #124 cascade (1 test)
> Product code changes: NONE (test files only: *.spec.ts)
> Visual Compliance Gate: N/A

## Context

Test-debt campaign ongoing. 15 of 33 inventory rows closed (Waves 0-3a + #155). This wave addresses 8 more rows.

Prior waves fixed four root causes that make these cond-skip guards obsolete:
- **#124 Wave-1** (PR #154): `openModal()` rewritten to use DB lookup (`resolveRecordDate`) instead of fragile walk-first-card logic
- **Wave 3a** (#160): column-mode environmental flake proven not product bug
- **#152** (PR #153): seed staleness fix ensures consistent shard seed data
- **#155** (PR #168): @transactional decorator eliminated GET-after-POST race

## The Cond-skip Guard Pattern

All 8 tests share the same guard structure:

```javascript
const clientTabs = page.locator('[data-testid^="tab-client-"]');
if ((await clientTabs.count()) === 0) {
  test.skip(true, 'No client records on schedule');
  return;
}
```

After #124 Wave-1 fix, `openModal()` (without recordId) uses `resolveRecordDate()` → deterministically picks the first active record → navigates to correct week → scans cards for one with client tabs. The guard should NOT fire on the seeded schedule.

## Tasks

All tasks are **trivial classification**: remove `if (cond) { test.skip(...); return; }` block (3-5 lines each). No logic change, no new files.

| # | File | Line | Guard | Issue | Action |
|---|------|------|-------|-------|--------|
| 1 | wave6-record-status-derived.spec.ts | 26-29 | `'No client records on schedule'` | #161 | remove `if/skip/return` (4 lines) |
| 2 | wave6-record-status-derived.spec.ts | 74-78 | same | #161 | remove `if/skip/return` (4 lines) |
| 3 | wave6-record-status-derived.spec.ts | 107-111 | same | #161 | remove `if/skip/return` (4 lines) |
| 4 | wave6-record-status-derived.spec.ts | 136-140 | same | #161 | remove `if/skip/return` (4 lines) |
| 5 | wave6-record-status-derived.spec.ts | 150-154 | `'Add visitor button not found'` | #162 | remove `if/skip/return` (4 lines) |
| 6 | wave6-status-shared.spec.ts | 49-53 | `'No client records on schedule'` | #161 | remove `if/skip/return` (4 lines) |
| 7 | wave6-status-shared.spec.ts | 89-93 | `'No client records'` | #161 | remove `if/skip/return` (4 lines) |
| 8 | activity-details-modal.spec.ts | 218-221 | bare `test.skip()` after `if (!activity)` | #124 cascade | remove `if/skip/return` (4 lines) |

**Total diff:** 3 files, ~-32 lines (8 guard blocks × 4 lines each).

## Risk Analysis

| Scenario | Probability | Impact | Mitigation |
|----------|-------------|--------|-----------|
| All 8 pass on CI | High (4× proven pattern) | 8 rows closed | — |
| 1-4 fail (#161 guards were legit) | Low | Re-skip with annotation, close remaining | Investigate specific failure |
| #162 "Add visitor" is real UI bug | Medium | Test fails with assertion, not silent skip | Fix UI testid or re-skip with #162 annotation |
| #124 cascade test fails | Low (openModal now safe) | Re-skip with annotation | Investigate openModal return |

## Verification

- **Local:** `cd frontend && npm run test` (vitest — no regression, these are E2E tests so vitest count unchanged)
- **CI:** both E2E shards — green = all 8 tests pass. Red = specific test(s) fail and we investigate.
- **No `npm run test:all` locally** (E2E shard env too flaky per prior waves). CI is the decisive arbiter.

## User Scenarios

| # | Scenario | Asserts | Test file:line |
|---|----------|---------|----------------|
| 1 | Wave 6 Sc1: edit visit status → record badge updates | StatusPicker visible, visits table visible | wave6-record-status-derived.spec.ts:18 |
| 2 | Wave 6 Sc2: add payment → totals update | Payment section visible with 'Оплаты' | wave6-record-status-derived.spec.ts:67 |
| 3 | Wave 6 Sc3: edit anonym_visits → header updates | Header text non-empty | wave6-record-status-derived.spec.ts:100 |
| 4 | Wave 6 Sc4: add visitor → new row | visitor-row count ≥ before | wave6-record-status-derived.spec.ts:129 |
| 5 | Wave 6 Shared: StatusPicker in activity modal ClientTab | `record-status` testid visible | wave6-status-shared.spec.ts:41 |
| 6 | Wave 6 Shared: StatusPicker DOM structure consistent | `record-status` visible, has trigger | wave6-status-shared.spec.ts:81 |
| 7 | ActivityDetails Sc4: settings update — service_id changes in DB | DB row service_id updated + restored | activity-details-modal.spec.ts:215 |
| 8 | (Sc5 wave6-status-shared /records filter) | NOT guarded — already active | — |

Note: Scenarios 1-7 are the guarded tests being un-skipped. Scenario 8 (wave6-status-shared.spec.ts:20 and :66) are already active and not touched.

## GH Issue Closure Plan

- **CI green (all 8 pass):** close #161 + #162 with summary comment
- **CI red on #161 tests only:** re-skip + comment why, close #162 if passed
- **CI red on #162 only:** re-skip + comment, close #161 if passed
- **CI red on #124 cascade:** re-skip + comment, investigate openModal return

## Out of Scope

- #159 records detail panel (2 fixme — Wave 3b product fix)
- #125 clients status filter timing (1 skip — Wave 3b)
- #109 visual-regression records page snapshot (infra)
- #124 item3 visitor PATCH 422 (backend)
- Cond-skip guards in unified-rows.spec.ts (#15-23 — legit, not debt)