"""Tests for the public masters dictionary route (GH #606, ADR-015).

``GET /api/v1/public/masters`` — the anonymous showcase dictionary: bare
JSON array (no envelope, no parameters), minimal ``MasterPublicResponse``
schema (exactly the 5 fields the web consumes — spec §3.1), server-side
exclusion of archived masters (``masters.is_active = false`` — the
schedule flag, D3; the filter mirrors the staff list of acting
masters), deterministic ``sort_order, first_name, id`` order, the
``BARE_LIST_MAX_ROWS`` ceiling of the ``/all`` canon.

Paired seeding with a positive control (the #600/#601 plan wording):
the archived master is seeded as a PAIR — acting + archived twin — and
the filtering test asserts BOTH halves: the acting twin present (the
filter is not just an empty table), the archived twin absent.

Domain rules: docs/domain-rules/auth.md (Public Access),
docs/specs/2026-11-13-adr015-dictionaries-606-design.md §3.1
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.schemas.master import MasterPublicResponse

pytestmark = pytest.mark.api

URL = "/api/v1/public/masters"

#: GH #606 spec §3.1: exactly the 5 showcase fields («имя, специальность,
#: фото») — ``avatar_url`` is the only nullable one.
PUBLIC_FIELDS = {"id", "first_name", "last_name", "specialty", "avatar_url"}


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (locations precedent).

    Not the shared ``api_client`` with a cleared jar: dictionary tests
    need BOTH views in one test — an authenticated client to seed rows
    (POST /staff writes the card + master section) and an anonymous one
    to probe the public route.
    """
    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def dictionary_fixture(api_client, create_master):
    """Paired seeding: acting + archived twins (the staff card archive
    flips BOTH flags — the person and the ``masters.is_active`` schedule
    extension, D6 — so the archived twin is out of the showcase)."""
    acting = create_master(
        first_name="Ольга", last_name="Середа", specialty="живопись"
    )
    archived = create_master(
        first_name="Бывший", last_name="Мастер", specialty="керамика"
    )
    resp = api_client.post(f"/api/v1/staff/{archived['id']}/archive")
    assert resp.status_code == 200, resp.text
    return {"acting": acting, "archived": archived}


class TestPublicMastersList:
    """GH #606: anonymous dictionary — archived masters invisible."""

    def test_anonymous_200_active_present_archived_absent(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Парный посев + позитивный контроль: анониму 200, действующий
        близнец в выдаче, архивный — нет."""
        fx = dictionary_fixture
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, list)  # bare array, no envelope
        ids = [item["id"] for item in body]
        # positive control: the acting twin IS here
        assert fx["acting"]["id"] in ids, "acting control missing"
        # the archived twin is not (masters.is_active = false — the
        # schedule flag the staff list filters by, D3/D6)
        assert fx["archived"]["id"] not in ids, "archived twin leaked"

    def test_items_carry_exactly_the_five_public_fields(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Ключи каждого элемента — ровно 5 публичных полей, лишних нет;
        nullable поле проходит как есть (``avatar_url`` → null)."""
        fx = dictionary_fixture
        body = anon_client.get(URL).json()
        for item in body:
            assert set(item.keys()) == PUBLIC_FIELDS, item
            MasterPublicResponse.model_validate(item)  # contract
        acting_row = next(i for i in body if i["id"] == fx["acting"]["id"])
        assert acting_row["avatar_url"] is None  # nullable passthrough
        assert acting_row["specialty"] == "живопись"

    def test_deterministic_order(self, anon_client, create_master) -> None:
        """``sort_order ASC, first_name ASC, id ASC`` (spec §3.1 — the
        staff-list order): pinned by relative positions — sort_order
        decides first, first_name breaks the sort_order=2 tie."""
        third = create_master(first_name="B-Alpha", sort_order=2)
        first = create_master(first_name="Z-First", sort_order=1)
        second = create_master(first_name="A-Second", sort_order=2)
        ids = [item["id"] for item in anon_client.get(URL).json()]
        assert (
            ids.index(first["id"]) < ids.index(second["id"]) < ids.index(third["id"])
        ), ids


def _bulk_seed_masters(db_engine, n: int) -> None:
    """Bulk-insert ``n`` acting masters (staff card + master extension)
    directly via SQLAlchemy (sync test → asyncio.run — the tags canon).

    Explicit uuid4 ids + timestamps are supplied because bulk ``insert()``
    with a list of dicts does not reliably invoke Python-side column
    defaults across SQLAlchemy versions. The extension rows stay
    ``is_active`` (acting) — the showcase-visible state.
    """
    import asyncio
    import uuid as _uuid

    async def _seed() -> None:
        from sqlalchemy import insert
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from src.models.master import Master
        from src.models.staff import Staff
        from src.util.utc import utc_now

        factory = async_sessionmaker(db_engine, expire_on_commit=False)
        now = utc_now()
        ids = [str(_uuid.uuid4()) for _ in range(n)]
        staff_rows = [
            {
                "id": staff_id,
                "first_name": f"Bulk-{i:05d}",
                "last_name": "Master",
                "sort_order": i,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for i, staff_id in enumerate(ids)
        ]
        master_rows = [
            {
                "staff_id": staff_id,
                "specialty": "живопись",
                "color": "#5B8C7A",
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for staff_id in ids
        ]
        async with factory() as session:
            await session.execute(insert(Staff), staff_rows)
            await session.execute(insert(Master), master_rows)
            await session.commit()

    asyncio.run(_seed())


class TestPublicMastersBareListCeiling:
    """The ``BARE_LIST_MAX_ROWS`` ceiling (the /all canon, spec §3.1) —
    boundary pair per the ``test_generic_api_contract`` precedent."""

    def test_limit_exceeded_422(self, anon_client, db_engine) -> None:
        """``BARE_LIST_MAX_ROWS + 1`` rows → 422 with the standard
        envelope (``code=VALIDATION_ERROR``, message naming the entity
        + the limit value)."""
        from src.services.generic import BARE_LIST_MAX_ROWS

        _bulk_seed_masters(db_engine, BARE_LIST_MAX_ROWS + 1)
        resp = anon_client.get(URL)
        assert resp.status_code == 422, f"limit exceeded → 422, got {resp.status_code}: {resp.text}"
        detail = resp.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "masters" in detail["message"], "message must name the entity ('masters')"
        assert str(BARE_LIST_MAX_ROWS) in detail["message"], "message must cite the limit value"

    def test_limit_boundary_ok(self, anon_client, db_engine) -> None:
        """Exactly ``BARE_LIST_MAX_ROWS`` rows → 200 with the full array
        (boundary)."""
        from src.services.generic import BARE_LIST_MAX_ROWS

        _bulk_seed_masters(db_engine, BARE_LIST_MAX_ROWS)
        resp = anon_client.get(URL)
        assert resp.status_code == 200, f"boundary → 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == BARE_LIST_MAX_ROWS, "exactly BARE_LIST_MAX_ROWS rows must be returned"
