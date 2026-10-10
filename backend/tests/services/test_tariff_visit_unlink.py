"""GH #357 — ``visits.tariff_id → tariffs.id`` FK with ``ondelete=SET NULL``.

DB-level contract tests (service-free, no HTTP for the tariff path):
the price snapshot is primary, the tariff link is informational — a
Visit survives its tariff's deletion and keeps ``price`` intact.

Prerequisite: FK enforcement in the test engine — ``PRAGMA
foreign_keys=ON`` is set per-checkout by the conftest pool listener
and per-connect by ``src/db/database.py`` (process-global Engine
listener). Without it SQLite silently ignores ``ondelete`` clauses,
so these tests double as a guard that the pragma is in effect.

Two scenarios (spec 2026-10-09-services-tariff-diff-357-design §3.3–3.4):

  * direct tariff DELETE (the ServiceService tariff-diff path and the
    ``_h_cascade_service_tariffs`` executor both emit plain ``DELETE``
    statements — the unhook must come from the DB, not the ORM);
  * the family scenario: service hard-delete cascades its tariffs in
    one transaction — visits on those tariffs survive, unlinked.

Domain rules: docs/domain-rules/visits.md §Invariants (price is a
creation-time snapshot, never derived at read time).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import delete, select

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tariff import Tariff
from src.models.visit import Visit

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ─── Direct-ORM setup helpers (same style as test_delete_cascades.py) ──────────


async def _insert_visited_tariff_graph(
    db_session: AsyncSession, *, visit_price: int = 1500,
) -> tuple[Visit, Tariff]:
    """Staff→Master→Service→Location→Activity→Client→Record + Tariff + Visit.

    The visit's ``tariff_id`` points at the service's tariff with a
    price snapshot copied from it (the production creation flow).
    """
    staff = Staff(first_name="M", last_name="L")
    service = Service(title="S", description="d", image_url="http://x",
                      specialty="s", min_age=5, duration=60, record_info="r")
    location = Location(title="L", capacity=20)
    db_session.add_all([staff, service, location])
    await db_session.flush()
    db_session.add(Master(staff_id=staff.id, specialty="s", color="#000000"))
    await db_session.flush()
    activity = Activity(
        master_id=staff.id, service_id=service.id, location_id=location.id,
        start=datetime(2030, 1, 1, 12, 0), duration=90, capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    tariff = Tariff(service_id=service.id, title="T", price=visit_price)
    client = Client(name="C", phone=None)
    record = Record(activity_id=activity.id, client_id=client.id,
                    status="pending", seats=1)
    db_session.add_all([tariff, client, record])
    await db_session.flush()
    visit = Visit(record_id=record.id, visitor_id=None, tariff_id=tariff.id,
                  price=visit_price, custom_price=None, status="waiting")
    db_session.add(visit)
    await db_session.commit()
    return visit, tariff


async def _reload_visit(db_session: AsyncSession, visit_id: str) -> Visit:
    """Fresh SELECT of the visit row (the session keeps loaded state)."""
    db_session.expire_all()
    return (await db_session.execute(
        select(Visit).where(Visit.id == visit_id)
    )).scalar_one()


# ─── Scenario 1: direct tariff DELETE unhooks the visit at DB level ───────────


async def test_tariff_delete_nullifies_visit_link_and_keeps_price(db_session):
    """A plain ``DELETE FROM tariffs`` nullifies ``visits.tariff_id``
    (``ondelete=SET NULL``) — the visit row and its price snapshot
    survive untouched."""
    visit, tariff = await _insert_visited_tariff_graph(db_session, visit_price=1500)

    await db_session.execute(delete(Tariff).where(Tariff.id == tariff.id))
    await db_session.commit()

    reloaded = await _reload_visit(db_session, visit.id)
    assert reloaded is not None          # the row survives its tariff
    assert reloaded.tariff_id is None    # unlinked by the DB, not the ORM
    assert reloaded.price == 1500        # creation-time snapshot intact
    assert reloaded.status == "waiting"  # rest of the row state intact


# ─── Scenario 2: family — service hard-delete cascades visited tariffs ────────


async def test_service_delete_family_unhooks_visits_on_its_tariffs(
    api_client, db_session,
):
    """Deleting a service hard-deletes its tariffs in one transaction;
    visits referencing those tariffs are unhooked by the DB and survive
    with the price snapshot intact (spec §3.4 — the tariff DELETE no
    longer hits the strict-FK wall)."""
    visit, _live_tariff = await _insert_visited_tariff_graph(db_session, visit_price=2000)

    # A second, bare service: no activity (activities BLOCK service
    # delete), only a tariff — and the visit is re-pointed at it, the
    # diff-update analogue of "tariff vanished while visits exist".
    dead = Service(title="Dead", description="d", image_url="http://x",
                   specialty="s", min_age=5, duration=60, record_info="r")
    db_session.add(dead)
    await db_session.flush()
    dead_tariff = Tariff(service_id=dead.id, title="DT", price=999)
    db_session.add(dead_tariff)
    await db_session.flush()
    visit.tariff_id = dead_tariff.id
    await db_session.commit()
    dead_id = dead.id  # captured before the delete: the ORM row expires with it

    # Preview: the tariffs dep is present in the tree → 409.
    resp = api_client.request(
        "DELETE", f"/api/v1/services/{dead_id}", params={"dry_run": "true"},
    )
    assert resp.status_code == 409, resp.text

    # Commit: all deps auto (tariffs/photos/service_tags/service_materials)
    # → expected {} executes the cascade → 204.
    resp = api_client.request(
        "DELETE", f"/api/v1/services/{dead_id}", json={"expected": {}},
    )
    assert resp.status_code == 204, resp.text

    reloaded = await _reload_visit(db_session, visit.id)
    assert reloaded is not None          # the visit outlives the family
    assert reloaded.tariff_id is None    # unhooked by ondelete=SET NULL
    assert reloaded.price == 2000        # snapshot intact
    leftover = (await db_session.execute(
        select(Tariff).where(Tariff.service_id == dead_id)
    )).scalars().all()
    assert leftover == []                # the dead service's tariffs are gone
