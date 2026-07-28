# GH #175 — Contract-тест GenericService.patch() — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить N×M дублирование PATCH-семантик (~92 generic-теста на 11+ сущностей) параметризованным contract-тестом `GenericService.patch()` с авто-обнаружением сущностей через `__subclasses__()`, config-тестом `NOT_NULL_FIELDS` ↔ nullability модели, и сократить per-entity API-тесты до smoke/wiring + инвариантов + override.

**Architecture:** Integration contract-тест на уровне сервисов (`db_session`, реальная БД — `onupdate` работает только при flush). Сущности обнаруживаются через `GenericService.__subclasses__()` минус явный список исключений `{ServiceService, PhotoService, RecordService}` (override-семантика). Per-service config (тестовые данные) — явная структура на сущность; отсутствие config-записи для нового подкласса = падение contract-теста. Единственное изменение в `src/` — выравнивание ClientService под subclass-паттерн (G1b-approved).

**Tech Stack:** pytest (asyncio_mode=auto), SQLAlchemy 2.0 async, Pydantic v2

**Spec:** `docs/specs/2026-07-28-generic-service-patch-contract-design.md`

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria:

- **Новый сервис-подкласс GenericService без config-записи** → contract-тест падает при сборе параметров с понятным сообщением (сервис обнаружен, config отсутствует)
- **Новая NOT NULL колонка в модели без обновления `NOT_NULL_FIELDS`** → config-тест падает сам
- **Изменение generic-семантики patch** (например, сломать exclude_unset) → падает 1 место (contract-тест), а не N per-entity файлов
- **Per-entity API PATCH-тесты** → остаётся 1 smoke/wiring (404 с `detail.code == "<ENTITY>_NOT_FOUND"`), инварианты (records/visits), override (tag_ids); всё остальное удалено
- **Backend test-suite** → зелёный; количество API PATCH-тестов ~51 → ~15-18
- **`src/` изменения** → только `services/client.py` + `api/v1/clients.py` (ClientService subclass, поведение не меняется)

---

## File Structure

### Modified `src/` files (G1b-approved ClientService alignment only)

| File | What's modified |
|------|----------------|
| `backend/src/services/client.py` | + `ClientService(GenericService[ClientCreate, ClientUpdate, ClientResponse])` пустой подкласс; `get_client_service()` возвращает его |
| `backend/src/api/v1/clients.py` | `_ServiceDep` / `_get_client_service()` аннотации: `GenericService[...]` → `ClientService` |

### New test files

| File | What's added |
|------|-------------|
| `backend/tests/services/test_generic_service_patch.py` | Contract-тест: discovery, 6 параметризованных тестов, config-тест NOT_NULL_FIELDS |

### Modified test files (дедуп + smoke/wiring)

| File | Action |
|------|--------|
| `backend/tests/test_api_materials.py` | Удалить 5 generic-тестов; 404-тест доработать `detail.code` |
| `backend/tests/test_api_photos.py` | Удалить 5 generic-тестов; оставить 3 tag_ids + 404 (доработать) |
| `backend/tests/test_api_records.py` | Удалить 6 generic-дублей; оставить 404 (доработать) + 2 инварианта + updated_at→удалить (покрыт contract) |
| `backend/tests/test_api_visits.py` | Не трогаем (standalone-сервис, отдельный issue) |
| `backend/tests/test_api_services.py` | Удалить 5 generic-тестов; оставить 3 tag_ids + 404 (доработать) |
| `backend/tests/test_api_locations.py` | Удалить 6 generic-тестов; 404 доработать |
| `backend/tests/test_api_activities.py` | Удалить 1 generic-тест; 404 доработать |
| `backend/tests/test_api_tags.py` | Удалить 3 generic-теста; 404 доработать |
| `backend/tests/test_api_masters.py` | Удалить 6 generic-тестов; 404 доработать |
| `backend/tests/test_api_payments.py` | Удалить 2 generic-теста; 404 уже имеет code-assertion |
| `backend/tests/test_api_visitors.py` | Удалить 6 generic-тестов; 404 доработать |
| `backend/tests/test_api_user_settings.py` | Не трогаем (standalone-сервис) |
| `backend/tests/test_api_clients.py` | Удалить 11 generic-тестов; оставить 404 (доработать) + 422 validation; updated_at → удалить (покрыт contract) |
| `backend/tests/test_coverage_boost.py` | Удалить 2 activity patch-теста (категория a) |
| `backend/tests/test_edge_cases.py` | Удалить 1 activity patch-тест |
| `backend/tests/test_nullable_consolidation.py` | **Удалить файл целиком** (9 тестов покрыты contract-тестом) |

### Docs

| File | What's modified |
|------|----------------|
| `docs/domain-rules/_overview.md` | + раздел «PATCH contract» — ссылка на contract-тест как источник истины generic-семантик + список исключений |

---

## Task 1: ClientService alignment (src/)

### Classification: small

### Task Description

Выровнять Client под общий subclass-паттерн (как TagService), чтобы ClientService обнаруживался через `__subclasses__()`. Поведение не меняется.

**Step 1: `backend/src/services/client.py`**

Прочитать файл. Заменить фабрику, возвращающую прямой экземпляр `GenericService`, на подкласс по образцу `TagService` (`src/services/tag.py`):

```python
class ClientService(GenericService[ClientCreate, ClientUpdate, ClientResponse]):
    """Client service — стандартный GenericService без NOT NULL полей."""
```

(Пустое тело — `NOT_NULL_FIELDS` по умолчанию `set()`, что соответствует текущему поведению.)

Обновить фабрику:

```python
@lru_cache
def get_client_service() -> ClientService:
    return ClientService(get_soft_delete_repository(), Client, ClientResponse)
```

Импорты: убедиться, что `ClientCreate`, `ClientUpdate`, `ClientResponse` импортированы (уже есть в файле).

**Step 2: `backend/src/api/v1/clients.py`**

Обновить аннотации (строки ~26-38):

```python
@lru_cache
def _get_client_service() -> ClientService:
    """Dependency factory returning a singleton ClientService."""
    return get_client_service()

_ServiceDep = Annotated[ClientService, Depends(_get_client_service)]
```

Обновить импорт: `from src.services.client import ClientService, get_client_service, list_clients_with_stats` (сохранить существующие импорты функций). Убрать неиспользуемый импорт `GenericService`, если он больше не нужен в файле.

**Step 3: Проверка**

- `cd backend && python -m pytest tests/test_api_clients.py -x -q` — все существующие тесты clients зелёные (поведение не изменилось).
- `python -c "from src.services.generic import GenericService; import src.services.client; print([c.__name__ for c in GenericService.__subclasses__()])"` — `ClientService` присутствует в списке. (Все сервисы должны быть импортированы: `import src.services.activity, src.services.client, ...` — contract-тест будет делать это явно.)

---

## Task 2: Contract-тест `test_generic_service_patch.py`

### Classification: large

### Task Description

Создать `backend/tests/services/test_generic_service_patch.py` — integration contract-тест. Зависит от Task 1 (ClientService должен существовать).

**Step 1: Discovery + per-service config**

```python
"""Contract-тест GenericService.patch() — единый источник истины generic-семантик.

Сущности обнаруживаются автоматически через GenericService.__subclasses__().
Новый подкласс без config-записи в CONTRACT_CONFIG → падение при сборе параметров.
Исключения (override-семантика patch) обязаны иметь собственные тесты.
"""

import pytest

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.tag import Tag
from src.models.visitor import Visitor
from src.schemas.activity import ActivityCreate, ActivityPatch
from src.schemas.client import ClientCreate, ClientPatch
from src.schemas.location import LocationCreate, LocationPatch
from src.schemas.master import MasterCreate, MasterPatch
from src.schemas.material import MaterialCreate, MaterialPatch
from src.schemas.payment import PaymentCreate, PaymentPatch
from src.schemas.tag import TagCreate, TagPatch
from src.schemas.visitor import VisitorCreate, VisitorPatch

# Явные импорты ВСЕХ сервисов — иначе __subclasses__() видит только загруженные модули
import src.services.activity  # noqa: F401
import src.services.client  # noqa: F401
import src.services.location  # noqa: F401
import src.services.master  # noqa: F401
import src.services.material  # noqa: F401
import src.services.payment  # noqa: F401
import src.services.photo  # noqa: F401
import src.services.record  # noqa: F401
import src.services.service  # noqa: F401
import src.services.tag  # noqa: F401
import src.services.visitor  # noqa: F401

from src.services.activity import get_activity_service
from src.services.client import get_client_service
from src.services.generic import GenericService
from src.services.location import get_location_service
from src.services.master import get_master_service
from src.services.material import get_material_service
from src.services.payment import get_payment_service
from src.services.photo import PhotoService
from src.services.record import RecordService
from src.services.service import ServiceService
from src.services.tag import get_tag_service
from src.services.visitor import get_visitor_service

# Сервисы с override-семантикой patch — исключены из generic-прогона,
# обязаны иметь собственные тесты (test_api_services.py / test_api_photos.py / test_api_records.py).
GENERIC_PATCH_EXCEPTIONS: set[type] = {ServiceService, PhotoService, RecordService}
```

Per-service config — `CONTRACT_CONFIG: dict[type, EntityConfig]`, где EntityConfig — dataclass/NamedTuple с полями:

- `service_factory` — callable без аргументов, возвращающий инстанс сервиса (например `get_activity_service`)
- `model` — класс модели
- `create_schema` / `patch_schema` — классы схем
- `create_data: dict` — валидные данные для `<Create>(**create_data)`
- `fk_fixtures: tuple[str, ...]` — имена pytest-фикстур, которые должны выполниться ДО создания сущности (для FK): например `("create_master", "create_service", "create_location")` для Activity — их возвращаемые dict'ы дают id'ы, подставляемые в create_data через `fk_map: dict[str, str]` (поле → имя фикстуры)
- `not_null_field: str | None`, `not_null_sentinel` — новое валидное значение (не None) для теста strip/partial
- `nullable_field: str | None`, `nullable_sentinel` — не-None значение для создания, затем patch None

Конкретные значения (8 сущностей):

| Entity | create_data (без FK) | fk_map | not_null_field / sentinel | nullable_field / sentinel |
|--------|---------------------|--------|---------------------------|---------------------------|
| Activity | `{"start": datetime(2030,1,1,10,0), "duration": 60, "capacity": 10, "comment": "c"}` | master_id→create_master, service_id→create_service, location_id→create_location | `capacity` / 99 | `comment` / "initial" |
| Client | `{"name": "Ivan", "phone": "+79000000000"}` | — | None (skip тест 3) | `name` / "Ivan" |
| Location | `{"name": "Loc", "capacity": 5, "address": "addr"}` | — | `name` / "Loc2" | `address` / "addr" |
| Master | `{"first_name": "A", "last_name": "B", "color": "#fff", "position": "p", "specialty": "s", "avatar_url": "http://x"}` | — | `color` / "#000000" | `avatar_url` / "http://x" |
| Material | `{"title": "T", "description": "D"}` | — | `title` / "T2" | None (skip тест 4) |
| Payment | `{"amount": 100, "method": "card"}` | record_id→create_record | `amount` / 200 | `method` / "cash" |
| Tag | `{"tag": "t1"}` | — | `tag` / "t2" | None (skip тест 4) |
| Visitor | `{"name": "V", "age": 10}` | client_id→create_client | `name` / "V2" | `age` / 10 |

FK-подстановка: фабрики `create_master` и т.п. — существующие function-scoped фикстуры из `tests/conftest.py`, возвращающие dict с `"id"`. Проблема: параметризованный тест не может динамически запросить фикстуру по имени. Решение — фабрика-создатель внутри config: `entity_factory: Callable[..., Awaitable[str]]` не годится (fixture-доступ). **Решение через `request.getfixturevalue`**:

```python
@pytest.fixture
def make_entity(request, db_session):
    """Создаёт сущность через её сервис, подтягивая FK-фикстуры по имени."""
    async def _make(cfg) -> tuple[object, object]:
        create_data = dict(cfg.create_data)
        for field, fixture_name in cfg.fk_map.items():
            created = request.getfixturevalue(fixture_name)
            create_data[field] = created["id"] if isinstance(created, dict) else created
        service = cfg.service_factory()
        created_resp = await service.create(db_session, cfg.create_schema(**create_data))
        return service, created_resp
    return _make
```

Примечание: `create_record` (для Payment) — существующая фикстура, создающая полную цепочку через API; возвращает dict с `"id"` записи. Подходит.

Примечание по Payment: `create_schema(**create_data)` — `PaymentCreate(amount=100, method="card", record_id=...)`. `method` — `PaymentMethod` enum; в create_data использовать строковые значения enum'а, pydantic сконвертит.

**Step 2: Параметризация с валидацией покрытия**

```python
def _contract_params() -> list:
    params = []
    for cls in GenericService.__subclasses__():
        if cls in GENERIC_PATCH_EXCEPTIONS:
            continue
        cfg = CONTRACT_CONFIG.get(cls)
        if cfg is None:
            # Новый сервис без config-записи → явный провал при сборе
            params.append(pytest.param(cls, None, id=f"{cls.__name__}-MISSING-CONFIG"))
            continue
        params.append(pytest.param(cls, cfg, id=cls.__name__))
    return params

@pytest.mark.parametrize("service_cls,cfg", _contract_params())
class TestGenericServicePatchContract:
    ...
```

В каждом тесте первой строкой: `assert cfg is not None, f"{service_cls.__name__} обнаружен через __subclasses__(), но отсутствует в CONTRACT_CONFIG"` — MISSING-CONFIG параметр падает с понятным сообщением.

Дополнительный guard-тест (не параметризованный):

```python
def test_all_generic_subclasses_covered_or_excepted():
    """Каждый подкласс GenericService — в CONTRACT_CONFIG или в исключениях."""
    for cls in GenericService.__subclasses__():
        assert cls in CONTRACT_CONFIG or cls in GENERIC_PATCH_EXCEPTIONS, (
            f"{cls.__name__} не покрыт contract-тестом и не в GENERIC_PATCH_EXCEPTIONS"
        )
```

**Step 3: Шесть contract-тестов** (внутри класса из Step 2, все `async def`, используют `db_session` + `make_entity`):

1. `test_patch_partial_update` — создать; patch `{not_null_field: sentinel}` (для Client — nullable_field); assert присланное поле изменилось, несланное (nullable_field со старым значением / другое поле) не изменилось.
2. `test_patch_empty_body_noop` — создать; patch `patch_schema()` (пустая схема); assert все поля ответа равны созданным.
3. `test_patch_not_null_field_null_stripped` — если `cfg.not_null_field is None` → `pytest.skip("нет NOT NULL полей")`; создать; patch `{not_null_field: None}`; assert поле сохранило значение создания.
4. `test_patch_nullable_field_null_applied` — если `cfg.nullable_field is None` → skip; создать с не-None nullable_sentinel; patch `{nullable_field: None}`; assert поле стало None.
5. `test_patch_not_found_returns_none` — `await service.patch(db_session, "nonexistent-id", patch_schema(**{not_null_field or nullable_field: sentinel}))`; assert `is None`.
6. `test_patch_updates_updated_at` — создать; захватить `created_resp.updated_at`; `await asyncio.sleep(0.01)` не нужно — datetime.utcnow имеет микросекундную точность, но SQLite DateTime может округлять до секунд: **проверить granularity** — если SQLite хранит микросекунды (SQLAlchemy DateTime хранит ISO-строку с микросекундами) — sleep не нужен; в плане заложить `await asyncio.sleep(1.1)` НЕТ — слишком медленно ×8 параметров. Решение: assert `updated >=` через свежий ORM-fetch (`await db_session.get(cfg.model, created_resp.id)`) и сравнение `> created_at` ИЛИ `!= created.updated_at`; fallback при flaky — сравнивать `>=` и дополнительно проверять, что поле в ответе присутствует. Точную формулировку ассерта implementer подбирает по факту (допустимая свобода), критерий: тест детектирует удаление `onupdate` из модели. ORM-fetch обязателен для Tag (updated_at нет в TagResponse).

**Step 4: Config-тест NOT_NULL_FIELDS ↔ model nullability** (в том же файле, вне класса):

```python
GENERIC_COLUMNS_EXCLUDED = {"id", "created_at", "updated_at", "is_active"}

@pytest.mark.parametrize("service_cls,cfg", _contract_params())
def test_not_null_fields_match_model(service_cls, cfg):
    """NOT_NULL_FIELDS сервиса == NOT NULL колонки модели (минус generic)."""
    assert cfg is not None, ...
    model_not_null = {
        col.name
        for col in cfg.model.__table__.columns
        if not col.nullable and col.name not in GENERIC_COLUMNS_EXCLUDED
    }
    service = cfg.service_factory()
    assert set(service.NOT_NULL_FIELDS) == model_not_null, (
        f"{service_cls.__name__}: NOT_NULL_FIELDS={service.NOT_NULL_FIELDS} "
        f"!= model NOT NULL columns={model_not_null}"
    )
```

⚠️ **Известное расхождение для проверки на RED-этапе:** у Client, Location, Master, Activity, Material, Payment, Tag, Visitor — сверить факт: `NOT_NULL_FIELDS` включает `sort_order` (Location, Master), который в модели может иметь default и `nullable=False` — тогда совпадает; `is_active` исключён. Client: `NOT_NULL_FIELDS=set()`, а у модели Client все колонки nullable=True → совпадает. Если на этапе impl обнаружится расхождение (например, `sort_order` nullable в модели, но в NOT_NULL_FIELDS) — это дефект данных сервиса: implementer сообщает BLOCKED с фактом, решение — добавить поле-исключение в config-тест с комментарием или исправить сервис (отдельное решение менеджера; в scope этой задачи — зафиксировать расхождение явным `KNOWN_MISMATCHES` dict в тесте с reason).

**Step 5: Проверка**

- `cd backend && python -m pytest tests/services/test_generic_service_patch.py -q` — зелёный.
- Sanity-check авто-обнаружения (вручную, затем revert): временно добавить фиктивный подкласс `class _DummyService(GenericService): pass` в отдельном scratch-тесте → `test_all_generic_subclasses_covered_or_excepted` падает → revert. Implementer отчитывается о результате.
- Запустить весь backend suite: `npm run test` (или `cd backend && python -m pytest -q`) — зелёный, ничего не сломано (per-entity тесты пока не тронуты).

---

## Task 3: Дедуп per-entity тестов + smoke/wiring

### Classification: standard

### Task Description

Удалить per-entity тесты generic-семантик (покрыты Task 2), доработать 404-тесты assertion'ом `detail.code`. Зависит от Task 2 (contract должен быть зелёным до удаления дублей).

**Per-file действия** (точные имена тестов из инвентаризации; implementer сверяет по факту, удаляя ТОЛЬКО перечисленное):

| Файл | Удалить | Оставить / доработать |
|------|---------|----------------------|
| `test_api_materials.py` | partial_update, empty_body, null_title_stripped, null_description_stripped, multiple_fields | `test_patch_material_not_found_404` + добавить `assert response.json()["detail"]["code"] == "MATERIAL_NOT_FOUND"` |
| `test_api_photos.py` | is_public_only, empty_body, null_filename_stripped, visitor_id_to_null | 404 + code `PHOTO_NOT_FOUND`; 3 tag_ids-теста без изменений |
| `test_api_services.py` | duration_only, empty_body, null_title_stripped, max_age_to_null | 404 + code `SERVICE_NOT_FOUND`; 3 tag_ids-теста без изменений |
| `test_api_locations.py` | capacity_only, empty_body, null_name_stripped, null_capacity_stripped, nullable_field_to_null, multiple_fields | 404 + code `LOCATION_NOT_FOUND` |
| `test_api_activities.py` | partial_update | 404 + code `ACTIVITY_NOT_FOUND` |
| `test_api_tags.py` | partial_update, empty_body, null_stripped | 404 + code `TAG_NOT_FOUND` |
| `test_api_masters.py` | color_only, empty_body, null_color_stripped, avatar_url_to_null, multiple_fields, sort_order | 404 + code `MASTER_NOT_FOUND` |
| `test_api_payments.py` | partial, null_amount_stripped | 404 (code-assertion уже есть) |
| `test_api_visitors.py` | name_only, age_only, empty_body, null_name_stripped, age_to_null, multiple_fields | 404 + code `VISITOR_NOT_FOUND`; + инвариант client_id непатчабелен — **проверить наличие**: если отдельного теста нет (client_id отсутствует в VisitorPatch — защита на уровне схемы), добавить smoke: PATCH с `{"client_id": "other"}` игнорирует поле (422 или игнор — зафиксировать фактическое поведение, НЕ менять его) |
| `test_api_clients.py` | updates_name, updates_channel, empty_body, multiple_fields_at_once, sets_name/phone/email/channel_to_null, preserves_other_fields, updates_updated_at_timestamp, response_validates | 404 + code `CLIENT_NOT_FOUND`; `test_patch_invalid_channel_returns_422` без изменений |
| `test_api_records.py` | status_only, comment_only, custom_price, custom_price_null_clears, multiple_fields, updates_updated_at | 404 + code `RECORD_NOT_FOUND`; `test_patch_anonym_visits_updates_seats`, `test_patch_record_preserves_tariff_id_in_visits` без изменений |
| `test_coverage_boost.py` | patch_activity_capacity, patch_activity_comment | остальное файла без изменений |
| `test_edge_cases.py` | patch-тест activity (`test_patch_partial`) | остальное без изменений |
| `test_nullable_consolidation.py` | **файл удалить целиком** | — |
| `test_api_visits.py`, `test_api_user_settings.py`, `test_schemas_client.py`, `services/test_visit_service.py`, `services/test_payment_service.py` | — | **не трогаем** |

Шаблон доработки 404 (по образцу `test_api_payments.py:224`):

```python
assert response.status_code == 404
assert response.json()["detail"]["code"] == "<ENTITY>_NOT_FOUND"
```

Проверить фактические значения `ErrorCode.*_NOT_FOUND` enum'ов (названия могут отличаться, напр. `ACTIVITY_NOT_FOUND` vs другое) — implementer сверяет с `src/api/errors.py` (или где определён ErrorCode) по факту.

**Проверка:** полный backend suite зелёный; подсчёт: API PATCH-тестов осталось ~15-18 (implementer прикладывает `pytest --collect-only -q | grep -c patch` до/после).

---

## Task 4: Документация

### Classification: trivial

### Task Description

В `docs/domain-rules/_overview.md` добавить раздел «PATCH Contract»:

- GenericService.patch() семантики — источник истины: `backend/tests/services/test_generic_service_patch.py`
- Список исключений (Service, Photo, Record) с одной строкой почему
- Правило: новый сервис-подкласс → config-запись в contract-тесте (иначе тест падает); новая NOT NULL колонка → обновить NOT_NULL_FIELDS (config-тест падает)

---

## Verification (финальный)

1. `cd backend && python -m pytest -q` — весь suite зелёный
2. `git diff main --stat -- src/` — только `services/client.py` + `api/v1/clients.py`
3. Количество API PATCH-тестов ~15-18 (collect-only до/после)
4. Acceptance criteria из spec §6 — все выполнены
