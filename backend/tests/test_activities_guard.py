"""GH #600 Task 2 — bare activity GETs are staff-only (activities:read).

The shared ``GET /api/v1/activities`` and ``GET /api/v1/activities/{id}``
left ``PUBLIC_ROUTES`` (#493 photos precedent): anonymous requests get
401, and so do CLIENT sessions — the client cookie
``memo_client_session`` is a different cookie NAME that the staff guard
(``require_session`` → ``memo_staff_session``) never reads (#499 spec §3).
Staff behaviour is UNCHANGED: admin sees all rows (private included),
a master sees his own private rows in the list and point-get (GH #263
scope regression pin). The anonymous schedule lives at
``GET /api/v1/public/activities`` (ADR-015, Task 1 — its own suite).

Domain rules: docs/domain-rules/activities.md (Invariants — staff-only),
docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from src.errors import ErrorCode
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

LIST_URL = "/api/v1/activities"


@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (photos/public precedents).

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
    point of the probe — the staff guard reads ``memo_staff_session`` and
    must
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


class TestBareActivityGetsAreStaffOnly:
    """US-3 (#600): anonymous / client sessions → 401 on both bare GETs."""

    def test_anonymous_list_401(self, anon_client) -> None:
        resp = anon_client.get(LIST_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_anonymous_single_401(self, anon_client, create_activity) -> None:
        """A REAL row id — the guard fires before any DB work; even an
        existing activity must not be readable anonymously."""
        activity = create_activity()
        resp = anon_client.get(f"{LIST_URL}/{activity['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_list_401(self, anon_client, create_activity) -> None:
        create_activity()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(LIST_URL)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value

    def test_client_session_single_401(
        self, anon_client, create_activity
    ) -> None:
        activity = create_activity()
        _client_session_on_jar(anon_client)
        resp = anon_client.get(f"{LIST_URL}/{activity['id']}")
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_UNAUTHORIZED.value


class TestStaffKeepsFullView:
    """Staff behaviour unchanged: admin sees all, master sees own private."""

    def test_admin_sees_all_including_private(
        self, api_client, create_activity
    ) -> None:
        regular = create_activity()
        private = create_activity(is_private=True)
        resp = api_client.get(LIST_URL)
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["items"]]
        assert regular["id"] in ids
        assert private["id"] in ids

    def test_master_sees_own_private_list_and_single(
        self, make_master, create_activity
    ) -> None:
        """GH #263 scope regression: the activities:read guard must not
        break the master narrowing — own private rows stay visible in
        the list AND point-get; foreign rows stay narrowed out."""
        master = make_master()
        own_private = create_activity(
            master_id=master["staff_id"], is_private=True
        )
        foreign = create_activity(is_private=False)

        resp = master["client"].get(LIST_URL)
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["items"]]
        assert own_private["id"] in ids
        assert foreign["id"] not in ids

        single = master["client"].get(f"{LIST_URL}/{own_private['id']}")
        assert single.status_code == 200, single.text
        assert single.json()["id"] == own_private["id"]
