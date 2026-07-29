"""US-2: list_activities issues a bounded number of queries (no N+1).

Regression guard for the batched sum_active_seats_bulk fix in #129.
Seed N activities (each with one record) and assert the SELECT count
during GET /api/v1/activities?date_from=...&date_to=... is BOUNDED —
must NOT scale with the number of activities (1+N → constant).
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

pytestmark = pytest.mark.api


def _count_select_queries(db_engine):
    """Return (counter, listener) — listener must be event.remove()d later."""
    counter = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            counter["n"] += 1

    event.listen(db_engine.sync_engine, "before_cursor_execute", _before)
    return counter, _before


def test_list_activities_query_count_is_bounded(
    api_client, db_engine, create_activity, create_client
) -> None:
    """occupied for N activities must NOT cost ~N SELECTs (N+1 regression guard)."""
    start = datetime.now(UTC) + timedelta(days=1)
    date_from = start.date().isoformat()
    date_to = (start + timedelta(days=1)).date().isoformat()

    # Seed 5 activities, each with one record occupying a seat
    for _ in range(5):
        activity = create_activity(start=start)
        client = create_client()
        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "seat",
            "visits": [{"name": "G", "price": 1000, "status": "waiting"}],
        })
        assert resp.status_code == 201

    counter, listener = _count_select_queries(db_engine)
    try:
        resp = api_client.get(f"/api/v1/activities?date_from={date_from}&date_to={date_to}")
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", listener)

    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 5
    # Before fix: ~1 (list) + 5 (per-activity SUM) = 6+. After: list + ONE batch SUM.
    # Pagination adds one extra count query. Final settled value: 3. < 5 leaves buffer.
    assert counter["n"] <= 4, f"N+1 regression: {counter['n']} SELECTs for 5 activities"
