"""GH #482 Task 6 — the ``notify`` flag chain, contract level (spec §3.3, US-1).

POST /api/v1/records and the ``notify`` flag:

* authenticated actor + ``notify: true`` → the flag is FIXED in the
  ``records.notify`` column at creation (§3.3.5 — the dispatcher later
  reads it live by record id);
* anonymous call with ``notify: true`` → recorded as ``false`` (§3.3.4
  actor gate — the booking route is public, an anonymous caller must
  not impose a mailing on an arbitrary client by phone);
* no field → ``false`` (``RecordCreate.notify`` defaults to False, so
  existing callers — seeds, e2e helpers, the public web form — are
  unchanged).

The API response is NOT changed by the flag (§3.3: ``notify`` is
internal record state read by the dispatcher) — the body must not
expose it.
"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import query_db

pytestmark = pytest.mark.api


def _notify_column(record_id: str) -> int:
    """Read the fixed flag straight from the column (0/1 SQLite bool)."""
    rows = query_db(f"SELECT notify FROM records WHERE id = '{record_id}'")
    assert len(rows) == 1, f"record {record_id} not found"
    return rows[0]["notify"]


class TestNotifyFlagChain:
    """US-1: the checkbox flag survives the whole chain into the column."""

    def test_actor_notify_true_fixed_in_column(
        self, api_client, create_activity
    ) -> None:
        """Authenticated admin + notify: true → column true."""
        activity = create_activity()
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": "+79995556677",
            "notify": True,
            "visits": [{"name": "Мария", "price": 1000}],
        })

        assert resp.status_code == 201, resp.text
        assert _notify_column(resp.json()["id"]) == 1

    def test_anonymous_notify_true_recorded_as_false(
        self, app, api_client, create_activity
    ) -> None:
        """No session principal → the flag is forced false (§3.3.4)."""
        activity = create_activity()
        anonymous = TestClient(app)  # no login — the booking route is public

        resp = anonymous.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": "+79995556688",
            "notify": True,
            "visits": [{"name": "Аноним", "price": 1000}],
        })

        assert resp.status_code == 201, resp.text
        assert _notify_column(resp.json()["id"]) == 0

    def test_field_absent_defaults_false(self, api_client, create_activity) -> None:
        """Existing callers send no flag → column false (compat default)."""
        activity = create_activity()
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": "+79995556699",
            "visits": [{"name": "Гость", "price": 1000}],
        })

        assert resp.status_code == 201, resp.text
        assert _notify_column(resp.json()["id"]) == 0

    def test_response_does_not_expose_notify(
        self, api_client, create_activity
    ) -> None:
        """§3.3: responses are unchanged — notify is internal state."""
        activity = create_activity()
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": "+79995556700",
            "notify": True,
            "visits": [{"name": "Мария", "price": 1000}],
        })

        assert resp.status_code == 201, resp.text
        assert "notify" not in resp.json()
