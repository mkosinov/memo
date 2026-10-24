"""GH #513 — client cabinet read: GET /api/v1/my/photos contract.

The second /my read endpoint (spec §«Контракт API → GET
/api/v1/my/photos»): ALL the client's photos regardless of publicity,
owner = the session's client card (``user.client_id``), fixed sorting
(``created_at`` DESC, id ASC — the deterministic tie-break canon),
``PaginationParams`` brick as the only input, tags resolved server-side
to NAMES (string[] — tag objects with ids stay in the admin contract).

Covered (spec §«Тесты» backend):
- contract: item field set (the «не входят» service fields are absent),
  tags as names, pagination envelope;
- non-public photos are returned alongside public ones (no publicity
  filter on the cabinet list);
- 401: no client cookie; a live STAFF token copied into the client
  cookie; cardless account → 200 empty (ownerless photos never leak);
- 422: the shared pagination canon (page=0, per_page=0/101, ?id=garbage);
- isolation: a second client's photos are invisible both ways;
  owner-less photos are invisible to everyone;
- deterministic order: created_at DESC with the id ASC tie-break.

Spec: docs/specs/2026-10-22-web-client-cabinet-read-design.md
Domain rules: docs/domain-rules/photos.md
"""

from __future__ import annotations

import secrets
import uuid as _uuid
from datetime import datetime

import pytest

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

MY_URL = "/api/v1/my/photos"


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

    The card (and its photos) are seeded while the staff jar is live;
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


def _insert_photo(
    card_id: str | None,
    created_at: str,
    *,
    is_public: bool = True,
) -> str:
    """Direct-SQL photo row with an EXPLICIT created_at → id.

    ``created_at`` is not input-controllable through the API, so the
    ordering tests seed rows with pinned timestamps (the same-second
    pairs exercise the id ASC tie-break).
    """
    photo_id = secrets.token_hex(16)
    query_db_params(
        "INSERT INTO photos (id, filename, client_id, is_public, "
        "created_at, updated_at) VALUES "
        "(:id, :fn, :card, :pub, :created, :created)",
        {
            "id": photo_id,
            "fn": f"img-{photo_id[:8]}.jpg",
            "card": card_id,
            "pub": int(is_public),
            "created": created_at,
        },
    )
    return photo_id


@pytest.fixture
def seed_photo(api_client):
    """Factory: a STAFF-created photo owned by ``card_id`` (must run
    BEFORE the jar switches to the client session)."""

    def factory(
        card_id: str,
        *,
        is_public: bool = True,
        tag_ids: list[str] | None = None,
    ) -> dict:
        payload = {
            "filename": f"photo-{secrets.token_hex(6)}.jpg",
            "client_id": card_id,
            "is_public": is_public,
            "tag_ids": tag_ids or [],
        }
        resp = api_client.post("/api/v1/photos", json=payload)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return factory


# ─── contract: field set, tags as names, envelope ──────────────────────────────


class TestContract:
    def test_item_field_set_and_tags_are_names(
        self, api_client, seed_photo, create_tag,
    ) -> None:
        card = _client_card(_unique_phone())
        t1 = create_tag(title="Детские")
        t2 = create_tag(title="Праздник")
        photo = seed_photo(card, tag_ids=[t1["id"], t2["id"]])
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
        # Spec «не входят»: client_id, client_name, service_id,
        # activity_id, location_id, updated_at.
        assert set(item) == {"id", "filename", "is_public", "tags", "created_at"}
        assert item["id"] == photo["id"]
        assert item["filename"] == photo["filename"]
        assert item["is_public"] is True
        # Tags resolve to NAMES (string[]) — no id-carrying objects.
        assert item["tags"] == sorted(["Детские", "Праздник"])
        # created_at — an ISO datetime string.
        datetime.fromisoformat(item["created_at"])

    def test_photo_without_tags_empty_list(
        self, api_client, seed_photo,
    ) -> None:
        card = _client_card(_unique_phone())
        seed_photo(card)
        _owner_of_card(api_client, card)
        assert api_client.get(MY_URL).json()["items"][0]["tags"] == []


# ─── publicity: no is_public filter on the cabinet list ────────────────────────


class TestPublicity:
    def test_non_public_returned_alongside_public(
        self, api_client, seed_photo,
    ) -> None:
        card = _client_card(_unique_phone())
        seed_photo(card, is_public=True)
        seed_photo(card, is_public=True)
        seed_photo(card, is_public=False)
        _owner_of_card(api_client, card)

        body = api_client.get(MY_URL).json()
        assert body["total"] == 3
        assert sorted(i["is_public"] for i in body["items"]) == [False, True, True]


# ─── sorting: fixed, deterministic ─────────────────────────────────────────────


class TestSorting:
    def test_created_at_desc_then_id_asc(self, api_client) -> None:
        card = _client_card(_unique_phone())
        jan = _insert_photo(card, "2026-01-01 10:00:00")
        mar_a = _insert_photo(card, "2026-03-01 10:00:00")
        feb = _insert_photo(card, "2026-02-01 10:00:00")
        mar_b = _insert_photo(card, "2026-03-01 10:00:00")  # tie with mar_a
        _owner_of_card(api_client, card)

        items = api_client.get(MY_URL).json()["items"]
        expected = [*sorted([mar_a, mar_b]), feb, jan]
        assert [i["id"] for i in items] == expected


# ─── pagination: envelope mechanics + the shared 422 canon ─────────────────────


class TestPagination:
    def test_page_slices_and_beyond_is_empty(self, api_client, seed_photo) -> None:
        card = _client_card(_unique_phone())
        for _ in range(3):
            seed_photo(card)
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
    def test_invalid_params_422(self, api_client, seed_photo, params: dict) -> None:
        card = _client_card(_unique_phone())
        seed_photo(card)
        _owner_of_card(api_client, card)

        resp = api_client.get(MY_URL, params=params)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    def test_id_narrowing_within_owner_scope(self, api_client, seed_photo) -> None:
        """The inherited machine ``?id=`` filter narrows inside the owner
        filter: own id → 1 row; a foreign photo's id → 200 + empty."""
        card_a = _client_card(_unique_phone())
        keep = seed_photo(card_a)
        seed_photo(card_a)
        card_b = _client_card(_unique_phone())
        foreign = seed_photo(card_b)
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

    def test_cardless_account_empty_list_never_ownerless(
        self, api_client,
    ) -> None:
        """A cardless account owns nothing — 200 empty; owner-less
        photos (client_id NULL, legal per domain) belong to no one and
        must never leak into any cabinet list."""
        _insert_photo(None, "2026-01-01 10:00:00")
        assert query_db("SELECT COUNT(*) AS n FROM photos")[0]["n"] == 1
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
    def test_second_client_invisible_both_ways(
        self, api_client, seed_photo,
    ) -> None:
        card_a = _client_card(_unique_phone())
        a1 = seed_photo(card_a)
        a2 = seed_photo(card_a)
        card_b = _client_card(_unique_phone())
        b1 = seed_photo(card_b)
        # Owner-less photo — invisible to everyone's cabinet.
        ownerless = api_client.post("/api/v1/photos", json={
            "filename": "orphan.jpg", "is_public": True, "tag_ids": [],
        })
        assert ownerless.status_code == 201, ownerless.text

        _owner_of_card(api_client, card_a)
        body_a = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_a["items"]} == {a1["id"], a2["id"]}
        assert body_a["total"] == 2

        _owner_of_card(api_client, card_b)
        body_b = api_client.get(MY_URL).json()
        assert {i["id"] for i in body_b["items"]} == {b1["id"]}
        assert body_b["total"] == 1
