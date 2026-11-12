"""Tests for the public activities schedule route (GH #600, ADR-015).

``GET /api/v1/public/activities`` — the anonymous web-schedule list:
minimal ``ActivityPublicResponse`` schema (exactly the 8 fields the web
schedule consumes), server-side private-row exclusion (NULL-safe
``is_private IS NOT TRUE``), deterministic ``start``+``id`` order, and
the default date window starting from today.

Paired seeding with a positive control (the #600 plan wording): every
private row is seeded as a PAIR — private + regular twin on the same
week — and each filtering test asserts BOTH halves: the regular twin
present (the filter is not just an empty table) and the private twin
absent.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.api

URL = "/api/v1/public/activities"

#: GH #600 domain rule: exactly the 8 fields the web schedule consumes.
PUBLIC_FIELDS = {
    "id",
    "service_id",
    "master_id",
    "location_id",
    "start",
    "duration",
    "capacity",
    "occupied",
}


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (photos precedent).

    Not the shared ``api_client`` with a cleared jar: schedule tests
    need BOTH views in one test — an authenticated client to seed rows
    (POST /activities writes) and an anonymous one to probe the public
    route.
    """
    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def schedule_fixture(create_activity):
    """Paired seeding: private + regular twins across one week (#600).

    - past pair (−2 days): outside the DEFAULT window (from today);
    - future regulars on +1/+2 at different hours (deterministic
      ``start`` order) plus a same-instant tie pair on +3 (``id``
      tie-break);
    - every private twin sits on the SAME day as a regular twin —
      filtering by date can never hide the pairing.
    """
    today = datetime.now(UTC).date()
    noon = datetime.combine(today, time(12, 0)).replace(tzinfo=UTC)

    def at(days: int, hour: int = 12) -> datetime:
        return noon.replace(hour=hour) + timedelta(days=days)

    return {
        "today": today,
        "past_regular": create_activity(start=at(-2, 12)),
        "past_private": create_activity(start=at(-2, 10), is_private=True),
        "d1_regular": create_activity(start=at(1, 10)),
        "d1_private": create_activity(start=at(1, 11), is_private=True),
        "d2_regular": create_activity(start=at(2, 9)),
        "d2_private": create_activity(start=at(2, 15), is_private=True),
        # same instant on +3: the ONLY ordering discriminator is id
        "tie_a": create_activity(start=at(3, 12)),
        "tie_b": create_activity(start=at(3, 12)),
    }


def _default_order(fx: dict) -> list[str]:
    """Expected public ids in the default window (start asc, id asc)."""
    return [
        fx["d1_regular"]["id"],
        fx["d2_regular"]["id"],
        *sorted([fx["tie_a"]["id"], fx["tie_b"]["id"]]),
    ]


class TestPublicActivitiesList:
    """GH #600: anonymous schedule list — private rows invisible."""

    def test_anonymous_200_private_absent_regular_present(
        self, anon_client, schedule_fixture
    ) -> None:
        """Парный посев + позитивный контроль: в окне, покрывающем всю
        неделю, обычные близнецы присутствуют, приватные — нет."""
        fx = schedule_fixture
        resp = anon_client.get(
            URL, params={"date_from": (fx["today"] - timedelta(days=3)).isoformat()}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = [a["id"] for a in body["items"]]
        # positive control: every regular twin is here
        for key in ("past_regular", "d1_regular", "d2_regular", "tie_a", "tie_b"):
            assert fx[key]["id"] in ids, f"{key} missing from the public list"
        # the private twins are not (same days, same week)
        for key in ("past_private", "d1_private", "d2_private"):
            assert fx[key]["id"] not in ids, f"{key} leaked into the public list"
        assert body["total"] == 5

    def test_default_window_starts_today(
        self, anon_client, schedule_fixture
    ) -> None:
        """Без ``date_from`` окно начинается с сегодняшнего дня: прошлая
        пара (вчера-2) не видна, будущие — видны."""
        fx = schedule_fixture
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = [a["id"] for a in body["items"]]
        assert fx["past_regular"]["id"] not in ids
        assert ids == _default_order(fx)
        assert body["total"] == 4

    def test_date_from_date_to_window(
        self, anon_client, schedule_fixture
    ) -> None:
        """Явные границы: [+2..+2] оставляет только обычного близнеца
        дня +2; ``date_to`` без ``date_from`` ограничивает дальний край,
        нижняя граница по умолчанию (сегодня) остаётся в силе."""
        fx = schedule_fixture
        plus2 = (fx["today"] + timedelta(days=2)).isoformat()
        resp = anon_client.get(URL, params={"date_from": plus2, "date_to": plus2})
        assert resp.status_code == 200, resp.text
        assert [a["id"] for a in resp.json()["items"]] == [fx["d2_regular"]["id"]]
        assert resp.json()["total"] == 1

        resp2 = anon_client.get(
            URL, params={"date_to": (fx["today"] + timedelta(days=3)).isoformat()}
        )
        assert resp2.status_code == 200, resp2.text
        assert [a["id"] for a in resp2.json()["items"]] == _default_order(fx)

    def test_pagination_envelope(
        self, anon_client, schedule_fixture
    ) -> None:
        """Конверт пагинации: ``items``/``total``/``page``/``per_page``,
        срез страницы честный, за краем — пустой ``items``, ``total``
        от фильтров, не от страницы."""
        fx = schedule_fixture
        expected = _default_order(fx)
        resp = anon_client.get(URL, params={"per_page": 2, "page": 2})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == {"items", "total", "page", "per_page"}
        assert body["total"] == 4
        assert body["page"] == 2
        assert body["per_page"] == 2
        assert [a["id"] for a in body["items"]] == expected[2:4]

        page3 = anon_client.get(URL, params={"per_page": 2, "page": 3}).json()
        assert page3["items"] == []
        assert page3["total"] == 4

    def test_order_start_then_id(
        self, anon_client, schedule_fixture
    ) -> None:
        """Порядок детерминированный: ``start ASC`` затем ``id ASC`` —
        тай-пара на одном мгновении упорядочена по id."""
        fx = schedule_fixture
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["items"]]
        assert ids == _default_order(fx)

    def test_response_fields_exactly_eight(
        self, anon_client, schedule_fixture
    ) -> None:
        """Схема аудитории: ровно 8 полей, никаких лишних (is_private,
        comment, record_info, timestamps, service_title не уходят)."""
        resp = anon_client.get(URL)
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert items, "fixture must seed visible rows for the field check"
        for item in items:
            assert set(item.keys()) == PUBLIC_FIELDS

    def test_occupied_bulk_computed(
        self, anon_client, create_activity, create_record
    ) -> None:
        """``occupied`` — тот же bulk-расчёт, что в общем списке:
        SUM(seats) активных записей занятия."""
        act = create_activity(capacity=5)
        create_record(
            activity_id=act["id"],
            visits=[
                {"name": "Аня", "price": 3500, "status": "waiting"},
                {"name": "Борис", "price": 3500, "status": "waiting"},
            ],
        )
        resp = anon_client.get(URL, params={"id": act["id"]})
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert [a["id"] for a in items] == [act["id"]]
        assert items[0]["occupied"] == 2
        assert items[0]["capacity"] == 5
        assert items[0]["duration"] == 90

    def test_private_id_via_narrowing_stays_invisible(
        self, anon_client, schedule_fixture
    ) -> None:
        """Guard: ``?id=`` сужает, но не расширяет видимость — приватный
        id через фильтр не достаётся (200 + пустой список)."""
        fx = schedule_fixture
        resp = anon_client.get(URL, params={"id": fx["d1_private"]["id"]})
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0
