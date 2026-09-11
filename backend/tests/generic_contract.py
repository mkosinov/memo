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
import src.services.position  # noqa: F401 — register for __subclasses__ discovery
import src.services.record  # noqa: F401
import src.services.service  # noqa: F401
import src.services.staff  # noqa: F401 — register for __subclasses__ discovery
import src.services.tag  # noqa: F401
import src.services.visitor  # noqa: F401

from src.services.generic import GenericService, ArchiveService

# Service classes + factories
from src.services.activity import ActivityService, get_activity_service
from src.services.client import ClientService, get_client_service
from src.services.location import LocationService, get_location_service
from src.services.master import MasterService, get_master_service
from src.services.material import MaterialService, get_material_service
from src.services.payment import PaymentService, get_payment_service
from src.services.photo import PhotoService
from src.services.record import RecordService
from src.services.service import ServiceService, get_service_service
from src.services.tag import TagService, get_tag_service
from src.services.visitor import VisitorService, get_visitor_service

# Models
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag
from src.models.visitor import Visitor

# Schemas — Create
from src.schemas.activity import ActivityCreate
from src.schemas.client import ClientCreate
from src.schemas.location import LocationCreate
from src.schemas.master import MasterCreate
from src.schemas.material import MaterialCreate
from src.schemas.payment import PaymentCreate
from src.schemas.service import ServiceCreate
from src.schemas.tag import TagCreate
from src.schemas.visitor import VisitorCreate

# Schemas — Patch
from src.schemas.activity import ActivityPatch
from src.schemas.client import ClientPatch
from src.schemas.location import LocationPatch
from src.schemas.master import MasterPatch
from src.schemas.material import MaterialPatch
from src.schemas.payment import PaymentPatch
from src.schemas.service import ServicePatch
from src.schemas.tag import TagPatch
from src.schemas.visitor import VisitorPatch

# Schemas — Update (PUT full-replace; Tag has no TagUpdate — reuses TagCreate)
from src.schemas.activity import ActivityUpdate
from src.schemas.client import ClientUpdate
from src.schemas.location import LocationUpdate
from src.schemas.master import MasterUpdate
from src.schemas.material import MaterialUpdate
from src.schemas.payment import PaymentUpdate
from src.schemas.service import ServiceUpdate
from src.schemas.visitor import VisitorUpdate

# Schemas — Response (HTTP-level contract: exact-keys + model_validate on bodies)
from src.schemas.activity import ActivityResponse
from src.schemas.client import ClientResponse
from src.schemas.location import LocationResponse
from src.schemas.master import MasterResponse
from src.schemas.material import MaterialResponse
from src.schemas.payment import PaymentResponse
from src.schemas.service import ServiceResponse
from src.schemas.staff import StaffCreate, StaffPatch, StaffResponse, StaffUpdate
from src.schemas.tag import TagResponse
from src.schemas.visitor import VisitorResponse


# ─── Исключения: сервисы с override-семантикой одного или нескольких
# ─── generic-методов (create/get/list/update/patch/delete) ─────────────────────
# Обязаны иметь собственные тесты (test_api_services.py / test_api_photos.py /
# test_api_records.py). ``ArchiveService`` — абстрактный промежуточный базовый
# класс (#195): не привязан к конкретной модели/схеме, не тестируется напрямую;
# его конкретные подклассы (Master/Location/Material/Client) покрыты через
# CONTRACT_CONFIG и обнаруживаются рекурсивно через ``_all_subclasses``.
#
# GH #266 Task 3: ``StaffService`` (композитная карточка: staff + masters-
# расширение + staff_positions + user) и ``PositionService`` (is_system-гард на
# delete) переопределяют generic-семантику — покрыты собственными наборами
# ``tests/services/test_staff_service.py`` / ``test_position_service.py``
# (HTTP-контракт добавит Task 4: api/v1/staff.py + position.py).
from src.services.position import PositionService
from src.services.staff import StaffService, get_staff_service

GENERIC_CONTRACT_EXCEPTIONS: set[type] = {
    ServiceService, PhotoService, RecordService, ArchiveService,
    StaffService, PositionService,
}


def _all_subclasses(cls: type) -> list[type]:
    """Рекурсивно собрать всех транзитивных потомков ``cls``.

    ``GenericService.__subclasses__()`` возвращает только прямых наследников.
    После #195 появилась промежуточная база ``ArchiveService``, чьи
    конкретные подклассы (Master/Location/Material/Client) — внуки
    ``GenericService`` и без рекурсии выпадали бы из contract-покрытия.
    """
    found: list[type] = []
    for sub in cls.__subclasses__():
        found.append(sub)
        found.extend(_all_subclasses(sub))
    return found


# ─── EntityConfig ────────────────────────────────────────────────────────────────
# Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
# §1/§3.3 — ``delete_semantics`` is the test-side record of the deletion domain
# policy. After #207 ALL 5 archive-capable entities (Master/Location/Service/
# Material/Client) join the hard-delete group: ``DELETE`` is now a real hard
# delete (with dependency-resolution for FK blockers), and archive/restore moved
# to dedicated ``POST /{id}/archive`` + ``POST /{id}/restore`` endpoints (Task 11).
#   * ``"hard"`` — DELETE physically removes the row (all entities post-#207).
#   * ``"soft"`` — kept for backward-compat with the ``_soft_params`` parameterizer
#     but currently empty: no entity declares it. Pinned by
#     ``test_no_entity_declares_soft_delete_semantics``.
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
    # (only Tag.tag is unique=True among the 8 models). Trailing fields below
    # all have defaults so unspecified entries keep working.
    unique_row_field: str | None = None
    # Field overrides that produce a row sorting BEFORE ``create_data`` per
    # §4.4 default order (GH #205 Task 4). Used by the ``/all`` default-order
    # contract test: the sentinel row must sort before the default-
    # ``create_data`` row regardless of insertion order. Only set on the 5
    # dictionary configs (masters/locations/services/tags/materials).
    earlier_create_data: dict | None = None
    # GH #212 search matrix (spec §7). None → entity excluded from
    # TestGenericApiSearchContract until Tasks 5-8 wire its config.
    search_override: dict | None = None  # create_data overrides carrying the Cyrillic probe value (stored UPPERCASE)
    search_query: str | None = None  # lowercase Cyrillic substring matching search_override (M5 pin)


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
        delete_semantics="hard",
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
        delete_semantics="hard",
        update_schema=LocationUpdate,
        update_data={"name": "Loc2", "capacity": 10},
        router_prefix="/api/v1/locations",
        not_found_code="LOCATION_NOT_FOUND",
        response_schema=LocationResponse,
        # §4.4 default order: sort_order ASC, name ASC, id ASC. Both rows share
        # sort_order=0 (column default), so ``name`` decides. "!" (0x21) < "L"
        # (0x4C) → sentinel sorts BEFORE the default ``name="Loc"``.
        earlier_create_data={"name": "!AAA-contract"},
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored value found by a lowercase substring query. All 4 substring
        # fields carry the probe; URL fields are exact-kind and covered by a
        # dedicated full-URL test (partial URLs never match).
        search_override={
            "name": "Флигель",
            "short_title": "Флигель",
            "address": "Флигель, дом 1",
            "description": "Флигель с мансардой",
        },
        search_query="флиг",
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
        delete_semantics="hard",
        update_schema=MasterUpdate,
        update_data={
            "first_name": "A2",
            "last_name": "B2",
            "color": "#000000",
        },
        router_prefix="/api/v1/masters",
        not_found_code="MASTER_NOT_FOUND",
        response_schema=MasterResponse,
        # §4.4 default order: sort_order ASC, first_name ASC, id ASC. Both rows
        # share sort_order=0 (column default), so ``first_name`` decides.
        # "!" (0x21) < "A" (0x41) → sentinel sorts BEFORE the default
        # ``first_name="A"``.
        earlier_create_data={"first_name": "!AAA-contract"},
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored values found by a lowercase substring query. Both substring
        # fields (first_name AND last_name) carry the probe; per-field
        # coverage via the dedicated per-field matrix test.
        search_override={"first_name": "Живописец", "last_name": "Живописный"},
        search_query="живопис",
    ),
    # GH #266 Task 3: StaffService overrides the generic CRUD semantics
    # (composite card) → it stays in GENERIC_CONTRACT_EXCEPTIONS for the CRUD
    # contract; this entry feeds the ArchiveService archive/restore bool
    # round-trip (its bare-card path: no master ext, no user → only the
    # staff row's is_active flips — D6 checkboxes have their own dedicated
    # tests in tests/services/test_staff_service.py).
    StaffService: EntityConfig(
        service_factory=get_staff_service,
        model=Staff,
        create_schema=StaffCreate,
        patch_schema=StaffPatch,
        create_data={"first_name": "A", "last_name": "B"},
        fk_map={},
        not_null_field="first_name",
        not_null_sentinel="A2",
        nullable_field="avatar_url",
        nullable_sentinel="http://x",
        delete_semantics="hard",
        update_schema=StaffUpdate,
        update_data={"first_name": "A2", "last_name": "B2"},
        # HTTP wiring — routes land in Task 4 (api/v1/staff.py).
        router_prefix="/api/v1/staff",
        not_found_code="STAFF_NOT_FOUND",
        response_schema=StaffResponse,
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
        delete_semantics="hard",
        update_schema=MaterialUpdate,
        update_data={"title": "T2", "description": "D2"},
        router_prefix="/api/v1/materials",
        not_found_code="MATERIAL_NOT_FOUND",
        response_schema=MaterialResponse,
        # §4.4 default order: title ASC, id ASC. "!" (0x21) < "T" (0x54) →
        # sentinel sorts BEFORE the default ``title="T"``.
        earlier_create_data={"title": "!AAA-contract"},
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored values found by a lowercase substring query. Both substring
        # fields (title AND description) carry the probe.
        search_override={"title": "Гуашевый", "description": "Гуашевые краски"},
        search_query="гуашев",
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
    # #207 Task 12: ServiceService is in GENERIC_CONTRACT_EXCEPTIONS (it
    # overrides update/patch for nested tariffs/tag_ids), but it shares the
    # ArchiveService.archive/restore surface with the other 4 archive-capable
    # entities. This config entry seeds the new TestArchiveServiceArchiveRestore
    # contract (via _archive_params); the standard _contract_params() skips
    # it (still excepted), so the CRUD contracts remain unaffected.
    ServiceService: EntityConfig(
        service_factory=get_service_service,
        model=Service,
        create_schema=ServiceCreate,
        patch_schema=ServicePatch,
        create_data={
            "title": "T",
            "description": "D",
            "image_url": "http://x",
            "specialty": "s",
            "min_age": 6,
            "duration": 60,
            "record_info": "ri",
        },
        fk_map={},
        not_null_field="title",
        not_null_sentinel="T2",
        nullable_field="max_age",
        nullable_sentinel=42,
        delete_semantics="hard",
        update_schema=ServiceUpdate,
        update_data={
            "title": "T2",
            "description": "D2",
            "image_url": "http://x2",
            "specialty": "s2",
            "min_age": 7,
            "duration": 90,
            "record_info": "ri2",
        },
        router_prefix="/api/v1/services",
        not_found_code="SERVICE_NOT_FOUND",
        response_schema=ServiceResponse,
        # §4.4 default order: title ASC, id ASC. "!" (0x21) < "T" (0x54) →
        # sentinel sorts BEFORE the default ``title="T"``.
        earlier_create_data={"title": "!AAA-contract"},
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored values found by a lowercase substring query. Both substring
        # fields (title AND description) carry the probe; ServiceService.list
        # is a custom override delegating to ArchiveRepository.list — its q
        # forwarding is exactly what this matrix pins.
        search_override={"title": "Батиковый", "description": "Батиковые изделия"},
        search_query="батиков",
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
        # §4.4 default order: tag ASC, id ASC. "!" (0x21) < "t" (0x74) →
        # sentinel sorts BEFORE the default ``tag="t1"``.
        earlier_create_data={"tag": "!aaa-contract"},
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored value found by a lowercase substring query. Differs from
        # create_data ("t1") so multi-row tests never hit the tag UNIQUE
        # constraint.
        search_override={"tag": "Живопись"},
        search_query="жив",
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
        # GH #212 search matrix probe (spec §5.2/§5.4 M5): uppercase Cyrillic
        # stored value found by a lowercase substring query (name only).
        search_override={"name": "Серафима"},
        search_query="серафим",
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
    """Parametrization over soft-delete entities only (``delete_semantics == "soft"``).

    Post-#207: ALL 5 archive-capable entities (Master/Location/Service/Material/
    Client) joined the hard-delete group — ``DELETE`` is a real hard delete and
    archive/restore moved to dedicated ``POST /{id}/archive`` + ``POST /{id}/restore``
    endpoints (spec §1/§3.3). No entity currently declares ``"soft"``, so this
    returns ``[]``. The invariant is pinned by
    ``test_no_entity_declares_soft_delete_semantics`` in
    ``tests/services/test_generic_service_contract.py`` — if a future entity
    regresses to soft-delete semantics, that contract test fails loudly and
    re-activates the (deleted) soft-only edge tests that were folded into the
    hard-delete world (spec Part B3 of #207 Task 13).
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


def _serialized_keys(schema_cls: type) -> set[str]:
    """Field names a Pydantic Response schema actually SERIALIZES to JSON.

    The 5 archive-capable Response schemas (Master/Location/Service/Material/
    Client, #207 §3.1) keep ``is_active`` as ``Field(..., exclude=True)`` (parsed
    in the constructor, NOT serialized) and expose ``archived`` via a
    ``@computed_field`` (serialized, but absent from ``model_fields``).
    Contract helpers that previously used ``set(model_fields.keys())`` compared
    against the stale parsed set and missed ``archived`` while asserting
    ``is_active`` — this helper computes what the API actually emits so the
    contract pins the wire shape (declared the approved Task 4 design — do NOT
    ``model_validate`` the body back, the excluded required field makes that
    raise). Hard-delete entity Response schemas have no ``exclude=True`` field
    and no computed fields → the helper returns ``set(model_fields)`` for them.
    """
    serialized: set[str] = set()
    for name, field in schema_cls.model_fields.items():
        if field.exclude is True:
            continue
        serialized.add(name)
    serialized |= set(schema_cls.model_computed_fields.keys())
    return serialized


def _archive_params() -> list:
    """Parametrization over archive-capable ``ArchiveService`` subclasses —
    the 5 entities with an ``is_active`` column: Master/Location/Service/
    Material/Client (concrete descendants of ``ArchiveService``).

    Spec §10 (#184/#185 reconciliation) + §14 acceptance criterion — drives
    ``TestArchiveServiceArchiveRestore``: the bool service contract for
    ``archive()``/``restore()`` (DB ``is_active`` False/True flip). The
    HTTP-level ``archived`` response body mapping (archived = not is_active)
    is asserted at the API route level (Task 13).

    Note: ``ServiceService`` shares this surface (inherits
    ``ArchiveService.archive``/``restore`` UNCHANGED — unlike ``update``/
    ``patch`` which it overrides) and stays in ``GENERIC_CONTRACT_EXCEPTIONS``
    for the standard CRUD contract tests. Its CONTRACT_CONFIG entry seeds the
    archive/restore round-trip here. Fail loudly if a new ArchiveService
    subclass lands without a config (mirror of ``_contract_params`` guard).
    """
    params = []
    for cls in _all_subclasses(ArchiveService):
        if cls is ArchiveService:
            continue
        cfg = CONTRACT_CONFIG.get(cls)
        assert cfg is not None, (
            f"{cls.__name__} is an ArchiveService subclass (concrete archive/"
            f"restore surface — has an is_active column) but missing from "
            f"CONTRACT_CONFIG. Add a config entry so the archive/restore "
            f"contract round-trip can seed a row, or drop the ArchiveService "
            f"base from the class."
        )
        params.append(pytest.param(cls, cfg, id=cls.__name__))
    return params


# ─── /all dictionary contract parametrizer (GH #205 Task 4, spec §4.6) ───────
# Opt-in set: the 5 dictionaries that ship a bare ``GET {prefix}/all`` route
# (masters/locations/services/tags/materials). ``ServiceService`` IS in
# ``GENERIC_CONTRACT_EXCEPTIONS`` for the CRUD contract (it overrides
# update/patch for nested tariffs/tag_ids), but it has a ``CONTRACT_CONFIG``
# entry and its ``list_all`` override (eager-loads tariffs+tags) is exactly
# what this contract guards — so it joins the ``/all`` set. The parametrizer
# reads ``CONTRACT_CONFIG`` directly (not ``_contract_params``), so the
# exceptions list does not filter it out.
BARE_ALL_ENTITIES: list[type] = [MasterService, LocationService, ServiceService, TagService, MaterialService]


def _all_params() -> list:
    """Opt-in parametrizer for the dictionary ``/all`` contract (#205).

    Returns one ``pytest.param`` per dictionary service class, carrying its
    ``EntityConfig`` (or ``None`` if missing — the test asserts non-None and
    fails loudly, mirroring ``_contract_params``' guard). Entities outside
    this list are never parametrized — the ``/all`` contract stays opt-in.
    """
    params = []
    for cls in BARE_ALL_ENTITIES:
        cfg = CONTRACT_CONFIG.get(cls)
        if cfg is None:
            params.append(pytest.param(cls, None, id=f"{cls.__name__}-all-MISSING-CONFIG"))
            continue
        params.append(pytest.param(cls, cfg, id=f"{cls.__name__}-all"))
    return params


# ─── ?q= search matrix parametrizer (GH #212 Task 4, spec §7) ──────────────
# Opt-in filter: only entities whose config sets ``search_query`` join the
# matrix (Task 5 wired the 5 generic dictionaries — masters/materials/
# locations/visitors/services + tags from Task 4; Tasks 6-8 wire the custom
# lists: clients/records/activities). Iterates ``CONTRACT_CONFIG``
# DIRECTLY — like ``_all_params``, NOT like ``_contract_params`` — so the
# search matrix must NOT skip ``GENERIC_CONTRACT_EXCEPTIONS``:
# ``ServiceService`` is in that set (it overrides update/patch) yet its
# custom-list q path needs matrix coverage (wired in Task 5).
def _search_params() -> list:
    return [
        pytest.param(cls, cfg, id=f"{cls.__name__}-search")
        for cls, cfg in CONTRACT_CONFIG.items()
        if cfg.search_query is not None
    ]


def _search_field_params() -> list:
    """Per-field rows for the substring contract (GH #212 Task 5, spec §7
    case 1): one ``(cfg, field)`` param per ``search_override`` key — i.e.
    per DECLARED substring field (``search_override`` carries the probe on
    every substring field; id/URL fields are not probe fields). The matrix's
    ``test_substring_match_case_insensitive`` seeds ONE row carrying the
    probe on ALL fields at once (matching via ANY field passes); these rows
    pin each field SEPARATELY: masters first_name AND last_name, materials/
    services title AND description, locations name/short_title/address/
    description, visitors name (single-field — parity row).
    """
    params = []
    for cls, cfg in CONTRACT_CONFIG.items():
        if cfg.search_query is None:
            continue
        assert cfg.search_override is not None
        for field in cfg.search_override:
            params.append(pytest.param(cfg, field, id=f"{cls.__name__}-{field}"))
    return params
