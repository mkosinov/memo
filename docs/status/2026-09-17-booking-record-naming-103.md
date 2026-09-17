# GH #103 — Booking → Record naming alignment (mechanical rename, zero user-visible change)

- **Date**: 2026-09-17
- **Branch**: `feat/103-record-naming`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `18a57e9` (#292, merged) — 7 commits (`280d167..b4b0882`), 25 files, +109 / −109
- **Issue**: #103 — booking/record naming alignment
- **Spec**: `docs/specs/2026-09-16-booking-record-naming-alignment-design.md`
- **Plan**: `docs/plans/2026-09-16-booking-record-naming-alignment-plan.md`

## Summary of Changes

Aligns code names with the domain rule («booking» = the booking **process**, «record» = the saved
**data**). Nothing user-visible changes; only internal component/prop/testid/field-id/selector/comment
names and one visual-baseline filename.

- **Filter component (T1, `280d167`):** `BookingFilters.tsx` → `RecordsFilters.tsx` (git rename,
  `R098`) — `BookingFiltersProps` → `RecordsFiltersProps`, component `BookingFilters` → `RecordsFilters`,
  testid prefix `booking-filters-status` → `records-filters-status`; consumer
  `app/(main)/records/page.tsx` (import + JSX) follows; unit suite
  `__tests__/BookingFilters.test.tsx` → `__tests__/RecordsFilters.test.tsx` (`R094`).
- **Records-filter e2e (T2, `a63fa97`):** `booking-filters-status` → `records-filters-status` in
  `e2e/records.spec.ts` (14 lines), `e2e/wave6-status-shared.spec.ts`, `e2e/visual-regression.spec.ts`;
  comment references updated in `wave6-status-shared.spec.ts`, `records-view.spec.ts`,
  `fixtures/helpers.ts`, `app/(main)/photos/components/PhotosFilters.tsx`.
- **Modal tab (T3, `6d8a0b7`):** `ActivityDetailsModal/NewBookingTab.tsx` → `NewRecordTab.tsx`
  (git rename, `R094`) — type `NewBookingSubmitData` → `NewRecordSubmitData`,
  `NewBookingTabProps` → `NewRecordTabProps`, component `NewBookingTab` → `NewRecordTab`,
  testid `new-booking-tab` → `new-record-tab`, HTML field ids `booking-name`/`booking-seats`/
  `booking-channel` → `record-name`/`record-seats`/`record-channel`; `index.ts` export, the modal's
  tab id `'new-booking'` → `'new-record'`, handler `handleNewBookingSubmit` → `handleNewRecordSubmit`
  and comments; `helpers/mockData.ts` comment.
- **Vitest suite (T4, `0b83dda`):** `__tests__/ActivityDetailsModal.test.tsx` — import, section
  comments, describes and all 17 `render(<NewRecordTab …>)` calls renamed.
- **Modal-tab e2e (T5, `70b44a0`):** `new-booking-tab` → `new-record-tab` in
  `activity-details-modal.spec.ts`, `error-messages.spec.ts`, `fixtures/helpers.ts`;
  `fixtures/server-push.ts` comment («The record lands on…»). Process-meaning comments at
  `server-push.ts:259` and `error-messages.spec.ts:90` were **deliberately kept** (spec §4.4).
- **Visual baseline (T6, `9e6fd91`):** `visual-regression.spec.ts` test title + `toHaveScreenshot`
  argument renamed; both snapshots git-renamed
  `modal-new-booking-{chromium,shard-rest}-linux.png` → `modal-new-record-{chromium,shard-rest}-linux.png`
  (`R100`, byte-identical binaries). The visual suite passes **without** `--update-snapshots` —
  pixel identity proof.
- **Final sweep (T7, `b4b0882`):** remaining `new-booking-tab` e2e stragglers
  (`anonymous-visits.spec.ts`, `client-phone-typeahead.spec.ts`, `master-role-record-create.spec.ts`)
  and component references in `docs/domain-rules/_overview.md`, `clients.md`, `records.md`.
- **Deliberately unchanged:** process-meaning «booking» occurrences allowed by spec §4.4 (incl.
  `BookingVisitor`/`BookingStep`, «Booking Context Types», `business-logic.md:49`); `docs/design-system.md`
  outdated navigation block → #287; backend, API contracts, `frontend/web`, `visit*` — out of scope (D11).

## Behavioral Delta

- **None.** S1–S4 behave exactly as before; only internal names change:
  - **S1** — the /records status filter works as before under the `records-filters-status` testid.
  - **S2** — the quickAdd modal's record tab works as before (no visible text changed — there was none).
  - **S3** — submit error still renders at the tab.
  - **S4** — /records and the modal render pixel-identically; the snapshot baseline is renamed only.
- Naming criterion (spec §8.1): `grep -rni booking` over `frontend/admin`, `packages/domain`,
  `packages/api-client` and the live domain-rule docs yields only the spec whitelist — **zero**
  data-meaning «booking» occurrences.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Rename filter component + unit test (`BookingFilters` → `RecordsFilters`) | small | ✅ (`280d167`) |
| T2 | Records-filter e2e selectors + comments | small | ✅ (`a63fa97`) |
| T3 | `NewBookingTab` → `NewRecordTab` component + modal wiring | small | ✅ (`6d8a0b7`) |
| T4 | Vitest tab suite rename (`ActivityDetailsModal.test.tsx`) | small | ✅ (`0b83dda`) |
| T5 | Modal-tab e2e selectors + comments | small | ✅ (`70b44a0`) |
| T6 | Visual baseline migration (`R100`, no `--update-snapshots`) | standard | ✅ (`9e6fd91`) |
| T7 | Final sweep (e2e stragglers + domain-rules refs) | standard | ✅ (`b4b0882`); push/PR step open |

## User Scenarios (spec §6) — covered

| # | Scenario | Anchor | Status |
|---|----------|--------|--------|
| S1 | /records status filter works as before | `e2e/records.spec.ts` (23/23), `e2e/wave6-status-shared.spec.ts` (4/4) | ✅ |
| S2 | QuickAdd record tab creates a record as before | `e2e/activity-details-modal.spec.ts` (14/14), `e2e/master-role-record-create.spec.ts` (2/2) | ✅ |
| S3 | Invalid submit shows the error at the tab | `e2e/error-messages.spec.ts` (6/6) | ✅ |
| S4 | /records and the modal look pixel-identically | `e2e/visual-regression.spec.ts` (renamed baseline green byte-identical) | ✅ |

## Test Results

- **admin vitest:** **2052 passed / 0 failed (131 files)**.
- **`tsc --noEmit`:** clean. **lint:** 0 errors (31 pre-existing warnings untouched).
- **e2e (local, shard mode):** `records` **23/23**, `activity-details-modal` **14/14**,
  `error-messages` **6/6**, `wave6-status-shared` **4/4**, `anonymous-visits` **6/6**,
  `master-role-record-create` **2/2**.
- **Visual regression:** **49/61** — the 12 failures are **pre-existing environment drift**, proven at
  the base commit (identical pixel counts at base; the renamed `modal-new-record` baseline passes
  byte-identical). Baselines were **not** re-recorded. CI (GitHub Actions, both e2e shards) is the
  authoritative merge gate.
- **Acceptance (spec §8):** §8.1 grep sweep clean modulo the whitelist (0 data-meaning «booking»);
  §8.2 affected e2e + vitest green, `tsc`/lint clean; §8.3 no `frontend/web`, `backend/**` or
  `/api/v1/**` changes.
- **Purity check:** `grep -rn "booking-filters-status\|new-booking-tab\|NewBookingTab\|BookingFilters"`
  in `frontend/admin`, `packages/domain`, `packages/api-client` — 0 hits.

## Key Files Changed

- **Renamed (git mv):** `app/(main)/records/components/BookingFilters.tsx` → `RecordsFilters.tsx`
  (`R098`), `__tests__/BookingFilters.test.tsx` → `RecordsFilters.test.tsx` (`R094`),
  `ActivityDetailsModal/NewBookingTab.tsx` → `NewRecordTab.tsx` (`R094`),
  `e2e/visual-regression.spec.ts-snapshots/modal-new-booking-*-linux.png` →
  `modal-new-record-*-linux.png` (`R100`).
- **Modified (prod):** `app/(main)/records/page.tsx`,
  `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`,
  `app/components/modal/ActivityDetailsModal/index.ts`,
  `app/(main)/photos/components/PhotosFilters.tsx` (comment).
- **Modified (tests):** `__tests__/ActivityDetailsModal.test.tsx`,
  `__tests__/helpers/mockData.ts`, `e2e/records.spec.ts`, `e2e/wave6-status-shared.spec.ts`,
  `e2e/records-view.spec.ts`, `e2e/activity-details-modal.spec.ts`, `e2e/error-messages.spec.ts`,
  `e2e/visual-regression.spec.ts`, `e2e/anonymous-visits.spec.ts`,
  `e2e/client-phone-typeahead.spec.ts`, `e2e/master-role-record-create.spec.ts`,
  `e2e/fixtures/helpers.ts`, `e2e/fixtures/server-push.ts`.
- **Docs (feature branch):** `docs/domain-rules/_overview.md`, `clients.md`, `records.md` (refs only,
  T7); meta: this status file, `PLAN.md`, `CHANGELOG.md` and the plan checkboxes.

## Docs Impact

- Spec (`docs/specs/2026-09-16-booking-record-naming-alignment-design.md`) and plan
  (`docs/plans/2026-09-16-booking-record-naming-alignment-plan.md`) live on main and were not edited
  except for ticking the plan's T1–T7 step checkboxes + adding a status line.
- `docs/domain-rules/_overview.md` / `clients.md` / `records.md` — reference strings only, updated in
  T7 (`b4b0882`); the domain-rule delta itself was committed with the spec on main (`0b3e9ee`).
- No `docs/memo-full-spec.md`, `docs/v4-design-system.md` or mock-data model changes: no design-system
  or data-model impact. `docs/design-system.md` outdated navigation block stays out of scope (#287).

## Known Non-Blocking Observations

- **Local visual failures are environment drift, not regressions:** identical at the base commit
  (static wave6 harness + font/AA rasterization, documented class, precedent #182); CI baselines are
  authoritative and the renamed baseline itself passes byte-identical.
- **Task 7 push/PR step intentionally left open** in the plan (`- [ ]`): the branch is not pushed and
  no PR is opened yet — Step 6 (finishing) owns push → PR → CI → merge.
- **Intermediate commits are e2e-red by design:** between T1 and T2 (and T3/T5) selectors pointed at
  the old testids; the plan documents this expected window, closed at T7.

## References

- **GitHub Issue**: #103 (dependency: #257, merged before IMPL start; out-of-scope follow-up: #287)
- **Design Spec**: `docs/specs/2026-09-16-booking-record-naming-alignment-design.md`
- **Plan**: `docs/plans/2026-09-16-booking-record-naming-alignment-plan.md`
- **PR**: _(to be added after PR creation)_
