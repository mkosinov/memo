"""GH #247 T7 — per-router guard matrix: default-deny on the real routers.

Spec §3.7's access matrix exercised end-to-end through the real app:

* anonymous → 401 ``AUTH_UNAUTHORIZED`` on a representative guarded
  endpoint of EVERY router (incl. ``GET /api/v1/events`` — SSE transport,
  session-guarded by the architect ruling; and user-settings);
* admin → 2xx on the same endpoints (``api_client`` is the authenticated
  fixture admin, GH #247 T6);
* master → 2xx where the role matrix grants access; 403
  ``AUTH_FORBIDDEN`` on ``payments:write`` / ``materials:*`` /
  ``clients:write`` (spec §2.5: read-only payments + clients, no
  materials);
* public surface intact (User Scenario 5): anonymous dictionary GETs →
  200 (incl. ``GET /api/v1/photos/web`` — the public gallery) and
  anonymous ``POST /api/v1/records`` → 201;
* Sec-Fetch-Site (User Scenario 6): an authenticated mutation with
  ``Sec-Fetch-Site: cross-site`` → 403; without the header → passes.

The route-level walk (every route guarded or allowlisted) lives in
``test_auth_contract.py``; this file pins the RUNTIME behavior.

Spec: docs/specs/2026-09-08-auth-design.md §2.5-2.7, §2.14, §3.7, §7
Domain rules: docs/domain-rules/auth.md
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from tests.conftest import insert_user
from tests.test_events_sse import SSEStream

pytestmark = pytest.mark.api

MASTER_PASSWORD = "master-pass-1"

# (label, method, path-template, minimal valid JSON body or None).
# One representative guarded endpoint per router (spec §3.7 matrix rows).
_GUARDED_ENDPOINTS: list[tuple[str, str, str, dict | None]] = [
    ("masters-write", "POST", "/api/v1/masters", {
        "first_name": "Гвард", "last_name": "Мастеров",
        "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
    }),
    ("masters-all-read", "GET", "/api/v1/masters/all", None),
    ("locations-write", "POST", "/api/v1/locations", {
        "name": "Гвард Студия", "address": "Гвард Адрес", "capacity": 20,
    }),
    ("services-write", "POST", "/api/v1/services", {
        "title": "Гвард Сервис", "description": "test",
        "image_url": "https://example.com/g.jpg", "specialty": "живопись",
        "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }),
    ("tags-write", "POST", "/api/v1/tags", {"tag": f"guard-{uuid.uuid4().hex[:8]}"}),
    ("activities-write", "POST", "/api/v1/activities", None),  # FK ids filled in-test
    ("photos-write", "POST", "/api/v1/photos", {"filename": f"g-{uuid.uuid4().hex[:8]}.jpg"}),
    ("records-read", "GET", "/api/v1/records", None),
    ("visits-read", "GET", "/api/v1/visits", None),
    ("visitors-read", "GET", "/api/v1/visitors", None),
    ("clients-read", "GET", "/api/v1/clients", None),
    ("payments-read", "GET", "/api/v1/payments", None),
    ("materials-read", "GET", "/api/v1/materials", None),
    ("user-settings-read", "GET", "/api/v1/user-settings", None),
    ("events-stream", "GET", "/api/v1/events", None),
]

#: Shared parametrize args for the anonymous/admin matrix classes (same
#: endpoint set, opposite expectations).
_ENDPOINT_PARAMS = pytest.mark.parametrize(
    "label,method,path,body",
    _GUARDED_ENDPOINTS,
    ids=[label for label, _, _, _ in _GUARDED_ENDPOINTS],
)

_PUBLIC_GETS = [
    "/api/v1/masters",
    "/api/v1/locations",
    "/api/v1/services",
    "/api/v1/tags",
    "/api/v1/activities",
    "/api/v1/photos",
    "/api/v1/photos/web",
    "/api/v1/health",
]


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (anonymous view).

    Not the shared ``api_client`` with a cleared jar: guard-matrix tests
    need BOTH views in one test — an authenticated client to seed parent
    rows (masters/services/… writes) and an anonymous one to probe guards.
    """
    from fastapi.testclient import TestClient

    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture(scope="module")
def _master_hash() -> str:
    """Hash the master password once per module (Argon2 is slow)."""
    return hash_password(MASTER_PASSWORD)


@pytest.fixture
def master_client(api_client, _master_hash, login_as):
    """A client logged in as a master-role user (fresh row per test).

    Phone is unique per test (users.phone UNIQUE; the conftest truncate
    wipes rows between tests but module-scoped sessions may outlive single
    rows — fresh rows keep it robust).
    """
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    insert_user(phone, _master_hash, role="master")
    client = login_as(phone, MASTER_PASSWORD)
    yield client
    client.cookies.clear()


def _request(client, method: str, path: str, json_body=None):
    if method == "GET":
        return client.get(path)
    return client.request(method, path, json=json_body)


def _cookie_header(client) -> str | None:
    """``memo_session=<token>`` from a TestClient's cookie jar, or None."""
    token = client.cookies.get("memo_session")
    return f"memo_session={token}" if token else None


def _fill_activity_body(api_client, label: str, body: dict | None) -> dict | None:
    """Resolve the request body for ``label``; POST /activities needs real
    FK ids (its table entry carries ``None``) — create master/service/
    location via the authenticated client and build the payload."""
    if label != "activities-write":
        return body
    master = api_client.post("/api/v1/masters", json={
        "first_name": "Гв", "last_name": "Masterov", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Гв Сервис", "description": "t",
        "image_url": "https://example.com/g.jpg", "specialty": "живопись",
        "min_age": 6, "max_age": 99, "duration": 90, "record_info": "t",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Гв Студия", "address": "Гв Адрес", "capacity": 20,
    }).json()
    from datetime import UTC, datetime, timedelta
    return {
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    }


# ─── anonymous → 401 on every guarded router (User Scenario 5) ─────────────────


class TestAnonymousGetsUnauthorized:
    @_ENDPOINT_PARAMS
    async def test_guarded_endpoint_rejects_anonymous(
        self, app, anon_client, api_client, label, method, path, body,
    ) -> None:
        body = _fill_activity_body(api_client, label, body)
        if label == "events-stream":
            # SSEStream (shared with test_events_sse): raw-ASGI, bounded —
            # TestClient deadlocks on infinite SSE bodies.
            async with SSEStream(app) as stream:
                await stream.wait_frame("AUTH_UNAUTHORIZED")
                assert stream.status == 401
            return
        resp = _request(anon_client, method, path, body)
        assert resp.status_code == 401, f"{method} {path}: {resp.text}"
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


# ─── admin → 2xx on the same endpoints (matrix column «admin») ─────────────────


class TestAdminPasses:
    @_ENDPOINT_PARAMS
    async def test_guarded_endpoint_accepts_admin(
        self, app, api_client, label, method, path, body,
    ) -> None:
        body = _fill_activity_body(api_client, label, body)
        if label == "user-settings-read":
            # Own-only (spec §3.8): no ?user_id= param — create the
            # session user's row, then a plain GET must return 200.
            me = api_client.get("/api/v1/auth/me").json()["user"]["id"]
            created = api_client.post("/api/v1/user-settings", json={"user_id": me})
            assert created.status_code == 201, created.text
            resp = api_client.get(path)
            assert resp.status_code == 200, resp.text
            return
        if label == "events-stream":
            async with SSEStream(app, _cookie_header(api_client)) as stream:
                await stream.wait_frame("event: ready")
                assert stream.status == 200
            return
        resp = _request(api_client, method, path, body)
        assert resp.status_code < 400, f"{method} {path}: {resp.text}"


# ─── master → allowed reads/writes 2xx, forbidden writes 403 (Scenario 6) ──────


class TestMasterMatrix:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/records",          # records:read + write (full)
            "/api/v1/visits",           # visits:read + write (full)
            "/api/v1/visitors",         # visitors:read + write (full)
            "/api/v1/clients",          # clients:read (read-only)
            "/api/v1/payments",         # payments:read (мастер видит, что оплачено)
            "/api/v1/masters/all",      # dictionaries:read
        ],
    )
    def test_master_reads_allowed(self, master_client, path) -> None:
        resp = master_client.get(path)
        assert resp.status_code == 200, f"GET {path}: {resp.text}"

    def test_master_records_write_allowed(self, master_client, create_activity) -> None:
        """records:write — master books a record (booking UI flow)."""
        activity = create_activity()
        resp = master_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "visits": [{"name": "Гость", "price": 2000}],
        })
        assert resp.status_code == 201, resp.text

    def test_master_payment_write_forbidden(self, master_client, create_record) -> None:
        """payments:write — 403 AUTH_FORBIDDEN (spec §2.5)."""
        resp = master_client.post("/api/v1/payments", json={
            "record_id": create_record()["id"], "amount": 1000, "method": "cash",
        })
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_master_materials_forbidden(self, master_client) -> None:
        """materials — master holds NO tokens at all: read 403, write 403."""
        resp = master_client.get("/api/v1/materials")
        assert resp.status_code == 403
        resp = master_client.post("/api/v1/materials", json={
            "title": "Гв Материал", "description": "запрещено",
        })
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_master_client_delete_forbidden(self, master_client, create_client) -> None:
        """clients:write — master cannot delete a client (read-only)."""
        resp = master_client.delete(f"/api/v1/clients/{create_client()['id']}")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_master_dictionary_write_forbidden(self, master_client) -> None:
        """masters:write — read-only dictionaries for the master role."""
        resp = master_client.post("/api/v1/masters", json={
            "first_name": "Нет", "last_name": "Прав", "color": "#5B8C7A",
            "position": "мастер", "specialty": "живопись",
        })
        assert resp.status_code == 403


# ─── public site surface intact (User Scenario 5) ──────────────────────────────


class TestPublicSurface:
    @pytest.mark.parametrize("path", _PUBLIC_GETS)
    def test_anonymous_dictionary_gets_200(self, anon_client, path) -> None:
        resp = anon_client.get(path)
        assert resp.status_code == 200, f"GET {path}: {resp.text}"

    def test_anonymous_record_create_201(self, anon_client, create_activity) -> None:
        """POST /records stays public until #8 (anonymous booking)."""
        activity = create_activity()
        resp = anon_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "visits": [{"name": "Гость", "price": 2000}],
        })
        assert resp.status_code == 201, resp.text


# ─── Sec-Fetch-Site: cross-site rejected, missing header passes (Scenario 6) ───


class TestSecFetchSite:
    def test_cross_site_authenticated_mutation_403(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/tags",
            json={"tag": f"csrf-{uuid.uuid4().hex[:8]}"},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_same_site_authenticated_mutation_passes(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/tags",
            json={"tag": f"csrf-{uuid.uuid4().hex[:8]}"},
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        assert resp.status_code == 201, resp.text

    def test_missing_header_authenticated_mutation_passes(self, api_client) -> None:
        """Legacy clients/tools (no Sec-Fetch-Site) pass — spec §2.14."""
        resp = api_client.post("/api/v1/tags", json={"tag": f"csrf-{uuid.uuid4().hex[:8]}"})
        assert resp.status_code == 201, resp.text

    def test_cross_site_anonymous_public_route_exempt(self, anon_client, create_activity) -> None:
        """Anonymous public routes are exempt from the CSRF line (§2.14)."""
        activity = create_activity()
        resp = anon_client.post(
            "/api/v1/records",
            json={
                "activity_id": activity["id"],
                "phone": f"+7999{uuid.uuid4().hex[:7]}",
                "visits": [{"name": "Гость", "price": 2000}],
            },
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert resp.status_code == 201, resp.text
