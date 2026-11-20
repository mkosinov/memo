"""GH #606 Task 3 — bare masters/services/tags GETs are staff-only.

The shared ``GET /api/v1/masters``, ``GET /api/v1/services``,
``GET /api/v1/services/{id}``, ``GET /api/v1/tags`` and
``GET /api/v1/tags/{id}`` left ``PUBLIC_ROUTES`` (#601 locations /
#600 activities / #493 photos precedents): anonymous requests get 401,
and so do CLIENT sessions — the client cookie ``memo_client_session``
is a different cookie NAME that the staff guard (``require_session`` →
``memo_session``) never reads (#499 spec §3). Staff behaviour is
UNCHANGED: admin and master read the lists and the point-get as before
(``/all`` already carried the read guard — untouched; the master role
holds every dictionary-read permission). The anonymous dictionaries
live at ``GET /api/v1/public/masters`` and ``GET /api/v1/public/services``
(ADR-015, Task 2 — their own suites). Masters have NO bare ``GET /{id}``
at all (removed with the mutations, #266) — nothing to close there.
Tags closed the same way in Task 3.2 — with NO showcase of their own:
the anonymous services showcase carries tag titles as sorted strings
(spec §3.3; the last bare dictionary GETs left ``PUBLIC_ROUTES``).

Domain rules: docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

MASTERS_URL = "/api/v1/masters"
SERVICES_URL = "/api/v1/services"
TAGS_URL = "/api/v1/tags"

MASTER_PASSWORD = "master-pass-1"


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (photos/activities precedents).

    Not the shared ``api_client`` with a cleared jar: guard tests need
    BOTH views in one test — an authenticated client to seed rows and an
    anonymous one to probe the guard.
    """
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

    The master role holds every dictionary-read permission
    (``masters:read`` / ``services:read`` / ``tags:read`` — #247
    ROLE_PERMISSIONS), so the guarded dictionaries must answer 200.
    """
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    insert_user(phone, _master_hash, role="master")
    client = login_as(phone, MASTER_PASSWORD)
    yield client
    client.cookies.clear()


def _client_session_on_jar(anon_client) -> None:
    """Put a live CLIENT session on the jar — ``memo_client_session`` only.

    The ``_owner`` issuance pattern from test_my_records_api: a
    client-role user + a live sessions row. The cookie NAME is the whole
    point of the probe — the staff guard reads ``memo_session`` and must
    stay blind to this one (401, not a resolved client principal).
    """
    user = insert_user(f"+7999{uuid.uuid4().hex[:7]}", None, role="client")
    token = uuid.uuid4().hex + uuid.uuid4().hex
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user["id"]},
    )
    anon_client.cookies.set("memo_client_session", token)


def _seed_tag(api_client) -> dict:
    """Seed ONE tag row via the admin write path (tags:write — admin
    holds it; no ``create_tag`` factory in conftest — the test_api_tags
    precedent: ``POST /api/v1/tags`` with a unique title)."""
    resp = api_client.post(
        "/api/v1/tags", json={"title": f"guard-{uuid.uuid4().hex[:8]}"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestBareDictionaryGetsAreStaffOnly:
    """#606 spec §3.3: anonymous / client sessions → 401 on the bare GETs."""

    def test_anonymous_masters_list_401(self, anon_client) -> None:
        resp = anon_client.get(MASTERS_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_anonymous_services_list_401(self, anon_client) -> None:
        resp = anon_client.get(SERVICES_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_anonymous_services_single_401(
        self, anon_client, create_service
    ) -> None:
        """A REAL row id — the guard fires before any DB work; even an
        existing service must not be readable anonymously."""
        service = create_service()
        resp = anon_client.get(f"{SERVICES_URL}/{service['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_masters_list_401(
        self, anon_client, create_master
    ) -> None:
        create_master()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(MASTERS_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_services_list_401(
        self, anon_client, create_service
    ) -> None:
        create_service()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(SERVICES_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_services_single_401(
        self, anon_client, create_service
    ) -> None:
        service = create_service()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(f"{SERVICES_URL}/{service['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    # ── Task 3.2: the tags pair — the last bare dictionary GETs (#606
    #    spec §3.3; no showcase of their own — the public services
    #    showcase carries tag titles as sorted strings). ──

    def test_anonymous_tags_list_401(self, anon_client) -> None:
        resp = anon_client.get(TAGS_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_anonymous_tags_single_401(self, anon_client, api_client) -> None:
        """A REAL row id — the guard fires before any DB work; even an
        existing tag must not be readable anonymously."""
        tag = _seed_tag(api_client)
        resp = anon_client.get(f"{TAGS_URL}/{tag['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_tags_list_401(self, anon_client, api_client) -> None:
        _seed_tag(api_client)
        _client_session_on_jar(anon_client)
        resp = anon_client.get(TAGS_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_tags_single_401(
        self, anon_client, api_client
    ) -> None:
        tag = _seed_tag(api_client)
        _client_session_on_jar(anon_client)
        resp = anon_client.get(f"{TAGS_URL}/{tag['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


class TestMasterKeepsRead:
    """The master role holds all dictionary-read permissions → 200."""

    def test_master_masters_list_200(self, master_client, create_master) -> None:
        create_master()
        resp = master_client.get(MASTERS_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_master_services_list_200(
        self, master_client, create_service
    ) -> None:
        create_service()
        resp = master_client.get(SERVICES_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_master_services_single_200(
        self, master_client, create_service
    ) -> None:
        service = create_service()
        resp = master_client.get(f"{SERVICES_URL}/{service['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == service["id"]

    def test_master_tags_list_200(self, master_client, api_client) -> None:
        _seed_tag(api_client)
        resp = master_client.get(TAGS_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_master_tags_single_200(self, master_client, api_client) -> None:
        tag = _seed_tag(api_client)
        resp = master_client.get(f"{TAGS_URL}/{tag['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == tag["id"]


class TestStaffKeepsRead:
    """Staff behaviour unchanged: admin reads the lists and the point-get."""

    def test_admin_masters_list_200(self, api_client, create_master) -> None:
        create_master()
        resp = api_client.get(MASTERS_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_admin_services_list_200(self, api_client, create_service) -> None:
        create_service()
        resp = api_client.get(SERVICES_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_admin_services_single_200(
        self, api_client, create_service
    ) -> None:
        service = create_service()
        resp = api_client.get(f"{SERVICES_URL}/{service['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == service["id"]
