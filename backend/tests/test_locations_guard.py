"""GH #601 Task 2 — bare location GETs are staff-only (locations:read).

The shared ``GET /api/v1/locations`` and ``GET /api/v1/locations/{id}``
left ``PUBLIC_ROUTES`` (#600 activities / #493 photos precedents):
anonymous requests get 401, and so do CLIENT sessions — the client
cookie ``memo_client_session`` is a different cookie NAME that the
staff guard (``require_session`` → ``memo_session``) never reads (#499
spec §3). Staff behaviour is UNCHANGED: admin reads the list and the
point-get as before (``/all`` already carried ``locations:read`` —
untouched). The anonymous dictionary lives at
``GET /api/v1/public/locations`` (ADR-015, Task 2 — its own suite).

Domain rules: docs/domain-rules/locations.md (List contract),
docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

LIST_URL = "/api/v1/locations"


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


class TestBareLocationGetsAreStaffOnly:
    """#601 spec §2.3: anonymous / client sessions → 401 on both bare GETs."""

    def test_anonymous_list_401(self, anon_client) -> None:
        resp = anon_client.get(LIST_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_anonymous_single_401(self, anon_client, create_location) -> None:
        """A REAL row id — the guard fires before any DB work; even an
        existing location must not be readable anonymously."""
        location = create_location()
        resp = anon_client.get(f"{LIST_URL}/{location['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_list_401(self, anon_client, create_location) -> None:
        create_location()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(LIST_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_single_401(
        self, anon_client, create_location
    ) -> None:
        location = create_location()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(f"{LIST_URL}/{location['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


class TestStaffKeepsRead:
    """Staff behaviour unchanged: admin reads the list and the point-get."""

    def test_admin_list_200(self, api_client, create_location) -> None:
        create_location()
        resp = api_client.get(LIST_URL)
        assert resp.status_code == 200, resp.text
        assert "items" in resp.json()

    def test_admin_single_200(self, api_client, create_location) -> None:
        location = create_location()
        resp = api_client.get(f"{LIST_URL}/{location['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == location["id"]
