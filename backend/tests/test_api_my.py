"""GH #262 Task 1 — GET/PUT /api/v1/my (self-service «Мои данные»).

Covers the plan RED list (spec §3.1/§4, D3/D7, domain-rules/profile.md):

* GET flat profile exactly per §4 (role, has_staff, has_master, card
  names/avatar, specialties array from the master-section CSV, private
  fields);
* ``has_staff=false`` for a user without a card OR with an archived card
  (names null; name writes ignored in that state);
* ``has_master=false`` when the master section is absent/archived
  (specialties null);
* PUT semantics: omitted key = keep, explicit null = clear;
* first/last name required when present (no null/empty) → written to the
  staff card;
* ``specialties`` in the PUT body ignored (read-only, #266 D5);
* lazy ``user_profiles`` creation (no pre-seeding, not even on GET);
* ONE transaction: staff fields + profile fields (a failed PUT persists
  nothing);
* emits the EXISTING ``staff`` SSE entity (never a ``user_profiles`` one);
* public GET /api/v1/masters (and /api/v1/staff) key sets contain none of
  the private field keys.
"""

import uuid

import pytest

from src.auth.passwords import hash_password
from src.events.hub import hub
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.api

MY_PASSWORD = "my-pass-123"

#: Private half of the flat profile (spec §3.1) — must never appear as a
#: key in any public serializer.
PRIVATE_KEYS = {
    "patronymic",
    "birth_date",
    "residence_address",
    "birth_place",
    "passport_series_number",
    "passport_issued_date",
    "passport_issued_by",
    "registration_address",
}

_FULL_PROFILE_SHAPE = {
    "role",
    "has_staff",
    "has_master",
    "first_name",
    "last_name",
    "avatar_url",
    "specialties",
    *PRIVATE_KEYS,
}


@pytest.fixture(scope="module")
def _my_hash() -> str:
    """Hash the test password once per module (Argon2 is slow)."""
    return hash_password(MY_PASSWORD)


@pytest.fixture
def anon(app, db_engine):
    """Unauthenticated TestClient (401/privacy probes)."""
    from fastapi.testclient import TestClient

    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def subscriber():
    """Subscribe to the SSE hub for ONE test; drain on exit."""
    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


def _drain(q) -> list[tuple[set[str], object]]:
    events: list[tuple[set[str], object]] = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


def _make_staff_user(
    api_client,
    login_as,
    _my_hash,
    *,
    with_master: bool = True,
    archive_card: bool = False,
    archive_section: bool = False,
    role: str = "master",
):
    """Create a staff card (+ optional master section) and a linked login.

    Returns ``(client, staff_id)``. ``archive_card`` flips ONLY the person
    flag (archive_master/archive_user unchecked) so the card-archive tests
    stay independent of the section/user flags.
    """
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    card: dict = {"first_name": "Мария", "last_name": "Иванова"}
    if with_master:
        card["master"] = {"specialty": "живопись, керамика", "color": "#5B8C7A"}
    resp = api_client.post("/api/v1/staff", json=card)
    assert resp.status_code == 201, resp.text
    staff_id = resp.json()["id"]

    if archive_section:
        section = {"specialty": "живопись, керамика", "color": "#5B8C7A", "archived": True}
        resp = api_client.patch(f"/api/v1/staff/{staff_id}", json={"master": section})
        assert resp.status_code == 200, resp.text
    if archive_card:
        resp = api_client.post(
            f"/api/v1/staff/{staff_id}/archive",
            json={"archive_master": False, "archive_user": False},
        )
        assert resp.status_code == 200, resp.text

    insert_user(phone, _my_hash, role=role, master_id=staff_id)
    return login_as(phone, MY_PASSWORD), staff_id


def _make_cardless_user(login_as, _my_hash, *, role: str = "admin"):
    """A user with NO staff card (pure admin / D7 «Аноним» case)."""
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    insert_user(phone, _my_hash, role=role)
    return login_as(phone, MY_PASSWORD)


def _user_id(client) -> str:
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    return me.json()["user"]["id"]


# ─── GET /api/v1/my ────────────────────────────────────────────────────────────


class TestGetMyProfile:
    def test_flat_shape_with_card_and_section(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Exact §4 response: card names, specialties array, private fields."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={
            "patronymic": "Петровна",
            "birth_date": "1990-05-01",
            "residence_address": "ул. Ленина, 1",
            "birth_place": "Москва",
            "passport_series_number": "4510 123456",
            "passport_issued_date": "2010-06-15",
            "passport_issued_by": "ОВД Москвы",
            "registration_address": "ул. Тверская, 5",
        })
        assert resp.status_code == 200, resp.text

        body = client.get("/api/v1/my").json()
        assert set(body.keys()) == _FULL_PROFILE_SHAPE
        assert body == {
            "role": "master",
            "has_staff": True,
            "has_master": True,
            "first_name": "Мария",
            "last_name": "Иванова",
            "avatar_url": None,
            "specialties": ["живопись", "керамика"],
            "patronymic": "Петровна",
            "birth_date": "1990-05-01",
            "residence_address": "ул. Ленина, 1",
            "birth_place": "Москва",
            "passport_series_number": "4510 123456",
            "passport_issued_date": "2010-06-15",
            "passport_issued_by": "ОВД Москвы",
            "registration_address": "ул. Тверская, 5",
        }

    def test_requires_session(self, anon) -> None:
        assert anon.get("/api/v1/my").status_code == 401

    def test_cardless_user(
        self, api_client, login_as, _my_hash
    ) -> None:
        """No card → has_staff/has_master false, public half all null."""
        client = _make_cardless_user(login_as, _my_hash)
        body = client.get("/api/v1/my").json()
        assert body["role"] == "admin"
        assert body["has_staff"] is False
        assert body["has_master"] is False
        assert body["first_name"] is None
        assert body["last_name"] is None
        assert body["avatar_url"] is None
        assert body["specialties"] is None
        assert all(body[k] is None for k in PRIVATE_KEYS)

    def test_archived_card_counts_as_no_staff(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Archived card → has_staff=false even with a live master section."""
        client, _sid = _make_staff_user(
            api_client, login_as, _my_hash, archive_card=True
        )
        body = client.get("/api/v1/my").json()
        assert body["has_staff"] is False
        assert body["has_master"] is False
        assert body["first_name"] is None
        assert body["last_name"] is None
        assert body["avatar_url"] is None
        assert body["specialties"] is None

    def test_no_master_section(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Card without the extension → has_master=false, specialties null."""
        client, _sid = _make_staff_user(
            api_client, login_as, _my_hash, with_master=False, role="admin"
        )
        body = client.get("/api/v1/my").json()
        assert body["has_staff"] is True
        assert body["has_master"] is False
        assert body["first_name"] == "Мария"
        assert body["specialties"] is None

    def test_archived_master_section(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Archived section → has_master=false, names still present."""
        client, _sid = _make_staff_user(
            api_client, login_as, _my_hash, archive_section=True
        )
        body = client.get("/api/v1/my").json()
        assert body["has_staff"] is True
        assert body["has_master"] is False
        assert body["specialties"] is None
        assert body["first_name"] == "Мария"

    def test_get_does_not_create_profile_row(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Lazy creation: GET (and only a private-field PUT) never seeds rows."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        client.get("/api/v1/my")
        rows = query_db("SELECT COUNT(*) AS n FROM user_profiles")
        assert rows[0]["n"] == 0

    def test_user_deleted_after_login_gets_401_not_500(
        self, api_client, login_as, _my_hash
    ) -> None:
        """A session outliving its user row (deleted server-side) gets the
        auth-guard 401 envelope on /my — never an assert crash or 500."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        user_id = _user_id(client)
        query_db(f"DELETE FROM users WHERE id = '{user_id}'")

        resp = client.get("/api/v1/my")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "AUTH_UNAUTHORIZED"


# ─── PUT /api/v1/my ────────────────────────────────────────────────────────────


class TestPutMyProfile:
    def test_requires_session(self, anon) -> None:
        resp = anon.put("/api/v1/my", json={"patronymic": "X"})
        assert resp.status_code == 401

    def test_cross_site_fetch_rejected(
        self, api_client, login_as, _my_hash
    ) -> None:
        """PUT carries verify_fetch_metadata: Sec-Fetch-Site: cross-site → 403."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put(
            "/api/v1/my",
            json={"patronymic": "X"},
            headers={"sec-fetch-site": "cross-site"},
        )
        assert resp.status_code == 403

    def test_omitted_key_keeps_value(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        client.put("/api/v1/my", json={"patronymic": "Петровна"})
        resp = client.put("/api/v1/my", json={"birth_place": "Москва"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["patronymic"] == "Петровна"  # omitted → kept
        assert body["birth_place"] == "Москва"

    def test_explicit_null_clears(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        client.put("/api/v1/my", json={
            "patronymic": "Петровна",
            "residence_address": "ул. Ленина, 1",
        })
        resp = client.put("/api/v1/my", json={"patronymic": None})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["patronymic"] is None  # explicit null → cleared
        assert body["residence_address"] == "ул. Ленина, 1"  # omitted → kept

    def test_names_required_when_present_null(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Explicit null on a NOT-NULL card column → 422 (null clears only
        nullable columns)."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={"first_name": None})
        assert resp.status_code == 422
        assert client.get("/api/v1/my").json()["first_name"] == "Мария"

    def test_names_required_when_present_empty(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={"last_name": ""})
        assert resp.status_code == 422

    def test_names_written_to_staff_card(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put(
            "/api/v1/my", json={"first_name": "Жанна", "last_name": "Петрова"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["first_name"] == "Жанна"
        # The admin staff view sees the same card change.
        card = api_client.get(f"/api/v1/staff/{staff_id}").json()
        assert card["first_name"] == "Жанна"
        assert card["last_name"] == "Петрова"

    def test_name_writes_ignored_without_card(
        self, login_as, _my_hash
    ) -> None:
        """D7: no card → name writes ignored, private fields fully usable."""
        client = _make_cardless_user(login_as, _my_hash)
        resp = client.put(
            "/api/v1/my",
            json={"first_name": "Жанна", "last_name": "Петрова", "patronymic": "Сергеевна"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["has_staff"] is False
        assert body["first_name"] is None
        assert body["last_name"] is None
        assert body["patronymic"] == "Сергеевна"

    def test_name_writes_ignored_when_card_archived(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(
            api_client, login_as, _my_hash, archive_card=True
        )
        resp = client.put("/api/v1/my", json={"first_name": "Жанна"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["first_name"] is None

    def test_specialties_ignored_on_write(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Read-only: the admin owns specialty (#266 D5)."""
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put(
            "/api/v1/my", json={"specialties": ["керамика", "скетчинг"]}
        )
        assert resp.status_code == 200, resp.text
        rows = query_db(
            f"SELECT specialty FROM masters WHERE staff_id = '{staff_id}'"
        )
        assert rows[0]["specialty"] == "живопись, керамика"
        assert client.get("/api/v1/my").json()["specialties"] == [
            "живопись", "керамика",
        ]

    def test_lazy_profile_row_created_on_private_put(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={"patronymic": "Сергеевна"})
        assert resp.status_code == 200, resp.text
        user_id = _user_id(client)
        rows = query_db(
            f"SELECT patronymic FROM user_profiles WHERE user_id = '{user_id}'"
        )
        assert len(rows) == 1
        assert rows[0]["patronymic"] == "Сергеевна"

    def test_empty_body_changes_nothing(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={})
        assert resp.status_code == 200, resp.text
        rows = query_db("SELECT COUNT(*) AS n FROM user_profiles")
        assert rows[0]["n"] == 0

    def test_passport_series_number_normalized(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Trim + collapse inner whitespace runs on save (spec §3.1)."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put(
            "/api/v1/my", json={"passport_series_number": "  4510   123456 "}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["passport_series_number"] == "4510 123456"

    def test_avatar_url_write_and_clear(
        self, api_client, login_as, _my_hash
    ) -> None:
        """avatar_url rides the staff card: value writes, null clears."""
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put(
            "/api/v1/my", json={"avatar_url": "/api/v1/files/avatar/x.jpg"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar_url"] == "/api/v1/files/avatar/x.jpg"
        card = api_client.get(f"/api/v1/staff/{staff_id}").json()
        assert card["avatar_url"] == "/api/v1/files/avatar/x.jpg"

        resp = client.put("/api/v1/my", json={"avatar_url": None})
        assert resp.status_code == 200, resp.text
        assert resp.json()["avatar_url"] is None

    def test_single_transaction_all_or_nothing(
        self, api_client, login_as, _my_hash
    ) -> None:
        """A failed PUT persists NOTHING: no staff change, no profile row."""
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.put("/api/v1/my", json={
            "first_name": "Жанна",          # valid card write
            "patronymic": "Петровна",       # valid private write
            "last_name": None,              # invalid → whole tx rolls back
        })
        assert resp.status_code == 422
        rows = query_db(
            f"SELECT first_name FROM staff WHERE id = '{staff_id}'"
        )
        assert rows[0]["first_name"] == "Мария"
        rows = query_db("SELECT COUNT(*) AS n FROM user_profiles")
        assert rows[0]["n"] == 0
        assert client.get("/api/v1/my").json()["patronymic"] is None


    def test_single_transaction_injected_failure_rolls_back_everything(
        self, api_client, login_as, _my_hash, monkeypatch
    ) -> None:
        """Atomicity proven at the seam: a crash AFTER the staff write +
        lazy-profile flush (but before commit) rolls back BOTH halves —
        one @transactional unit (spec §4)."""
        from fastapi import HTTPException

        from src.services import profile as profile_module

        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)

        def _boom(*args, **kwargs):
            # Handled exception → 500 response in-band (a bare RuntimeError
            # would be re-raised by TestClient past the ServerError
            # middleware); the rollback path is identical.
            raise HTTPException(status_code=500, detail="boom after writes")

        monkeypatch.setattr(profile_module.ProfileService, "_to_response", _boom)

        resp = client.put("/api/v1/my", json={
            "first_name": "Жанна", "patronymic": "Петровна",
        })
        assert resp.status_code == 500
        rows = query_db(
            f"SELECT first_name FROM staff WHERE id = '{staff_id}'"
        )
        assert rows[0]["first_name"] == "Мария"
        rows = query_db("SELECT COUNT(*) AS n FROM user_profiles")
        assert rows[0]["n"] == 0


# ─── SSE emit (existing `staff` entity only) ──────────────────────────────────


class TestSseEmit:
    def test_put_emits_existing_staff_entity(
        self, api_client, login_as, _my_hash, subscriber
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        _drain(subscriber)  # discard setup events (card/section writes)
        resp = client.put("/api/v1/my", json={"first_name": "Жанна"})
        assert resp.status_code == 200, resp.text

        events = _drain(subscriber)
        entities = {entity for es, _origin in events for entity in es}
        assert "staff" in entities
        assert "user_profiles" not in entities

    def test_private_only_put_still_emits_staff(
        self, api_client, login_as, _my_hash, subscriber
    ) -> None:
        """One @transactional method → one `staff` event even when only the
        private half changed (spec §4: the method emits the staff event)."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        _drain(subscriber)  # discard setup events (card/section writes)
        resp = client.put("/api/v1/my", json={"patronymic": "Петровна"})
        assert resp.status_code == 200, resp.text

        events = _drain(subscriber)
        assert events, "expected at least one published event"
        for entities, _origin in events:
            assert "user_profiles" not in entities
        assert any("staff" in entities for entities, _ in events)

    def test_get_emits_nothing(
        self, api_client, login_as, _my_hash, subscriber
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        _drain(subscriber)  # discard setup events (card/section writes)
        client.get("/api/v1/my")
        assert _drain(subscriber) == []


# ─── Public/private boundary (D3 — structural) ────────────────────────────────


def _collect_keys(node: object, acc: set) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            acc.add(key)
            _collect_keys(value, acc)
    elif isinstance(node, list):
        for item in node:
            _collect_keys(item, acc)


class TestPublicBoundary:
    def test_public_masters_leak_no_private_keys(
        self, api_client, login_as, _my_hash, anon
    ) -> None:
        """Anonymous GET /masters: no private field key anywhere (S4)."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        client.put("/api/v1/my", json={
            "patronymic": "Петровна",
            "passport_series_number": "4510 123456",
            "registration_address": "ул. Тверская, 5",
        })
        resp = anon.get("/api/v1/masters")
        assert resp.status_code == 200, resp.text
        keys: set = set()
        _collect_keys(resp.json(), keys)
        assert not (keys & PRIVATE_KEYS), keys & PRIVATE_KEYS

    def test_staff_view_leaks_no_private_keys(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Guarded GET /staff (admin) carries the card, never the profile."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        client.put("/api/v1/my", json={"patronymic": "Петровна"})
        resp = api_client.get("/api/v1/staff")
        assert resp.status_code == 200, resp.text
        keys: set = set()
        _collect_keys(resp.json(), keys)
        assert not (keys & PRIVATE_KEYS), keys & PRIVATE_KEYS
