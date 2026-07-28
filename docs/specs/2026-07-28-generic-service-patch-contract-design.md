# Design: GH #175 — Contract-тест GenericService.patch() вместо N×M дублирования

- **Issue:** GH #175
- **Type:** Test refactoring (green tests — no behavior change, no features mixed in)
- **Date:** 2026-07-28
- **Concept:** вариант A′ (approved at G1a, 2026-07-28)

## 1. Problem

PATCH-семантики `GenericService.patch()` продублированы per-entity: ~92 из 105
PATCH-тестов проверяют одни и те же generic-контракты (partial update, empty
body = no-op, NOT NULL strip, 404, updated_at) на 11+ сущностях. Добавление
новой сущности = копипаста того же набора тестов; изменение контракта =
правки в N файлах.

## 2. Contract under test (фактическое поведение, не желаемое)

`GenericService.patch()` (`backend/src/services/generic.py:82-103`):

1. `model_dump(exclude_unset=True)` — применяются **только явно присланные** поля.
2. Для полей из `NOT_NULL_FIELDS` значение `None` **молча стрипится**
   (intent клиента = "не менять", а не "установить null").
3. `None` для полей **вне** `NOT_NULL_FIELDS` (nullable) — применяется как null
   (это `exclude_unset`, не `exclude_none`).
4. Запись не найдена → возвращает `None` (endpoint → 404).
5. `updated_at` обновляется через SQLAlchemy `onupdate` (flush реальной сессии —
   работает только на integration-уровне).
6. **Soft-delete зазор (out of scope):** `BaseRepository.patch()` не фильтрует
   `is_active` — патч удалённой записи возвращает 200. Это существующее
   поведение; issue не исправляет и не закрепляет его.

## 3. Scope

### 3.1 Параметризованный contract-тест — `backend/tests/services/test_generic_service_patch.py`

Integration-уровень (реальная `db_session`, фабрики переиспользуются).
Шесть тестовых функций, каждая `@pytest.mark.parametrize` по обнаруженным сущностям:

| # | Тест | Контракт |
|---|------|----------|
| 1 | `test_patch_partial_update` | sent-поля применяются, несланные не меняются |
| 2 | `test_patch_empty_body_noop` | пустая схема → объект не изменён |
| 3 | `test_patch_not_null_field_null_stripped` | `None` для NOT NULL поля → поле сохраняет старое значение |
| 4 | `test_patch_nullable_field_null_applied` | `None` для nullable поля → поле становится null |
| 5 | `test_patch_not_found_returns_none` | несуществующий id → `None` |
| 6 | `test_patch_updates_updated_at` | `updated_at` после patch > до patch |

**Авто-обнаружение сущностей** (constraint: НЕ вести ручной список сервисов):

```python
GENERIC_PATCH_EXCEPTIONS: set[type[GenericService]] = {ServiceService, PhotoService, RecordService}

def _discover_contract_services() -> list[type[GenericService]]:
    return [
        cls for cls in GenericService.__subclasses__()
        if cls not in GENERIC_PATCH_EXCEPTIONS
    ]
```

- Дерево наследования плоское (depth=1, все подклассы — прямые дети
  `GenericService`), `__subclasses__()` достаточно; recursive-обход не нужен.
- Метапрограммирование запрещено: сущность параметризуется, patch-схема
  конструируется явно через `Model(**{field: value})` — никаких
  `model_fields` loops в ассертах.

**Per-service config** (тестовые данные, не конфигурация сервисов): для каждой
сущности — структура `{service_class, model, patch_schema, create_data,
not_null_field, nullable_field, not_null_sentinel, nullable_sentinel}`.
Валидация config'а — частью config-теста (3.2): если у сущности нет
nullable поля (Material, Tag) — параметр теста 4 для неё **skip**
(`pytest.param(..., marks=pytest.mark.skip(reason=...))`), не пропуск молча.

**ClientService — выравнивание под общий паттерн (G1b-approved, единственное
разрешённое изменение в `src/`):** `get_client_service()` сейчас возвращает
прямой экземпляр `GenericService`, не подкласс — невидим для
`__subclasses__()`. Механический рефакторинг без изменения поведения:

```python
# backend/src/services/client.py
class ClientService(GenericService[ClientCreate, ClientUpdate, ClientResponse]):
    """Client service — стандартный GenericService, NOT_NULL_FIELDS пуст."""
```

`get_client_service()` инстанцирует `ClientService(...)` вместо
`GenericService(...)`; импорты/аннотации типов в роутере
`backend/src/api/v1/clients.py` обновляются. После этого `ClientService`
автоматически обнаруживается и **включается** в contract-прогон. Так как
`NOT_NULL_FIELDS` пуст: тест 3 (NOT NULL strip) для Client — skip с reason
(нет NOT NULL полей), все nullable-тесты (4) работают. Per-entity тесты
clients сокращаются по общим правилам (3.4): остаются smoke/wiring +
ClientPatch schema-тесты (`test_schemas_client.py`, pure_unit — не трогаем).

### 3.2 Config-тест: NOT_NULL_FIELDS ↔ nullability модели

Тот же файл или `backend/tests/services/test_generic_service_config.py`.
Параметризован по `_discover_contract_services()`:

- Для каждого сервиса: `NOT_NULL_FIELDS` == {колонки модели с
  `nullable=False`} − {`id`, `created_at`, `updated_at`, `is_active`}.
- Метаданные — из SQLAlchemy `__table__.columns`, без БД.
- Новая NOT NULL колонка в модели без обновления сервиса → тест падает сам.
- Мягкое правило: колонки с server-side default (например, `sort_order`)
  допустимы в NOT_NULL_FIELDS даже если технически имеют default — сверка
  идёт по `nullable=False`, default не учитывается. Если обнаружится
  расхождение — фиксируется в плане как отдельный пункт.

### 3.3 Список исключений (явный, маленький)

`{ServiceService, PhotoService, RecordService}` — сервисы с override-семантикой
patch (tag_ids у Service/Photo, visits+seats+status у Record). Они исключены
из generic-прогона и **обязаны иметь собственные тесты** (уже существуют:
tag_ids-тесты в `test_api_services.py`/`test_api_photos.py`, record-тесты в
`test_api_records.py` и др.). Constraint: НЕ вести белый список разрешённых
override — список исключений сам является документацией отклонений.

Проверка покрытия исключений: smoke-тест, что каждый класс из
`GENERIC_PATCH_EXCEPTIONS` имеет хотя бы один существующий тестовый файл —
НЕ требуется (существующие тесты не удаляются из исключений, см. 3.4).

### 3.4 Сокращение дублей per-entity

Удаляются per-entity тесты generic-семантик категорий (a)(b)(c)(c2)(d)(e) —
теперь покрыты contract-тестом. **Остаются per-entity:**

1. **1 smoke/wiring-тест на сущность** — эндпоинт существует, PATCH проходит,
   правильный `ErrorCode.*_NOT_FOUND` в 404. Доработка существующих
   404-тестов: добавить assertion `detail.code == "<ENTITY>_NOT_FOUND"`
   (по шаблону `test_api_payments.py:224`), остальные PATCH-тесты файла удалить.
2. **Инварианты** (visitors `client_id` непатчабелен — проверить наличие
   такого теста; capacity/seats/status-cascade у records/visits).
3. **Override-тесты** (tag_ids у services/photos — 6 тестов, не трогаем).
4. **Специальные случаи:** Record — весь файл по сути инварианты/override,
   сокращается только явный дубль (updated_at, generic partial duplicates);
   Visits/UserSettings — standalone-сервисы,
   вне contract-теста, их generic-дубли (4+4 теста) **не сокращаются** в этом
   issue (вне GenericService-контракта) — отдельный issue (менеджер создаст).

**Целевой итог:** ~51 → ~15-18 API PATCH-тестов (дельта по подсчёту GH #175).
Точный список удалений/сохранений — в плане (per-file таблица).

## 4. Исключения и границы

- **Client:** после выравнивания (3.1) включается в contract-прогон;
  `NOT_NULL_FIELDS` пуст → тест 3 skip с reason.
- **`is_active` (появился в PATCH-схемах после PR #180):** поле не входит в
  generic-контракт — это soft-delete toggle, не обычное patchable-поле.
  Contract-тест его игнорирует; per-entity `is_active`-семантику покрывают
  новые `test_patch_is_active.py` / `test_put_is_active.py` (из #180).
  Config-тест NOT_NULL_FIELDS исключает `is_active` из сверки (он nullable
  с default, в NOT_NULL_FIELDS не входит).
- **Visit, UserSettings, Health:** standalone-сервисы (не GenericService) →
  вне scope.
- **Tag:** нет nullable полей и нет `updated_at` в Response — тест 4 skip,
  тест 6 проверяет ORM-уровень (updated_at есть в модели, нет в response
  schema) — использовать `db_session.get(Tag, id)` или исключить из
  параметров теста 6 с reason. Решение: тест 6 работает на ORM-уровне для
  всех сущностей через `db_session.refresh`/`get` — единообразно, Tag не
  исключается.
- **Material:** нет nullable полей → тест 4 skip.
- **Response schema vs ORM:** contract-тест на service-уровне, ассерты по
  возвращаемому response-schema; updated_at — по ORM через свежий fetch.
- **Файл `test_nullable_consolidation.py`** (9 activity-тестов категории c/a):
  целиком покрывается contract-тестом → **удалить файл**.
- **`test_coverage_boost.py` / `test_edge_cases.py` activity patch-дубли** —
  удалить patch-тесты категории (a).

## 5. Не-цели (out of scope)

- Исправление soft-delete зазора в `BaseRepository.patch()`.
- Унификация Client под subclass-модель.
- Contract-тесты для `create`/`update`/`delete`/`reorder`.
- Дедуп тестов standalone-сервисов (Visit, UserSettings).
- Изменение `RecordService.patch` (возврат raw ORM и т.п.).

## 6. Acceptance criteria

1. `test_generic_service_patch.py` зелёный, параметры обнаружены через
   `__subclasses__()` без ручного списка сервисов.
2. Config-тест NOT_NULL_FIELDS ↔ model nullability зелёный.
3. Добавление фиктивного нового подкласса GenericService без config-записи
   → contract-тест падает (проверено вручную на IMPL-этапе, затем revert).
4. Per-entity файлы: осталось по 1 smoke/wiring + инварианты + override;
   итог ~15-18 API PATCH-тестов.
5. Весь backend test-suite зелёный (`npm run test` / pytest), покрытие
   patch-семантик не снижено (diff coverage generic.py/repositories —
   не падает).
6. Изменения в `src/` ограничены выравниванием ClientService (3.1) —
   механический рефакторинг без изменения поведения; остальное — только
   `tests/`.

## 7. Visual Compliance Checks

N/A — backend-only test refactoring, нет user-visible UI.

## 8. Решённые вопросы (G1b, 2026-07-28)

1. **Client:** ✅ выравнивается под общий паттерн (ClientService subclass),
   включается в contract-прогон.
2. **Smoke/wiring:** ✅ доработать существующие 404-тесты assertion'ом
   `detail.code == "<ENTITY>_NOT_FOUND"` (по образцу payments).
3. **Visits/UserSettings:** ✅ не трогаем — отдельный issue (менеджер создаст).
