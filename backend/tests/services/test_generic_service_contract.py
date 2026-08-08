"""Contract-тест GenericService full-CRUD (create/get/list/update/patch/delete).

Единый источник истины generic-семантик. Сущности обнаруживаются
автоматически через GenericService.__subclasses__(). Новый подкласс без
config-записи в CONTRACT_CONFIG → падение при сборе параметров. Исключения
(override-семантика одного или нескольких generic-методов) обязаны иметь
собственные тесты.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from src.services.activity import ActivityService
from src.services.generic import GenericService
from src.services.payment import PaymentService
from src.services.visitor import VisitorService
from tests.generic_contract import (
    CONTRACT_CONFIG,
    GENERIC_CONTRACT_EXCEPTIONS,
    EntityConfig,
    _all_subclasses,
    _contract_params,
    _soft_params,
)

# Shared missing-config guard message — newer contract classes
# (TestGenericServiceUpdateContract and onward) use this constant; older
# classes (Patch/Create/Get/List/Delete semantics) keep their inline
# f-string messages for historical parity. Parametrized ids already
# announce the class via `pytest.param(cls, None,
# id=f"{cls.__name__}-MISSING-CONFIG")` so the message itself can be terse.
MISSING_MSG = "subclass detected via __subclasses__() but missing from CONTRACT_CONFIG"


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
    ``is_active`` is injected as ``True`` for soft entities (required PUT
    field, GH #178) — both dropped by the model_fields filter / never added.

    Spec: 2026-08-03-generic-service-crud-contract-design.md §3.2 (payload
    construction), §3.3 Update row (D7).
    """
    allowed = set(cfg.update_schema.model_fields)
    data = {k: v for k, v in sent.model_dump().items() if k in allowed}
    data.update(cfg.update_data)
    # GH #178: is_active is a required PUT field for soft entities — the
    # create schema never carries it, so inject it explicitly. Hard
    # entities (no is_active in update_schema) are unaffected by the filter.
    if "is_active" in allowed:
        data.setdefault("is_active", True)
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
# schema defaults, except sticky fields (id, created_at — never in the Update
# schema, so never touched). ``is_active`` is a required PUT field on soft
# entities (GH #178), not a sticky PUT exception; its PATCH stickiness is
# pinned by TestGenericServiceIsActiveContract.
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
        for field in set(payload) - set(cfg.update_data) - {"is_active"}:
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
        Client post-#201: nullable_field is required → omission raises
        ValidationError (data-driven branch).
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
        # GH #201: a required-nullable Update field (Client post-#201) makes
        # omission a ValidationError, not a default reversion — flip the
        # expectation data-driven, same pattern as the #178 is_active guard.
        if cfg.update_schema.model_fields[cfg.nullable_field].is_required():
            with pytest.raises(ValidationError):
                cfg.update_schema(**payload)
            return
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


# ─── Contract-test: is_active semantics on update/patch (#178 canonical PUT) ─
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §2 (amended
# contract table), §3.3 (IsActiveContract row), §8 D12/D13 — user-directed
# semantics: ``get`` deliberately returns archived rows (*list hides* / *get
# returns* pairing — user decision 1); PUT requires ``is_active`` (canonical
# full-replace, GH #178 — omitted → 422 from the Update schema before any DB
# write; explicit bool applies, ``True`` on archived = legal reactivation);
# PATCH is sticky (omitted / explicit ``None`` preserve the stored value;
# explicit bool applies). ``is_active`` is no longer a PUT sticky-field
# exception — it is a required PUT field, like any other NOT NULL column.
#
# Parametrized over soft entities only via ``_soft_params()`` — one in-test
# skip: ``test_update_without_is_active_raises_validation_error`` skips Client
# until GH #201 redefines Client PUT semantics (the check is data-driven via
# ``FieldInfo.is_required()`` and lifts itself when #201 flips ClientUpdate to
# required). Every test still starts with the ``assert cfg is not None`` line
# for symmetry with the other contract classes (``_soft_params`` already
# filters MISSING-CONFIG entries, so the assert is a no-op invariant here).
#
# Multi-phase tests use **labeled assertions** (assert messages per direction)
# for failure localization (panel conflict resolution round 2 — Assertion
# Roulette dismissed). ``ServiceService`` is a contract exception (own
# ``update``/``patch`` overrides) and is covered in
# ``backend/tests/services/test_service_service.py``.
class TestGenericServiceIsActiveContract:
    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_get_archived_returns_row_with_is_active_false(
        self, service_cls, cfg, db_session, make_entity
    ):
        """get() deliberately returns archived rows (user decision 1).

        No ``is_active`` filter on ``get`` — the *list hides* / *get returns*
        pairing is locked here; the row's archive state is visible via the
        Response schema (``is_active`` is exposed on all 5 soft entities).
        """
        assert cfg is not None, MISSING_MSG
        service, created = await make_entity(cfg)
        ok = await service.delete(db_session, created.id)
        assert ok, f"{service_cls.__name__}: setup delete() returned False"
        fetched = await service.get(db_session, created.id)
        assert fetched is not None, (
            f"{service_cls.__name__}: get must return archived rows "
            f"(user decision 1)"
        )
        assert fetched.is_active is False, (
            f"{service_cls.__name__}: archived row's is_active must be False"
        )

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_update_without_is_active_raises_validation_error(
        self, service_cls, cfg, db_session, make_entity
    ):
        """PUT without ``is_active`` → the Update schema refuses construction
        (canonical full-replace, GH #178): ``is_active`` is required, so
        Pydantic raises ``ValidationError`` before any DB write.

        Entities whose Update schema still treats ``is_active`` as optional
        (Client — until GH #201 redefines Client PUT semantics) skip: the
        check is data-driven via ``FieldInfo.is_required()`` and lifts
        itself automatically when #201 flips ClientUpdate to required.
        """
        assert cfg is not None, MISSING_MSG
        field = cfg.update_schema.model_fields.get("is_active")
        assert field is not None, (
            f"{service_cls.__name__}: soft entity must expose is_active"
        )
        if not field.is_required():
            pytest.skip(
                "GH #201: is_active not yet required for this entity "
                "(Client PUT semantics redefined there)"
            )
        _, _, sent = await make_entity(cfg, with_input=True)
        payload = _update_kwargs(cfg, sent)
        payload.pop("is_active")
        with pytest.raises(ValidationError):
            cfg.update_schema(**payload)

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_update_explicit_is_active_applies(
        self, service_cls, cfg, db_session, make_entity
    ):
        """PUT with explicit ``is_active`` bool applies it: False archives an
        active row (phase 1), True reactivates an archived row (phase 2), and
        the reactivated row must be visible in ``list()`` again (phase 3).

        ``True`` on archived = legal reactivation (user decision 3).
        """
        assert cfg is not None, MISSING_MSG
        service, created, sent = await make_entity(cfg, with_input=True)
        payload = _update_kwargs(cfg, sent)
        payload["is_active"] = False
        await service.update(
            db_session, created.id, cfg.update_schema(**payload)
        )
        archived = await service.get(db_session, created.id)
        assert archived is not None, (
            f"{service_cls.__name__}: row vanished after archive"
        )
        assert archived.is_active is False, (
            f"{service_cls.__name__}: explicit False must archive"
        )
        # phase 2: explicit True reactivates the archived row
        payload["is_active"] = True
        await service.update(
            db_session, created.id, cfg.update_schema(**payload)
        )
        reactivated = await service.get(db_session, created.id)
        assert reactivated is not None, (
            f"{service_cls.__name__}: row vanished after reactivate"
        )
        assert reactivated.is_active is True, (
            f"{service_cls.__name__}: explicit True must reactivate"
        )
        # phase 3: reactivated row visible in list() again (default active-only)
        resp = await service.list(db_session)
        assert created.id in [i.id for i in resp.items], (
            f"{service_cls.__name__}: reactivated row visible in list again"
        )

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_patch_preserves_is_active_when_omitted_or_none(
        self, service_cls, cfg, db_session, make_entity
    ):
        """PATCH preserves ``is_active`` in two flavors: (phase 1) field
        omitted from the patch entirely → no-op; (phase 2) field sent as
        ``None`` → stripped, never written as NULL to the NOT NULL column
        (user-directed semantics, spec §2 amended patch row).

        The explicit-None hazard: the 4 soft Patch schemas already declare
        ``is_active: bool | None = None``, but ``GenericService.patch`` only
        strips None for ``NOT_NULL_FIELDS`` (and ``is_active`` is in no
        service's ``NOT_NULL_FIELDS``) → PATCH ``{"is_active": null}`` writes
        NULL → DB NOT NULL violation. After the §3.5 fix
        (``SoftDeleteService._patch_payload`` pops is_active=None) the
        stored value is preserved instead.
        """
        assert cfg is not None, MISSING_MSG
        service, created = await make_entity(cfg)
        ok = await service.delete(db_session, created.id)
        assert ok, f"{service_cls.__name__}: setup delete() returned False"
        # phase 1: omitted (empty patch) → no-op
        await service.patch(
            db_session, created.id, cfg.patch_schema()
        )
        after1 = await service.get(db_session, created.id)
        assert after1 is not None, f"{service_cls.__name__}: phase 1 row vanished"
        assert after1.is_active is False, (
            f"{service_cls.__name__}: patch omitted is_active must preserve "
            f"archived state"
        )
        # phase 2: explicit None (must mean preserve, never NULL)
        await service.patch(
            db_session, created.id, cfg.patch_schema(is_active=None)
        )
        after2 = await service.get(db_session, created.id)
        assert after2 is not None, f"{service_cls.__name__}: phase 2 row vanished"
        assert after2.is_active is False, (
            f"{service_cls.__name__}: is_active=None must mean preserve, "
            f"never NULL"
        )

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    async def test_patch_explicit_is_active_applies(
        self, service_cls, cfg, db_session, make_entity
    ):
        """PATCH with explicit ``is_active`` bool applies it (both directions):
        False archives an active row (phase 1), True reactivates an archived
        row (phase 2) and the row reappears in ``list()`` (phase 3)."""
        assert cfg is not None, MISSING_MSG
        service, created = await make_entity(cfg)
        # phase 1: explicit False archives
        await service.patch(
            db_session, created.id, cfg.patch_schema(is_active=False)
        )
        archived = await service.get(db_session, created.id)
        assert archived is not None, (
            f"{service_cls.__name__}: row vanished after archive"
        )
        assert archived.is_active is False, (
            f"{service_cls.__name__}: patch explicit False must archive"
        )
        # phase 2: explicit True reactivates
        await service.patch(
            db_session, created.id, cfg.patch_schema(is_active=True)
        )
        reactivated = await service.get(db_session, created.id)
        assert reactivated is not None, (
            f"{service_cls.__name__}: row vanished after reactivate"
        )
        assert reactivated.is_active is True, (
            f"{service_cls.__name__}: patch explicit True must reactivate"
        )
        # phase 3: reactivated row visible in list()
        resp = await service.list(db_session)
        assert created.id in [i.id for i in resp.items], (
            f"{service_cls.__name__}: reactivated row visible in list again"
        )
