"""PhotoService.list rides the BaseRepository.list_custom row core (GH #213 §5.2).

Contract test for the migration off the hand-rolled count+slice:
  - the list path MUST delegate to ``list_custom`` (the shared row-tuple core)
  - the stmt handed over carries NO order_by — the core computes COUNT on the
    unordered subquery, so photos' count-order deviation is fixed by
    construction (ordering via the core's ``order_by=`` parameter, the
    RecordService.list convention)
"""

from __future__ import annotations

import pytest

from src.models.photo import Photo
from src.repositories.generic import BaseRepository
from src.schemas.photo import PhotoListParams
from src.services.photo import get_photo_service

pytestmark = pytest.mark.asyncio


async def test_photo_list_rides_list_custom_core(db_session, monkeypatch) -> None:
    """PhotoService.list delegates count+order+slice to the repo row core.

    5 photos, page 2 of per_page 3 → the ordered-count deviation can't hide:
    the core counts the UNordered stmt (total stays 5), the order arrives
    via ``order_by=`` (filename asc → p3, p4 on the sliced page).
    """
    db_session.add_all([Photo(filename=f"p{i}.jpg") for i in range(5)])
    await db_session.flush()

    calls: list[tuple[object, dict]] = []
    original = BaseRepository.list_custom

    async def spy(_self, session, stmt, **kwargs):
        calls.append((stmt, kwargs))
        return await original(_self, session, stmt, **kwargs)

    monkeypatch.setattr(BaseRepository, "list_custom", spy)

    service = get_photo_service()
    items, total = await service.list(
        db_session,
        PhotoListParams(sort_by="filename", sort_order="asc", page=2, per_page=3),
    )

    assert len(calls) == 1, "PhotoService.list must ride BaseRepository.list_custom"
    stmt, kwargs = calls[0]
    # count-order deviation fixed by construction: UNordered stmt in,
    # ordering via the core's order_by= parameter (never baked into the stmt)
    assert not stmt._order_by_clauses, "stmt must reach the core unordered"
    order_by = kwargs.get("order_by")
    assert order_by, "ordering must be passed through the order_by= parameter"
    assert str(order_by[0]) == str(Photo.filename.asc())
    # honest multi-page envelope + ordering preserved through the parameter
    assert total == 5
    assert [item.filename for item in items] == ["p3.jpg", "p4.jpg"]
