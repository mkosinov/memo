"""GH #499 (spec §5) — client booking: POST /api/v1/my/records contract.

The session-based branch of the record-creation scenario: the owner comes
ONLY from the client session (``require_client_session`` → the account's
``client_id``), visit prices are computed SERVER-side from the service's
tariffs (one query), and the wire carries no privileged fields
(``MyRecordCreate`` is ``extra="forbid"`` — no ``client_id``/``visitor_id``/
``price``/``custom_price``/``notify``/``status``).

Covered (spec §6 US-1/US-2/US-3/US-6):
- happy path: owner from session, prices from tariffs, anonymous visits,
  response ``{id, activity_id, start, comment, visits[{name, age,
  tariff_id, price}]}`` — no service fields;
- tariff-free service: price 0, no ``tariff_id`` needed (US-2);
- refusals: 401 (no/foreign session), 403 (Sec-Fetch-Site / Origin lines),
  404 (activity), 409 (capacity), 422 (PHONE_INVALID / TARIFF_REQUIRED /
  TARIFF_NOT_FOUND / extra fields / visits 1..20), 429 (anti-spam);
- anti-spam counters: 20 records / 40 visits per account per 15 min,
  registered only on success, isolated per account.

Spec: docs/specs/2026-10-20-web-client-auth-booking-design.md §5
Domain rules: docs/domain-rules/records.md («Business Logic → Backend»,
session-based branch), docs/domain-rules/auth.md («Клиентская
аутентификация (#499)», «CSRF Posture»)
"""

from __future__ import annotations

import secrets
from datetime import datetime

import pytest

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

CLIENT_PHONE = "+79995557701"
MY_RECORDS_URL = "/api/v1/my/records"


# ─── helpers (conftest direct-SQL pattern, test_client_session_api) ────────────


def _insert_tariff(service_id: str, title: str, price: int) -> str:
    """Direct-SQL tariff row → id (no tariff API exists; sample_tariff pattern)."""
    tariff_id = f"tariff-{secrets.token_hex(8)}"
    query_db_params(
        "INSERT INTO tariffs (id, service_id, title, price, is_active, "
        "created_at, updated_at) "
        "VALUES (:id, :svc, :title, :price, 1, datetime('now'), datetime('now'))",
        {"id": tariff_id, "svc": service_id, "title": title, "price": price},
    )
    return tariff_id


def _client_card(phone: str) -> str:
    """Active client card with this phone → id."""
    card_id = secrets.token_hex(16)
    query_db_params(
        "INSERT INTO clients (id, name, phone, is_active, created_at, updated_at) "
        "VALUES (:id, :name, :phone, 1, datetime('now'), datetime('now'))",
        {"id": card_id, "name": "Анна Клиент", "phone": phone},
    )
    return card_id


def _owner(api_client, phone: str = CLIENT_PHONE) -> dict:
    """Client account + linked card + live client session on the jar."""
    card_id = _client_card(phone)
    user = insert_user(phone, None, role="client")
    query_db_params(
        "UPDATE users SET client_id = :card WHERE id = :user",
        {"card": card_id, "user": user["id"]},
    )
    token = secrets.token_urlsafe(32)
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user["id"]},
    )
    api_client.cookies.clear()
    api_client.cookies.set("memo_client_session", token)
    user["card_id"] = card_id
    return user


def _record_rows(record_id: str) -> list[dict]:
    return query_db(f"SELECT * FROM records WHERE id = '{record_id}'")


def _visit_rows(record_id: str) -> list[dict]:
    return query_db(
        f"SELECT * FROM visits WHERE record_id = '{record_id}' "
        f"ORDER BY created_at, id"
    )


# ─── fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_my_booking_counters():
    """Isolate the module-level in-memory counter store between tests."""
    from src.auth import service as service_module

    service_module._FAILURE_COUNTERS.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()


@pytest.fixture
def pinned_origins(monkeypatch):
    """A concrete CORS list (tests must not depend on the env file's list)."""
    from src.core.config import settings

    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://localhost:3000"])


@pytest.fixture
def tariff_activity(create_activity) -> dict:
    """Activity whose service carries two tariffs."""
    activity = create_activity()
    activity["tariff_adult"] = _insert_tariff(activity["service_id"], "Взрослый", 3500)
    activity["tariff_kid"] = _insert_tariff(activity["service_id"], "Детский", 2500)
    return activity


@pytest.fixture
def free_activity(create_activity) -> dict:
    """Activity whose service has NO tariffs («Стоимость уточняется»)."""
    return create_activity()


def _booking_payload(activity: dict, **overrides) -> dict:
    payload = {
        "activity_id": activity["id"],
        "phone": CLIENT_PHONE,
        "comment": "Хочу на мастер-класс",
        "visits": [
            {"name": "Анна", "age": 30, "tariff_id": activity["tariff_adult"]},
            {"tariff_id": activity["tariff_kid"]},
        ],
        **overrides,
    }
    return payload


# ─── US-1: happy path — owner from session, prices from tariffs ────────────────


class TestHappyPath:
    def test_full_contract(self, api_client, tariff_activity) -> None:
        owner = _owner(api_client)

        resp = api_client.post(MY_RECORDS_URL, json=_booking_payload(tariff_activity))
        assert resp.status_code == 201, resp.text
        body = resp.json()

        # Response shape: exactly the spec §5 fields, nothing service-level.
        assert set(body) == {"id", "activity_id", "start", "comment", "visits"}
        assert body["activity_id"] == tariff_activity["id"]
        assert body["comment"] == "Хочу на мастер-класс"
        for visit in body["visits"]:
            assert set(visit) == {"name", "age", "tariff_id", "price"}

        # `start` — the activity's date, byte-identical to the activity read.
        activity_resp = api_client.get(f"/api/v1/activities/{tariff_activity['id']}")
        assert body["start"] == activity_resp.json()["start"]

        # Named + anonymous visits, prices from the tariffs.
        by_tariff = {v["tariff_id"]: v for v in body["visits"]}
        adult = by_tariff[tariff_activity["tariff_adult"]]
        kid = by_tariff[tariff_activity["tariff_kid"]]
        assert adult == {"name": "Анна", "age": 30,
                         "tariff_id": tariff_activity["tariff_adult"], "price": 3500}
        assert kid == {"name": None, "age": None,
                       "tariff_id": tariff_activity["tariff_kid"], "price": 2500}

        # DB: the owner is the session's card; seats/status derived.
        rows = _record_rows(body["id"])
        assert len(rows) == 1
        assert rows[0]["client_id"] == owner["card_id"]
        assert rows[0]["seats"] == 2
        assert rows[0]["status"] == "waiting"
        assert rows[0]["notify"] == 0, "client branch never opts into mailings"

        visits = _visit_rows(body["id"])
        assert len(visits) == 2
        prices = {v["tariff_id"]: v["price"] for v in visits}
        assert prices == {
            tariff_activity["tariff_adult"]: 3500,
            tariff_activity["tariff_kid"]: 2500,
        }

        # Visitor resolution: named → find-or-create under the OWNER card;
        # anonymous → visitor_id NULL (existing semantics).
        visitors = query_db(
            f"SELECT * FROM visitors WHERE client_id = '{owner['card_id']}'"
        )
        assert len(visitors) == 1
        assert visitors[0]["name"] == "Анна"
        assert visitors[0]["age"] == 30
        assert any(v["visitor_id"] is None for v in visits)

    def test_comment_optional_defaults_null(self, api_client, tariff_activity) -> None:
        _owner(api_client)
        payload = _booking_payload(tariff_activity)
        del payload["comment"]

        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 201, resp.text
        assert resp.json()["comment"] is None

    def test_single_anonymous_visit_allowed(
        self, api_client, tariff_activity,
    ) -> None:
        """US-1 minimal shape: one anonymous seat on a tariff counter."""
        _owner(api_client)
        payload = _booking_payload(
            tariff_activity,
            visits=[{"tariff_id": tariff_activity["tariff_adult"]}],
        )
        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 201, resp.text
        assert resp.json()["visits"] == [{
            "name": None, "age": None,
            "tariff_id": tariff_activity["tariff_adult"], "price": 3500,
        }]


# ─── US-2: tariff-free service — price 0, no tariff_id needed ──────────────────


class TestTariffFreeService:
    def test_no_tariffs_price_zero(self, api_client, free_activity) -> None:
        _owner(api_client)
        payload = {
            "activity_id": free_activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [{}, {"name": "Борис", "age": 8}],
        }

        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert {v["price"] for v in body["visits"]} == {0}
        assert all(v["tariff_id"] is None for v in body["visits"])

        rows = _visit_rows(body["id"])
        assert {v["price"] for v in rows} == {0}

    def test_paid_service_requires_tariff(
        self, api_client, tariff_activity,
    ) -> None:
        """A service WITH tariffs: a visit without tariff_id → 422
        TARIFF_REQUIRED (zero price of a paid service is unreachable)."""
        _owner(api_client)
        payload = _booking_payload(
            tariff_activity,
            visits=[{"name": "Анна"}, {"tariff_id": tariff_activity["tariff_kid"]}],
        )

        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.TARIFF_REQUIRED.value
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 0

    def test_foreign_tariff_rejected(
        self, api_client, tariff_activity, create_activity,
    ) -> None:
        """A tariff of ANOTHER service → 422 TARIFF_NOT_FOUND."""
        # The other activity must be built BEFORE _owner wipes the admin
        # jar (create_activity rides the staff session).
        other = create_activity()
        _owner(api_client)
        foreign = _insert_tariff(other["service_id"], "Чужой", 999)

        payload = _booking_payload(tariff_activity, visits=[{"tariff_id": foreign}])
        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.TARIFF_NOT_FOUND.value
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 0

    def test_tariff_on_tariff_free_service_rejected(
        self, api_client, tariff_activity, free_activity,
    ) -> None:
        """A tariff-free service + a tariff_id (any tariff is foreign to it)
        → 422 TARIFF_NOT_FOUND — price 0 is the only reachable price."""
        _owner(api_client)
        payload = {
            "activity_id": free_activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [{"tariff_id": tariff_activity["tariff_adult"]}],
        }
        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.TARIFF_NOT_FOUND.value


# ─── guards: session, Sec-Fetch-Site, Origin (CSRF Posture) ────────────────────


class TestGuards:
    def test_no_cookie_401(self, api_client, tariff_activity) -> None:
        api_client.cookies.clear()
        resp = api_client.post(MY_RECORDS_URL, json=_booking_payload(tariff_activity))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_staff_session_not_accepted_401(
        self, api_client, tariff_activity,
    ) -> None:
        """The jar holds a LIVE staff ``memo_session`` — the client resolver
        reads only ``memo_client_session`` → 401."""
        resp = api_client.post(MY_RECORDS_URL, json=_booking_payload(tariff_activity))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_cross_site_sec_fetch_403(self, api_client, tariff_activity) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL,
            json=_booking_payload(tariff_activity),
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_same_site_sec_fetch_passes(
        self, api_client, tariff_activity,
    ) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL,
            json=_booking_payload(tariff_activity),
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        assert resp.status_code == 201, resp.text

    def test_foreign_origin_403(
        self, api_client, tariff_activity, pinned_origins,
    ) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL,
            json=_booking_payload(tariff_activity),
            headers={"Origin": "https://evil.example"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 0

    def test_listed_origin_accepted(
        self, api_client, tariff_activity, pinned_origins,
    ) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL,
            json=_booking_payload(tariff_activity),
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 201, resp.text


# ─── US-6: schema strictness — extra fields, bounds, phone ─────────────────────


class TestSchemaRejections:
    @pytest.mark.parametrize("field", [
        "client_id", "custom_price", "notify", "status", "price",
    ])
    def test_forbidden_top_level_fields(
        self, api_client, tariff_activity, field: str,
    ) -> None:
        """The wire never carries privileged record fields — extra=forbid."""
        _owner(api_client)
        payload = _booking_payload(tariff_activity)
        payload[field] = "whatever" if field != "notify" else True

        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    @pytest.mark.parametrize("field", [
        "visitor_id", "price", "custom_price", "status",
    ])
    def test_forbidden_visit_fields(
        self, api_client, tariff_activity, field: str,
    ) -> None:
        _owner(api_client)
        payload = _booking_payload(tariff_activity)
        payload["visits"][0][field] = "x"

        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.VALIDATION_ERROR.value

    def test_empty_visits_422(self, api_client, tariff_activity) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL, json=_booking_payload(tariff_activity, visits=[]),
        )
        assert resp.status_code == 422

    def test_over_20_visits_422(self, api_client, tariff_activity) -> None:
        _owner(api_client)
        visits = [{"tariff_id": tariff_activity["tariff_kid"]}] * 21
        resp = api_client.post(
            MY_RECORDS_URL, json=_booking_payload(tariff_activity, visits=visits),
        )
        assert resp.status_code == 422

    def test_phone_missing_422(self, api_client, tariff_activity) -> None:
        _owner(api_client)
        payload = _booking_payload(tariff_activity)
        del payload["phone"]
        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 422

    @pytest.mark.parametrize("phone", ["   ", "9" * 21])
    def test_phone_invalid_domain_code(
        self, api_client, tariff_activity, phone: str,
    ) -> None:
        _owner(api_client)
        resp = api_client.post(
            MY_RECORDS_URL, json=_booking_payload(tariff_activity, phone=phone),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == ErrorCode.PHONE_INVALID.value

    def test_activity_id_missing_422(self, api_client) -> None:
        _owner(api_client)
        resp = api_client.post(MY_RECORDS_URL, json={"phone": CLIENT_PHONE, "visits": [{}]})
        assert resp.status_code == 422


# ─── inherited scenario checks: 404 activity, 409 capacity ─────────────────────


class TestScenarioChecks:
    def test_missing_activity_404(self, api_client) -> None:
        _owner(api_client)
        resp = api_client.post(MY_RECORDS_URL, json={
            "activity_id": "00000000-0000-0000-0000-000000000000",
            "phone": CLIENT_PHONE,
            "visits": [{}],
        })
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == ErrorCode.ACTIVITY_NOT_FOUND.value

    def test_capacity_exceeded_409(
        self, api_client, create_activity,
    ) -> None:
        activity = create_activity(capacity=1)
        activity["tariff_adult"] = _insert_tariff(activity["service_id"], "Взрослый", 3500)
        _owner(api_client)

        resp = api_client.post(MY_RECORDS_URL, json={
            "activity_id": activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [
                {"tariff_id": activity["tariff_adult"]},
                {"tariff_id": activity["tariff_adult"]},
            ],
        })
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == ErrorCode.ACTIVITY_AT_CAPACITY.value
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 0


# ─── anti-spam: 20 records / 40 visits per account per 15 minutes ──────────────


class TestAntiSpam:
    def _store(self) -> dict:
        from src.auth import service as service_module

        return service_module._FAILURE_COUNTERS

    def test_21st_record_429(self, api_client, free_activity) -> None:
        owner = _owner(api_client)
        self._store()[f"mybook:records:{owner['id']}"] = (20, datetime.utcnow())

        resp = api_client.post(MY_RECORDS_URL, json={
            "activity_id": free_activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [{}],
        })
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in {h.lower() for h in resp.headers}
        assert query_db("SELECT COUNT(*) AS n FROM records")[0]["n"] == 0

    def test_visits_projection_429(self, api_client, free_activity) -> None:
        """A request that would push the account OVER 40 total visits is
        rejected whole (39 done + 2 new = 41 → 429), one visit still fits."""
        owner = _owner(api_client)
        self._store()[f"mybook:visits:{owner['id']}"] = (39, datetime.utcnow())

        payload = {
            "activity_id": free_activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [{}, {}],
        }
        assert api_client.post(MY_RECORDS_URL, json=payload).status_code == 429

        payload["visits"] = [{}]
        resp = api_client.post(MY_RECORDS_URL, json=payload)
        assert resp.status_code == 201, resp.text

    def test_successful_booking_registers_counters(
        self, api_client, tariff_activity,
    ) -> None:
        owner = _owner(api_client)
        first = api_client.post(MY_RECORDS_URL, json=_booking_payload(tariff_activity))
        assert first.status_code == 201, first.text

        store = self._store()
        assert store[f"mybook:records:{owner['id']}"][0] == 1
        assert store[f"mybook:visits:{owner['id']}"][0] == 2

    def test_counters_isolated_per_account(
        self, api_client, free_activity,
    ) -> None:
        """Another account's tripped wires never block this one."""
        _owner(api_client)
        self._store()["mybook:records:someone-else"] = (20, datetime.utcnow())
        self._store()["mybook:visits:someone-else"] = (40, datetime.utcnow())

        resp = api_client.post(MY_RECORDS_URL, json={
            "activity_id": free_activity["id"],
            "phone": CLIENT_PHONE,
            "visits": [{}],
        })
        assert resp.status_code == 201, resp.text
