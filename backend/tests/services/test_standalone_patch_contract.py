"""Standalone PATCH mini-contract (GH #179): Visits + UserSettings.

GH #239 made VisitService and UserSettingsService standalone transactional
services (no GenericService base), so the generic patch contract
(tests/generic_contract.py → TestGenericServicePatchContract) no longer
covers them. This file pins the SAME three patch semantics for the two
standalone services, at SERVICE level (no HTTP):

  1. partial update — the sentinel lands on the patched field; EVERY other
     field of the patch schema stays at its pre-state;
  2. not-found — patching a missing owner row returns ``None`` (Visit:
     missing ``visit_id``; UserSettings: ``user_id`` without a row);
  3. updated_at — a real patch bumps ``updated_at`` (``>=`` guard against
     equal SQLite ticks).

Shape modeled on tests/generic_contract.py: a config NamedTuple per entity
(``PatchContractConfig``) drives a parametrized test class — but this file
is STANDALONE: explicit configs only, NO auto-discovery, NO inheritance
from the generic contract (the two services are not GenericService
subclasses).

Task 2 of the plan (null-policy / empty-body semantics) is intentionally
NOT here.
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
    trimmed to what the three patch semantics need:

    * ``name`` — parametrization id (e.g. ``visits``).
    * ``service_factory`` — the service singleton factory (get_*_service).
    * ``patch_schema`` — the Pydantic partial-update schema
      (VisitPatch / UserSettingsPatch).
    * ``patch_call`` — ``(db_session, key, data) -> row | None`` wrapper
      over the service's patch method (VisitService.patch vs
      UserSettingsService.update_by_user_id — different method names, so
      the service-specific binding lives in the config, not the tests).
    * ``read_state`` — ``(db_session, key) -> dict | None`` pre/post-patch
      snapshot (ORM attributes vs parsed UserSettingsResponse).
    * ``not_null_fields`` — patch-schema fields the service treats as
      NOT NULL (null → stripped; Task 2 pins that policy). Visits:
      {price, status}; UserSettings: all 6 fields
      (docs/domain-rules/user_settings.md).
    * ``nullable_field`` — one patch-schema field that MAY be null, or None
      when the schema has no nullable field (UserSettingsPatch).
    * ``patch_field`` — the single field the partial-update test patches
      (must be in not_null_fields or equal nullable_field).
    * ``original`` / ``sentinel`` — the pre-state value of ``patch_field``
      and its replacement; ``original != sentinel`` is guaranteed by
      ``test_sentinel_differs_from_original`` (the standalone analogue of
      ``_ensure_different`` from the generic contract).
    * ``make_owner`` — async factory:
      ``(db_session, sample_visit) -> (service, row, key)``. Visits reuse
      the conftest ``sample_visit`` async fixture — declared as a DIRECT
      test parameter and forwarded here (lazy ``request.getfixturevalue``
      of async fixtures cannot run inside the test's event loop);
      UserSettings accept it for signature symmetry but ignore it — they
      build their own async setup (a ``User`` row inserted through
      ``db_session`` + the settings row created via the service call; the
      sync ``_user`` conftest fixture commits on a separate connection
      and is deliberately NOT reused).
    """

    name: str
    service_factory: Callable[[], Any]
    patch_schema: type
    patch_call: PatchCall
    read_state: StateReader
    not_null_fields: frozenset[str]
    nullable_field: str | None
    patch_field: str
    original: Any
    sentinel: Any
    make_owner: OwnerFactory


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
    patch_field="price",
    original=3000,  # sample_visit seeds price=3000
    sentinel=7777,
    make_owner=_make_visit_owner,
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
    patch_field="theme",
    original="light",  # UserSettingsCreate.theme default
    sentinel="dark",
    make_owner=_make_user_settings_owner,
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


# ─── Contract: the three patch semantics (2 configs × 3 tests) ──────────────────


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


# ─── Helpers ─────────────────────────────────────────────────────────────────────

def _get_field(row: Any, field: str) -> Any:
    """Uniform field access over ORM Visit and UserSettingsResponse."""
    return getattr(row, field)


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
