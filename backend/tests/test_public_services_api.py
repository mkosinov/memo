"""Tests for the public services dictionary route (GH #606, ADR-015).

``GET /api/v1/public/services`` — the anonymous showcase dictionary:
bare JSON array (no envelope, no parameters), minimal
``ServicePublicResponse`` schema (exactly the 10 fields the web form
consumes — spec §3.2: form fields + transport details + ``specialty``),
server-side exclusion of archived services (``is_active = false``) and
hidden services (``is_public = false`` — the #601 visibility mirror,
spec §3.6), tags as SORTED title strings (the ``PhotoPublicResponse``
#493 precedent — assembled by an explicit mapper, never
``model_validate`` over ORM tags), materials ordered ``title ASC,
id ASC`` (the staff-contract order), deterministic ``title, id``
order, the ``BARE_LIST_MAX_ROWS`` ceiling of the ``/all`` canon.

Paired seeding with a positive control (the #600/#601 plan wording):
the hidden service is seeded as a PAIR — rich visible twin + hidden
twin — and the filtering test asserts BOTH halves: the visible twin
present (the filter is not just an empty table), the hidden twin
absent. An archived row is the third exclusion half (archived ≠
hidden — distinct rules, the #601 precedent).

Domain rules: docs/domain-rules/auth.md (Public Access),
docs/domain-rules/services.md (Visibility),
docs/specs/2026-11-13-adr015-dictionaries-606-design.md §3.2
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.schemas.service import ServicePublicResponse

pytestmark = pytest.mark.api

URL = "/api/v1/public/services"

#: GH #606 spec §3.2: exactly the 10 showcase fields (form fields +
#: transport details + ``specialty``) — ``max_age`` is the only
#: nullable scalar.
PUBLIC_FIELDS = {
    "id", "title", "description", "image_url", "specialty",
    "min_age", "max_age", "tariffs", "materials", "tags",
}

TARIFF_FIELDS = {"id", "title", "price"}
MATERIAL_FIELDS = {"title", "description", "note"}


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (locations precedent).

    Not the shared ``api_client`` with a cleared jar: dictionary tests
    need BOTH views in one test — an authenticated client to seed rows
    (POST /services writes the service + nested tariffs/tags/materials)
    and an anonymous one to probe the public route.
    """
    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def dictionary_fixture(api_client, create_service, create_material, create_tag):
    """Triple seeding: a RICH visible control (≥2 materials with
    distinct titles, ≥1 tariff, ≥1 tag, ages set — spec §3.2), a hidden
    twin (``is_public = false``), and an archived row.

    The control's nested rows are seeded title-DESC on purpose (the
    ``Б`` material linked first, the ``z`` tag first): every nested
    order the route promises (materials ``title ASC``, tags sorted) is
    the MAPPER's doing, never the insertion order."""
    tag_z = create_tag(title="z-тег")
    tag_a = create_tag(title="a-тег")
    mat_b = create_material(title="B-Canvas", description="Прочный холст")
    mat_a = create_material(title="A-Brush", description="Мягкая кисть")
    visible = create_service(
        title="Витринная услуга",
        description="Богатый позитивный контроль",
        min_age=5,
        max_age=12,
        tariffs=[{"title": "Базовый", "price": 3000}],
        tag_ids=[tag_z["id"], tag_a["id"]],
        materials=[
            {"material_id": mat_b["id"], "note": "берите свой"},
            {"material_id": mat_a["id"], "note": None},
        ],
    )
    hidden = create_service(title="Скрытая услуга", is_public=False)
    archived = create_service(title="Архивная услуга")
    resp = api_client.post(f"/api/v1/services/{archived['id']}/archive")
    assert resp.status_code == 200, resp.text
    return {"visible": visible, "hidden": hidden, "archived": archived}


class TestPublicServicesList:
    """GH #606: anonymous dictionary — archived/hidden services invisible."""

    def test_anonymous_200_visible_present_hidden_archived_absent(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Парный посев + позитивный контроль: анониму 200, видимый
        близнец в выдаче, скрытый (``is_public = false``) и архивный —
        нет."""
        fx = dictionary_fixture
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, list)  # bare array, no envelope
        ids = [item["id"] for item in body]
        # positive control: the rich visible twin IS here
        assert fx["visible"]["id"] in ids, "visible control missing"
        # the hidden twin is not (is_public = false — the #601 mirror)
        assert fx["hidden"]["id"] not in ids, "hidden twin leaked"
        # the archived row is not (archived ≠ hidden — a distinct rule)
        assert fx["archived"]["id"] not in ids, "archived row leaked"

    def test_items_carry_exactly_the_ten_public_fields(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Ключи каждого элемента — ровно 10 публичных полей (staff-only
        ``duration``/``record_info``/``archived``/``is_public`` и
        timestamps не протекают); скаляры проходят как есть."""
        fx = dictionary_fixture
        body = anon_client.get(URL).json()
        for item in body:
            assert set(item.keys()) == PUBLIC_FIELDS, item
            ServicePublicResponse.model_validate(item)  # contract
        visible_row = next(i for i in body if i["id"] == fx["visible"]["id"])
        assert visible_row["min_age"] == 5
        assert visible_row["max_age"] == 12
        assert visible_row["specialty"] == "живопись"
        assert visible_row["description"] == "Богатый позитивный контроль"
        assert visible_row["image_url"] == "https://example.com/test.jpg"

    def test_tags_are_sorted_title_strings(
        self, anon_client, dictionary_fixture
    ) -> None:
        """``tags`` — строки-названия, отсортированные по названию
        серверно (прецедент #493): посеяны ``z`` раньше ``a`` — в выдаче
        ``a`` раньше ``z``."""
        fx = dictionary_fixture
        body = anon_client.get(URL).json()
        visible_row = next(i for i in body if i["id"] == fx["visible"]["id"])
        assert visible_row["tags"] == ["a-тег", "z-тег"]
        for item in body:
            assert all(isinstance(tag, str) for tag in item["tags"])

    def test_nested_key_sets_and_materials_order(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Вложенные ключи: тариф ``{id, title, price}`` (штатный
        ``description``/``audience``/``service_id`` не протекают),
        материал ``{title, description, note}``; материалы отсортированы
        ``title ASC`` маппером (посеяны ``B`` раньше ``A``)."""
        fx = dictionary_fixture
        body = anon_client.get(URL).json()
        visible_row = next(i for i in body if i["id"] == fx["visible"]["id"])
        assert len(visible_row["tariffs"]) >= 1
        for tariff in visible_row["tariffs"]:
            assert set(tariff.keys()) == TARIFF_FIELDS, tariff
        assert visible_row["tariffs"][0]["title"] == "Базовый"
        assert visible_row["tariffs"][0]["price"] == 3000
        assert len(visible_row["materials"]) == 2
        for material in visible_row["materials"]:
            assert set(material.keys()) == MATERIAL_FIELDS, material
        titles = [m["title"] for m in visible_row["materials"]]
        assert titles == ["A-Brush", "B-Canvas"], titles
        by_title = {m["title"]: m for m in visible_row["materials"]}
        assert by_title["B-Canvas"]["note"] == "берите свой"
        assert by_title["A-Brush"]["note"] is None
        assert by_title["A-Brush"]["description"] == "Мягкая кисть"

    def test_deterministic_order(self, anon_client, create_service) -> None:
        """``title ASC, id ASC`` (spec §3.2 — the staff-list order):
        pinned by relative positions — title wins over creation order;
        an EXACT title tie is broken by id ASC."""
        third = create_service(title="B-Alpha")
        first = create_service(title="A-Beta")  # created later — title wins
        twin_b = create_service(title="C-Twin")
        twin_a = create_service(title="C-Twin")  # exact tie → id decides
        ids = [item["id"] for item in anon_client.get(URL).json()]
        assert (
            ids.index(first["id"])
            < ids.index(third["id"])
            < ids.index(twin_a["id"])
        ), ids
        assert (
            ids.index(twin_a["id"]) < ids.index(twin_b["id"])
            if twin_a["id"] < twin_b["id"]
            else ids.index(twin_b["id"]) < ids.index(twin_a["id"])
        ), ids


def _bulk_seed_services(db_engine, n: int) -> None:
    """Bulk-insert ``n`` active + public services directly via
    SQLAlchemy (sync test → asyncio.run — the tags canon).

    Explicit uuid4 ids + timestamps are supplied because bulk
    ``insert()`` with a list of dicts does not reliably invoke
    Python-side column defaults across SQLAlchemy versions. No nested
    rows: the ceiling counts services rows only — tariffs/tags/
    materials are selectinload satellites, they never multiply the
    parents.
    """
    import asyncio
    import uuid as _uuid

    async def _seed() -> None:
        from sqlalchemy import insert
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from src.models.service import Service
        from src.util.utc import utc_now

        factory = async_sessionmaker(db_engine, expire_on_commit=False)
        now = utc_now()
        rows = [
            {
                "id": str(_uuid.uuid4()),
                "title": f"Bulk-{i:05d}",
                "description": "bulk seed",
                "image_url": "https://example.com/bulk.jpg",
                "specialty": "живопись",
                "min_age": 6,
                "max_age": None,
                "duration": 90,
                "record_info": "",
                "is_public": True,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for i in range(n)
        ]
        async with factory() as session:
            await session.execute(insert(Service), rows)
            await session.commit()

    asyncio.run(_seed())


class TestPublicServicesBareListCeiling:
    """The ``BARE_LIST_MAX_ROWS`` ceiling (the /all canon, spec §3.2) —
    boundary pair per the ``test_generic_api_contract`` precedent."""

    def test_limit_exceeded_422(self, anon_client, db_engine) -> None:
        """``BARE_LIST_MAX_ROWS + 1`` rows → 422 with the standard
        envelope (``code=VALIDATION_ERROR``, message naming the entity
        + the limit value)."""
        from src.services.generic import BARE_LIST_MAX_ROWS

        _bulk_seed_services(db_engine, BARE_LIST_MAX_ROWS + 1)
        resp = anon_client.get(URL)
        assert resp.status_code == 422, f"limit exceeded → 422, got {resp.status_code}: {resp.text}"
        detail = resp.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "services" in detail["message"], "message must name the entity ('services')"
        assert str(BARE_LIST_MAX_ROWS) in detail["message"], "message must cite the limit value"

    def test_limit_boundary_ok(self, anon_client, db_engine) -> None:
        """Exactly ``BARE_LIST_MAX_ROWS`` rows → 200 with the full array
        (boundary)."""
        from src.services.generic import BARE_LIST_MAX_ROWS

        _bulk_seed_services(db_engine, BARE_LIST_MAX_ROWS)
        resp = anon_client.get(URL)
        assert resp.status_code == 200, f"boundary → 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == BARE_LIST_MAX_ROWS, "exactly BARE_LIST_MAX_ROWS rows must be returned"
