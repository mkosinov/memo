"""Standalone PATCH mini-contract (GH #179): Visits + UserSettings.

GH #239 made VisitService and UserSettingsService standalone transactional
services (no GenericService base), so the generic patch contract
(tests/generic_contract.py → TestGenericServicePatchContract) no longer
covers them. This file pins the SAME five patch semantics for the two
standalone services, at SERVICE level (no HTTP):

  1. partial update — the sentinel lands on the patched field; EVERY other
     field of the patch schema stays at its pre-state;
  2. not-found — patching a missing owner row returns ``None`` (Visit:
     missing ``visit_id``; UserSettings: ``user_id`` without a row);
  3. updated_at — a real patch bumps ``updated_at`` (``>=`` guard against
     equal SQLite ticks);
  4. null-policy — an explicit ``null`` on a NOT NULL field is IGNORED
     ('don't change'), while on a NULLABLE field it is APPLIED (clears the
     field); list fields take ``[]`` as a VALUE while ``null`` stays ignored;
  5. empty body — a patch schema with NO fields set is a full no-op: every
     field value AND ``updated_at`` stay unchanged.

Shape modeled on tests/generic_contract.py: a config NamedTuple per entity
(``PatchContractConfig``) drives a parametrized test class — but this file
is STANDALONE: explicit configs only, NO auto-discovery, NO inheritance
from the generic contract (the two services are not GenericService
subclasses).

Task 4 of the plan (dedup of private test files) is intentionally NOT
here; Task 3 (null-policy / empty-body semantics) IS.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, NamedTuple

import pytest

from src.schemas.user_settings import UserSettingsCreate, UserSettingsPatch
from src.schemas.visit import VisitPatch
from src.services.user_settings import (
    UserSettingsService,
    get_user_settings_service,
)
from src.services.visit import VisitService, get_visit_service

# ─── Config ──────────────────────────────────────────────────────────────────────

# Builds the owner row for the config and returns (service, row, key):
# ``key`` is what the patch method addresses (visit_id for Visits, user_id
# for UserSettings) and ``row`` is the freshly created owner (ORM Visit /
# UserSettingsResponse). Receives (cfg, db_session, sample_visit):
# ``sample_visit`` is declared as a DIRECT test parameter (the pattern
# proven in tests/services/test_visit_service.py — lazy
# ``request.getfixturevalue`` of an async fixture cannot run inside the
# test's event loop); the UserSettings factory accepts it for signature
# uniformity and ignores it, building its own User row async.
OwnerFactory = Callable[..., Awaitable[tuple[Any, Any, str]]]

# Applies a partial update through the service's patch method and returns
# the patched row (ORM Visit / UserSettingsResponse) — or None on not-found.
# Signature: (cfg, db_session, key, data); the service resolves via
# ``cfg.service_factory()``.
PatchCall = Callable[..., Awaitable[Any]]

# Reads the owner's current state as a flat dict (pre/post patch snapshot).
# Signature: (cfg, db_session, key).
StateReader = Callable[..., Awaitable[dict[str, Any] | None]]


class PatchContractConfig(NamedTuple):
    """Per-entity config for the standalone PATCH mini-contract.

    Modeled on ``EntityConfig`` from tests/generic_contract.py (GH #184/#185),
    trimmed to what the five patch semantics need:

    * ``name`` — parametrization id (e.g. ``visits``).
    * ``service_factory`` — the service singleton factory (get_*_service).
    * ``patch_schema`` — the Pydantic partial-update schema
      (VisitPatch / UserSettingsPatch).
    * ``patch_call`` — ``(cfg, db_session, key, data) -> row | None``
      wrapper over the service's patch method (VisitService.patch vs
      UserSettingsService.update_by_user_id — different method names, so
      the service-specific binding lives in the config, not the tests;
      the service resolves via ``service_factory()``).
    * ``read_state`` — ``(cfg, db_session, key) -> dict | None`` pre/post-patch
      snapshot (ORM attributes vs parsed UserSettingsResponse).
    * ``not_null_fields`` — patch-schema fields the service treats as
      NOT NULL (null → stripped; Task 3 pins that policy). Visits:
      {price, status}; UserSettings: all 6 fields
      (docs/domain-rules/user_settings.md).
    * ``nullable_field`` — one patch-schema field that MAY be null, or None
      when the schema has no nullable field (UserSettingsPatch). The
      null-policy test's nullable half runs only when this is set; the
      ``apply_null`` callback (optional) turns ``field=None`` into a schema
      for the null-policy probes without touching the sentinel path.
    * ``list_fields`` — patch-schema list fields (UserSettings:
      column_order_staff / column_order_locations): ``null`` → ignored,
      ``[]`` → applied as a real value. Empty for Visits (no list fields).
    * ``patch_field`` — the single field the partial-update test patches
      (must be in not_null_fields or equal nullable_field).
    * ``original`` / ``sentinel`` — the pre-state value of ``patch_field``
      and its replacement; ``original != sentinel`` is guaranteed by
      ``test_sentinel_differs_from_original`` (the standalone analogue of
      ``_ensure_different`` from the generic contract).
    * ``make_owner`` — async factory:
      ``(cfg, db_session, sample_visit) -> (service, row, key)``. Visits
      reuse the conftest ``sample_visit`` async fixture — declared as a
      DIRECT test parameter and forwarded here (lazy
      ``request.getfixturevalue`` of async fixtures cannot run inside the
      test's event loop); UserSettings accept it for signature symmetry
      but ignore it — they build their own async setup (a ``User`` row
      inserted through ``db_session`` + the settings row created via the
      service call; the sync ``_user`` conftest fixture commits on a
      separate connection and is deliberately NOT reused).
    """

    name: str
    service_factory: Callable[[], Any]
    patch_schema: type
    patch_call: PatchCall
    read_state: StateReader
    not_null_fields: frozenset[str]
    nullable_field: str | None
    list_fields: frozenset[str]
    patch_field: str
    original: Any
    sentinel: Any
    make_owner: OwnerFactory
    apply_null: Callable[[type, str], Any] | None = None
    """Builds a patch schema instance with ``field=None`` EXPLICITLY set
    (``lambda schema, field: schema(**{field: None})``). Optional because
    the sentinel path never needs it; both configs provide it so the
    null-policy probes stay uniform. Signature: (patch_schema, field)."""


# ─── Visits config ───────────────────────────────────────────────────────────────

async def _make_visit_owner(
    cfg: PatchContractConfig,
    db_session,
    sample_visit,
) -> tuple[VisitService, Any, str]:
    """Visits owner factory: conftest ``sample_visit`` — declared as a
    DIRECT test parameter (the pytest-asyncio-proven pattern from
    test_visit_service.py; ``request.getfixturevalue`` of an async
    fixture from inside a running loop raises ``RuntimeError:
    Runner.run() cannot be called from a running event loop``).
    Seeds price=3000, status='waiting'."""
    service = cfg.service_factory()
    assert isinstance(service, VisitService)
    return service, sample_visit, sample_visit.id


def _visit_patch_call(
    cfg: PatchContractConfig, db_session, key: str, data: Any
) -> Awaitable[Any]:
    return VisitService.patch(cfg.service_factory(), db_session, key, data)


async def _visit_read_state(
    cfg: PatchContractConfig, db_session, key: str
) -> dict[str, Any] | None:
    """Pre/post-patch snapshot from the ORM Visit (attribute access)."""
    orm = await cfg.service_factory().get(db_session, key)
    if orm is None:
        return None
    return {c.name: getattr(orm, c.name) for c in type(orm).__table__.columns}


# ─── UserSettings config ─────────────────────────────────────────────────────────

async def _make_user_settings_owner(
    cfg: PatchContractConfig,
    db_session,
    sample_visit,  # accepted for signature uniformity; unused by this factory.
) -> tuple[UserSettingsService, Any, str]:
    """UserSettings owner factory — OWN async setup (GH #179 Task 1).

    1. Insert a ``User`` row through ``db_session`` (the same session the
       service call below uses — the sync ``_user`` conftest fixture
       commits on a separate connection and is NOT reused).
    2. Create the settings row via ``UserSettingsService.create``.

    Defaults match UserSettingsCreate so ``original`` (theme="light") is
    the real pre-state of the created row.
    """
    from src.models.user import User

    user = User(
        phone=f"+7999{uuid.uuid4().int % 10**10:010d}",
        password_hash="test",
        role="admin",
    )
    db_session.add(user)
    await db_session.flush()

    service = cfg.service_factory()
    assert isinstance(service, UserSettingsService)
    row = await service.create(db_session, UserSettingsCreate(user_id=user.id))
    return service, row, row.user_id


def _user_settings_patch_call(
    cfg: PatchContractConfig, db_session, key: str, data: Any
) -> Awaitable[Any]:
    return UserSettingsService.update_by_user_id(
        cfg.service_factory(), db_session, key, data
    )


async def _user_settings_read_state(
    cfg: PatchContractConfig, db_session, key: str
) -> dict[str, Any] | None:
    """Pre/post-patch snapshot from UserSettingsResponse (parsed: JSON
    columns decoded back to lists)."""
    resp = await cfg.service_factory().get_by_user_id(db_session, key)
    if resp is None:
        return None
    return resp.model_dump()


# ─── Explicit configs (NO auto-discovery — GH #179 is standalone) ────────────────

VISITS_CONFIG = PatchContractConfig(
    name="visits",
    service_factory=get_visit_service,
    patch_schema=VisitPatch,
    patch_call=_visit_patch_call,
    read_state=_visit_read_state,
    not_null_fields=frozenset({"price", "status"}),
    nullable_field="custom_price",
    list_fields=frozenset(),  # VisitPatch has no list fields
    patch_field="price",
    original=3000,  # sample_visit seeds price=3000
    sentinel=7777,
    make_owner=_make_visit_owner,
    apply_null=lambda schema, field: schema(**{field: None}),
)

USER_SETTINGS_CONFIG = PatchContractConfig(
    name="user_settings",
    service_factory=get_user_settings_service,
    patch_schema=UserSettingsPatch,
    patch_call=_user_settings_patch_call,
    read_state=_user_settings_read_state,
    not_null_fields=frozenset({
        "theme",
        "language",
        "column_order_staff",
        "column_order_locations",
        "show_archived_masters",
        "show_archived_locations",
    }),
    nullable_field=None,  # UserSettingsPatch has no nullable field
    list_fields=frozenset({"column_order_staff", "column_order_locations"}),
    patch_field="theme",
    original="light",  # UserSettingsCreate.theme default
    sentinel="dark",
    make_owner=_make_user_settings_owner,
    apply_null=lambda schema, field: schema(**{field: None}),
)

PATCH_CONTRACT_CONFIGS = [VISITS_CONFIG, USER_SETTINGS_CONFIG]


# ─── Guard: config sanity + sentinel/original difference ────────────────────────


@pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
def test_sentinel_differs_from_original(cfg: PatchContractConfig) -> None:
    """The (original, sentinel) pair is guaranteed different — the standalone
    analogue of ``_ensure_different`` from tests/generic_contract.py. A config
    whose sentinel equals its original would make the partial-update test
    vacuously pass (nothing changed yet every assertion holds)."""
    assert cfg.sentinel != cfg.original, (
        f"{cfg.name}: sentinel {cfg.sentinel!r} == original {cfg.original!r} — "
        f"the partial-update contract would be vacuous"
    )
    assert cfg.patch_field in cfg.not_null_fields or (
        cfg.patch_field == cfg.nullable_field
    ), f"{cfg.name}: patch_field {cfg.patch_field!r} not covered by config"
    schema_fields = set(cfg.patch_schema.model_fields)
    assert cfg.patch_field in schema_fields
    for field in cfg.not_null_fields:
        assert field in schema_fields, f"{cfg.name}: {field} not in patch schema"
    for field in cfg.list_fields:
        assert field in cfg.not_null_fields, (
            f"{cfg.name}: list field {field!r} must also be a NOT NULL field "
            f"(list columns are NOT NULL — null must be ignored, [] applied)"
        )
    if cfg.nullable_field is not None:
        assert cfg.nullable_field in schema_fields
        assert cfg.nullable_field not in cfg.not_null_fields, (
            f"{cfg.name}: nullable_field {cfg.nullable_field!r} must not be "
            f"a NOT NULL field"
        )
    assert cfg.apply_null is not None, (
        f"{cfg.name}: null-policy tests need apply_null"
    )


# ─── Contract: the five patch semantics (3 landed + 2 Task-3 RED) ────────────────


class TestStandalonePatchContract:
    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_partial_update_applies_sentinel_keeps_pre_state(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 1 — partial update: sentinel lands on ``patch_field``;
        EVERY other patch-schema field keeps its pre-state value."""
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None

        patched = await cfg.patch_call(
            cfg, db_session, key, cfg.patch_schema(**{cfg.patch_field: cfg.sentinel})
        )
        assert patched is not None, f"{cfg.name}: patch on existing row returned None"

        assert _get_field(patched, cfg.patch_field) == cfg.sentinel
        for field in cfg.patch_schema.model_fields:
            if field == cfg.patch_field:
                continue
            assert _get_field(patched, field) == pre[field], (
                f"{cfg.name}.{field} changed after patching {cfg.patch_field} "
                f"(pre-state {pre[field]!r})"
            )

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_not_found_returns_none(
        self, cfg: PatchContractConfig, db_session
    ) -> None:
        """Semantic 2 — not-found: patching an address with no owner row
        returns None (Visit.patch → None; update_by_user_id → None)."""
        missing_key = f"missing-{uuid.uuid4()}"
        result = await cfg.patch_call(
            cfg,
            db_session,
            missing_key,
            cfg.patch_schema(**{cfg.patch_field: cfg.sentinel}),
        )
        assert result is None

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_bumps_updated_at(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 3 — a real patch refreshes ``updated_at``.

        ``>=`` comparison (not ``>``): SQLite datetime resolution can keep
        the tick identical when the patch lands within the same clock tick,
        so the contract pins "not older". ``original`` differs from
        ``sentinel``, so this is a REAL patch — the ORM ``onupdate`` /
        explicit ``updated_at`` write must fire.
        """
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None
        pre_updated_at = pre["updated_at"]
        assert pre_updated_at is not None

        patched = await cfg.patch_call(
            cfg, db_session, key, cfg.patch_schema(**{cfg.patch_field: cfg.sentinel})
        )
        assert patched is not None
        post_updated_at = _get_field(patched, "updated_at")
        assert post_updated_at is not None
        assert _as_datetime(post_updated_at) >= _as_datetime(pre_updated_at), (
            f"{cfg.name}: updated_at went backwards after patch "
            f"({pre_updated_at!r} → {post_updated_at!r})"
        )

    # ─── Task 3 semantics: null-policy + empty body ───────────────────────────

    @pytest.mark.parametrize(
        "field",
        ["theme", "language", "show_archived_masters", "show_archived_locations"],
    )
    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_null_on_not_null_field_is_ignored(
        self, cfg: PatchContractConfig, db_session, sample_visit, field: str
    ) -> None:
        """Semantic 4a — null-policy: an explicit ``null`` on a NOT NULL
        field means 'don't change' — the pre-state value survives.

        Scalar NOT NULL fields only (theme/language for UserSettings — the
        list NOT NULL fields get their own rule in the list-fields test;
        price/status for Visits via the dedicated per-config loop below —
        each trips a separate IntegrityError path on the current code).
        """
        if field not in cfg.not_null_fields:
            pytest.skip(f"{cfg.name}: {field!r} is not a NOT NULL patch field")
        if field in cfg.list_fields:
            pytest.skip(f"{cfg.name}: {field!r} is a list field — own test")
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None

        patched = await cfg.patch_call(
            cfg, db_session, key, _apply_null(cfg, field)
        )
        assert patched is not None, f"{cfg.name}: patch on existing row returned None"

        assert _get_field(patched, field) == pre[field], (
            f"{cfg.name}.{field} is NOT NULL — explicit null must be ignored "
            f"(pre-state {pre[field]!r}), got {_get_field(patched, field)!r}"
        )

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_null_on_not_null_price_status_is_ignored(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 4a (Visits) — explicit ``null`` on ``price`` / ``status``
        must be ignored, one probe per field. Visits-only capability: other
        configs' scalar NOT NULL fields live in 4a above.
        """
        visit_not_null_scalars = {"price", "status"}
        if not (visit_not_null_scalars & cfg.not_null_fields):
            pytest.skip(f"{cfg.name}: no {sorted(visit_not_null_scalars)} "
                        f"NOT NULL fields")
        for field in sorted(visit_not_null_scalars & cfg.not_null_fields
                            - cfg.list_fields):
            _service, _row, key = await cfg.make_owner(
                cfg, db_session, sample_visit
            )
            pre = await cfg.read_state(cfg, db_session, key)
            assert pre is not None

            patched = await cfg.patch_call(
                cfg, db_session, key, _apply_null(cfg, field)
            )
            assert patched is not None
            assert _get_field(patched, field) == pre[field], (
                f"{cfg.name}.{field} is NOT NULL — explicit null must be "
                f"ignored (pre-state {pre[field]!r}), "
                f"got {_get_field(patched, field)!r}"
            )

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_null_on_nullable_field_is_applied(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 4b — null-policy (nullable half, Visits-only): an
        explicit ``null`` on the NULLABLE field is APPLIED — it clears the
        field. UserSettingsPatch has no nullable field → capability skip.
        """
        if cfg.nullable_field is None:
            pytest.skip(f"{cfg.name}: no nullable field in patch schema")
        assert cfg.nullable_field is not None  # narrowed for the type checker
        field: str = cfg.nullable_field
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None

        patched = await cfg.patch_call(
            cfg, db_session, key, _apply_null(cfg, field)
        )
        assert patched is not None

        assert _get_field(patched, field) is None, (
            f"{cfg.name}.{field} is nullable — explicit null must be APPLIED "
            f"(cleared); pre-state {pre[field]!r}, "
            f"got {_get_field(patched, field)!r}"
        )

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_list_fields_null_ignored_empty_applied(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 4c — list-fields rule: ``null`` → ignored (pre-state
        list survives), ``[]`` → applied as a REAL value (empties the list).
        Only configs with list fields (UserSettings) run the body.
        """
        if not cfg.list_fields:
            pytest.skip(f"{cfg.name}: no list fields in patch schema")
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None

        # null → ignored on every list field
        for field in sorted(cfg.list_fields):
            patched = await cfg.patch_call(
                cfg, db_session, key, _apply_null(cfg, field)
            )
            assert patched is not None
            assert _get_field(patched, field) == pre[field], (
                f"{cfg.name}.{field} is a NOT NULL list column — explicit "
                f"null must be ignored (pre-state {pre[field]!r}), "
                f"got {_get_field(patched, field)!r}"
            )

        # [] → applied as a value (distinct from the null probe)
        empty_probe = cfg.patch_schema(
            **{field: [] for field in sorted(cfg.list_fields)}
        )
        patched = await cfg.patch_call(cfg, db_session, key, empty_probe)
        assert patched is not None
        for field in sorted(cfg.list_fields):
            assert _get_field(patched, field) == [], (
                f"{cfg.name}.{field} — explicit [] must be APPLIED as a "
                f"real value (empty list), got {_get_field(patched, field)!r}"
            )

    @pytest.mark.parametrize("cfg", PATCH_CONTRACT_CONFIGS, ids=lambda c: c.name)
    async def test_patch_empty_body_is_full_noop(
        self, cfg: PatchContractConfig, db_session, sample_visit
    ) -> None:
        """Semantic 5 — empty body: a patch schema with NO fields set is a
        full no-op — every field value AND ``updated_at`` stay unchanged.

        ``updated_at`` must not move: no early-exit on the current
        VisitService.patch means the unconditional ``updated_at = now()``
        fires even with nothing to apply (RED half of the premise).
        """
        _service, _row, key = await cfg.make_owner(cfg, db_session, sample_visit)
        pre = await cfg.read_state(cfg, db_session, key)
        assert pre is not None

        patched = await cfg.patch_call(cfg, db_session, key, cfg.patch_schema())
        assert patched is not None, f"{cfg.name}: patch on existing row returned None"

        for field in cfg.patch_schema.model_fields:
            assert _get_field(patched, field) == pre[field], (
                f"{cfg.name}.{field} changed on EMPTY patch body "
                f"(pre-state {pre[field]!r}, got {_get_field(patched, field)!r})"
            )
        post_updated_at = _get_field(patched, "updated_at")
        assert post_updated_at is not None
        assert _as_datetime(post_updated_at) == _as_datetime(pre["updated_at"]), (
            f"{cfg.name}: EMPTY patch body must not touch updated_at "
            f"({pre['updated_at']!r} → {post_updated_at!r})"
        )


# ─── Helpers ─────────────────────────────────────────────────────────────────────

def _get_field(row: Any, field: str) -> Any:
    """Uniform field access over ORM Visit and UserSettingsResponse."""
    return getattr(row, field)


def _apply_null(cfg: PatchContractConfig, field: str) -> Any:
    """Null probe: patch schema with ``field=None`` EXPLICITLY set.

    The explicit set is the whole point — a bare ``cfg.patch_schema()``
    leaves the field unset (partial-update hole) and would test nothing.
    """
    assert cfg.apply_null is not None, f"{cfg.name}: null-policy needs apply_null"
    return cfg.apply_null(cfg.patch_schema, field)


def _as_datetime(value: Any) -> datetime:
    """Normalize datetime | ISO-string → NAIVE UTC datetime for comparison.

    The two sources disagree on tzinfo: DB-stored values come back naive
    (AbstractModel default ``datetime.utcnow``) while VisitService.patch
    stamps ``datetime.now(UTC)`` (aware). Both are UTC — strip tzinfo so
    the ``>=`` guard compares like with like instead of raising TypeError.
    """
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    assert isinstance(value, str), f"unexpected updated_at type: {type(value)!r}"
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=None)
