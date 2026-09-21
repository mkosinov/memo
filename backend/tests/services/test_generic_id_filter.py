"""GH #232 §3.1 Task 2 — universal ``?id=`` set narrowing on the generic path.

Guards on the shared mechanism (helper + ``GenericService`` plumbing), per
the plan's «страж» clause:

* ``_list_stmt`` applies the typed ``id IN (…)`` predicate as a SEPARATE
  case — the ``**filters`` bag stays ``column = value`` equalities only;
* the paginated ``list()`` carries ``ids`` BESIDE the bag down to the
  repository (spy assertion: ``id`` never appears inside ``filters``);
* the dictionary representative (locations, the ``ArchiveService`` line)
  actually narrows rows and ``total``.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from src.models.enums import ArchiveStatus
from src.models.location import Location
from src.repositories.generic import ArchiveRepository
from src.schemas.location import LocationResponse
from src.services.location import LocationService

pytestmark = pytest.mark.asyncio


def _location_service() -> LocationService:
    """Fresh service over its own repository instance (no shared singletons)."""
    return LocationService(ArchiveRepository(), Location, LocationResponse)


def test_list_stmt_applies_typed_in_predicate() -> None:
    """``_list_stmt(ids=…)`` compiles a WHERE with an IN-shaped list param of
    canonical string UUIDs (stored ids are ``str(uuid4)`` — the predicate
    normalizes, it does not hand UUID objects to the driver)."""
    svc = _location_service()
    stmt = svc._list_stmt(ids=[UUID(int=1), UUID(int=2)])
    compiled = stmt.compile()
    assert "WHERE" in str(compiled).upper()
    list_params = [v for v in compiled.params.values() if isinstance(v, list)]
    assert list_params, f"no list-typed bind param in {compiled.params}"
    assert set(list_params[0]) == {str(UUID(int=1)), str(UUID(int=2))}


def test_list_stmt_without_ids_adds_no_predicate() -> None:
    """No ``ids`` → no narrowing clause beyond the caller's own predicates
    (boundary guard for the GREEN step: the mechanism is opt-in, never a
    baked no-op clause). ``status=ALL`` strips the archive predicate too."""
    svc = _location_service()
    stmt = svc._list_stmt(status=ArchiveStatus.ALL)
    assert "WHERE" not in str(stmt.compile()).upper()


async def test_universal_list_narrows_rows_and_total(db_session) -> None:
    """Locations (dictionary representative of the universal path): repeated
    and duplicate ids narrow to the exact row set; ``total`` follows; row
    duplicates of one id collapse (SQL IN is row-level dedup)."""
    l1 = Location(title="Uno", capacity=10, sort_order=0)
    l2 = Location(title="Dos", capacity=10, sort_order=1)
    l3 = Location(title="Tres", capacity=10, sort_order=2)
    db_session.add_all([l1, l2, l3])
    await db_session.commit()

    svc = _location_service()
    result = await svc.list(
        db_session, ids=[UUID(l1.id), UUID(l1.id), UUID(l3.id)]
    )

    assert result.total == 2
    assert {i.id for i in result.items} == {l1.id, l3.id}


async def test_ids_never_leak_into_the_filters_bag(db_session) -> None:
    """Страж: ``ids`` travels as its own named argument to the repository —
    the ``filters`` dict stays equality-only and must not contain ``id``."""
    repo = ArchiveRepository()
    svc = LocationService(repo, Location, LocationResponse)
    captured: dict = {}
    original = repo.list

    async def spy(session, table, **kwargs):
        captured.update(kwargs)
        return await original(session, table, **kwargs)

    repo.list = spy  # type: ignore[method-assign]  # instance-local shadow

    await svc.list(db_session, ids=[UUID(int=7)])

    assert captured.get("ids") == [UUID(int=7)]
    assert "id" not in (captured.get("filters") or {})
