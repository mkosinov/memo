# Design: E2E test debt cleanup — Wave 1 (re-enable disabled tests, #121)

**Date:** 2026-07-17
**Issue:** #121 (title "18 deferred flaky tests" — stale; real count of disabled tests is 40)
**Type:** Test-debt cleanup (un-disable), NOT a product feature.

---

## Problem

CI on `main` is green — but green **because a large set of E2E tests are disabled** (`test.fixme` / `test.skip(true)`), not because everything is verified. The user flagged this in a prior session: *"из-за стандартно падающих тестов мы пропускаем реальные баги"* — disabled tests normalize skipping real regressions.

A recon (@explore, ses_08efdb81effe) inventoried **40 intentionally-disabled E2E tests** (25 `test.fixme` + 15 `test.skip(true)`), grouped by root cause:

| Bucket | Count | Root cause |
|--------|-------|-----------|
| A) Flaky-infra | 14 | clients stale-cache cascade, column-mode dropdown timing, openModal helper |
| B) Real product bug | 16 | #124 openModal wrong-activity (11), records detail panel (2), #125 status filter, #109 snapshot, #84 occupied |
| C/D) Obsolete/unknown | 0 | — |

Cleaning all 40 at once violates bite-sized principles and mixes unrelated root causes. **We proceed in waves by root cause.**

Several blocker issues have since been **CLOSED**: #84 (occupied calc), #108 (DB lock), #126 (standalone warmup), #127 (cache unification). Tests disabled *because of* those blockers should now pass with a simple un-disable.

---

## Scope (Wave 1)

**Hypothesis (now VERIFIED empirically):** the 13 tests whose blocker is a now-CLOSED issue pass with zero code changes — only the `test.fixme` marker needs removal.

### Diagnostic result (frontend-coder ses_08ee2c379ffe, standalone single-spec runs)

| File | Tests re-enabled | Result |
|------|------------------|--------|
| `e2e/occupied-calc.spec.ts` | 1 (US-S03, blocker #84 CLOSED) | ✅ 1/1 PASS — assertions already match post-#84 "sum of visits" semantics |
| `e2e/error-messages.spec.ts` | 1 ("Недостаточно мест") | ✅ PASS (whole file 6/6) |
| `e2e/clients.spec.ts` | 11 (tests 4,5,6,7,10,12,13,14,15,16,17 — cascade, blocker #127 CLOSED) | ✅ 11/11 PASS — "stale cache race" did not reproduce |

**No product-code changes. No assertion updates. No flakes on first attempt.** Pure un-disable.

### IN scope
- Convert `test.fixme(` → `test(` for the 13 tests above (3 files).
- Remove any accompanying `// deferred: ... #XXX` / `// Tests in this file are temporarily marked as test.fixme ...` comments that no longer apply.
- Do NOT touch runtime data-guards *inside* test bodies (`test.skip()` with no args, wave6 `test.skip(true, 'No client records')`) — those are legitimate conditional guards.

### OUT of scope (later waves)
- `clients.spec.ts` test 11 — status filter (#125, real product bug).
- All 11 `unified-rows.spec.ts` `test.skip(true, ... #124 ...)` — openModal-wrong-activity (big shared root cause).
- `private-toggle-layout` / `modal-blur-footer` / `modal-no-jump` — openModal helper (big root cause).
- 6 column-mode tests (`schedule-day-view`, `schedule-column-visibility`) — Topbar.tsx `handleColumnModeSelect` race (product fix).
- `records.spec.ts` detail-panel (2), `visual-regression.spec.ts` (#109 snapshot).
- Non-E2E debt: 1 vitest `it.skip` (ClientsIntegration:446), 4 pytest `xfail(strict)` in `test_client_stats.py` (`ge=1` constraint on `ClientListParams`).

---

## Verification (gate)

The diagnostic ran **standalone / single-spec**. CI runs **shard mode** (parallel, shared per-shard DB), where timing under parallelism can surface flakes not seen solo.

**Pre-merge verification (user-approved):**
1. **Local shard-mode run** of the 3 affected spec files before merge (per-shard playwright, `--workers=1` per shard as configured). This catches parallelism-timing flakes locally.
2. **Full CI on the PR** (GitHub Actions runs the canonical shard suite).

**Fallback rule:** if any of the 13 tests flakes under shard mode (passes solo, fails/flakes in parallel), that specific test is reverted back to `test.fixme` **and** a real GH issue is filed (replacing the `#XXX` placeholder) describing the timing root cause. We do NOT ship a flaky test to keep the green baseline honest.

---

## Issue-tracker hygiene

- Many disabled tests carry placeholder `#XXX` (no real issue was ever filed).
- After Wave 1: update **#121** — its "18" title is stale; record that 13 tests were re-enabled (blockers #84/#127 closed), ~27 disabled tests remain across future waves. Reference the recon inventory.
- No new product issues expected (Wave 1 is un-disable only).

---

## User Scenarios

These are **test-suite health** scenarios (the "user" is a developer / CI relying on the suite), not end-user product flows. Wave 1 does not change product behavior — it restores coverage that already passes.

1. **US-1 — Occupied count coverage restored:** A developer runs the E2E suite; `occupied-calc.spec.ts` US-S03 executes (no longer skipped) and verifies `occupied = sum of visits for active records` (post-#84 semantics), so a regression to the old "count of records" bug would be caught.

2. **US-2 — Capacity error message coverage restored:** The suite executes `error-messages.spec.ts` "Недостаточно мест", verifying that creating a record on a full activity surfaces the capacity error — so a regression that swallows the error is caught.

3. **US-3 — Clients page CRUD coverage restored:** The suite executes the 11 clients-page tests (create, view, edit name, delete, search, modal backdrop close, record-tab fields, visit-status change, add payment, save-button activation, cancel-resets) — so regressions in the clients page (many of which motivated #127) are caught rather than silently skipped.

4. **US-4 — Honest green baseline:** After Wave 1, CI green means "these 13 flows are verified", not "these 13 flows are skipped". A future PR that breaks any of them turns CI red, restoring the signal the user asked for.

Each of US-1..US-3 maps directly to the re-enabled spec(s). US-4 is verified by the pre-merge shard run + PR CI being green with the tests active.

---

## Non-goals / risks

- **Not** fixing openModal helper, column-mode race, or #124/#125 product bugs (future waves).
- **Risk:** shard-mode parallelism reveals a flake absent in solo runs → handled by the fallback rule (revert that test to fixme + file real issue).
- **Risk:** re-enabled tests add CI time → negligible (13 tests, seconds each).
