# План: Справочник направлений (specialty) — #599

## Goal
Заменить свободный текст направлений (`services.specialty` String(20), `masters.specialty` Text-CSV) справочником `specialties`: услуга — FK `specialty_id` (ровно одно, обязательное), сотрудник — M2M `staff_specialties`; админка — вкладка «Направления» на странице услуг (третий вид рядом с «Материалами»), выбор из справочника в модалках; удаление — семейный контракт (services — блокирующая зависимость, staff-связи — auto-cascade). Web и публичные контракты не меняются.

## Architecture
Слои снизу вверх: модель + миграции → схемы Pydantic → generic-сервис/роутер справочника (гарды, delete-family) → перевод потребителей (services, staff/master-секция, activity copy-week, /my profile, аудит, sqladmin) → api-client → сид и предзагрузка → admin UI. Сортировочные выражения живут только в `domain/sorting.py` (локальные резолверы запрещены). Строковые поля отображения (`specialty: str`) сохраняются во всех ответах — отображающий код таблиц/шапки не меняется.

## Tech Stack
FastAPI + SQLAlchemy (async) + alembic (SQLite dev, Postgres prod-мишень); Pydantic v2; React/Next admin + @memo/api-client; vitest + Playwright; pytest.

## Behavioral Delta
Живёт в спеке §8 (`docs/specs/2026-11-13-specialty-dictionary-599-design.md`, рев.3 = main f222e2b6) — задачами не пересказывается.

## Инварианты волны
- Дерево зелёное после каждой задачи: миграция — три DDL-ревизии. R1 (Task 1) добавляет структуры: `specialties` + оба индекса, `staff_specialties`, `services.specialty_id` NULLABLE. R2 (Task 3) — `services.specialty_id` → NOT NULL + дроп `services.specialty`. R3 (Task 4) — дроп `masters.specialty`. Конечное состояние и набор операций совпадают со спекой §4.1 — разбивка на порядок наката ради зелёного дерева, без изменения контракта (решение план-ревью 13.11); на непустой dev-базе первым падает R2 — штатная ошибка NOT NULL, ожидаемое поведение.
- Миграции — DDL-only; dev-база (`backend/memo.db`, SQLite) пересида once в конце волны: удалить файл, поднять стек через dev.sh (он накатывает миграции и сеет). На непустой dev-базе R2 упадёт со штатной ошибкой NOT NULL — это ожидаемое поведение (спека §4.1).
- Дом-правила уже на main (specialties.md новый; services/staff/activities/_overview правлены) — задачами не дублируются, только соблюдаются.

## Task 1: Сущность Specialty — модель, миграция R1, схемы, CRUD-роутер
### Classification: standard
### Required Docs: docs/domain-rules/specialties.md (целиком), docs/domain-rules/_overview.md
- `backend/src/models/specialty.py`: класс `Specialty`, `__tablename__ = "specialties"`, `AbstractModel`, `title: String(100)`; функциональный уникальный индекс `lower(title)` — в миграции пишется вручную (`op.create_index(..., sa.text("lower(title)"))`).
- Миграция R1: `specialties` (+2 индекса), `staff_specialties` (составной PK `(staff_id, specialty_id)`, оба FK CASCADE, `passive_deletes=True`, отдельный индекс по `specialty_id`), `services.specialty_id` — FK RESTRICT, NULLABLE (NOT NULL придёт в R2).
- `backend/src/schemas/specialty.py`: `SpecialtyView {id, title, created_at, updated_at}` + Create/Update; нормализация title при записи — trim, схлопывание внутренних пробелов, NFC, пустое/пробельное → 422.
- `backend/src/services/specialty.py` + `backend/src/api/v1/specialties.py`: зеркало позиционного роута — пагинированный список БЕЗ `sort_by` (фикс. `title ASC, id ASC`), `/all` c `BARE_LIST_MAX_ROWS`, POST/PATCH/DELETE; гарды поимённо: `_READ_GUARD = require_permission("specialties:read")`, `_WRITE_GUARD` = `specialties:write` + `verify_fetch_metadata`; 409 `SPECIALTY_TITLE_TAKEN` — поимка `IntegrityError` уникального индекса (SELECT-предпроверка — только UX-быстрый путь); переименование в собственный регистровый вариант — успех; код и сообщение ошибки — в `errors.py`.
- **DoD:** юнит-тесты: нормализация (trim/пробелы/NFC/пустое→422); 409 по IntegrityError-пути и по предпроверке; rename-to-self ok; гарды 403; лист delete-family (без связей) — dry_run 204 / commit 204; миграция R1 up/down на пустой базе зелёные.

## Task 2: Delete-family направления — services (блокирующая) + staff (auto-cascade)
### Classification: standard
### Required Docs: docs/domain-rules/specialties.md (Delete semantics), docs/domain-rules/deletion.md
- Регистрация зависимостей в delete-family реестре: `services` — видимая блокирующая, `allowed_actions: []`, счётчик по **всем** услугам включая архивные; `staff_specialties` — auto-cascade (образец — материалы: commit `{"resolutions": {}}`).
- Порядок проверок зеркала позиционного роута: форма → probe (404) → dry_run/commit; голый DELETE и тело при dry_run → 422.
- **DoD:** юнит-тесты трёх состояний: занято услугой → 409 `has_dependencies` с узлом «Услуги: N»; занято только архивной услугой → 409; только сотрудники → commit `{"resolutions": {}}` → отвязка + 204; лист → 204.

## Task 3: Услуги на specialty_id + миграция R2 (NOT NULL, дроп старых колонок)
### Classification: standard
### Required Docs: docs/domain-rules/services.md, docs/domain-rules/specialties.md
- `schemas/service.py`: `ServiceCreate.specialty_id` (обязательное; неизвестный id → 422 предвалидацией по образцу материалов), `ServiceUpdate.specialty_id: UUID | None` (отсутствует → сохранить; явный `null` → 422), `ServiceView` сохраняет `specialty: str` + добавляет `specialty_id`.
- `services/service.py`: `NOT_NULL_FIELDS` → `specialty_id`; списки/`/all`/GET — `joinedload` направления (N+1-гвард в тесте).
- `api/v1/services.py`: sort key `specialty` → JOIN `Specialty.title` через `domain/sorting.py`.
- Миграция R2: `services.specialty_id` → NOT NULL; дроп `services.specialty`; downgrade возвращает пустую текстовую колонку. (Дроп `masters.specialty` — отдельная ревизия R3 в Task 4: код мастера перестаёт читать колонку только там.)
- **DoD:** юнит-тесты: неизвестный id → 422; явный null → 422; PATCH без поля сохраняет направление; N+1-гвард; сортировка услуг по названию направления; миграция R2 на пустой базе зелёная; негатив-тест — на базе со старой схемой и хотя бы одной строкой услуг накат R2 падает со штатной ошибкой NOT NULL (ожидаемое поведение, спека §4.1).

## Task 4: Master-секция на specialty_ids
### Classification: large
### Required Docs: docs/domain-rules/staff.md, docs/domain-rules/specialties.md
- `schemas/staff.py`/`schemas/master.py`: вход master-секции `specialty_ids: list[UUID]` (hard-replace как `position_ids`; дедуп дубликатов; после дедупа >50 → 422; неизвестный id → 422; пустой набор при живой секции → 422 `SPECIALTY_REQUIRED` — D5 без ослабления); ответ — `specialty: str` (названия через «, », по алфавиту) + `specialty_ids`; `MasterView.specialty` — та же joined-строка.
- `services/master.py` (`_require_section_fields` — непустота набора вместо непустой строки; удалить `_split_specialty*`-хелперы из `services/master.py`/`services/profile.py`), `usecases/staff.py` (`_write_section`, чтение секции), `services/staff.py`.
- Список сотрудников — `selectinload` связей (N+1-гвард).
- Сортировка staff `specialty` — корреляционный скалярный подзапрос `string_agg(title ORDER BY title, ', ')` в `SortKeySpec` (`domain/sorting.py`; НЕ GROUP BY; `always_nulls_last` — нет master-секции → в конце); проверить на обоих диалектах (SQLite + Postgres-совместимое выражение).
- Миграция R3: дроп `masters.specialty`; downgrade возвращает пустую текстовую колонку.
- **DoD:** юнит-тесты: D5 → 422; неизвестный id → 422; дедуп и лимит 50; hard-replace; различающие данные — ввод «Керамика», «Живопись» → ответ `specialty = "Живопись, Керамика"`; сортировка asc/desc — сотрудник без master-секции в конце в обоих направлениях; N+1-гвард.

## Task 5: Прочие потребители
### Classification: standard
### Required Docs: docs/domain-rules/activities.md, docs/domain-rules/profile.md, docs/domain-rules/specialties.md
- `services/activity.py`: ремап архивного мастера при copy-week — пересечение по id связей (вместо `_split_specialty`).
- `services/profile.py` + `schemas/my.py`: `MyProfileResponse.specialties` из связей (по алфавиту, форма не меняется); `MyProfileUpdate.specialties` остаётся «принимается-но-игнорируется» + юнит-тест на игнор.
- `events/audit.py`: снапшоты несут название **вместе с `specialty_id`**.
- `admin/setup.py`: колонка `Service.specialty` в `column_list` → связь (`specialty.title`); inline-редактирование master-секции — на id-набор.
- Web e2e-фикстуры с raw-SQL INSERT — обе переводятся на создание без колонки `specialty` (услуга получает направление через сид/создание связи): `frontend/web/e2e/fixtures/visibility-pair.ts:98` и `frontend/web/e2e/fixtures/location-visibility-pair.ts:83` (вторая — добавлена по план-ревью 13.11, в спеке рев.3 значилась одна).
- **DoD:** юнит-тесты: ремап — пересекающиеся связи → замена, непересекающиеся → skip; `/my`-ответ по алфавиту и accepted-but-ignored; аудит-снапшот с id; sqladmin-страница услуг открывается (тест-клиент).

## Task 6: api-client
### Classification: small
### Required Docs: docs/domain-rules/specialties.md (API Endpoints)
- `packages/api-client`: `SpecialtyView/Create/Update` + эндпоинты — зеркало позиционного набора (list/getAll/create/patch/delete по действующему неймингу файла позиций); `ServiceView`/`ServiceCreate` — `specialty_id`; `MasterSectionInput.specialty_ids`; `StaffSortBy` без изменений; `packages/domain` — БЕЗ правок (строка сохраняется).
- **DoD:** `schemas.test.ts` / `endpoints.test.ts` зелёные (дельта контракта покрыта).

## Task 7: Сид и предзагрузка
### Classification: standard
### Required Docs: docs/domain-rules/specialties.md (Сид/предзагрузка), docs/domain-rules/_overview.md
- `seed/seed.py`: названия нынешних литералов → записи справочника, услуги/мастера связываются; обогащение — ≥3 направлений и ≥1 сотрудник с 2+ направлениями, введёнными НЕ по алфавиту (различающие данные сценария 2 и тестов сортировки).
- `seed/reference.py`: `_apply_specialties` — upsert по `lower(title)`, **принимает список названий независимо от формата файла** (стык с #612: меняется только парсер); `backend/seed-data/specialties.yaml` (список названий); `services.yaml` `specialty` — название-ссылка (резолв по lower через `_check_refs`, неизвестное → ошибка с именем значения); `staff.yaml` — `specialties: [названия]`, старый CSV-ключ `specialty` → ошибка загрузки.
- **DoD:** юнит-тесты загрузчика: upsert по регистру, регистронезависимый резолв, неизвестное название → ошибка, старый CSV-ключ → ошибка; dev-пересид (удалить `backend/memo.db`, dev.sh) даёт связные данные — прогон вручную в конце волны + упоминание в отчёте.

## Task 8: Admin UI — вкладка «Направления» и выбор в модалках
### Classification: large
### Required Docs: docs/domain-rules/specialties.md, docs/domain-rules/services.md, docs/domain-rules/staff.md, docs/design-system/ (канон компонентов)
- Страница услуг `app/(main)/services/`: третий вид «Направления» в переключателе (`data-testid="specialties-tab"` на кнопке; видна при `can('specialties:read')` — образец материалов); `useSpecialtiesUrlState` (префикс, как `mat_`), `SpecialtiesProvider` (server-paginated, монтируется только видимый вид — #349), `SpecialtiesTable`, `SpecialtyModal` (одно поле «Название», ошибка 409 «такое направление уже есть») по образцу позиционной модалки; удаление — deferred-конвейер (dry_run/commit, 409-дерево «Услуги: N») по образцу позиций/материалов.
- `serviceFields.tsx`: поле «Направление» — словарный селект из `/specialties/all` (примитив существующих селектов, ручной ввод недоступен); валидация обязательности.
- `StaffModal.tsx`: направления — чекбоксы (образец должностей); `StaffTable.tsx:145,181` — payload master-секции на `specialty_ids`.
- **DoD:** E2E `specialties-crud.spec.ts` (шаблон `tags-crud.spec.ts`) — сценарии 3, 4, 5a/b/c спеки §7 проходят (RED-GREEN-REFACTOR); VC-пункт вкладки (machine hint `specialties-tab`) зелёный.

## Task 9: E2E сценарии 1–2
### Classification: standard
### Required Docs: docs/domain-rules/services.md, docs/domain-rules/staff.md
- Расширение сервисного e2e (база — `combobox-dictionaries.spec.ts`/сервисный crud-спек): создание услуги с выбором направления из выпадающего списка, таблица показывает направление (сценарий 1).
- Расширение staff-e2e (база — `staff-s7-create-composite.spec.ts`): сотрудник с направлениями, введёнными не по алфавиту → в карточке и таблице алфавитная строка (сценарий 2).
- **DoD:** E2E сценарии 1–2 проходят (RED-GREEN-REFACTOR).

## Верификация волны
- Юнит-слои: backend pytest, admin vitest, api-client vitest — зелёные локально (канон локального гейта backend-PR: ruff + lint_budget).
- E2E: сценарии 1–5a/b/c; Visual Compliance — секция спеки (1 machine hint `/services` + 3 manual).
- Одноразовый dev-пересид после волны (Task 7 DoD); e2e-снапшоты шард-стеков пересобираются штатно.
