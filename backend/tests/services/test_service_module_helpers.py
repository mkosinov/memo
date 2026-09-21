"""№6/№7 helpers as module functions (GH #217 Task 4, ADR 007 / canon
rule 8).

Behavior-for-behavior moves, pinned by these tests:

- ``sum_active_seats_bulk`` — Corridor 3 free function in the activity
  service module (dict-shaped aggregate: reads the foreign records table
  in ONE query; the naming keeps the content verb — ADR 007 naming
  convention, ``view`` is reserved for table pages). The method is gone
  from ``ActivityService`` with no residual shim; GET /activities calls
  the function directly with the session.
- ``_attach_counts`` — module-internal free function in the material
  service module (the underscore stays: a deliberate module-internal
  convention, not a canon requirement); all five service call sites
  (after list / list_all / get / update / patch) rebind from
  ``self._attach_counts(...)`` to ``_attach_counts(...)``.
"""

from __future__ import annotations

from src.models.material import Material
from src.models.record import Record
from src.models.service import Service
from src.models.service_material import ServiceMaterial
from src.schemas.material import MaterialResponse
from src.services.activity import ActivityService, sum_active_seats_bulk
from src.services.material import MaterialService, _attach_counts

# asyncio mode is AUTO in pyproject — async tests collect without an
# explicit mark; the two ``hasattr`` tests stay sync on purpose.


# ─── №6: sum_active_seats_bulk is a module-level function ───────────────────


async def test_sum_active_seats_bulk_as_function(db_session, sample_visits) -> None:
    """The module function aggregates occupied seats in ONE dict-shaped
    pass: waiting + visited count, cancelled/missed don't."""
    record_id = sample_visits[0].record_id
    record = await db_session.get(Record, record_id)

    result = await sum_active_seats_bulk(db_session, [record.activity_id, "nonexistent-id"])

    # sample_visits: 3 active visits → the record's seats are summed;
    # ids with no active records are absent from the dict
    assert result[record.activity_id] == record.seats
    assert "nonexistent-id" not in result


async def test_sum_active_seats_bulk_empty_ids(db_session) -> None:
    """Empty id list → empty dict (no query)."""
    assert await sum_active_seats_bulk(db_session, []) == {}


def test_activity_service_has_no_sum_active_seats_bulk_method() -> None:
    """The method is removed from the class — NO residual shim."""
    assert not hasattr(ActivityService, "sum_active_seats_bulk")


# ─── №7: _attach_counts is a module-level function ──────────────────────────


async def _seed_material_with_services(db_session, *, active: bool) -> MaterialResponse:
    """One material linked to one service (active or archived)."""
    material = Material(title="M", description="d")
    service = Service(
        title="S",
        description="d",
        image_url="https://example.com/s.jpg",
        specialty="x",
        min_age=1,
        duration=30,
        record_info="r",
        is_active=active,
    )
    db_session.add_all([material, service])
    await db_session.flush()
    db_session.add(ServiceMaterial(service_id=service.id, material_id=material.id))
    await db_session.flush()
    return MaterialResponse.model_validate(material)


async def test_attach_counts_as_function_counts_active_services_only(db_session) -> None:
    """Module function attaches used_in_services_count counting NON-ARCHIVED
    services only (spec #223 §6); untouched materials keep the default 0."""
    linked = await _seed_material_with_services(db_session, active=True)
    archived = await _seed_material_with_services(db_session, active=False)
    bare_orm = Material(title="B", description="d")
    db_session.add(bare_orm)
    await db_session.flush()
    bare = MaterialResponse.model_validate(bare_orm)

    await _attach_counts(db_session, [linked, archived, bare])

    assert linked.used_in_services_count == 1
    assert archived.used_in_services_count == 0
    assert bare.used_in_services_count == 0


async def test_attach_counts_empty_batch_is_noop(db_session) -> None:
    """Empty batch → early return, no query."""
    await _attach_counts(db_session, [])  # must not raise


def test_material_service_has_no_attach_counts_method() -> None:
    """The method is removed from the class — the five call sites use the
    module function directly."""
    assert not hasattr(MaterialService, "_attach_counts")
