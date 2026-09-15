# GH #258 + #259 — Slot-click activity creation + empty week/day always render the grid

- **Date**: 2026-09-15
- **Branch**: `feature/schedule-slot-create-258-259`
- **Status**: Completed (PR pending)
- **Base**: `ddb2929` (2026-09-14) — 11 commits (`71e0672..b4a917d`), 21 files, +1372 / −233
- **Issues**: #258 (click on a free slot did not open creation — regression; **already closed on GitHub, deliberately not reopened, referenced only**), #259 (empty week showed «Нет занятий» instead of the grid — closes on merge)
- **Spec**: `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` (rev 2)
- **Plan**: `docs/plans/2026-09-14-schedule-slot-create-empty-week-plan.md`

## Summary of Changes

- **Create mode in `ActivityDetailsModal` (`3aa5824`):** the modal gained `mode='create'` with a nullable
  `activity`; the body is split into per-mode subcomponents so record hooks (`useRecordMutations`,
  `useActivityRecords`, `services.find` by `serviceId`, `deleteActivity`) live only in the edit
  subcomponent and never run in create mode (Rules of Hooks — all six unconditional-dereference crash
  points of §2.1.2 closed structurally, not with ad-hoc `if`s). `TabNav` renders the single form tab in
  create mode (`onAddClick` became optional, «+ Запись» only when provided), the delete footer is hidden,
  the title is «Новое занятие» wired to the visible heading via `aria-labelledby`
  (`Modal` gained an optional `titleId` — `<h2>` always rendered when passed). Closing is blocked while
  the request is in flight (X / Esc / backdrop click).
- **`CreateActivityTab` — the create form (`71e0672`):** master / service / location / weekday / start
  time / duration / capacity / private checkbox (testids `create-*`, submit `btn-create-activity`).
  Day + start time are prefilled from the clicked slot (editable); duration/capacity start empty and are
  filled from `service.durationMinutes` / `location.defaultCapacity ?? 0` on selection, exactly as the
  stamp does. «Создать» is enabled only with master + service + location + valid time; saving disables the
  button (anti-double-click) and is released in the mutation callbacks.
- **Save path:** the shared `addActivity` (`ScheduleDataContext`) gained optional `{ onSuccess, onError }`
  callbacks (second `mutate` argument — the existing stamp call site is untouched) → the same
  `POST /api/v1/activities` as the stamp. Success → one toast with the stamp's owner semantics (no double
  toast), modal closes, card appears in the grid (no jump to details); server error → error-kind toast of
  the shared `UIContext` stack (`parseApiError` message + `kind='error'`), the form stays open with the
  entered values, no duplicate is created.
- **Empty week (`20d9ea2`, `d722f83`) / empty day (`1008cae`):** the week's early-return stub was deleted —
  column headers, time axis, `DayColumn` slots and `DndContext` always render, so both click-create and
  the stamp work on an empty week through the same code path (no empty-week branches in creation logic).
  The hint is an in-flow banner with `role="status"` / `aria-live="polite"` and no `z-[N]` (D7), keeping
  both texts — «Нет занятий на эту неделю» / «Нет занятий по выбранным фильтрам» — with the same
  filter-state source in week and day views. In the day view the `ScheduleColumnHeader` stub
  «Нет занятий на этот день» was replaced by the same banner while keeping the grid.
- **Wiring (`d5b9b75`, `1008cae`):** `WeekView`/`DayView` keep slot coordinates in state and pass them as
  `createDefaults` (`dayIndex` + `startMinutes`); the render gate mounts the modal on `modalOpen` + mode
  instead of requiring `modalActivity`.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | `CreateActivityTab` — create form with slot prefills | large | ✅ (`71e0672`) |
| T2 | `ActivityDetailsModal` create mode — per-mode subcomponents, single tab, blocked close while saving | large | ✅ (`3aa5824`) |
| T3 | `WeekView` — slot coordinates + modal gate | standard | ✅ (`d5b9b75`) |
| T4 | `WeekView` — empty week: grid always + `role=status` hint | standard | ✅ (`20d9ea2`, cosmetics `d722f83`) |
| T5 | `DayView` — unified hint + create with slot coordinates | small | ✅ (`1008cae`) |
| T6 | e2e helper + S1 — `admin-clicks-empty-slot` fixed (`.catch` removed) | standard | ✅ (`0c6d1ba`) |
| T7 | e2e S2 + S4 — new `schedule-empty-week.spec.ts` | standard | ✅ (`34a2eaf`) |
| T8 | e2e S3 — new `dayview-slot-create.spec.ts` | small | ✅ (`bf37eff`) |
| T9 | Visual snapshots — create-mode baseline | small | ✅ (`1ffa309`) |
| T10 | Full run + CHANGELOG | small | ✅ (`b4a917d`) |

All tasks two-stage reviewed (large) or tier-appropriately reviewed (standard/small) — all reviews green.

## User Scenarios (spec §5)

| # | Scenario | Status |
|---|----------|--------|
| S1 | Click a free slot on a normal week → «Новое занятие» with prefilled day/time → create → card in grid | ✅ e2e `admin-clicks-empty-slot.spec.ts` (assert no longer swallowed by `.catch`) |
| S2 | Empty week → grid (7 columns, time axis) + hint → slot click creates → card appears, hint gone | ✅ e2e `schedule-empty-week.spec.ts` |
| S3 | Day view: same click-create + unified hint | ✅ e2e `dayview-slot-create.spec.ts` |
| S4 | Stamp on an empty week creates an activity by slot click (no modal) | ✅ e2e `schedule-empty-week.spec.ts` |
| S5 | Hint distinguishes «нет занятий на эту неделю» / «нет занятий по выбранным фильтрам» | ✅ unit tests (D9 — S5 is unit-level by decision) |

## Behavioral Changes Shipped

- Clicking a free slot on the week grid or day view opens the creation form with day and start time already
  filled from the slot; the activity is created through the same endpoint as the stamp.
- An empty week and an empty day now show the normal grid plus an in-flow hint, so activities can be created
  on them (by click or stamp) — previously the empty week rendered only «Нет занятий» and the whole grid
  (including the stamp) was unreachable.
- Quick-add «+» on an existing card, the stamp on a populated week, existing-activity tabs, loading/error
  branches and the `__memo-*` e2e backdoors behave as before (regression perimeter §2.3 covered by tests).
- Developer-facing: zero backend/API/schema change; no new `z-[N]` or inline `zIndex` (D7 — the concurrent
  #260 z-token track kept the post-merge line shifts only).

## Test Results

- **admin vitest:** 121 files / **1808 passed, 0 failed, 0 skipped** (baseline 1790 — +18: create-mode
  modal suite, `CreateActivityTab`, empty week/day expectations, `onOpenModal` coordinates).
- **tsc:** clean.
- **e2e (standalone full run):** **364 passed / 13 failed / 0 skipped** — all 13 are the known local visual
  baseline drift (`toHaveScreenshot`, env font/render drift; red on `main` too, CI is authoritative —
  `docs/tests_workflow.md` «Known caveats», precedents #252/#266). **Zero functional failures**; new specs
  S1–S4 all green.
- **Reviews:** two-stage reviews per task (large) / tier-appropriate (standard, small) — all ✅; final
  full-feature run green on the functional perimeter.

## Key Files Changed

- Created: `frontend/admin/app/components/modal/ActivityDetailsModal/CreateActivityTab.tsx`,
  `frontend/admin/__tests__/CreateActivityTab.test.tsx`, `frontend/admin/e2e/schedule-empty-week.spec.ts`,
  `frontend/admin/e2e/dayview-slot-create.spec.ts`,
  `frontend/admin/e2e/visual-regression.spec.ts-snapshots/modal-create-mode-shard-rest-linux.png`.
- Modified (prod): `ActivityDetailsModal.tsx` (+`index.ts`), `TabNav.tsx`,
  `app/components/shared/modal/Modal.tsx`, `contexts/schedule/ScheduleDataContext.tsx`,
  `WeekView.tsx`, `DayView.tsx`.
- Modified (tests): `ActivityDetailsModal.test.tsx`, `WeekView.test.tsx`, `DayColumn.test.tsx`,
  `page.test.tsx`, `DayView.test.tsx`, `e2e/fixtures/helpers.ts`, `e2e/admin-clicks-empty-slot.spec.ts`,
  `e2e/visual-regression.spec.ts`.
- Meta: `CHANGELOG.md` (`b4a917d`), this status file, `PLAN.md` status entry.

## Docs Impact

- Spec + plan live in `docs/specs/` and `docs/plans/` and were not touched on this branch (only impl + meta).
- `CHANGELOG.md` [Unreleased] entry added in `b4a917d`; `docs/status/` and `PLAN.md` in this commit.
- `docs/domain-rules/activities.md` already carries the D8 invariant (parallel activities in one slot are
  valid) — no change needed in this track.

## Known Non-Blocking Observations

- 13 e2e visual failures are pre-existing local environment drift (font/render), not regressions from this
  branch; CI baselines are authoritative and were regenerated only for the new create-mode modal baseline.
- #258 was already closed on GitHub before the fix landed; per the handoff it is referenced in the PR but
  deliberately **not reopened** — the real regression fix is in this branch. #259 closes on merge.
- Merge conflicts with #260 are expected as pure line shifts in `WeekView.tsx` / `DayColumn.tsx` / `DayView.tsx`
  (spec §4); resolve by plain rebase, no semantic dependency.

## References

- **GitHub Issues**: #258, #259
- **Design Spec**: `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` (rev 2, D1–D10)
- **Plan**: `docs/plans/2026-09-14-schedule-slot-create-empty-week-plan.md` (rev 2, T1–T10)
- **PR**: _(to be added after PR creation)_
