# GH #325 — Удаление занятия в сценарии (каскадный долг 1/3)

- **Date**: 2026-09-26
- **Branch**: `325-activity-delete-scenario`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `4f08ff74` — 5 commits (`ae0933b2..556b4c63`), 22 files, +1129 / −142
- **Issue**: #325 — перенос удаления занятия из `ActivityService.delete` в сценарий `usecases/activities.py::delete_activity`
- **Spec**: `docs/specs/2026-09-20-activity-delete-scenario-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-20-activity-delete-scenario-plan.md` (5 tasks)
- **Canon**: `docs/domain-rules/service-layer.md` (rev8 — rule 10 пункт про занятие снят)

## Goal

Cascade debt 1/3: the activity delete moves out of `ActivityService.delete` into the new
`backend/src/usecases/activities.py::delete_activity` scenario (canonical corridor 2), with a full
cascade audit — every related entity (visits, payments, records, tags, photos) is deleted by its
owning service via bulk helpers. Backend-only, HTTP contracts / behavior / event grids unchanged.
Behavioral delta for the user: **NONE** (до = после).

## Summary of Changes (per task)

- **T1 (small):** bulk-помощники визитов и платежей — `VisitService.delete_visits_by_record_ids`,
  `PaymentService.delete_by_record_ids` (`ae0933b2`).
- **T2 (small):** bulk-помощник записей + фото-открепление —
  `RecordService.delete_rows_with_tags_bulk`, `PhotoService.unlink_from_activity` (`fb8e9aed`).
- **T3 (standard):** сценарий `delete_activity` в новом `backend/src/usecases/activities.py` +
  helper `ActivityService.delete_row_with_activity_tags`; тесты (сетка чистого занятия
  `{photos, tags, activities}` покрыта) (`a130eddb`).
- **T4 (standard):** проводка роута на сценарий, демонтаж `ActivityService.delete`, переезд
  spy-теста и 4 каскадных тестов на сценарий, обновление устаревающих упоминаний (докстринг
  роута, FK-карта, комментарии тестов, канон service-layer.md правило 10 — снят пункт про
  занятие, rev8) (`a724407d`).
- **T5 (trivial):** полная верификация + фикс ruff TC002 в `payment.py` (`556b4c63`).

## Test Results

- **pytest (full backend):** **2717 passed / 15 skipped / 0 failed** (32:24).
- **ruff:** delta vs merge-base = 0.
- **mypy:** delta = 0.
- **e2e `activity-deferred-delete.spec.ts`:** 8/8 green (7+1: S3 упал в первом прогоне на 5s
  UI-wait и прошёл при retry на идентичном сиде — flake, не регрессия; логи
  `/tmp/tester-t5-e2e-run7.log`, `/tmp/tester-t5-e2e-s3-retry.log`). Файл спеки e2e не тронут.
- **git status:** чист.

## Acceptance Criteria

| Criterion | Status |
|---|---|
| All endpoint contracts / behavior / event grids unchanged | ✅ (Behavioral Delta ветки идентичны: 422/404/409/204) |
| Event grids identical (`{records, visits, payments, tags, photos, activities}` / `{photos, tags, activities}`) | ✅ |
| Contract tests + e2e green WITHOUT contract edits | ✅ (Gate C не сработал — контракты не правились) |
| `ActivityService.delete` dismantled, route wired to scenario | ✅ T4 (`a724407d`) |
| Canon rule 10 пункт про занятие removed (rev8) | ✅ T4 (`a724407d`) |

## Key Files Changed

- `backend/src/usecases/activities.py` — new `delete_activity` scenario (T3)
- `backend/src/services/visit.py` — `delete_visits_by_record_ids` (T1)
- `backend/src/services/payment.py` — `delete_by_record_ids` (T1)
- `backend/src/services/record.py` — `delete_rows_with_tags_bulk` (T2)
- `backend/src/services/photo.py` — `unlink_from_activity` (T2)
- `backend/src/services/activity.py` — `delete_row_with_activity_tags` helper; `delete` demolished (T3/T4)
- `backend/src/api/v1/activities.py` — route DELETE /activities/{id} wired to scenario (T4)
- Tests: usecase + cascade-grid + spy tests re-bound to the scenario (T3/T4)
- `docs/domain-rules/service-layer.md` — rev8 (T4)

## Docs Impact

- `PLAN.md` — completion blockquote in the header (this docs commit).
- `CHANGELOG.md` — new entry under `[Unreleased]` (this docs commit).
- Spec/plan pre-existing on main, unchanged by IMPL.

## Behavioral Delta

None — internal refactor; nothing changes for the user.

## Follow-ups (NOT in this PR)

- S3 e2e flake (5s visibility wait on compile-laden route) — отдельный тикет.

## References

- **GitHub Issue**: #325
- **Design Spec**: `docs/specs/2026-09-20-activity-delete-scenario-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-20-activity-delete-scenario-plan.md`
- **Canon**: `docs/domain-rules/service-layer.md` (rev8)
- **Related**: #326 (каскадный долг 2/3 — usecases для staff), #217 (corridor 3 / composite reads)
- **PR**: _(to be added after PR creation)_
