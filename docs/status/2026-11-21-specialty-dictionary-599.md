# GH #599 — Справочник направлений (specialty dictionary)

- **Date**: 2026-11-21
- **Branch**: `599-specialty-dictionary` (base `697afb55` = origin/main;
  HEAD `95663f0b`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `697afb55` — 9 задач, 15 коммитов `c7a987dd..95663f0b`,
  155 файлов, +9590/−759
- **Issue**: #599 — направление студии было свободным текстом в двух
  местах (`services.specialty` String(20), `masters.specialty` Text-CSV):
  «Живопись» и «живопись» для системы — разные направления, опечатки не
  ловились, ввод вручную без справочника. Решение — таблица-справочник
  `specialties`: услуга ссылается ровно на одну запись (FK NOT NULL,
  обязательное), сотрудник — на несколько (M2M `staff_specialties`);
  админка — вкладка «Направления» на странице услуг + выбор из
  справочника в модалках; удаление — семейный контракт #324 (услуги —
  блокирующая зависимость, staff-связи — auto-cascade). Web и публичные
  контракты не меняются. Волна ADR-015.
- **Спека**: `docs/specs/2026-11-13-specialty-dictionary-599-design.md`
  (рев.4) — на main (`c2d0e661`), unchanged by IMPL
- **План**: `docs/plans/2026-11-13-specialty-dictionary-599-plan.md`
  — на main (`c2d0e661`), 9/9 задач, все done, unchanged by IMPL
- **Domain rules**: базовый канон (`specialties.md` новый;
  `staff.md`/`activities.md`/`profile.md`/`_overview.md` правлены)
  влит на main вместе со спекой (`c2d0e661`, канон: дом-правила едут
  со спекой); в ветке — добивка пробелов, найденных ревью задач:
  `deletion.md` + `_overview.md` (строки Specialty в матрицах,
  `bd1cbc88`) и `services.md` (R2-контракт specialty_id, `b55c83d2`);
  docser-хвост — сид-раздел `specialties.md` доведён до кода
  (`specialties.yaml` формат, `SPECIALTY_MAX`, дубли в файле).

## Что выполнено

1. **Сущность Specialty (T1, `c7a987dd` standard)** — модель
   `Specialty` (`AbstractModel`, `title: String(100)`, функциональный
   уникальный индекс `lower(title)` пишется в миграции вручную),
   миграция R1 (`specialties` + 2 индекса, `staff_specialties` —
   составной PK, оба FK CASCADE, `passive_deletes=True`, индекс по
   `specialty_id`; `services.specialty_id` FK RESTRICT NULLABLE),
   Pydantic-схемы с нормализацией title (trim, схлопывание пробелов,
   NFC; пустое → 422), CRUD-роутер — зеркало позиционного: пагинированный
   список БЕЗ `sort_by` (фикс. `title ASC, id ASC`), `/all` с
   `BARE_LIST_MAX_ROWS`, гарды поимённо (`specialties:read` /
   `specialties:write` + CSRF); 409 `SPECIALTY_TITLE_TAKEN` — поимка
   `IntegrityError` (SELECT-предпроверка — только UX-быстрый путь),
   rename-to-self — успех.
2. **Delete-family (T2, `60a883ab` + docs `bd1cbc88` standard)** —
   реестр зависимостей: `services` — видимая блокирующая
   (`allowed_actions: []`, счётчик по всем услугам включая архивные),
   `staff_specialties` — auto-cascade (образец материалов). Маршрут —
   зеркало позиционного: форма → probe (404) → dry_run/commit; голый
   DELETE и тело при dry_run → 422. Строки Specialty в
   `deletion.md`/`_overview.md` — пробел, отмеченный ревью задачи.
3. **Услуги на specialty_id (T3, `b55c83d2` + fix `48071eee`
   standard)** — миграция R2 (`specialty_id` → NOT NULL, дроп
   `services.specialty`); `ServiceCreate.specialty_id` обязательно
   (неизвестный id → 422 предвалидацией, образец материалов), PUT
   требует поле, PATCH: absent → сохранить, явный `null` → 422
   (обнуление невозможно); `ServiceView` сохраняет строку `specialty`
   + `specialty_id`; списки — один JOIN (`services_specialty_join` +
   `contains_eager`, N+1-гвард); сортировка `sort_by=specialty` →
   JOIN `Specialty.title` через `domain/sorting.py`.
4. **Master-секция на specialty_ids (T4, `dc72cdb6` standard)** —
   миграция R3 (дроп `masters.specialty`); вход `specialty_ids`
   hard-replace (дедуп; >50 после дедупа → 422; неизвестный id → 422;
   пустой набор при живой секции → 422 `SPECIALTY_REQUIRED` — D5 без
   ослабления); ответ — алфавитная строка «, » + `specialty_ids`;
   список сотрудников — `selectinload` (N+1-гвард); сортировка staff
   `specialty` — корреляционный скалярный подзапрос
   `string_agg(title ORDER BY title, ', ')` в `SortKeySpec`
   (`always_nulls_last`).
5. **Прочие потребители (T5, `114bb309` standard)** — copy-week ремап
   архивного мастера по пересечению связей по id (не по тексту);
   `/my` — `specialties` из связей по алфавиту
   (`MyProfileUpdate.specialties` — принимается-но-игнорируется);
   аудит-снапшоты несут название вместе с `specialty_id`; sqladmin —
   связь вместо колонки; web e2e-фикстуры с raw-SQL INSERT переведены
   на схему без колонки `specialty` (обе: `visibility-pair.ts` и
   `location-visibility-pair.ts`).
6. **api-client (T6, `59eae7ca` small)** — `SpecialtyView/Create/Update`
   + эндпоинты (зеркало позиционного набора), `ServiceCreate.specialty_id`,
   `MasterSectionInput.specialty_ids`; `packages/domain` без правок
   (строка сохраняется). Контракт **616/616**.
7. **Сид и предзагрузка (T7, `893a1d10` + polish `328f4f8f`
   standard)** — dev-сид: ≥3 направлений, мастер с 2+ направлениями,
   введёнными не по алфавиту; прод-загрузчик `_apply_specialties` —
   upsert по `lower(title)` (список названий независимо от формата
   файла — стык с #612); `seed-data/specialties.yaml`; ссылки по
   названию в `services.yaml`/`staff.yaml` с регистронезависимым
   резолвом (неизвестное → ошибка с именем значения), старый CSV-ключ
   `specialty` в staff.yaml → ошибка (`extra="forbid"`).
8. **Admin UI (T8, `20d536a0` + `f87dbd36` + `4b22f623` + polish
   `e66b9541`, large — 3 staged подзадачи)** — вкладка «Направления»
   на странице услуг (третий вид по образцу «Материалов»:
   `specialties-tab`, свой URL-префикс, `SpecialtiesProvider`
   server-paginated, монтируется только видимый вид; видна при
   `specialties:read`); `SpecialtiesTable` + `SpecialtyModal` (одно
   поле, 409 «такое направление уже есть»); удаление — deferred-
   конвейер (dry_run/commit, 409-дерево «Услуги: N»); в модалке услуги
   — словарный селект из `/specialties/all`, в `StaffModal` — чекбоксы,
   payload master-секции на `specialty_ids`.
9. **E2E сценарии 1–2 (T9, `95663f0b` standard)** — сервисный e2e:
   создание услуги с выбором направления из выпадающего списка,
   таблица показывает направление (сценарий 1); staff-e2e: сотрудник
   с направлениями не по алфавиту → алфавитная строка в карточке и
   таблице (сценарий 2).

## Отклонения и фикс-циклы

- Девиаций от спеки рев.4 нет; спека, план и базовый канон дом-правил —
  коммиты main (`c2d0e661`) ещё до ветки, IMPL их не касался.
  Разбивка DDL на три ревизии R1/R2/R3 (ради зелёного дерева после
  каждой задачи) — зафиксирована в плане как решение план-ревью 13.11,
  конечное состояние совпадает со спекой §4.1.
- Полировка в скоупе задач: doc-гэп строк Specialty в матрицах
  удалений (`bd1cbc88`), fix сервисного контракта R2 (`48071eee`),
  полировка вкладки направлений (`e66b9541`), polish сид-задачи
  (`328f4f8f`).
- **Visual gate**: §7 спеки — 1 машинная проверка (`specialties-tab`)
  пройдена раннером exit 0; 3 manual-review пункта — by design
  (раннер не кликает — канон харнесса #602). GREEN.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Backend pytest (полный) | **4287 passed / 92 skipped** |
| Backend ruff + lint_budget | **109/109** |
| admin vitest (полный) | **3212/3212** |
| admin `tsc --noEmit` / lint | **0 / чистый** |
| api-client vitest (T6) | **616/616** |
| e2e `specialties-crud` (сценарии 3–5a/b/c, T8) | **5/5** |
| e2e расширенные service/staff спеки (сценарии 1–2, T9) | **17/17** |
| e2e tags canary (регресс) | **11/11** |
| Visual Compliance gate | **exit 0** (1 machine PASSED `specialties-tab`, 3 manual by design) |

Dev-пересид (удалён backend/memo.db; seed + alembic на :8020, дефолтные
порты заняты стеком 606) — связные данные: 3 специальности
(Декор/Живопись/Керамика), 7/7 услуг с резолвящимся specialty_id,
мастер с 2 specialty_ids (Живопись+Керамика), ошибок сидирования нет.

Приёмка: сценарии 1–5a/b/c спеки §7 — все зелёные (unit + e2e +
visual). Спека Behavioral Delta (§8) реализована полностью.

## Известные остатки (follow-up-кандидаты, не в этом PR)

- Осознанных остатков нет. Открытые смежные волны независимы: #612
  (CSV-загрузчик — меняет только парсер, `_apply_specialties`
  format-agnostic) и #606 (публичное чтение словарей + гарды —
  после v1).

## PR-заметки

- `Closes #599` — только в описании PR (канон репо), в коммиты не
  пишется.
- Спека рев.4 и план (`c2d0e661`) — на main, unchanged by IMPL;
  docser-коммит — дом-правила (сид-раздел `specialties.md`) + мета-доки
  (PLAN.md, CHANGELOG.md, этот файл).
- Доска: карточка #599 остаётся `In IMPL` до создания PR (перевод в
  `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only 697afb55..95663f0b`)

```
backend/alembic/versions/a5c7e9b1d3f4_specialty_dictionary_r1.py
backend/alembic/versions/b8d2e6f4a9c1_specialty_dictionary_r2.py
backend/alembic/versions/d4f6a8c0e2b1_specialty_dictionary_r3.py
backend/seed-data/README.md
backend/seed-data/services.yaml
backend/seed-data/specialties.yaml
backend/seed-data/staff.yaml
backend/src/admin/setup.py
backend/src/api/v1/services.py
backend/src/api/v1/specialties.py
backend/src/api/v1/staff.py
backend/src/db/database.py
backend/src/domain/deletion.py
backend/src/domain/errors.py
backend/src/domain/sorting.py
backend/src/errors.py
backend/src/events/audit.py
backend/src/main.py
backend/src/models/__init__.py
backend/src/models/master.py
backend/src/models/service.py
backend/src/models/specialty.py
backend/src/models/staff.py
backend/src/schemas/my.py
backend/src/schemas/service.py
backend/src/schemas/specialty.py
backend/src/schemas/staff.py
backend/src/seed/reference.py
backend/src/seed/seed.py
backend/src/services/activity.py
backend/src/services/master.py
backend/src/services/profile.py
backend/src/services/service.py
backend/src/services/specialty.py
backend/src/services/staff.py
backend/src/usecases/staff.py
backend/tests/conftest.py
backend/tests/domain/test_deletion.py
backend/tests/domain/test_deletion_archivable.py
backend/tests/domain/test_deletion_family.py
backend/tests/domain/test_deletion_tags.py
backend/tests/domain/test_sorting.py
backend/tests/fixtures/seed.py
backend/tests/generic_contract.py
backend/tests/services/test_archive_service.py
backend/tests/services/test_delete_cascades.py
backend/tests/services/test_delete_visits_by_visitor.py
backend/tests/services/test_master_service.py
backend/tests/services/test_photo_service.py
backend/tests/services/test_service_module_helpers.py
backend/tests/services/test_service_service.py
backend/tests/services/test_staff_service.py
backend/tests/services/test_tariff_visit_unlink.py
backend/tests/services/test_visit_service.py
backend/tests/services/test_visitor_service.py
backend/tests/test_admin_sqladmin_pages.py
backend/tests/test_api_activities.py
backend/tests/test_api_my.py
backend/tests/test_api_payments.py
backend/tests/test_api_services.py
backend/tests/test_api_specialties.py
backend/tests/test_api_staff.py
backend/tests/test_audit_autocollect.py
backend/tests/test_audit_explicit.py
backend/tests/test_audit_unit.py
backend/tests/test_auth_guards.py
backend/tests/test_auth_scope.py
backend/tests/test_copy_week.py
backend/tests/test_coverage_boost.py
backend/tests/test_delete_matrix_guard.py
backend/tests/test_errors.py
backend/tests/test_events_entities.py
backend/tests/test_integration_flows.py
backend/tests/test_list_id_uniform_guards.py
backend/tests/test_master_scope_contract.py
backend/tests/test_migration_tariff_audience.py
backend/tests/test_models.py
backend/tests/test_notification_migration.py
backend/tests/test_patch_is_active.py
backend/tests/test_patch_service_tariffs.py
backend/tests/test_put_is_active.py
backend/tests/test_repository_bulk_commands.py
backend/tests/test_repository_list.py
backend/tests/test_schemas_service.py
backend/tests/test_seed.py
backend/tests/test_seed_reference_specialties.py
backend/tests/test_service_record_view.py
backend/tests/test_specialty_dictionary_migration.py
backend/tests/test_staff_restructuring_migration_data.py
backend/tests/test_staff_restructuring_models_migration.py
backend/tests/test_update_rejects_is_active.py
backend/tests/test_user_client_migration.py
backend/tests/usecases/test_staff_archive.py
backend/tests/usecases/test_staff_create.py
backend/tests/usecases/test_staff_delete.py
backend/tests/usecases/test_staff_update_patch.py
docs/domain-rules/_overview.md
docs/domain-rules/deletion.md
docs/domain-rules/services.md
frontend/admin/__tests__/ClientQuickCard.test.tsx
frontend/admin/__tests__/DeleteDialog.test.tsx
frontend/admin/__tests__/PhotosContext.test.tsx
frontend/admin/__tests__/RecordsFilters.test.tsx
frontend/admin/__tests__/ServiceModal.test.tsx
frontend/admin/__tests__/ServicesTable.test.tsx
frontend/admin/__tests__/StaffAccountBlock.test.tsx
frontend/admin/__tests__/StaffModal.test.tsx
frontend/admin/__tests__/StaffTable.test.tsx
frontend/admin/__tests__/buildAdminSchedule.test.ts
frontend/admin/__tests__/helpers/mockData.ts
frontend/admin/__tests__/invalidate.test.ts
frontend/admin/__tests__/photos/PhotosFilters.test.tsx
frontend/admin/__tests__/photos/photoColumns.test.tsx
frontend/admin/__tests__/recordsTimeParity.test.ts
frontend/admin/__tests__/scheduleIntegration.test.tsx
frontend/admin/__tests__/serviceColumns.test.tsx
frontend/admin/__tests__/specialties/ServicesPageSpecialtiesTab.test.tsx
frontend/admin/__tests__/specialties/SpecialtiesTable.test.tsx
frontend/admin/__tests__/specialties/SpecialtiesTableDeleteFlow.test.tsx
frontend/admin/__tests__/specialties/useSpecialtiesUrlState.test.tsx
frontend/admin/__tests__/timezone-dnd-bug.test.ts
frontend/admin/__tests__/transformers.test.ts
frontend/admin/__tests__/useDeleteService.test.ts
frontend/admin/__tests__/useReactQueryHooks.test.tsx
frontend/admin/__tests__/useServicesMutations.test.ts
frontend/admin/__tests__/useStaffMutations.test.ts
frontend/admin/app/(main)/services/components/ServiceModal.tsx
frontend/admin/app/(main)/services/components/ServicesTable.tsx
frontend/admin/app/(main)/services/components/SpecialtiesTable.tsx
frontend/admin/app/(main)/services/components/SpecialtyModal.tsx
frontend/admin/app/(main)/services/components/serviceFields.tsx
frontend/admin/app/(main)/services/components/specialtyColumns.tsx
frontend/admin/app/(main)/services/components/specialtyFields.ts
frontend/admin/app/(main)/services/page.tsx
frontend/admin/app/(main)/services/useServicesUrlState.ts
frontend/admin/app/(main)/staff/components/StaffModal.tsx
frontend/admin/app/(main)/staff/components/StaffTable.tsx
frontend/admin/app/components/DeleteDialog.tsx
frontend/admin/app/lib/api/parseApiError.ts
frontend/admin/contexts/SpecialtiesContext.tsx
frontend/admin/e2e/fixtures/factories.ts
frontend/admin/e2e/fixtures/helpers.ts
frontend/admin/e2e/services-crud.spec.ts
frontend/admin/e2e/specialties-crud.spec.ts
frontend/admin/e2e/staff-s7-create-composite.spec.ts
frontend/admin/hooks/useSpecialties.ts
frontend/admin/hooks/useSpecialtiesMutations.ts
frontend/admin/lib/queryKeys.ts
frontend/web/e2e/fixtures/location-visibility-pair.ts
frontend/web/e2e/fixtures/visibility-pair.ts
packages/api-client/src/__fixtures__/backend-responses.json
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
```

## References

- **GitHub Issue**: #599
- **Design Spec**: `docs/specs/2026-11-13-specialty-dictionary-599-design.md` (рев.4)
- **Plan**: `docs/plans/2026-11-13-specialty-dictionary-599-plan.md` (9/9)
- **Domain rules**: `docs/domain-rules/specialties.md` (канон на main
  `c2d0e661` + сид-раздел — docser), `docs/domain-rules/services.md`
  (`specialty_id`, ветка `b55c83d2`), `docs/domain-rules/staff.md`
  (M2M, main), `docs/domain-rules/deletion.md` + `_overview.md`
  (матрицы, ветка `bd1cbc88`)
- **Смежные**: #612 (CSV-загрузчик — стык по `_apply_specialties`),
  #606 (публичное чтение словарей — после v1), #324 (семейный контракт
  удалений — зеркало позиционного роута), #207 (образец auto-cascade),
  #205 (пагинация справочников), #349 (URL-state третьего вида)
- **PR**: _(to be added after PR creation)_
