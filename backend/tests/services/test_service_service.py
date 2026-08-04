"""Per-entity ServiceService tests (contract exception — own update/patch/list semantics)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.models.service import Service
from src.schemas.common import PaginatedResponse
from src.schemas.service import ServicePatch, ServiceUpdate
from src.services.service import get_service_service

pytestmark = pytest.mark.asyncio


# ─── ServiceService.list pagination (moved from test_generic_service_list.py:140-155) ─

async def test_service_service_list_paginated(db_session):
    """ServiceService.list returns envelope with eager-loaded tariffs/tags."""
    for i in range(3):
        db_session.add(Service(
            title=f"S{i}", description="d", image_url="http://x",
            specialty="s", min_age=5, duration=60, record_info="r",
        ))
    await db_session.flush()
    service = get_service_service()
    result = await service.list(db_session, page=1, per_page=2)
    assert isinstance(result, PaginatedResponse)
    assert result.total == 3
    assert len(result.items) == 2
    assert hasattr(result.items[0], "tariffs")
    assert hasattr(result.items[0], "tags")


# ─── ServiceService is_active stickiness (D11 — contract exception) ────────────────
# Spec: docs/specs/2026-08-03-generic-service-crud-contract-design.md §3.3, §3.5,
# §8 D11/D13. ``ServiceService`` is a soft-delete entity with its own
# ``update``/``patch`` overrides that bypass ``SoftDeleteService.update`` /
# ``GenericService.patch`` (they build apply-dicts via
# ``data.model_dump(exclude={...})`` + ``setattr`` directly). Same is_active
# stickiness hazards as the 4 contract soft entities; pinned here so the
# ServiceService exception stays honest. Test class wraps the 5 per-entity
# flows so the ``-k IsActive`` filter collects them alongside
# ``TestGenericServiceIsActiveContract`` (Service is in
# ``GENERIC_CONTRACT_EXCEPTIONS`` — not parametrized by the contract file).
# Multi-phase tests use labeled assertions (assert messages per direction)
# mirroring ``TestGenericServiceIsActiveContract``.
#
# Rows are seeded via ORM ``db_session.add(Service(...))`` exactly as
# ``test_service_service_list_paginated`` does (NOT via the ``create_service``
# API factory — ``ServiceService()`` requires constructor args). The
# ServiceUpdate payload field set mirrors the green service PUT test
# ``backend/tests/test_put_is_active.py:95-115``
# (``test_put_service_with_is_active_false``), with values changed. ``is_active``
# is added/removed per-test to exercise the sticky-field semantics; ``tariffs``
# and ``tag_ids`` default to empty lists in ``ServiceUpdate`` (not sent).
_SERVICE_UPDATE_FIELDS: dict = {
    "title": "Updated Service",
    "description": "Updated description",
    "image_url": "https://example.com/updated.jpg",
    "specialty": "живопись",
    "min_age": 7,
    "max_age": 12,
    "duration": 60,
    "record_info": "Updated info",
}


async def _seed_service(db_session) -> str:
    """Seed a Service row via ORM and return its id.

    Mirrors ``test_service_service_list_paginated`` seeding (does NOT use the
    ``create_service`` API factory). Defaults ``is_active=True`` via
    ``AbstractModelSoftDelete``.
    """
    svc = Service(
        title="S", description="d", image_url="http://x",
        specialty="s", min_age=5, duration=60, record_info="r",
    )
    db_session.add(svc)
    await db_session.flush()
    return svc.id


class TestServiceIsActiveContract:
    """``ServiceService`` is_active contract — canonical PUT (#178) + sticky
    PATCH. 5 per-entity tests mirroring ``TestGenericServiceIsActiveContract``
    against ServiceService directly (own ``update``/``patch`` overrides —
    spec D11). Class name carries ``IsActive`` so the ``-k IsActive``
    selector collects them alongside the generic contract class.
    """

    async def test_get_archived_returns_row_with_is_active_false(self, db_session):
        """get() deliberately returns archived rows — *list hides* / *get returns*."""
        service_id = await _seed_service(db_session)
        service = get_service_service()
        ok = await service.delete(db_session, service_id)
        assert ok, "setup delete() returned False"
        fetched = await service.get(db_session, service_id)
        assert fetched is not None, "get must return archived rows (user decision 1)"
        assert fetched.is_active is False, "archived row's is_active must be False"

    async def test_update_without_is_active_raises_validation_error(self, db_session):
        """PUT without is_active → ServiceUpdate refuses construction (GH #178)."""
        payload = dict(_SERVICE_UPDATE_FIELDS)
        payload.pop("is_active", None)
        with pytest.raises(ValidationError):
            ServiceUpdate(**payload)

    async def test_update_explicit_is_active_applies(self, db_session):
        """PUT with explicit is_active bool applies it: False archives an active
        row (phase 1), True reactivates an archived row (phase 2), and the
        reactivated row must be visible in ``list()`` again (phase 3)."""
        service = get_service_service()
        service_id = await _seed_service(db_session)

        # phase 1: explicit False archives
        payload = dict(_SERVICE_UPDATE_FIELDS)
        payload["is_active"] = False
        await service.update(db_session, service_id, ServiceUpdate(**payload))
        archived = await service.get(db_session, service_id)
        assert archived is not None, "row vanished after archive"
        assert archived.is_active is False, (
            "ServiceService.update: explicit False must archive"
        )

        # phase 2: explicit True reactivates the archived row
        payload["is_active"] = True
        await service.update(db_session, service_id, ServiceUpdate(**payload))
        reactivated = await service.get(db_session, service_id)
        assert reactivated is not None, "row vanished after reactivate"
        assert reactivated.is_active is True, (
            "ServiceService.update: explicit True must reactivate"
        )

        # phase 3: reactivated row visible in list() again (default active-only)
        resp = await service.list(db_session)
        assert service_id in [i.id for i in resp.items], (
            "ServiceService.update: reactivated row visible in list again"
        )

    async def test_patch_preserves_is_active_when_omitted_or_none(self, db_session):
        """PATCH preserves is_active in two flavors: (phase 1) field omitted
        → no-op; (phase 2) field sent as ``None`` → stripped, never written as
        NULL to the NOT NULL column.

        The explicit-None hazard: ``ServicePatch.is_active: bool | None = None``
        is already declared, but ``ServiceService.patch``'s NOT_NULL strip loop
        does NOT include ``is_active`` (``NOT_NULL_FIELDS`` covers scalar CRUD
        fields, not the lifecycle flag) → ``setattr(service, "is_active", None)``
        writes NULL → IntegrityError on the NOT NULL column.
        """
        service = get_service_service()
        service_id = await _seed_service(db_session)
        ok = await service.delete(db_session, service_id)
        assert ok, "setup delete() returned False"

        # phase 1: omitted (empty patch) → no-op
        await service.patch(db_session, service_id, ServicePatch())
        after1 = await service.get(db_session, service_id)
        assert after1 is not None, "phase 1 row vanished"
        assert after1.is_active is False, (
            "ServiceService.patch: patch omitted is_active must preserve archived state"
        )

        # phase 2: explicit None (must mean preserve, never NULL)
        await service.patch(db_session, service_id, ServicePatch(is_active=None))
        after2 = await service.get(db_session, service_id)
        assert after2 is not None, "phase 2 row vanished"
        assert after2.is_active is False, (
            "ServiceService.patch: is_active=None must mean preserve, never NULL"
        )

    async def test_patch_explicit_is_active_applies(self, db_session):
        """PATCH with explicit is_active bool applies it (both directions): False
        archives (phase 1), True reactivates (phase 2), and the row reappears in
        ``list()`` (phase 3)."""
        service = get_service_service()
        service_id = await _seed_service(db_session)

        # phase 1: explicit False archives
        await service.patch(db_session, service_id, ServicePatch(is_active=False))
        archived = await service.get(db_session, service_id)
        assert archived is not None, "row vanished after archive"
        assert archived.is_active is False, (
            "ServiceService.patch: patch explicit False must archive"
        )

        # phase 2: explicit True reactivates
        await service.patch(db_session, service_id, ServicePatch(is_active=True))
        reactivated = await service.get(db_session, service_id)
        assert reactivated is not None, "row vanished after reactivate"
        assert reactivated.is_active is True, (
            "ServiceService.patch: patch explicit True must reactivate"
        )

        # phase 3: reactivated row visible in list()
        resp = await service.list(db_session)
        assert service_id in [i.id for i in resp.items], (
            "ServiceService.patch: reactivated row visible in list again"
        )