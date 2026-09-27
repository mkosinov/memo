# План: унификация сортировочных параметров табличных списков (#367)

- Дата: 2026-09-27
- Спека: `docs/specs/2026-09-27-sort-params-367-design.md` (rev2, Gate B пройден) — Behavioral Delta, User Scenarios (С1–С8) и инвентарь 8 резолв-мест там, здесь не дублируются.
- Канон: дельта канона (инвариант 9 «Сортировка списков» в `_overview.md`) запушена вместе со спекой (`b87dbcf7`) — задачей плана не является; ссылки задач на неё корректны.

## Goal

Один общий кирпень параметров сортировки (`SortParams`) + один общий резолвер (`domain/sorting.py`) для всех 8 списков с сортировкой; клиенты переведены с молчаливого отката на жёсткий 422. Поведение строк всех таблиц сохраняется дословно (дефолты и хвосты — по инвентарю спеки §1); единственные видимые изменения — 422 у клиентов и детерминированный тайбрейк `id`.

## Architecture

```
роут / сервис списка
  ↓ валидация параметров
SortParams[Literal] (params-модели: clients/records/photos) · scalar Query + общий SortOrder (справочники)
  — белый список сущности = 422, фиксированные дефолты переопределяются в подклассе
  ↓ колонки сортировки
карта сущности (ключ → выражения + nulls-политика) — содержание таблицы, у сущности
  (записи/услуги: коррелированные подзапросы — pin #213 / tariffs)
  ↓ применение
domain/sorting.py — единственный резолвер: направление, nulls-канон / always_nulls_last,
тайбрейк id asc последним, UnknownSortKeyError → глобальный хендлер 422
```

- Канон: `asc → nullsfirst / desc → nullslast`; исключение «пустые — в конце» (staff `specialty`/`color`) — per-key политика в карте.
- Фронтенд не меняется (#349 несёт тот же формат параметров). Легаси `/masters` и сущности без сортировки не трогаем.

## Tech Stack

FastAPI + Pydantic v2 (Generic BaseModel — прецедент `PaginatedResponse`), SQLAlchemy (`nullsfirst`/`nullslast`), pytest (+ параметризованные стражи). Новых зависимостей нет.

## Task 1. Резолвер `domain/sorting.py` + юнит-контракт

Классификация: standard. Required Docs: спека §4.2; канон `_overview.md` инвариант 9.

- Функция применения: карта (ключ → список выражений + nulls-политика `canonical`|`always_nulls_last`), `sort_order`, тайбрейк-колонка → список ORDER BY (тайбрейк `asc()` последним, вне nulls-политики).
- `UnknownSortKeyError` (domain/errors.py) + глобальный хендлер → 422 VALIDATION_ERROR (страховочный слой; основная линия — Literal, вторая — страж Task 6). Комментарий о диалектной зависимости NULLS FIRST/LAST.
- Сценарии: С6 (механика политики), С2 (страховка 422).
- DoD: `tests/domain/test_sorting.py` — канон asc/desc, `always_nulls_last` в обоих направлениях, тайбрейк последним и без политики, неизвестный ключ → исключение (юнит-вызов напрямую).

## Task 2. `SortParams` + перевод params-моделей (клиенты, записи, фото)

Классификация: standard. Required Docs: спека §4.1; канон инвариант 9.

- `SortByT = TypeVar("SortByT", bound=str)` + `SortParams(BaseModel, Generic[SortByT])` в `schemas/common.py`; правило дефолтов спеки: кирпень — форма, дефолты — в подклассе.
- `ClientListParams(SortParams[ClientSortBy], PaginationParams)`: `ClientSortBy` Literal из 7 колонок, `sort_by="name"`, `sort_order="asc"`; записи: `sort_by: RecordSortBy = "date"`; фото: `sort_by="created_at"`, **`sort_order="desc"` сохраняется**; `RecordSortOrder` удаляется (проверить использования в экспортах/тестах).
- Чек-пойнт комбинации generic+query (первая импл-проверка Task'а): мусорный `sort_by` через query-инъекцию → 422, OpenAPI рендерит enum; при упоре — fallback спеки §4.1 (`sort_by` объявляется в подклассе напрямую, резолвер не зависит от формы кирпня).
- Сценарии: С2, С3, С5 (контрактная база).
- DoD: smoke-тест 422 + OpenAPI-enum на клиентах; существующие тесты моделей зелёные.

## Task 3. Клиенты на жёсткий контракт

Классификация: standard. Required Docs: спека §3, §4.3 (строка clients); канон инвариант 9.

- `services/client.py list_clients_view`: `dict.get(..., default)` → прямая индексация карты; применение → резолвер Task 1 + тайбрейк `Client.id.asc()`.
- Тесты (`test_api_clients.py`): 422 на `banana`, пустую строку, регистр `Name`, мусорный `sort_order`; сортировка `name`/`total_paid` asc+desc; дефолт без параметров; двухстраничная стабильность при равных `total_paid` (данные достаточны для разреза страницы, паттерн `test_api_records.py:1010`); `last_record` nulls — как сегодня.
- Тест отката `test_invalid_sort_by_falls_back_to_name` переписывается в тест 422.
- Сценарии: С1, С2, С3, С8.
- DoD: новый тест-набор зелёный; старый тест фолбэка удалён/заменён; остальной клиентский набор не тронут.

## Task 4. Записи и фото на резолвер

Классификация: small. Required Docs: спека §4.2 (pins), §4.3.

- `services/record.py _sort_columns`: карта подзапросов (с `correlate()`) остаётся; применение (`desc/asc/nulls/хвост`) → резолвер.
- `services/photo.py`: inline-применение → резолвер (фактического изменения порядка нет — колонки NOT NULL).
- Тесты: регресс записей вкл. `q` + client-sort (pin #213); **новый тест фото без sort-параметров** (дефолт `created_at desc` — страж флипа); существующие тесты фото — зелёные.
- Сценарии: С4, С5.
- DoD: регресс-набор записей и фото зелёный.

## Task 5. Staff и справочники на резолвер

Классификация: standard. Required Docs: спека §4.3 (staff/справочники); канон инвариант 9.

- `api/v1/staff.py`: `_staff_order_by` удаляется — карта + резолвер; `specialty`/`color` → `always_nulls_last`; fallback при `None` (колонка `Staff.sort_order asc, first_name, id`) остаётся в роуте.
- `api/v1/{services,materials,locations,tags}.py`: каждая `_X_order_by` → карта + резолвер; fallback (`title asc, id`; locations — колонка `sort_order asc, title, id`) остаётся у сущности.
- Тесты: staff «пустые — в конце» для `specialty`/`color` в обоих направлениях + 422 на generic `sort_by=bogus`; regressive тест сортировки services по `tariffs` (коррелированный COUNT — второй pin класса #213); существующие 422-тесты справочников зелёные.
- Сценарии: С6, С7.
- DoD: наборы staff и справочников зелёные; локальные `_X_order_by`-функции удалены.

## Task 6. Стражи контракта и финальная проверка

Классификация: small. Required Docs: спека §4.2 (слои защиты), §6, §8.

- CI-страж дрейфа: для каждой из 8 сущностей `set(get_args(Literal))` == `set(карты)` (параметризованный тест; ловит «Literal расширили, карту забыли»).
- OpenAPI-тест: `sort_by` клиентов — enum из 7 значений.
- DoD-греп: в `backend/src/api` и `backend/src/services` нет локальных резолвов сортировки вне карт (`_order_by`, inline `order_by(...nulls...)`); lint ноль; полный тест-набор зелёный.
- Сценарии: С7 (справочники продолжают 422 через общий механизм).
- DoD: стражи зелёные; строка в `CHANGELOG.md` (конвенция репо — журнал ведётся при мержах).
