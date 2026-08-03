"""Contract-тест GenericService full-CRUD (create/get/list/update/patch/delete).

Единый источник истины generic-семантик. Сущности обнаруживаются
автоматически через GenericService.__subclasses__(). Новый подкласс без
config-записи в CONTRACT_CONFIG → падение при сборе параметров. Исключения
(override-семантика одного или нескольких generic-методов) обязаны иметь
собственные тесты.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, NamedTuple

import pytest
from sqlalchemy import select

# ─── Явные импорты ВСЕХ сервисов — иначе __subclasses__() видит только загруженные модули ───
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

from src.services.generic import GenericService, SoftDeleteService

# Service classes + factories
from src.services.activity import ActivityService, get_activity_service
from src.services.client import ClientService, get_client_service
from src.services.location import LocationService, get_location_service
from src.services.master import MasterService, get_master_service
from src.services.material import MaterialService, get_material_service
from src.services.payment import PaymentService, get_payment_service
from src.services.photo import PhotoService
from src.services.record import RecordService
from src.services.service import ServiceService
from src.services.tag import TagService, get_tag_service
from src.services.visitor import VisitorService, get_visitor_service

# Models
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.tag import Tag
from src.models.visitor import Visitor

# Schemas — Create
from src.schemas.activity import ActivityCreate
from src.schemas.client import ClientCreate
from src.schemas.location import LocationCreate
from src.schemas.master import MasterCreate
from src.schemas.material import MaterialCreate
from src.schemas.payment import PaymentCreate
from src.schemas.tag import TagCreate
from src.schemas.visitor import VisitorCreate

# Schemas — Patch
from src.schemas.activity import ActivityPatch
from src.schemas.client import ClientPatch
from src.schemas.location import LocationPatch
from src.schemas.master import MasterPatch
from src.schemas.material import MaterialPatch
from src.schemas.payment import PaymentPatch
from src.schemas.tag import TagPatch
from src.schemas.visitor import VisitorPatch

# Schemas — Update (PUT full-replace; Tag has no TagUpdate — reuses TagCreate)
from src.schemas.activity import ActivityUpdate
from src.schemas.client import ClientUpdate
from src.schemas.location import LocationUpdate
from src.schemas.master import MasterUpdate
from src.schemas.material import MaterialUpdate
from src.schemas.payment import PaymentUpdate
from src.schemas.visitor import VisitorUpdate


# ─── Исключения: сервисы с override-семантикой одного или нескольких
# ─── generic-методов (create/get/list/update/patch/delete) ─────────────────────
# Обязаны иметь собственные тесты (test_api_services.py / test_api_photos.py /
# test_api_records.py). ``SoftDeleteService`` — абстрактный промежуточный базовый
# класс (#195): не привязан к конкретной модели/схеме, не тестируется напрямую;
# его конкретные подклассы (Master/Location/Material/Client) покрыты через
# CONTRACT_CONFIG и обнаруживаются рекурсивно через ``_all_subclasses``.
GENERIC_CONTRACT_EXCEPTIONS: set[type] = {ServiceService, PhotoService, RecordService, SoftDeleteService}

# Shared missing-config guard message — newer contract classes
# (TestGenericServiceUpdateContract and onward) use this constant; older
# classes (Patch/Create/Get/List/Delete semantics) keep their inline
# f-string messages for historical parity. Parametrized ids already
# announce the class via `pytest.param(cls, None,
# id=f"{cls.__name__}-MISSING-CONFIG")` so the message itself can be terse.
MISSING_MSG = "subclass detected via __subclasses__() but missing from CONTRACT_CONFIG"


def _all_subclasses(cls: type) -> list[type]:
    """Рекурсивно собрать всех транзитивных потомков ``cls``.

    ``GenericService.__subclasses__()`` возвращает только прямых наследников.
    После #195 появилась промежуточная база ``SoftDeleteService``, чьи
    конкретные подклассы (Master/Location/Material/Client) — внуки
    ``GenericService`` и без рекурсии выпадали бы из contract-покрытия.
    """
    found: list[type] = []
    for sub in cls.__subclasses__():
        found.append(sub)
        found.extend(_all_subclasses(sub))
    return found


# ─── EntityConfig ────────────────────────────────────────────────────────────────
# Spec: docs/specs/2026-08-01-deletion-policy-design.md §2.6 —
# ``delete_semantics`` is the test-side record of the deletion domain policy:
#   * ``"hard"`` — DELETE physically removes the row (Tag/Photo/Visitor/
#     Activity/Record/UserSettings/Payment/Visit).
#   * ``"soft"`` — is_active is flipped to False (Master/Location/Service/
#     Material/Client).
# The generic delete test asserts each entity's behavior matches its declared
# semantics. Adding new entity configs below requires setting this field.
class EntityConfig(NamedTuple):
    service_factory: Any  # callable() → service instance
    model: type
    create_schema: type
    patch_schema: type
    create_data: dict
    fk_map: dict[str, str]  # field → fixture name
    not_null_field: str | None
    not_null_sentinel: Any
    nullable_field: str | None
    nullable_sentinel: Any
    delete_semantics: Literal["soft", "hard"]
    # PUT-style schema (full replace). Tag has no TagUpdate → reuses TagCreate.
    update_schema: type
    # Fields present in update_schema, values != create_data; never contains
    # is_active (sticky-field semantics are pinned by TestGenericServiceIsActiveContract).
    update_data: dict
    # Column with a DB unique constraint that multi-row tests must vary per row
    # (only Tag.tag is unique=True among the 8 models). Must be last — has a
    # default — so unspecified entries keep working.
    unique_row_field: str | None = None


# ─── Per-service config ──────────────────────────────────────────────────────────
CONTRACT_CONFIG: dict[type, EntityConfig] = {
    ActivityService: EntityConfig(
        service_factory=get_activity_service,
        model=Activity,
        create_schema=ActivityCreate,
        patch_schema=ActivityPatch,
        create_data={
            "start": datetime(2030, 1, 1, 10, 0),
            "duration": 60,
            "capacity": 10,
            "comment": "initial",
        },
        fk_map={
            "master_id": "create_master",
            "service_id": "create_service",
            "location_id": "create_location",
        },
        not_null_field="capacity",
        not_null_sentinel=99,
        nullable_field="comment",
        nullable_sentinel="initial",
        delete_semantics="hard",
        update_schema=ActivityUpdate,
        update_data={
            "start": datetime(2030, 2, 2, 12, 0),
            "duration": 90,
            "capacity": 20,
        },
    ),
    ClientService: EntityConfig(
        service_factory=get_client_service,
        model=Client,
        create_schema=ClientCreate,
        patch_schema=ClientPatch,
        create_data={"name": "Ivan", "phone": "+79000000000"},
        fk_map={},
        not_null_field=None,
        not_null_sentinel=None,
        nullable_field="name",
        nullable_sentinel="Ivan",
        delete_semantics="soft",
        update_schema=ClientUpdate,
        update_data={"name": "Petr", "phone": "+79111111111"},
    ),
    LocationService: EntityConfig(
        service_factory=get_location_service,
        model=Location,
        create_schema=LocationCreate,
        patch_schema=LocationPatch,
        create_data={"name": "Loc", "capacity": 5, "address": "addr"},
        fk_map={},
        not_null_field="name",
        not_null_sentinel="Loc2",
        nullable_field="address",
        nullable_sentinel="addr",
        delete_semantics="soft",
        update_schema=LocationUpdate,
        update_data={"name": "Loc2", "capacity": 10},
    ),
    MasterService: EntityConfig(
        service_factory=get_master_service,
        model=Master,
        create_schema=MasterCreate,
        patch_schema=MasterPatch,
        create_data={
            "first_name": "A",
            "last_name": "B",
            "color": "#ffffff",
            "position": "p",
            "specialty": "s",
            "avatar_url": "http://x",
        },
        fk_map={},
        not_null_field="color",
        not_null_sentinel="#000000",
        nullable_field="avatar_url",
        nullable_sentinel="http://x",
        delete_semantics="soft",
        update_schema=MasterUpdate,
        update_data={
            "first_name": "A2",
            "last_name": "B2",
            "color": "#000000",
        },
    ),
    MaterialService: EntityConfig(
        service_factory=get_material_service,
        model=Material,
        create_schema=MaterialCreate,
        patch_schema=MaterialPatch,
        create_data={"title": "T", "description": "D"},
        fk_map={},
        not_null_field="title",
        not_null_sentinel="T2",
        nullable_field=None,
        nullable_sentinel=None,
        delete_semantics="soft",
        update_schema=MaterialUpdate,
        update_data={"title": "T2", "description": "D2"},
    ),
    PaymentService: EntityConfig(
        service_factory=get_payment_service,
        model=Payment,
        create_schema=PaymentCreate,
        patch_schema=PaymentPatch,
        create_data={"amount": 100, "method": "card"},
        fk_map={"record_id": "create_record"},
        not_null_field="amount",
        not_null_sentinel=200,
        nullable_field="method",
        nullable_sentinel="cash",
        delete_semantics="hard",
        update_schema=PaymentUpdate,
        update_data={"amount": 200, "method": "cash"},
    ),
    TagService: EntityConfig(
        service_factory=get_tag_service,
        model=Tag,
        create_schema=TagCreate,
        patch_schema=TagPatch,
        create_data={"tag": "t1"},
        fk_map={},
        not_null_field="tag",
        not_null_sentinel="t2",
        nullable_field=None,
        nullable_sentinel=None,
        delete_semantics="hard",
        update_schema=TagCreate,  # Tag has no TagUpdate — TagService is GenericService[TagCreate, TagCreate, TagResponse]
        update_data={"tag": "t2-upd"},
        unique_row_field="tag",
    ),
    VisitorService: EntityConfig(
        service_factory=get_visitor_service,
        model=Visitor,
        create_schema=VisitorCreate,
        patch_schema=VisitorPatch,
        create_data={"name": "V", "age": 10},
        fk_map={"client_id": "create_client"},
        not_null_field="name",
        not_null_sentinel="V2",
        nullable_field="age",
        nullable_sentinel=10,
        delete_semantics="hard",
        update_schema=VisitorUpdate,
        update_data={"name": "V2", "age": 11},
    ),
}


# ─── Known mismatches: NOT_NULL_FIELDS vs model NOT NULL columns ────────────────
# FK-поля, которые NOT NULL в модели, но отсутствуют в NOT_NULL_FIELDS сервиса,
# потому что они не входят в Patch-схему (нельзя переназначить FK через patch).
KNOWN_MISMATCHES: dict[type, str] = {
    PaymentService: "record_id is NOT NULL in model but not in NOT_NULL_FIELDS — FK not in PaymentPatch schema",
    VisitorService: "client_id is NOT NULL in model but not in NOT_NULL_FIELDS — FK not in VisitorPatch schema",
    ActivityService: "is_private is NOT NULL in model (default=False) but not in NOT_NULL_FIELDS — has DB default, patching to None would violate constraint",
}


# ─── Helpers ─────────────────────────────────────────────────────────────────────
def _get_patch_field_and_sentinel(cfg: EntityConfig) -> tuple[str, Any]:
    """Return (field_name, sentinel_value) for patch tests.

    Uses not_null_field if available, else nullable_field.
    Adjusts sentinel to differ from the current value if needed.
    """
    field = cfg.not_null_field or cfg.nullable_field
    assert field is not None, "No patchable field configured"
    sentinel = cfg.not_null_sentinel if cfg.not_null_field else cfg.nullable_sentinel
    return field, sentinel


def _ensure_different(sentinel: Any, current: Any) -> Any:
    """Ensure sentinel differs from current value."""
    if sentinel == current:
        if isinstance(sentinel, str):
            return sentinel + "_patched"
        elif isinstance(sentinel, (int, float)):
            return sentinel + 1
    return sentinel


def _update_kwargs(cfg: EntityConfig, sent: Any) -> dict:
    """Build a PUT payload for the update contract tests.

    PUT payload = create fields (parsed, incl. resolved FK ids) + update_data,
    filtered to update_schema fields. FK values come from ``sent`` (the
    create_schema instance returned by ``make_entity(with_input=True)``) —
    reused unchanged (D2/D3). ``VisitorUpdate`` has no ``client_id`` and
    ``is_active`` is never sent explicitly here — both dropped by the
    model_fields filter / never added.

    Spec: 2026-08-03-generic-service-crud-contract-design.md §3.2 (payload
    construction), §3.3 Update row (D7).
    """
    allowed = set(cfg.update_schema.model_fields)
    data = {k: v for k, v in sent.model_dump().items() if k in allowed}
    data.update(cfg.update_data)
    return data


# ─── Fixtures ────────────────────────────────────────────────────────────────────
@pytest.fixture
def make_entity(request, db_session):
    """Создаёт сущность через её сервис, подтягивая FK-фикстуры по имени.

    conftest-фабрики (create_master и др.) возвращают factory-callable,
    а не dict — фабрику нужно ВЫЗВАТЬ, чтобы получить dict с "id".

    Параметры ``_make``:
      * ``**overrides`` — поля, перетирающие ``cfg.create_data`` (например
        ``tag="t-X"`` для многострочного посева Tag с уникальными значениями);
      * ``with_input=True`` — вернуть дополнительно сконструированный
        ``create_schema`` (parsed типы + разрешённые FK id). Существующие
        места вызова без этих параметров остаются совместимыми.
    """

    async def _make(cfg: EntityConfig, with_input: bool = False, **overrides):
        create_data = dict(cfg.create_data)
        for field, fixture_name in cfg.fk_map.items():
            factory = request.getfixturevalue(fixture_name)
            created = factory()  # factory-callable → dict с "id"
            create_data[field] = created["id"]
        create_data.update(overrides)
        service = cfg.service_factory()
        input_schema = cfg.create_schema(**create_data)
        created_resp = await service.create(db_session, input_schema)
        if with_input:
            return service, created_resp, input_schema
        return service, created_resp

    return _make


@pytest.fixture
def seed_rows(request, db_session):
    """Create n rows via the entity's service. FK parents resolved ONCE and shared;
    unique_row_field (Tag.tag) suffixed per row to respect the DB unique constraint."""

    async def _seed(cfg: EntityConfig, n: int):
        base_data = dict(cfg.create_data)
        fk_ids: dict[str, Any] = {}
        for field, fixture_name in cfg.fk_map.items():
            factory = request.getfixturevalue(fixture_name)
            fk_ids[field] = factory()["id"]
        service = cfg.service_factory()
        created = []
        for i in range(n):
            data: dict[str, Any] = {**base_data, **fk_ids}
            if cfg.unique_row_field:
                data[cfg.unique_row_field] = f"{base_data[cfg.unique_row_field]}-{i}"
            created.append(await service.create(db_session, cfg.create_schema(**data)))
        return service, created

    return _seed


# ─── Параметризация ──────────────────────────────────────────────────────────────
def _contract_params() -> list:
    params = []
    for cls in _all_subclasses(GenericService):
        if cls in GENERIC_CONTRACT_EXCEPTIONS:
            continue
        cfg = CONTRACT_CONFIG.get(cls)
        if cfg is None:
            params.append(pytest.param(cls, None, id=f"{cls.__name__}-MISSING-CONFIG"))
            continue
        params.append(pytest.param(cls, cfg, id=cls.__name__))
    return params


def _soft_params() -> list:
    """Parametrization over soft-delete entities only (delete_semantics == "soft").

    Cleaner than in-test skips: a 9th soft entity is auto-included via its
    config entry. Used by the soft-only DeleteSemantics edge tests
    (``test_delete_already_deleted_soft_returns_false``,
    ``test_soft_deleted_absent_from_list``) — spec §3.3 (DeleteSemantics row).
    """
    return [
        p
        for p in _contract_params()
        if p.values[1] is not None and p.values[1].delete_semantics == "soft"
    ]


# ─── Guard-тест ──────────────────────────────────────────────────────────────────
def test_all_generic_subclasses_covered_or_excepted():
    """Каждый (транзитивный) подкласс GenericService — в CONTRACT_CONFIG или в исключениях."""
    for cls in _all_subclasses(GenericService):
        assert cls in CONTRACT_CONFIG or cls in GENERIC_CONTRACT_EXCEPTIONS, (
            f"{cls.__name__} не покрыт contract-тестом и не в GENERIC_CONTRACT_EXCEPTIONS"
        )


# ─── Contract-тесты ──────────────────────────────────────────────────────────────
class TestGenericServicePatchContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_partial_update(
        self, service_cls, cfg, db_session, make_entity
    ):
        """Patch одного поля изменяет только его, остальные не трогаются."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)

        patch_field, sentinel = _get_patch_field_and_sentinel(cfg)
        current_value = getattr(created, patch_field)
        sentinel = _ensure_different(sentinel, current_value)

        patched = await service.patch(
            db_session, created.id, cfg.patch_schema(**{patch_field: sentinel})
        )
        assert patched is not None

        # Patched field changed
        assert getattr(patched, patch_field) == sentinel

        # Unpatched field unchanged — pick a different field to verify
        other_field = cfg.nullable_field if cfg.not_null_field else (
            "phone" if hasattr(created, "phone") else
            "description" if hasattr(created, "description") else
            None
        )
        if other_field and other_field != patch_field:
            assert getattr(patched, other_field) == getattr(created, other_field)

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_empty_body_noop(
        self, service_cls, cfg, db_session, make_entity
    ):
        """Пустой patch (все поля default) не меняет ничего."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)

        patched = await service.patch(db_session, created.id, cfg.patch_schema())
        assert patched is not None

        # Explicit per-field assertions — no model_fields reflection.
        # Collect fields known to the test config: create_data, FK maps, and
        # the not_null / nullable sentinel fields.
        fields_to_check: set[str] = set(cfg.create_data.keys()) | set(cfg.fk_map.keys())
        if cfg.not_null_field:
            fields_to_check.add(cfg.not_null_field)
        if cfg.nullable_field:
            fields_to_check.add(cfg.nullable_field)

        for field_name in fields_to_check:
            assert getattr(patched, field_name) == getattr(created, field_name), (
                f"{field_name} changed after empty patch"
            )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_not_null_field_null_stripped(
        self, service_cls, cfg, db_session, make_entity
    ):
        """None для NOT NULL поля молча игнорируется (поле не меняется)."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        if cfg.not_null_field is None:
            pytest.skip(f"{service_cls.__name__}: no not_null_field configured")

        service, created = await make_entity(cfg)
        original_value = getattr(created, cfg.not_null_field)

        patched = await service.patch(
            db_session, created.id,
            cfg.patch_schema(**{cfg.not_null_field: None}),
        )
        assert patched is not None
        assert getattr(patched, cfg.not_null_field) == original_value

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_nullable_field_null_applied(
        self, service_cls, cfg, db_session, make_entity
    ):
        """None для nullable поля применяется (поле становится None)."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        if cfg.nullable_field is None:
            pytest.skip(f"{service_cls.__name__}: no nullable_field configured")

        service, created = await make_entity(cfg)
        # Verify the field was created with a non-None value
        assert getattr(created, cfg.nullable_field) is not None, (
            f"{cfg.nullable_field} was created as None — cannot test null-applied"
        )

        patched = await service.patch(
            db_session, created.id,
            cfg.patch_schema(**{cfg.nullable_field: None}),
        )
        assert patched is not None
        assert getattr(patched, cfg.nullable_field) is None

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_not_found_returns_none(
        self, service_cls, cfg, db_session
    ):
        """Patch несуществующего ID возвращает None."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service = cfg.service_factory()
        patch_field, sentinel = _get_patch_field_and_sentinel(cfg)

        result = await service.patch(
            db_session, "nonexistent-id",
            cfg.patch_schema(**{patch_field: sentinel}),
        )
        assert result is None

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_patch_updates_updated_at(
        self, service_cls, cfg, db_session, make_entity
    ):
        """updated_at обновляется после patch (onupdate=datetime.utcnow)."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)

        # Fetch original updated_at via ORM (Tag has no updated_at in Response)
        db_session.expire_all()
        original_orm = await db_session.get(cfg.model, created.id)
        assert original_orm is not None
        original_updated_at = original_orm.updated_at

        # Patch a field
        patch_field, sentinel = _get_patch_field_and_sentinel(cfg)
        current_val = getattr(created, patch_field)
        sentinel = _ensure_different(sentinel, current_val)

        await service.patch(
            db_session, created.id,
            cfg.patch_schema(**{patch_field: sentinel}),
        )

        # Fetch fresh ORM object
        db_session.expire_all()
        patched_orm = await db_session.get(cfg.model, created.id)
        assert patched_orm is not None
        assert patched_orm.updated_at > original_updated_at, (
            f"updated_at did not increase after patch: "
            f"{patched_orm.updated_at} <= {original_updated_at}"
        )


# ─── Config-тест: NOT_NULL_FIELDS ↔ model nullability ────────────────────────────
# ``is_active`` was removed from the exclusion set per #194 Task 9: it is now
# a real column ONLY on soft-delete entities (AbstractModelSoftDelete) and is
# governed by the soft-delete lifecycle (NOT_NULL_FIELDS deals with patch
# fieldset semantics, not lifecycle flags). For soft-delete entities the
# parity check excludes ``is_active`` conditionally via ``model.soft_delete``
# — hard-delete entities have no such column, so the unconditional exclusion
# became a no-op anyway. See docs/specs/2026-08-01-deletion-policy-design.md
# §2.6 for the policy rationale.
GENERIC_COLUMNS_EXCLUDED = {"id", "created_at", "updated_at"}


@pytest.mark.parametrize("service_cls,cfg", _contract_params())
def test_not_null_fields_match_model(service_cls, cfg):
    """NOT_NULL_FIELDS сервиса == NOT NULL колонки модели (минус generic)."""
    assert cfg is not None, (
        f"{service_cls.__name__} обнаружен через __subclasses__(), "
        f"но отсутствует в CONTRACT_CONFIG"
    )
    model_not_null = {
        col.name
        for col in cfg.model.__table__.columns
        if not col.nullable and col.name not in GENERIC_COLUMNS_EXCLUDED
    }
    # ``is_active`` is a NOT NULL column on soft-delete entities but is
    # governed by the soft-delete lifecycle (delete flips it to False),
    # not by patch-fieldset semantics. NOT_NULL_FIELDS protects patch
    # bodies from NULL writes; ``is_active`` is therefore excluded from
    # the parity check for soft-delete entities. Hard-delete entities
    # have no such column (the unconditional GENERIC_COLUMNS_EXCLUDED
    # entry was a no-op there). Spec: docs/specs/2026-08-01-deletion-
    # policy-design.md §2.6.
    if cfg.model.soft_delete:
        model_not_null -= {"is_active"}
    service = cfg.service_factory()
    service_not_null = set(service.NOT_NULL_FIELDS)

    # Account for known mismatches (FK fields not in Patch schema)
    known_extra = set()
    if service_cls in KNOWN_MISMATCHES:
        # Subtract FK fields that are NOT NULL in model but intentionally
        # excluded from NOT_NULL_FIELDS (because they're not patchable)
        known_extra = model_not_null - service_not_null

    expected = model_not_null - known_extra
    assert service_not_null == expected, (
        f"{service_cls.__name__}: NOT_NULL_FIELDS={service_not_null} "
        f"!= model NOT NULL columns={model_not_null}"
        + (
            f" (known mismatches: {KNOWN_MISMATCHES[service_cls]})"
            if service_cls in KNOWN_MISMATCHES
            else ""
        )
    )


# ─── Contract-test: delete semantics per entity (#194 Task 9) ───────────────────
# Spec: docs/specs/2026-08-01-deletion-policy-design.md §2.6 —
# ``EntityConfig.delete_semantics`` is the test-side record of the deletion
# policy (hard = row physically removed; soft = is_active flipped to False).
# Tag/Photo/Visitor/Activity/Record/UserSettings/Payment/Visit → hard;
# Master/Location/Service/Material/Client → soft. This contract test
# exercises the real ``service.delete()`` path so custom cascades
# (ActivityService, VisitorService) are implicitly covered.
class TestGenericServiceDeleteSemantics:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_delete_semantics_per_entity(
        self, service_cls, cfg, db_session, make_entity
    ):
        """service.delete() honors per-entity ``delete_semantics``.

        Hard-delete → row physically gone (fresh SELECT returns None).
        Soft-delete → row survives with ``is_active=False``.
        """
        assert cfg is not None, (
            f"{service_cls.__name__} detected via __subclasses__() but "
            f"missing from CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)
        entity_id = created.id

        ok = await service.delete(db_session, entity_id)
        assert ok, (
            f"{service_cls.__name__}.delete() returned False — entity "
            f"was not found (or already inactive for soft-delete)"
        )

        # Drop the identity-map cache so the assertion SELECT hits the DB
        # (Core-DELETE cascades in ActivityService/VisitorService leave the
        # stale ORM instance in the identity map).
        db_session.expire_all()
        orm = (
            await db_session.execute(
                select(cfg.model).where(cfg.model.id == entity_id)
            )
        ).scalar_one_or_none()

        if cfg.delete_semantics == "hard":
            assert orm is None, (
                f"{service_cls.__name__} (hard-delete): row still present "
                f"after delete — expected physically removed"
            )
        else:  # soft
            assert orm is not None, (
                f"{service_cls.__name__} (soft-delete): row gone — "
                f"expected present with is_active=False"
            )
            assert orm.is_active is False, (
                f"{service_cls.__name__} (soft-delete): is_active="
                f"{orm.is_active!r}, expected False"
            )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_delete_nonexistent_returns_false(
        self, service_cls, cfg, db_session
    ):
        """delete(nonexistent-id) → False (no row, no exception).

        Applies to all 8 entities — both ``BaseRepository.delete``
        (hard path, returns False on missing instance) and
        ``SoftDeleteRepository.delete`` (soft path, same) honor this.
        """
        assert cfg is not None, (
            f"{service_cls.__name__} detected via __subclasses__() but "
            f"missing from CONTRACT_CONFIG"
        )
        service = cfg.service_factory()
        assert await service.delete(db_session, "nonexistent-id") is False, (
            f"{service_cls.__name__}: delete(nonexistent-id) returned "
            f"True, expected False"
        )

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_delete_already_deleted_soft_returns_false(
        self, service_cls, cfg, db_session, make_entity
    ):
        """delete() on an already-archived soft row → False (idempotent soft delete).

        Locks the ``SoftDeleteRepository.delete`` already-inactive edge
        (``repositories/generic.py:147-156``): the ``not instance.is_active``
        guard makes a second ``delete()`` return False — never re-flip and
        never no-op-True.
        """
        assert cfg is not None, (
            f"{service_cls.__name__} detected via __subclasses__() but "
            f"missing from CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)

        first = await service.delete(db_session, created.id)
        assert first, (
            f"{service_cls.__name__}: first delete() returned False — "
            f"setup failure (created row not active or delete failed)"
        )

        second = await service.delete(db_session, created.id)
        assert second is False, (
            f"{service_cls.__name__}: second delete() on already-inactive "
            f"soft row returned {second!r}, expected False"
        )

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_soft_deleted_absent_from_list(
        self, service_cls, cfg, db_session, make_entity
    ):
        """Soft-deleted row is hidden from list() items AND excluded from total.

        The *list hides* half of the list/get pairing (spec §2: archived
        rows must not surface in the default active-only view — SoftDeleteService.list
        filters ``is_active`` by default, ``ArchiveStatus.ACTIVE``).
        """
        assert cfg is not None, (
            f"{service_cls.__name__} detected via __subclasses__() but "
            f"missing from CONTRACT_CONFIG"
        )
        service, created = await make_entity(cfg)

        ok = await service.delete(db_session, created.id)
        assert ok, (
            f"{service_cls.__name__}: setup delete() returned False"
        )

        resp = await service.list(db_session)
        assert created.id not in [i.id for i in resp.items], (
            f"{service_cls.__name__}: archived row leaked into list items"
        )
        assert resp.total == 0, (
            f"{service_cls.__name__}: archived row counted in list total "
            f"(got {resp.total!r}, expected 0)"
        )


# ─── Contract-test: create semantics ───────────────────────────────────────────
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §3.3 —
# ``test_create_response_contains_create_data_fields`` locks the response↔input
# parity for ``create_data`` keys (fields that round-trip through the Response
# schema). ``test_create_persists_row`` asserts the row is reachable via a
# fresh ORM-level ``db_session.get`` — a path distinct from the service's own
# ``get()``, so a service that returns a populated object without flushing
# cannot pass.
class TestGenericServiceCreateContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_create_response_contains_create_data_fields(
        self, service_cls, cfg, db_session, make_entity
    ):
        """Response create fields match the values sent in the input schema."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        _, created, sent = await make_entity(cfg, with_input=True)
        for field in cfg.create_data:
            if field in type(created).model_fields:
                assert getattr(created, field) == getattr(sent, field), (
                    f"{service_cls.__name__}.create: response field {field} mismatch"
                )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_create_persists_row(
        self, service_cls, cfg, db_session, make_entity
    ):
        """Create flushes the row — reachable by a fresh ORM ``db_session.get``."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        _, created = await make_entity(cfg)
        # Drop the identity-map cache so db_session.get hits the DB — a
        # no-flush create would otherwise return the in-memory instance.
        db_session.expire_all()
        row = await db_session.get(cfg.model, created.id)  # ORM-level, distinct from service.get
        assert row is not None, f"{service_cls.__name__}.create: row not persisted"


# ─── Contract-test: get semantics ───────────────────────────────────────────────
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §2/§3.3 —
# ``get`` deliberately returns archived rows (*list hides, get returns*); the
# nonexistent-id → ``None`` edge is half of the contract. ``fk_map`` fields are
# skipped in the round-trip assertion because the input schema carries the
# FK id while the persisted/returned ORM row is compared via the same field —
# the FK comparison would be tautological and obscures real value-set drift.
class TestGenericServiceGetContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_get_returns_created_entity(
        self, service_cls, cfg, db_session, make_entity
    ):
        """get(id) returns the row created via the service with matching fields."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, created, sent = await make_entity(cfg, with_input=True)
        fetched = await service.get(db_session, created.id)
        assert fetched is not None
        for field in cfg.create_data:
            if field in type(fetched).model_fields and field not in cfg.fk_map:
                assert getattr(fetched, field) == getattr(sent, field), (
                    f"{service_cls.__name__}.get: field {field} mismatch"
                )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_get_nonexistent_returns_none(
        self, service_cls, cfg, db_session
    ):
        """get(nonexistent-id) → None (no row, no exception)."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service = cfg.service_factory()
        assert await service.get(db_session, "nonexistent-id") is None


# ─── Contract-test: list semantics ──────────────────────────────────────────────
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §3.3 —
# ``TestGenericServiceListContract`` locks the generic list semantics across
# all 8 non-excepted entities: envelope shape, content, empty-state, pagination
# slicing, out-of-range page, and id-filter narrowing. Replaces the dissolved
# ``test_generic_service_list.py`` (§3.4 absorption mapping).
class TestGenericServiceListContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_envelope_shape(
        self, service_cls, cfg, db_session, make_entity
    ):
        """list() returns PaginatedResponse with exactly {items,total,page,per_page}."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        _, created = await make_entity(cfg)

        service = cfg.service_factory()
        resp = await service.list(db_session)

        assert resp.page == 1, f"{service_cls.__name__}.list: page != 1"
        assert resp.per_page == 20, f"{service_cls.__name__}.list: per_page != 20"
        assert resp.total == 1, f"{service_cls.__name__}.list: total != 1"
        assert isinstance(resp.items, list), (
            f"{service_cls.__name__}.list: items is not a list"
        )
        assert set(type(resp).model_fields) == {"items", "total", "page", "per_page"}, (
            f"{service_cls.__name__}.list: envelope fields != {{items,total,page,per_page}}"
        )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_contains_created_entity(
        self, service_cls, cfg, db_session, make_entity
    ):
        """A row created via the service appears in items and counts toward total."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        _, created = await make_entity(cfg)

        service = cfg.service_factory()
        resp = await service.list(db_session)

        assert created.id in [item.id for item in resp.items], (
            f"{service_cls.__name__}.list: created row not in items"
        )
        assert resp.total == 1, (
            f"{service_cls.__name__}.list: total != 1 after single create"
        )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_empty(self, service_cls, cfg, db_session):
        """Fresh DB (reset_db autouse) → total==0, items==[]."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service = cfg.service_factory()
        resp = await service.list(db_session)

        assert resp.total == 0, f"{service_cls.__name__}.list: total != 0 on empty DB"
        assert resp.items == [], f"{service_cls.__name__}.list: items != [] on empty DB"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_pagination_slices_and_total(
        self, service_cls, cfg, db_session, seed_rows
    ):
        """per_page=2 over 3 rows → page1 has 2 items, page2 has 1; totals agree;
        the two pages are disjoint."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, _rows = await seed_rows(cfg, 3)

        page1 = await service.list(db_session, page=1, per_page=2)
        page2 = await service.list(db_session, page=2, per_page=2)

        assert len(page1.items) == 2, (
            f"{service_cls.__name__}.list: page1 len != 2"
        )
        assert len(page2.items) == 1, (
            f"{service_cls.__name__}.list: page2 len != 1"
        )
        assert page1.total == 3, f"{service_cls.__name__}.list: page1.total != 3"
        assert page2.total == 3, f"{service_cls.__name__}.list: page2.total != 3"
        ids_p1 = {item.id for item in page1.items}
        ids_p2 = {item.id for item in page2.items}
        assert ids_p1.isdisjoint(ids_p2), (
            f"{service_cls.__name__}.list: page1 and page2 ids overlap"
        )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_out_of_range_page(
        self, service_cls, cfg, db_session, seed_rows
    ):
        """page beyond the end → items==[], total still reflects all rows."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, _rows = await seed_rows(cfg, 3)

        resp = await service.list(db_session, page=99, per_page=2)

        assert resp.items == [], (
            f"{service_cls.__name__}.list: out-of-range page items != []"
        )
        assert resp.total == 3, (
            f"{service_cls.__name__}.list: out-of-range page total != 3"
        )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_list_id_filter_narrows_items_and_total(
        self, service_cls, cfg, db_session, seed_rows
    ):
        """id= filter narrows items to one row and total to 1."""
        assert cfg is not None, (
            f"{service_cls.__name__} обнаружен через __subclasses__(), "
            f"но отсутствует в CONTRACT_CONFIG"
        )
        service, rows = await seed_rows(cfg, 3)
        target = rows[0]

        resp = await service.list(db_session, id=target.id)

        assert resp.total == 1, (
            f"{service_cls.__name__}.list: id filter total != 1"
        )
        assert resp.items[0].id == target.id, (
            f"{service_cls.__name__}.list: id filter items[0].id != target.id"
        )


# ─── Contract-test: update (PUT full-replace) semantics ─────────────────────────
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §3.3 (Update
# row, D7), §2 — full replace (PUT, RFC 9110 §9.3.4): omitted fields revert to
# schema defaults, except sticky fields (id, created_at, is_active — the last
# pinned by the future TestGenericServiceIsActiveContract, not exercised here).
# Payload construction via ``_update_kwargs`` (§3.2, D2/D3): create fields +
# update_data, filtered to update_schema.model_fields.
class TestGenericServiceUpdateContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_update_applies_update_data(
        self, service_cls, cfg, db_session, make_entity
    ):
        """update(): update_data fields changed to update_data values; other
        payload fields (create fields reused unchanged) remain at sent values."""
        assert cfg is not None, MISSING_MSG
        service, created, sent = await make_entity(cfg, with_input=True)
        payload = _update_kwargs(cfg, sent)
        updated = await service.update(
            db_session, created.id, cfg.update_schema(**payload)
        )
        assert updated is not None
        after = await service.get(db_session, created.id)
        for field, value in cfg.update_data.items():
            assert getattr(after, field) == value, (
                f"{service_cls.__name__}: update_data field {field} not applied"
            )
        sent_dump = sent.model_dump()
        for field in set(payload) - set(cfg.update_data):
            assert getattr(after, field) == sent_dump[field], (
                f"{service_cls.__name__}: field {field} unexpectedly changed"
            )

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_update_nonexistent_returns_none(
        self, service_cls, cfg, db_session, make_entity
    ):
        """update(nonexistent-id, ...) → None."""
        assert cfg is not None, MISSING_MSG
        service, _, sent = await make_entity(cfg, with_input=True)  # entity only to build a valid payload
        payload = _update_kwargs(cfg, sent)
        assert await service.update(
            db_session, "nonexistent-id", cfg.update_schema(**payload)
        ) is None

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    async def test_update_omitted_optional_field_reverts_to_default(
        self, service_cls, cfg, db_session, make_entity
    ):
        """PUT discrimination: omitting nullable_field from the payload
        reverts the column to its update_schema default (full-replace
        semantics). Explicit pop — the field otherwise rides along via
        create_data (spec panel fix). Tag/Material skip (no nullable_field).
        """
        assert cfg is not None, MISSING_MSG
        if cfg.nullable_field is None:
            pytest.skip(
                f"{service_cls.__name__}: no nullable field "
                f"(PUT default-reversion not exercisable)"
            )
        service, created, sent = await make_entity(cfg, with_input=True)
        # created row already carries a non-default nullable_field value via
        # create_data (verified: all 8 configs)
        payload = _update_kwargs(cfg, sent)
        payload.pop(cfg.nullable_field, None)  # explicit pop
        updated = await service.update(
            db_session, created.id, cfg.update_schema(**payload)
        )
        assert updated is not None
        after = await service.get(db_session, created.id)
        expected_default = cfg.update_schema.model_fields[cfg.nullable_field].default
        assert getattr(after, cfg.nullable_field) == expected_default, (
            f"{service_cls.__name__}: omitted {cfg.nullable_field} did not revert "
            f"to schema default — full-replace (PUT) semantics broken "
            f"(patch semantics leakage?)"
        )
