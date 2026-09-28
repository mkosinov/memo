# GH #324 — Остаток семьи удалений «навсегда» (этапы 2+3 из #346)

- **Date**: 2026-09-26
- **Branch**: `324-delete-family-remaining`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `20b710f7` (main) — 10 commits (`cfb0ec95..c55ef3ef`), 70 files, +9051 / −574
- **Issue**: #324 — Delete без is_active: довести честный контракт удаления до visitors/positions/photos/user_settings + тест-страж
- **Spec**: `docs/specs/2026-09-21-delete-family-remaining-324-design.md` (rev3, canon — on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-21-delete-family-remaining-324-plan.md` (9 tasks — on main; 9/9 DONE)
- **Roadmap**: этапы 2+3 из #346 (единый флоу удалений; этап 1 = теги #318, остаток — архивируемые #345)
- **Canon**: пер-сущностные секции (`visitors.md`/`photos.md`/`visits.md`/`payments.md`/`user_settings.md`/`staff.md`/`_overview.md`) пришли спека-коммитом `5fdeac5b` на main; доспех фаз (`deletion.md` таблица применения, `_overview.md` отметка #346, `staff.md` секция удаления должностей, CHANGELOG, PLAN) — этим docs-коммитом

## Goal

Визиты, оплаты, фото, настройки, посетители и должности переводятся на единый
семейный контракт удалений #318 (`?dry_run=true` превью / голый DELETE → 422 /
тело `{resolutions?, expected}` с subset-сверкой / кольцо 5 с) плюс тест-страж
«схема ↔ матрица», краснеющий на новой незадекларированной FK-связи или
DELETE-руте в том же PR.

## Summary of Changes (per task)

- **T1 (standard, `cfb0ec95`) — домен: матрица + реестры шести субъектов:**
  `FK_MATRIX` + счётчики / id-коллекторы / item-коллекторы / каскад-хендлеры
  для Visit, Payment, UserSettings (листья), Photo (`photo_tags` — видимая),
  Visitor (`visits` — видимая + `visitor_tags` auto), Position
  (`staff_positions` — видимая); `tests/domain/test_deletion_family.py`.
- **T2 (standard, `ac12e909`) — пачка визитов посетителя:**
  `VisitService.delete_visits_by_visitor` — один bulk-DELETE + пересчёт
  статуса/мест каждой затронутой записи (`recompute_record_*` — те же хуки, что
  одиночный путь); SSE-метки `visits`+`records`; `VisitorService._delete_cascade`
  делегирует блоку (клиент-каскад наследует пересчёт), исполнитель
  `(Visitor, "visits")`; `repositories/visit.py` — set-based bulk.
- **T3 (standard, `42d63d6f`) — единый контракт шести DELETE-рутов:** порядок
  форма → probe → guard → развилка; общий транспорт `_delete_family.py` +
  `DeleteBody` в `schemas/common.py`; голый DELETE всех шести → 422
  `expected_state_required`, превью — только `?dry_run=true`; системная охрана
  должности — до развилки; 14 тест-файлов переведены на commit-body.
- **T4 (small, `d7a0a09d`) — тест-страж «схема ↔ матрица»:**
  `test_delete_matrix_guard.py` — (1) входящие FK-рёбра схемы против
  `FK_MATRIX`, (2) все DELETE-руты против `FK_MATRIX` (нормализация префиксов).
- **T5 (large, `8f83bfcf`) — бэкенд-тесты:** 108 новых — mixin
  `delete_family_full_contract.py` (полный флейвор: dry_run 204/409-дерево,
  голый 422, subset-сверка, stale 409, 404, `allowed_actions`) + 7
  пер-сущностных файлов.
- **T6 (small, `8cc18290`) — api-client:** `deleteVisit`/`deletePayment`
  optional body — deferred-хуки шлют `{expected: {}}`; мок-обвязка
  синхронизирована.
- **T7 (standard, `1b9020d0`) — фронт: фото и должности на конвейер:**
  `usePhotosMutations` / `usePositionsMutations` (по образцу тегов), `DeleteDialog`
  типы узлов, `staleAwareOnError` overload, `Photo/PositionsTable` проводка
  (`window.confirm` должностей удалён).
- **T8 (standard, `71ba19f1` + `b5058241`) — фронт: посетители на конвейер:**
  `useVisitorsMutations`; `ClientInfoTab` переведён на useQuery-рендер — undo
  визуально возвращает строку (единственный прод-вызов); rollback DELETE несёт
  обязательное `{expected:{}}`.
- **T9 (large, `c55ef3ef`) — e2e §9.1–§9.6:** 3 новых спеки
  (`photos-deferred-delete`, `visitors-deferred-delete`,
  `positions-deferred-delete`) + factories cleanup + миграция `staff-s5`.

## Test Results

- **pytest (полный):** **2609 passed / 0 failed / 15 skipped** (прогон до T6–T9;
  бэкенд дальше не трогался).
- **admin vitest (полный):** **2521 passed / 0 failed** (157 файлов).
- **api-client vitest:** **424 passed / 0 failed**.
- **e2e:** §9-сценарии **6/6** (изолированный стек :8021/:3022) + collateral
  (`staff-s5` 6/6, `photos-crud` 19/19, `clients` 18/19 → известный флейк, реран
  зелёный).
- **tsc / eslint / next build:** чисты.

## Acceptance Criteria (spec §8 behavioral delta)

| Сценарий | Статус |
|---|---|
| Фото с тегами → диалог + кольцо; после окна теги отвязаны, фото удалено | ✅ e2e §9.2 |
| Чистое фото → кольцо без диалога, отмена возвращает | ✅ e2e §9.1 |
| Посетитель с визитами → диалог + честный пересчёт записей | ✅ e2e §9.3 + pytest (включая клиент-каскад) |
| Гонка в окне (stale_dependencies) → честная ошибка + «Обновить» | ✅ e2e §9.4 |
| Занятая должность → диалог «Сотрудники: N» → отвязка | ✅ e2e §9.5 |
| Системная должность → ранняя 422 `POSITION_IS_SYSTEM` | ✅ e2e §9.6 (api + дым) |
| Голый DELETE всех 6 рутов → 422 `expected_state_required` | ✅ pytest |
| Новый FK без декларации → страж красный | ✅ pytest (страж) |
| Визиты/оплаты UI видимо без изменений (тело `{expected:{}}`) | ✅ vitest + api-client |

## Key Files Changed

- `backend/src/domain/deletion.py` — матрица + реестры шести субъектов (T1)
- `backend/src/services/visit.py`, `backend/src/repositories/visit.py` — блок `delete_visits_by_visitor` (T2)
- `backend/src/services/visitor.py` — делегация `_delete_cascade` (T2)
- `backend/src/api/v1/_delete_family.py` + 6 рутов (visits/payments/photos/user_settings/visitors/position) — единый контракт (T3)
- `backend/src/schemas/common.py` — `DeleteBody` (T3)
- `backend/tests/test_delete_matrix_guard.py` — страж (T4); `delete_family_full_contract.py` + 7 пер-сущностных файлов (T5)
- `packages/api-client/src/endpoints.ts` — optional body визитов/оплат + dry-run/resolve (T6–T8)
- `frontend/admin/hooks/usePhotosMutations.ts` / `usePositionsMutations.ts` / `useVisitorsMutations.ts` / `useRecordMutations.ts` (T7–T8)
- `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` — useQuery-рендер (T8)
- `frontend/admin/lib/staleAwareOnError.ts`, `DeleteDialog.tsx`, таблицы/колонки фото и должностей (T7)
- e2e: `photos-deferred-delete.spec.ts`, `visitors-deferred-delete.spec.ts`, `positions-deferred-delete.spec.ts`, `staff-s5-positions-directory.spec.ts`, `fixtures/factories.ts` (T9)

## Docs Impact

- Спека rev3 (canon) + план (9 задач) на main, веткой не менялись; пер-сущностные
  секции канона пришли спека-коммитом `5fdeac5b` на main.
- Этим docs-коммитом: `deletion.md` (таблица применения — фазы выполнены),
  `_overview.md` (отметка этапов 2+3 #346, снят future-tense), `staff.md`
  (секция удаления должностей), `CHANGELOG.md`, `PLAN.md`, этот status-файл.

## Known Non-Blocking Observations

- Полный e2e-гейт — CI (PR); локально прогнаны §9-сценарии и collateral.
- Этап 4 трекера #346 (архивируемые: staff/location/service/material/client) —
  #345, вне рамок ветки; `delete_client` usecase — #327 (строительный блок T2
  готов).
- Флейк `clients` e2e (18/19) — известный, зелёный на реране; механизм не из
  этой ветки.

## References

- **GitHub Issue**: #324
- **Design Spec**: `docs/specs/2026-09-21-delete-family-remaining-324-design.md` (rev3, on main)
- **Plan**: `docs/plans/2026-09-21-delete-family-remaining-324-plan.md` (on main)
- **Canon**: `docs/domain-rules/deletion.md`, `_overview.md`, `staff.md`, `visitors.md`, `photos.md`, `visits.md`, `payments.md`, `user_settings.md`
- **Reference contracts**: #285 (records), #318 (tags)
- **PR**: _(to be added after PR creation)_
