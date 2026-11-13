"""Tests for the public locations dictionary route (GH #601, ADR-015).

``GET /api/v1/public/locations`` — the anonymous web dictionary: bare
JSON array (no envelope, no parameters), minimal ``LocationPublicResponse``
schema (exactly the 4 fields the web consumes — spec §2.2), server-side
exclusion of archived rows and rows hidden by ``is_public = false``,
deterministic ``sort_order, title, id`` order, the ``BARE_LIST_MAX_ROWS``
ceiling of the ``/all`` canon.

Paired seeding with a positive control (the #600/#601 plan wording):
the hidden location is seeded as a PAIR — hidden + visible twin, each
with an activity in the schedule window — and the filtering test
asserts BOTH halves: the visible twin present (the filter is not just
an empty table), the hidden twin absent. An archived+public row is the
third exclusion half (archived ≠ hidden — distinct rules, spec §2.1).

Domain rules: docs/domain-rules/locations.md (List contract),
docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.schemas.location import LocationPublicResponse

pytestmark = pytest.mark.api

URL = "/api/v1/public/locations"

#: GH #601 spec §2.2: exactly the 4 fields the web dictionary consumes.
PUBLIC_FIELDS = {"id", "title", "address", "location_hint"}


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (photos/activities precedents).

    Not the shared ``api_client`` with a cleared jar: dictionary tests
    need BOTH views in one test — an authenticated client to seed rows
    (POST /locations writes) and an anonymous one to probe the public
    route.
    """
    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def dictionary_fixture(api_client, create_location, create_activity):
    """Paired seeding: hidden + visible twins, each with an in-window
    activity; plus an archived+public row (a third exclusion half).

    ``create_activity(location_id=…)`` composites its own throwaway
    master/service; the activities' default ``start`` (tomorrow) keeps
    them inside the public schedule window.
    """
    visible = create_location(
        title="Visible Control", address=None, location_hint="2nd floor"
    )
    hidden = create_location(title="Hidden Twin", is_public=False)
    # each twin gets an activity in the window (the pair mirrors the
    # web scenario: the hidden location is NOT hidden for lack of rows)
    create_activity(location_id=visible["id"])
    create_activity(location_id=hidden["id"])
    archived = create_location(title="Archived Row")
    resp = api_client.post(f"/api/v1/locations/{archived['id']}/archive")
    assert resp.status_code == 200, resp.text
    return {"visible": visible, "hidden": hidden, "archived": archived}


class TestPublicLocationsList:
    """GH #601: anonymous dictionary — hidden/archived rows invisible."""

    def test_anonymous_200_visible_present_hidden_archived_absent(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Парный посев + позитивный контроль: анониму 200, видимый
        близнец в выдаче, скрытый и архивный — нет."""
        fx = dictionary_fixture
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, list)  # bare array, no envelope
        ids = [item["id"] for item in body]
        # positive control: the visible twin IS here
        assert fx["visible"]["id"] in ids, "visible control missing"
        # the hidden twin is not (is_public=false — same pair, same window)
        assert fx["hidden"]["id"] not in ids, "hidden twin leaked"
        # the archived row is not (archived ≠ hidden — a distinct rule)
        assert fx["archived"]["id"] not in ids, "archived row leaked"

    def test_items_carry_exactly_the_four_public_fields(
        self, anon_client, dictionary_fixture
    ) -> None:
        """Ключи каждого элемента — ровно 4 публичных поля, лишних нет;
        nullable поля проходят как есть (``address`` → null)."""
        fx = dictionary_fixture
        body = anon_client.get(URL).json()
        for item in body:
            assert set(item.keys()) == PUBLIC_FIELDS, item
            LocationPublicResponse.model_validate(item)  # contract
        visible_row = next(i for i in body if i["id"] == fx["visible"]["id"])
        assert visible_row["address"] is None  # nullable passthrough
        assert visible_row["location_hint"] == "2nd floor"

    def test_deterministic_order(self, anon_client, create_location) -> None:
        """``sort_order ASC, title ASC, id ASC`` (spec §2.2): pinned by
        relative positions — sort_order decides first, title breaks the
        sort_order=2 tie."""
        third = create_location(title="B-Alpha", sort_order=2)
        first = create_location(title="Z-First", sort_order=1)
        second = create_location(title="A-Second", sort_order=2)
        ids = [item["id"] for item in anon_client.get(URL).json()]
        assert (
            ids.index(first["id"]) < ids.index(second["id"]) < ids.index(third["id"])
        ), ids
