"""GH #513 — client cabinet read: GET /api/v1/my/records contract.

The first of the three /my read endpoints (spec §«Контракт API → GET
/api/v1/my/records»): own records with visits, owner = the session's
client card (``user.client_id``), fixed sorting (activity start DESC,
record id ASC; visits by id ASC), ``PaginationParams`` brick as the
only input, per-visit SNAPSHOT price (visit ``custom_price`` when set,
else stored ``price`` — the tariff is never consulted on read, #357).

Covered (spec §«Тесты» backend):
- contract: item/visit field sets (the «не входят» service fields are
  absent), computed ``activity_date``/``activity_start``/``activity_end``,
  pagination envelope;
- 401: no client cookie; a live STAFF token copied into the client
  cookie (single AUTH_UNAUTHORIZED code); cardless account → 200 empty;
- 422: the shared pagination canon (page=0, per_page=0/101, ?id=garbage);
- isolation: a second client's records are invisible both ways;
- snapshot price: visit custom_price wins, else stored price; record
  custom_price never leaks into per-visit prices; price survives the
  tariff's deletion;
- ``visitor_name: null`` for an anonymous seat; deterministic order
  (records tie-break by id, visits by id).

Spec: docs/specs/2026-10-22-web-client-cabinet-read-design.md
Domain rules: docs/domain-rules/records.md, visits.md (#357 invariant)
"""

from __future__ import annotations

import secrets
import uuid as _uuid
from datetime import datetime

import pytest

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

MY_URL = "/api/v1/my/records"


# ─── helpers (conftest direct-SQL pattern, test_my_records_api) ────────────────


def _client_card(phone: str, name: str = "Анна Клиент") -> str:
    """Active client card with this phone → id (direct SQL)."""
    card_id = secrets.token_hex(16)
    query_db_params(
        "INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
        "VALUES (:id, :name, :phone, 1, datetime('now'), datetime('now'))",
        {"id": card_id, "name": name, "phone": phone},
    )
    return card_id


def _unique_phone() -> str:
    return f"+7999{_uuid.uuid4().hex[:7]}"


def _client_session(api_client, user_id: str) -> str:
    """Live client session row → token (jar is NOT touched here)."""
    token = secrets.token_urlsafe(32)
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user_id},
    )
    return token


def _owner_of_card(api_client, card_id: str) -> dict:
    """User linked to an EXISTING card + live client session on the jar.

    The card (and its records) are seeded while the staff jar is live;
    this helper then swaps the jar to the client session.
    """
    phone = _unique_phone()
    user = insert_user(phone, None, role="client")
    query_db_params(
        "UPDATE users SET client_id = :card WHERE id = :user",
        {"card": card_id, "user": user["id"]},
    )
    token = _client_session(api_client, user["id"])
    api_client.cookies.clear()
    api_client.cookies.set("memo_client_session", token)
    return user


@pytest.fixture
def seed_record(api_client, create_activity):
    """Factory: a STAFF-created record owned by ``card_id`` on a fresh
    activity with the given ``start``/``duration`` (default 1 named
    visit at 3500). Must run BEFORE the jar switches to the client
    session (``_owner_of_card``)."""

    def factory(
        card_id: str,
        start: datetime,
        duration: int = 90,
        visits: list[dict] | None = None,
        comment: str | None = "Позвоните накануне",
    ) -> dict:
        activity = create_activity(start=start, duration=duration)
        payload = {
            "activity_id": activity["id"],
            "client_id": card_id,
            "comment": comment,
            "visits": visits or [{"name": "Анна", "price": 3500, "status": "waiting"}],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201, resp.text
        record = resp.json()
        record["service_title"] = _service_title(api_client, activity["service_id"])
        return record

    return factory


def _service_title(api_client, service_id: str) -> str:
    resp = api_client.get(f"/api/v1/services/{service_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()["title"]


def _expected_visits(record_id: str) -> list[dict]:
    """DB truth for a record's visits: id ASC with resolved names."""
    rows = query_db(
        "SELECT v.id, v.price, v.custom_price, v.status, vi.name AS visitor_name "
        f"FROM visits v LEFT JOIN visitors vi ON vi.id = v.visitor_id "
        f"WHERE v.record_id = '{record_id}' ORDER BY v.id ASC"
    )
    return [
        {
            "id": r["id"],
            "visitor_name": r["visitor_name"],
            "status": r["status"],
            "price": r["custom_price"] if r["custom_price"] is not None else r["price"],
        }
        for r in rows
    ]


# ─── contract: field sets, computed fields, envelope ───────────────────────────


class TestContract:
    def test_record_and_visit_field_sets(self, api_client, seed_record) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        _owner_of_card(api_client, card)

        resp = api_client.get(MY_URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        # Envelope: the standard PaginatedResponse shape.
        assert set(body) == {"items", "total", "page", "per_page"}
        assert body["total"] == 1
        assert body["page"] == 1
        assert body["per_page"] == 20

        assert len(body["items"]) == 1
        item = body["items"][0]
        # Spec «не входят»: client_id, activity_id, seats, record status,
        # custom_price, tariff_id, visitor_id, record_id, created/updated.
        assert set(item) == {
            "id", "activity_date", "activity_start", "activity_end",
            "service_title", "comment", "visits",
        }
        assert item["id"] == record["id"]
        assert item["service_title"] == record["service_title"]
        assert item["comment"] == "Позвоните накануне"

        assert len(item["visits"]) == 1
        visit = item["visits"][0]
        # Spec «не входят» (visit): tariff_id, visitor_id, record_id,
        # custom_price, created_at/updated_at.
        assert set(visit) == {"id", "visitor_name", "status", "price"}
        assert visit == {
            "id": record["visits"][0]["id"],
            "visitor_name": "Анна",
            "status": "waiting",
            "price": 3500,
        }

    def test_activity_date_start_end(self, api_client, seed_record) -> None:
        """date/start/end are computed from activity start + duration."""
        card = _client_card(_unique_phone())
        seed_record(card, start=datetime(2026, 11, 5, 18, 30), duration=90)
        _owner_of_card(api_client, card)

        item = api_client.get(MY_URL).json()["items"][0]
        assert item["activity_date"] == "2026-11-05"
        assert item["activity_start"] == "18:30:00"
        # end = start + duration (90 min), model stores only start+duration
        assert item["activity_end"] == "20:00:00"

    def test_comment_null_when_absent(self, api_client, seed_record) -> None:
        card = _client_card(_unique_phone())
        seed_record(card, start=datetime(2026, 11, 5, 18, 30), comment=None)
        _owner_of_card(api_client, card)
        assert api_client.get(MY_URL).json()["items"][0]["comment"] is None


# ─── sorting: fixed, deterministic ─────────────────────────────────────────────


class TestSorting:
    def test_records_by_activity_start_desc_then_id_asc(
        self, api_client, seed_record,
    ) -> None:
        card = _client_card(_unique_phone())
        r_nov = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        r_dec = seed_record(card, start=datetime(2026, 12, 1, 10, 0))
        r_oct = seed_record(card, start=datetime(2026, 10, 15, 9, 15))
        # Same start as r_nov (a different activity) → tie, id ASC decides.
        r_tie = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        _owner_of_card(api_client, card)

        items = api_client.get(MY_URL).json()["items"]
        expected = [
            r_dec["id"],
            *sorted([r_nov["id"], r_tie["id"]]),
            r_oct["id"],
        ]
        assert [i["id"] for i in items] == expected

    def test_visits_by_id_asc(self, api_client, seed_record) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(
            card,
            start=datetime(2026, 11, 5, 18, 30),
            visits=[
                {"name": "Анна", "price": 3500, "status": "waiting"},
                {"price": 2500, "status": "visited"},
                {"name": "Борис", "price": 1500, "status": "waiting"},
            ],
        )
        _owner_of_card(api_client, card)

        item = api_client.get(MY_URL).json()["items"][0]
        assert item["visits"] == _expected_visits(record["id"])


# ─── pagination: envelope mechanics + the shared 422 canon ─────────────────────


class TestPagination:
    def test_page_slices_and_beyond_is_empty(self, api_client, seed_record) -> None:
        card = _client_card(_unique_phone())
        for start in (
            datetime(2026, 10, 15, 9, 15),
            datetime(2026, 11, 5, 18, 30),
            datetime(2026, 12, 1, 10, 0),
        ):
            seed_record(card, start=start)
        _owner_of_card(api_client, card)

        page1 = api_client.get(MY_URL, params={"per_page": 2}).json()
        assert (page1["total"], page1["page"], page1["per_page"]) == (3, 1, 2)
        assert len(page1["items"]) == 2

        page2 = api_client.get(MY_URL, params={"per_page": 2, "page": 2}).json()
        assert len(page2["items"]) == 1
        assert page2["items"][0]["id"] not in {i["id"] for i in page1["items"]}

        beyond = api_client.get(MY_URL, params={"per_page": 2, "page": 5}).json()
        assert beyond["items"] == []
        assert beyond["total"] == 3

    @pytest.mark.parametrize("params", [
        {"page": 0},
        {"per_page": 0},
        {"per_page": 101},
        {"id": "not-a-uuid"},
    ])
    def test_invalid_params_422(self, api_client, seed_record, params: dict) -> None:
        card = _client_card(_unique_phone())
        seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        _owner_of_card(api_client, card)

        resp = api_client.get(MY_URL, params=params)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    def test_id_narrowing_within_owner_scope(self, api_client, seed_record) -> None:
        """The inherited machine ``?id=`` filter narrows inside the owner
        filter: own id → 1 row; a foreign record's id → 200 + empty."""
        card_a = _client_card(_unique_phone())
        keep = seed_record(card_a, start=datetime(2026, 11, 5, 18, 30))
        drop = seed_record(card_a, start=datetime(2026, 12, 1, 10, 0))
        card_b = _client_card(_unique_phone())
        foreign = seed_record(card_b, start=datetime(2026, 10, 15, 9, 15))
        _owner_of_card(api_client, card_a)

        body = api_client.get(MY_URL, params={"id": keep["id"]}).json()
        assert [i["id"] for i in body["items"]] == [keep["id"]]
        assert body["total"] == 1

        # Repeated ?id= dedups (#232) and NEVER expands the owner scope.
        body = api_client.get(
            MY_URL, params=[("id", keep["id"]), ("id", keep["id"])],
        ).json()
        assert [i["id"] for i in body["items"]] == [keep["id"]]

        body = api_client.get(MY_URL, params={"id": foreign["id"]}).json()
        assert body["items"] == []
        assert body["total"] == 0
        assert drop["id"] != foreign["id"]


# ─── guards: 401 shapes, cardless account ──────────────────────────────────────


class TestGuards:
    def test_no_cookie_401(self, api_client) -> None:
        api_client.cookies.clear()
        resp = api_client.get(MY_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_staff_token_in_client_cookie_401(self, api_client) -> None:
        """A LIVE staff session token copied into the client cookie name
        resolves, then fails the role barrier — the same single 401."""
        staff_token = api_client.cookies.get("memo_session")
        assert staff_token, "fixture admin session missing"
        api_client.cookies.clear()
        api_client.cookies.set("memo_client_session", staff_token)

        resp = api_client.get(MY_URL)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_cardless_account_empty_list(self, api_client, create_activity) -> None:
        """A client account with no linked card owns nothing — 200 empty
        (never the anonymous records: the None filter must not leak)."""
        create_activity(start=datetime(2026, 11, 5, 18, 30))
        query_db(
            "INSERT INTO records (id, activity_id, client_id, status, seats, "
            "created_at, updated_at) SELECT lower(hex(randomblob(16))), "
            "a.id, NULL, 'waiting', 1, datetime('now'), datetime('now') "
            "FROM activities a LIMIT 1"
        )
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 1
        user = insert_user(_unique_phone(), None, role="client")
        token = _client_session(api_client, user["id"])
        api_client.cookies.clear()
        api_client.cookies.set("memo_client_session", token)

        resp = api_client.get(MY_URL)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0


# ─── isolation: the owner filter is the only visibility ────────────────────────


class TestIsolation:
    def test_second_client_invisible_both_ways(self, api_client, seed_record) -> None:
        card_a = _client_card(_unique_phone())
        a1 = seed_record(card_a, start=datetime(2026, 11, 5, 18, 30))
        a2 = seed_record(card_a, start=datetime(2026, 12, 1, 10, 0))
        card_b = _client_card(_unique_phone())
        b1 = seed_record(card_b, start=datetime(2026, 10, 15, 9, 15))

        _owner_of_card(api_client, card_a)
        body_a = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_a["items"]} == {a1["id"], a2["id"]}
        assert body_a["total"] == 2

        _owner_of_card(api_client, card_b)
        body_b = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_b["items"]} == {b1["id"]}
        assert body_b["total"] == 1


# ─── snapshot price (#357): custom_price → stored price, tariff never read ─────


class TestVisitSnapshotPrice:
    def test_visit_custom_price_wins_over_stored(
        self, api_client, seed_record,
    ) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(
            card,
            start=datetime(2026, 11, 5, 18, 30),
            visits=[
                {"name": "Анна", "price": 3500, "status": "waiting"},
                {"price": 2500, "status": "waiting"},
            ],
        )
        target = record["visits"][0]["id"]
        resp = api_client.patch(
            f"/api/v1/visits/{target}", json={"custom_price": 1000},
        )
        assert resp.status_code == 200, resp.text
        _owner_of_card(api_client, card)

        item = api_client.get(MY_URL).json()["items"][0]
        assert item["visits"] == _expected_visits(record["id"])
        prices = {v["id"]: v["price"] for v in item["visits"]}
        assert prices[target] == 1000
        assert prices[record["visits"][1]["id"]] == 2500

    def test_record_custom_price_never_leaks_into_visit_prices(
        self, api_client, seed_record,
    ) -> None:
        """Record-level custom_price overrides the TOTAL, not per-visit
        prices — the /my screen shows per-visit snapshot prices only."""
        card = _client_card(_unique_phone())
        record = seed_record(
            card,
            start=datetime(2026, 11, 5, 18, 30),
            visits=[{"name": "Анна", "price": 3500, "status": "waiting"}],
        )
        resp = api_client.patch(
            f"/api/v1/records/{record['id']}", json={"custom_price": 777},
        )
        assert resp.status_code == 200, resp.text
        _owner_of_card(api_client, card)

        item = api_client.get(MY_URL).json()["items"][0]
        assert item["visits"][0]["price"] == 3500
        assert "custom_price" not in item

    def test_price_survives_tariff_deletion(self, api_client, create_activity) -> None:
        """Book through the client branch (price snapshotted from the
        tariff), then DELETE the tariff row — the read must return the
        stored snapshot without ever consulting the tariff (#357)."""
        activity = create_activity(start=datetime(2026, 11, 5, 18, 30))
        tariff_id = f"tariff-{secrets.token_hex(8)}"
        query_db_params(
            "INSERT INTO tariffs (id, service_id, title, price, is_active, "
            "created_at, updated_at) VALUES "
            "(:id, :svc, :title, 3500, 1, datetime('now'), datetime('now'))",
            {"id": tariff_id, "svc": activity["service_id"], "title": "Взрослый"},
        )
        card = _client_card(_unique_phone())
        _owner_of_card(api_client, card)

        booking = api_client.post(MY_URL, json={
            "activity_id": activity["id"],
            "phone": _unique_phone(),
            "visits": [{"tariff_id": tariff_id}],
        })
        assert booking.status_code == 201, booking.text
        record_id = booking.json()["id"]
        assert booking.json()["visits"][0]["price"] == 3500

        query_db_params("DELETE FROM tariffs WHERE id = :id", {"id": tariff_id})

        items = api_client.get(MY_URL).json()["items"]
        match = [i for i in items if i["id"] == record_id]
        assert len(match) == 1
        assert match[0]["visits"][0]["price"] == 3500
