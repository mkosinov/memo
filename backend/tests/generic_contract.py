"""Shared config for GenericService contract tests (service level + HTTP level, GH #184/#185). One entry per entity drives both contracts. The explicit service imports below power __subclasses__() discovery — do not trim."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, NamedTuple

import pytest

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

# Schemas — Response (HTTP-level contract: exact-keys + model_validate on bodies)
from src.schemas.activity import ActivityResponse
from src.schemas.client import ClientResponse
from src.schemas.location import LocationResponse
from src.schemas.master import MasterResponse
from src.schemas.material import MaterialResponse
from src.schemas.payment import PaymentResponse
from src.schemas.tag import TagResponse
from src.schemas.visitor import VisitorResponse


# ─── Исключения: сервисы с override-семантикой одного или нескольких
# ─── generic-методов (create/get/list/update/patch/delete) ─────────────────────
# Обязаны иметь собственные тесты (test_api_services.py / test_api_photos.py /
# test_api_records.py). ``SoftDeleteService`` — абстрактный промежуточный базовый
# класс (#195): не привязан к конкретной модели/схеме, не тестируется напрямую;
# его конкретные подклассы (Master/Location/Material/Client) покрыты через
# CONTRACT_CONFIG и обнаруживаются рекурсивно через ``_all_subclasses``.
GENERIC_CONTRACT_EXCEPTIONS: set[type] = {ServiceService, PhotoService, RecordService, SoftDeleteService}


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
    # HTTP-level wiring (used by tests/test_generic_api_contract.py; the
    # service-level contract ignores them). Required, no defaults — a new
    # entity configured without them must fail loudly at import, not silently
    # lose HTTP coverage (spec D16).
    router_prefix: str  # e.g. "/api/v1/masters"
    not_found_code: str  # e.g. "MASTER_NOT_FOUND" — explicit, NOT derived (activities → ACTIVITY, spec D15)
    response_schema: type  # <Entity>Response — model_validate + exact-keys on HTTP bodies
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
        router_prefix="/api/v1/activities",
        not_found_code="ACTIVITY_NOT_FOUND",
        response_schema=ActivityResponse,
    ),
    ClientService: EntityConfig(
        service_factory=get_client_service,
        model=Client,
        create_schema=ClientCreate,
        patch_schema=ClientPatch,
        create_data={"name": "Ivan", "phone": "+79000000000", "email": "ivan@example.com", "channel": "telegram"},
        fk_map={},
        not_null_field=None,
        not_null_sentinel=None,
        nullable_field="name",
        nullable_sentinel="Ivan",
        delete_semantics="soft",
        update_schema=ClientUpdate,
        update_data={"name": "Petr", "phone": "+79111111111", "email": "petr@example.com", "channel": "whatsapp"},
        router_prefix="/api/v1/clients",
        not_found_code="CLIENT_NOT_FOUND",
        response_schema=ClientResponse,
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
        router_prefix="/api/v1/locations",
        not_found_code="LOCATION_NOT_FOUND",
        response_schema=LocationResponse,
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
        router_prefix="/api/v1/masters",
        not_found_code="MASTER_NOT_FOUND",
        response_schema=MasterResponse,
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
        router_prefix="/api/v1/materials",
        not_found_code="MATERIAL_NOT_FOUND",
        response_schema=MaterialResponse,
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
        router_prefix="/api/v1/payments",
        not_found_code="PAYMENT_NOT_FOUND",
        response_schema=PaymentResponse,
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
        router_prefix="/api/v1/tags",
        not_found_code="TAG_NOT_FOUND",
        response_schema=TagResponse,
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
        router_prefix="/api/v1/visitors",
        not_found_code="VISITOR_NOT_FOUND",
        response_schema=VisitorResponse,
    ),
}


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


def _hard_params() -> list:
    """Parametrization over hard-delete entities only (delete_semantics == "hard").

    Mirror of _soft_params(); used by the HTTP-level delete-visibility tests
    (tests/test_generic_api_contract.py, GH #185).
    """
    return [
        p
        for p in _contract_params()
        if p.values[1] is not None and p.values[1].delete_semantics == "hard"
    ]
