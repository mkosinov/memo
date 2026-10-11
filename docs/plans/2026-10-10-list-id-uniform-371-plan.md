# План #371 — Единый вход GET-списков: одна модель-как-query, `?id=` на всех

Спека: `docs/specs/2026-10-10-list-id-uniform-371-design.md` (rev4). Поведенческая дельта живёт в спеке (§3) и здесь не пересказывается.

## Goal

Вход каждого GET-маршрута с query-параметрами — одна pydantic-модель через `Annotated[Model, Query()]` (19 конверсий: 11 пагинированных списков + 8 одиночных маршрутов). `?id=`-сужение работает на всех 16 пагинированных списках. Старая форма (скалярные сиблинги, Depends-инъекция пагинации) исчезает из дерева; её возвращение ловят два CI-стража.

## Architecture

Кирпни `SortParams[XSortBy]` (#367) и `PaginationParams` (несёт `page`/`per_page`/`id` с дедупом и капом 100) в `backend/src/schemas/`; каждому из 11 списков — свой `XListParams` композицией кирпней плюс пер-сущностные поля; роутеры читают `params.<поле>`. Сервисный слой применяет `ids` через общий хелпер `ids_in_predicate` (`repositories/search.py`) конъюнктивно остальным фильтрам, до счётных подзапросов. Механика сортировки #367 не меняется: карты ключей и `apply_sort` в домене, ветка «`sort_by=None` → дефолтный порядок сущности» у маршрута. Проводная дельта только у десятки (появляется работающий `id`); остальные конверсии провод не меняют (FastAPI разворачивает поля query-модели в те же параметры — живой прецедент clients/records/photos, спека §4.6).

## Tech Stack

Python, FastAPI, pydantic v2, SQLAlchemy, pytest (API-тесты `backend/tests/`).

---

## Task 1: Одиночные скалярные GET — в схемы (8 маршрутов)

### Classification: small

`ArchiveStatusParams` (`status: ArchiveStatus = ACTIVE` — дефолт сверен по коду у всех пяти) на 5 словарных `/all` (services, materials, locations, staff, masters); `PhotoWebListParams` (`activity_id`), `PaymentTotalsParams` (`record_ids: list[str]`, кап 200), `ClientPhoneLookupParams` (`phone`, мин 3). Каждый маршрут: `params: Annotated[<Model>, Query()]`, скалярная строка уходит. Провод не меняется.

Новые 422-пины одиночных: мусорный `status` на `/all`, не-UUID `activity_id` на `/web`, `phone` короче 3 на `/get`, `record_ids` сверх 200 на `/totals`. Существующие тесты всех восьми маршрутов — зелёные без правок ожиданий.

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8 (вход GET — одна модель-как-query).
- Спека §4.2 (таблица одиночных, дефолты), §2 С8, §6 (422-пины).

### DoD

API-тест сценария С8 (часть: одиночные маршруты) проходит (RED-GREEN-REFACTOR); дефолты таблицы §4.2 не изменились; существующие тесты восьми маршрутов зелёные.

## Task 2: Справочники сортировки — services, materials, tags

### Classification: standard

Классы `ServiceListParams(SortParams[ServiceSortBy], PaginationParams)` (+`status=ACTIVE`, `q` 2/100, `material_id`), `MaterialListParams(SortParams[MaterialSortBy], PaginationParams)` (+`status=ACTIVE`, `q`), `TagListParams(SortParams[TagSortBy], PaginationParams)` (+`q`). Конверсия роутеров: сигнатура — `Annotated[XListParams, Query()]`, чтение `params.<поле>`; карты сортировки и фолбэки не меняются. `?id=` начинает работать (сервисы готовы) — в сервисный вызов добавляется `ids=params.id`.

**Чек-пойнт спеки §4.6 (обязателен до продолжения):** services — первая конверсия из 11 — smoke: `?id=X&id=Y` сужает (строки + total), OpenAPI разворачивает поля модели в те же query-параметры.

Тесты: С1 — **единая параметризованная матрица на все 7 «готовых» эндпоинтов заводится здесь** (services, materials, tags — первые три строки; задача 3 расширяет ту же матрицу четырьмя), С2 (пересечение: архивная услуга при дефолтном `status=ACTIVE` → пусто; явный `status=ARCHIVED` + активная → пусто), С3 (422-матрица: мусор / пустое / запятая-склейка / 101 различный).

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8.
- Спека §4.1 (инвентарь и дефолты), §4.6 (опоры и чек-пойнты), §2 С1–С3.

### DoD

API-тесты сценариев С1, С2, С3 (справочники сортировки) проходят (RED-GREEN-REFACTOR); чек-пойнт §4.6 зафиксирован зелёным прогоном.

## Task 3: Простые списки — visitors, activities, payments, positions

### Classification: standard

Классы без сортировочного кирпня: `VisitorListParams(PaginationParams)` (+`q`; scope-зависимость остаётся `Depends`, не query), `ActivityListParams(PaginationParams)` (+`date_from`, `date_to`, `q`, `service_id`), `PaymentListParams(PaginationParams)` (+`record_id`), `PositionListParams(PaginationParams)` (только унаследованные). Конверсия роутеров, `ids=params.id` в сервисные вызовы.

**Чек-пойнт §4.6:** visitors/activities — первая конверсия с scope-зависимостью — smoke со scope (существующие тесты этих эндпоинтов гоняют scope и остаются регресс-сеткой).

Тесты: расширение **той же единой матрицы С1/С3** из задачи 2 четырьмя эндпоинтами (не отдельная матрица).

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8.
- Спека §4.1 (строки visitors/activities/payments/positions таблицы), §4.6, §2 С1/С3.

### DoD

API-тесты сценариев С1 и С3 (четыре простых списка) проходят (RED-GREEN-REFACTOR); scope-smoke зафиксирован.

## Task 4: Локации — гибрид → модель

### Classification: small

`LocationListParams(SortParams[LocationSortBy], PaginationParams)` (+`status=ACTIVE`, `q` 2/100); сиблинг `id: IdListQuery` удаляется — `id` теперь унаследованное поле модели. Регресс: сужение и 422 вели себя правильно и до конверсии — матрицы С1/С3/С4 на локациях обязаны остаться зелёными; проводной контракт не меняется (`page`/`per_page`/фильтры были и остаются, `id` работал и работает).

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8.
- Спека §4.1 (строка locations), §2 С4, §6 (регресс форм).

### DoD

API-тест сценария С4 (локации: регресс сужения/422 после конверсии) проходит (RED-GREEN-REFACTOR).

## Task 5: Сотрудники — обе ветки + сервисный зазор

### Classification: standard

`StaffListParams(SortParams[StaffSortBy], PaginationParams)` (+`status=ACTIVE`, `q`). Сервис: `StaffService.list_join_masters` получает `ids` + `ids_in_predicate(Staff.id, ids)` в базовую выборку до join-размножения строк и до счётного подзапроса (строки и total сужаются согласованно); ветка `list` готова ранее. Ветвление маршрута по значению сортировки сохраняется на `params.sort_by`.

Тесты С5: обе ветки — строки + total под `?id=`; join-ветка — обязательный арбитр размещения предиката.

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8, инвариант конъюнктивности.
- Спека §4.3 (зазор 1), §2 С5, §9 (риск двух веток).

### DoD

API-тест сценария С5 (обе ветки staff: строки + total) проходит (RED-GREEN-REFACTOR).

## Task 6: Посещения — класс + сервисный зазор

### Classification: small

`VisitListParams(PaginationParams)` (+`record_id`). Сервис: `VisitService.list` получает `ids` + предикат сразу после фильтра `record_id`, до счётного подзапроса.

Тест С6: `record_id` + `id` вместе (сужение поверх существующего фильтра).

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8, инвариант конъюнктивности.
- Спека §4.3 (зазор 2), §2 С6.

### DoD

API-тест сценария С6 (visits: record_id + id) проходит (RED-GREEN-REFACTOR).

## Task 7: Журнал аудита — класс + сервисный зазор

### Classification: small

`AuditLogListParams(PaginationParams)` (+`user_id`, `action`, `entity`, `entity_id`, `date_from`, `date_to`). Сервис: `list_audit_logs` получает `ids` + конъюнктивный предикат к существующим фильтрам, до счётного запроса.

Тест С7: `?id=` в сочетании с `user_id`/`action`/`entity`/`entity_id`/датами.

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8, инвариант конъюнктивности.
- Спека §4.3 (зазор 3), §2 С7.

### DoD

API-тест сценария С7 (audit-logs: комбинированное сужение) проходит (RED-GREEN-REFACTOR).

## Task 8: Чистка и стражи

### Classification: standard

Чистка: удалить `IdQueryParam` (`schemas/pagination.py`) и локальный `IdListQuery` (`api/v1/locations.py`) — потребителей после 19 конверсий не остаётся; переписать устаревшие докстринги (`pagination.py` — оговорка о Depends-дропе; `common.py` — «фолбэк только у скалярных роутов»).

Стражи: (1) OpenAPI-тест — каждый GET-маршрут с `response_model=PaginatedResponse[...]` объявляет query-параметр `id` (чтение сгенерированной схемы `app.openapi()`); (2) структурный CI-греп по `backend/src` — запрещены `IdQueryParam`, `IdListQuery` и инъекция пагинации через `Depends` в **любой** форме: совпадение `PaginationParams` с `Depends()` в одной сигнатуре ловит обе реальные формы записи (`pagination: PaginationParams = Depends()` — сегодняшняя в дереве — и `Depends(PaginationParams)`); (3) 401/403-проверка на одном конвертированном маршруте (сохранность guard'ов); (4) служебный тест пагинации — списки эндпоинтов расширены (10 новых `?id=`-энфорсеров; локации были).

### Required Docs

- `docs/domain-rules/service-layer.md` — правило 8 (стражи канона).
- Спека §4.4 (чистка), §4.5 (стражи), §6 (охрана маршрутов), §8 (DoD).

### DoD

Оба стража зелёные; структурный греп чист; 401-проверка зелёная; lint ноль; полные DoD-строки §8 спеки выполнены; API-тест сценария С8 (финальная сборка регресса) проходит.

---

## Порядок и независимость

Задачи 1–7 независимы между собой (частичный выкат безопасен — спека §8); задача 8 выполняется последней, после всех конверсий. Задача 2 открывает конверсии 11 списков и несёт smoke-чек-пойнт §4.6; задача 3 — scope-чек-пойнт.
