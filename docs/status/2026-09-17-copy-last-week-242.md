# GH #242 — «Копировать прошлую неделю» (admin schedule copy-last-week)

- **Date**: 2026-09-17
- **Branch**: `feat/242-copy-last-week`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `80aa34f` — 10 commits (`aef08be..851422a`), 24 files, +2957 / −51
- **Issue**: #242 — schedule «Копировать прошлую неделю» (was a silent fake toast stub)
- **Spec**: `docs/specs/2026-09-17-copy-last-week-design.md` (rev2, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-17-copy-last-week-plan.md` (on main, unchanged by IMPL)

## Summary of Changes

- **Backend — contracts (`aef08be`, T1):** `ActivityCopyWeekRequest` / `CopyWeekResult` schemas in
  `backend/src/schemas/activity.py` (`week_start` date + explicit `locations: list[UUID]`) and three new
  `ErrorCode`s (`COPY_WEEK_START_NOT_MONDAY`, `COPY_WEEK_SOURCE_TOO_LARGE` + the empty/unknown-location
  validation forms) with `ERROR_MESSAGES` entries; `test_errors.py` pins that every code has a message.
- **Backend — service (`49c1717`, T2 + docstring fix `b4aefab`):** `ActivityService.copy_week` is ONE
  atomic `@transactional` pipeline (no per-row `create()`, which commits per row): Monday validation,
  source/target `day_range` windows, filters (private / archived location / explicit location list),
  archived-master remap to the first active master with an intersecting CSV `specialty` in canonical
  board order (`sort_order, first_name, id`; no replacement → skip), merge dedup on
  `(master, service, start + 7d, duration)` against the target week AND within the run, cap 100 after
  dedup, direct ORM inserts + explicit `activity_tags` join rows + `mark_changed("tags")`. 17
  service-level tests in `backend/tests/test_copy_week.py`.
- **Backend — route (`04a83e4`, T3):** `POST /api/v1/activities/copy-week` behind `_WRITE_GUARD`;
  9 API tests (auth 401, master 403, CSRF 403, 422 non-Monday / empty locations / unknown location /
  cap, end-to-end merge, repeat → `copied=0`).
- **api-client + context (`00805b2`, T4):** `copyWeek` endpoint + zod schema in `packages/api-client`;
  the fake `copyLastWeek` stub in `ScheduleDataContext` replaced by a real mutation with family
  invalidation `['activities']`; all consumers/mocks re-typed.
- **Popover (`d1d5eef`, T5; review fixes `8eaf360`):** `CopyLastWeekPopover` — previous-week location
  picker with net «к копированию» counters (minus target-week duplicates, minus private), private-K
  hint, «первые 100 из N» cap note, empty state with a disabled CTA, spec §6 toasts, close-on-success,
  DST-safe date math via `shiftDateKey`; request always carries the explicit checked-location list.
- **Toolbar wiring (`93d5f08`, T6):** the «Копировать прошлую неделю» button opens the popover; the fake
  toast is deleted; `schedule-z-layering.spec.ts` S3 rerouted to the popover's real error toast.
- **e2e + CHANGELOG (`e1b001e`, T7; `851422a`):** `frontend/admin/e2e/copy-last-week.spec.ts` with S1–S8
  per spec §9 — seed anchors resolved from the DB, seed archives restored in `finally`; CHANGELOG
  Unreleased entry.

## Tasks (plan)

| # | Task | Status |
|---|------|--------|
| T1 | Copy-week backend contracts (schemas + error codes) | ✅ (`aef08be`) |
| T2 | `copy_week` service method (atomic pipeline) | ✅ (`49c1717`, docstring fix `b4aefab`) |
| T3 | Copy-week route + API tests | ✅ (`04a83e4`) |
| T4 | api-client + context mutation (stub → real mutation) | ✅ (`00805b2`) |
| T5 | `CopyLastWeekPopover` (location picker) | ✅ (`d1d5eef`, review `8eaf360`) |
| T6 | Toolbar wiring + honest toasts | ✅ (`93d5f08`) |
| T7 | e2e S1–S8 + CHANGELOG | ✅ (`e1b001e`, `851422a`) |

## User Scenarios (spec §9) — e2e anchors, all green

| # | Scenario | Status |
|---|----------|--------|
| S1 | Clean target week ← copy of the previous week, same slots, popup closes | ✅ |
| S2 | Immediate repeat → `copied=0`, «Всё уже есть», grid unchanged | ✅ |
| S3 | Merge into a partially occupied week — only missing rows copied | ✅ |
| S4 | `is_private=true` rows not copied; popup shows the K hint | ✅ |
| S5 | Archived location skipped; its activities are not copy candidates | ✅ |
| S6 | Archived master remap in canonical board order; no replacement → skip | ✅ |
| S7 | Unchecked location not copied — request carries the explicit list | ✅ |
| S8 | Empty previous week → empty state, «Скопировать» disabled | ✅ |

## Tests (final)

- **pytest:** full suite 2166 passed / 8 skipped; targeted `copy_week` service 17/17,
  API `-k copy_week` 29/29.
- **vitest (admin):** full 2087 passed / 0 failed; `CopyLastWeekPopover` 25/25; `tsc` clean.
- **e2e:** `copy-last-week.spec.ts` 8/8 (S1–S8), two consecutive runs + reviewer rerun green.
- **Visual gate:** PASS.

## Acceptance

All 7 plan tasks done; issue DoD covered by S1 (the button really copies) + S2 (repeat without
duplicates) + «молчаливых заглушек не осталось» (the fake toast is gone).
