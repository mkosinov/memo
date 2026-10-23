"""GH #513 — client cabinet read: GET /api/v1/my/payments contract.

The third /my read endpoint (spec §«Контракт API → GET
/api/v1/my/payments»): payments of the client's records — ownership is
THROUGH the record (a payment is "mine" iff its record belongs to the
session's client card). Each item carries a brief record context
(``{id, activity_date, service_title}``) that is ALWAYS present: a
payment without a record cannot exist (``record_id`` is a mandatory
FK, payments are deleted with the record).

Covered (spec §«Тесты» backend):
- contract: item/record-context field sets (no ``updated_at``, no full
  record data), pagination envelope;
- record context present and correct for every payment;
- ``method: null`` passes the contract (nullable by model);
- 401: no client cookie; a live STAFF token copied into the client
  cookie; cardless account → 200 empty;
- 422: the shared pagination canon (page=0, per_page=0/101, ?id=garbage);
- isolation: a second client's payments are invisible both ways;
  payments of client-less (anonymous) records never appear;
- deterministic order: created_at DESC with the id ASC tie-break.

Spec: docs/specs/2026-10-22-web-client-cabinet-read-design.md
Domain rules: docs/domain-rules/payments.md
"""

from __future__ import annotations

import secrets
import uuid as _uuid
from datetime import datetime

import pytest

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

MY_URL = "/api/v1/my/payments"


# ─── helpers (conftest direct-SQL pattern, test_my_records_read_api) ───────────


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

    The card (and its records/payments) are seeded while the staff jar
    is live; this helper then swaps the jar to the client session.
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
    activity (default 1 named visit). Returns the record dict + the
    resolved ``service_title`` + expected ``activity_date``."""

    def factory(card_id: str, start: datetime) -> dict:
        activity = create_activity(start=start)
        payload = {
            "activity_id": activity["id"],
            "client_id": card_id,
            "visits": [{"name": "Анна", "price": 3500, "status": "waiting"}],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201, resp.text
        record = resp.json()
        svc = api_client.get(f"/api/v1/services/{activity['service_id']}")
        assert svc.status_code == 200, svc.text
        record["service_title"] = svc.json()["title"]
        record["activity_date"] = start.date().isoformat()
        return record

    return factory


@pytest.fixture
def seed_payment(api_client):
    """Factory: a STAFF-created payment on ``record_id``. ``created_at``
    is client-suppliable on POST (backdating is a domain feature), so
    ordering tests pin timestamps through the API — no SQL needed."""

    def factory(
        record_id: str,
        amount: int = 3000,
        method: str | None = "card",
        created_at: str | None = None,
    ) -> dict:
        payload: dict = {"record_id": record_id, "amount": amount}
        if method is not None:
            payload["method"] = method
        if created_at is not None:
            payload["created_at"] = created_at
        resp = api_client.post("/api/v1/payments", json=payload)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return factory


# ─── contract: field sets, record context, envelope ────────────────────────────


class TestContract:
    def test_item_and_record_context_field_sets(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        payment = seed_payment(record["id"], amount=3000, method="card")
        _owner_of_card(api_client, card)

        resp = api_client.get(MY_URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert set(body) == {"items", "total", "page", "per_page"}
        assert body["total"] == 1
        assert body["page"] == 1
        assert body["per_page"] == 20

        assert len(body["items"]) == 1
        item = body["items"][0]
        # Spec «не входят»: updated_at; no full record data either.
        assert set(item) == {"id", "amount", "method", "created_at", "record"}
        assert item["id"] == payment["id"]
        assert item["amount"] == 3000
        assert item["method"] == "card"
        datetime.fromisoformat(item["created_at"])

        # Record context: exactly the three brief fields, always present.
        assert set(item["record"]) == {"id", "activity_date", "service_title"}
        assert item["record"]["id"] == record["id"]
        assert item["record"]["activity_date"] == "2026-11-05"
        assert item["record"]["service_title"] == record["service_title"]

    def test_record_context_present_for_every_payment(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        """The context is not optional: two payments on two records —
        each carries its OWN record's id/date/title."""
        card = _client_card(_unique_phone())
        r1 = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        r2 = seed_record(card, start=datetime(2026, 12, 1, 10, 0))
        seed_payment(r1["id"], amount=1000, created_at="2026-11-06T12:00:00")
        seed_payment(r2["id"], amount=2000, created_at="2026-12-02T12:00:00")
        _owner_of_card(api_client, card)

        items = api_client.get(MY_URL).json()["items"]
        assert len(items) == 2
        by_record = {i["record"]["id"]: i["record"] for i in items}
        assert set(by_record) == {r1["id"], r2["id"]}
        assert by_record[r1["id"]]["activity_date"] == "2026-11-05"
        assert by_record[r2["id"]]["activity_date"] == "2026-12-01"
        assert by_record[r1["id"]]["service_title"] == r1["service_title"]
        assert by_record[r2["id"]]["service_title"] == r2["service_title"]

    def test_method_null_passes_contract(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        """``method`` is nullable by model — «Способ не указан»."""
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        seed_payment(record["id"], amount=500, method=None)
        _owner_of_card(api_client, card)

        items = api_client.get(MY_URL).json()["items"]
        assert len(items) == 1
        assert items[0]["method"] is None

    def test_all_method_enum_values(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        for method in ("cash", "card", "transfer"):
            seed_payment(record["id"], amount=100, method=method)
        _owner_of_card(api_client, card)

        methods = {i["method"] for i in api_client.get(MY_URL).json()["items"]}
        assert methods == {"cash", "card", "transfer"}


# ─── sorting: fixed, deterministic ─────────────────────────────────────────────


class TestSorting:
    def test_created_at_desc_then_id_asc(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        card = _client_card(_unique_phone())
        r1 = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        r2 = seed_record(card, start=datetime(2026, 12, 1, 10, 0))
        jan = seed_payment(r1["id"], created_at="2026-01-01T10:00:00")
        mar_a = seed_payment(r2["id"], created_at="2026-03-01T10:00:00")
        feb = seed_payment(r1["id"], created_at="2026-02-01T10:00:00")
        mar_b = seed_payment(r2["id"], created_at="2026-03-01T10:00:00")  # tie
        _owner_of_card(api_client, card)

        items = api_client.get(MY_URL).json()["items"]
        expected = [*sorted([mar_a["id"], mar_b["id"]]), feb["id"], jan["id"]]
        assert [i["id"] for i in items] == expected


# ─── pagination: envelope mechanics + the shared 422 canon ─────────────────────


class TestPagination:
    def test_page_slices_and_beyond_is_empty(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        for month in (1, 2, 3):
            seed_payment(
                record["id"], amount=100 * month,
                created_at=f"2026-0{month}-01T10:00:00",
            )
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
    def test_invalid_params_422(
        self, api_client, seed_record, seed_payment, params: dict,
    ) -> None:
        card = _client_card(_unique_phone())
        record = seed_record(card, start=datetime(2026, 11, 5, 18, 30))
        # Seed while the STAFF jar is live (before the client swap).
        seed_payment(record["id"], amount=100)
        _owner_of_card(api_client, card)

        resp = api_client.get(MY_URL, params=params)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    def test_id_narrowing_within_owner_scope(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        """The inherited machine ``?id=`` filter narrows PAYMENT ids
        inside the owner-through-record filter: own id → 1 row; a
        foreign payment's id → 200 + empty."""
        card_a = _client_card(_unique_phone())
        ra = seed_record(card_a, start=datetime(2026, 11, 5, 18, 30))
        keep = seed_payment(ra["id"], created_at="2026-02-01T10:00:00")
        seed_payment(ra["id"], created_at="2026-01-01T10:00:00")
        card_b = _client_card(_unique_phone())
        rb = seed_record(card_b, start=datetime(2026, 12, 1, 10, 0))
        foreign = seed_payment(rb["id"], created_at="2026-03-01T10:00:00")
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

    def test_cardless_account_empty_list_never_anonymous_records(
        self, api_client, create_activity,
    ) -> None:
        """A cardless account owns nothing — 200 empty; payments of
        client-less (anonymous) records belong to no one and must never
        leak into any cabinet list (ownership is THROUGH the record)."""
        activity = create_activity(start=datetime(2026, 11, 5, 18, 30))
        # Anonymous visit (no name): visitor resolution needs a client
        # card, and the point here is the client-less RECORD, not the seat.
        anon_record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "visits": [{"price": 1000, "status": "waiting"}],
        })
        assert anon_record.status_code == 201, anon_record.text
        payment = api_client.post("/api/v1/payments", json={
            "record_id": anon_record.json()["id"], "amount": 1000,
        })
        assert payment.status_code == 201, payment.text
        assert query_db("SELECT COUNT(*) AS n FROM payments")[0]["n"] == 1

        user = insert_user(_unique_phone(), None, role="client")
        token = _client_session(api_client, user["id"])
        api_client.cookies.clear()
        api_client.cookies.set("memo_client_session", token)

        resp = api_client.get(MY_URL)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0


# ─── isolation: the owner-through-record filter is the only visibility ─────────


class TestIsolation:
    def test_second_client_invisible_both_ways(
        self, api_client, seed_record, seed_payment,
    ) -> None:
        card_a = _client_card(_unique_phone())
        ra = seed_record(card_a, start=datetime(2026, 11, 5, 18, 30))
        a1 = seed_payment(ra["id"], amount=1000, created_at="2026-02-01T10:00:00")
        a2 = seed_payment(ra["id"], amount=2000, created_at="2026-01-01T10:00:00")
        card_b = _client_card(_unique_phone())
        rb = seed_record(card_b, start=datetime(2026, 12, 1, 10, 0))
        b1 = seed_payment(rb["id"], amount=3000, created_at="2026-03-01T10:00:00")

        _owner_of_card(api_client, card_a)
        body_a = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_a["items"]} == {a1["id"], a2["id"]}
        assert body_a["total"] == 2

        _owner_of_card(api_client, card_b)
        body_b = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_b["items"]} == {b1["id"]}
        assert body_b["total"] == 1
