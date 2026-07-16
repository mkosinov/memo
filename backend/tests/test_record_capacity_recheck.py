"""Capacity re-check on record update/patch (US-4, US-5, US-6, US-7, US-9).

Verifies the Variant 1 fix from #129 / spec §3:
- update growing past capacity → 409 ACTIVITY_AT_CAPACITY, record unchanged
- update shrinking → 200 (shrink always allowed)
- patch visits past capacity → 409
- patch only comment on a full activity → 200 (no capacity check)
- on a full activity, edit visit fields (price/tariff/relink visitor_id) with the
  same seat count → 200 via both PUT and PATCH (the "edit-in-place on a sold-out
  class" guarantee).

The capacity check sits between delete-old-visits and insert-new-visits, with
`recompute_record_seats` called BEFORE the check (resets the record's own
contribution to the occupied sum, avoids double-count).
"""

import pytest

pytestmark = pytest.mark.api


def _make_activity_with_record(
    api_client, create_activity, create_client, *, capacity, n_visits
):
    """Helper: create an activity (capacity=N) and a record with N visits (filled)."""
    activity = create_activity(capacity=capacity)
    client = create_client()
    visits = [
        {"name": f"G{i}", "price": 1000, "status": "waiting"}
        for i in range(n_visits)
    ]
    resp = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client["id"],
        "comment": "x",
        "visits": visits,
    })
    assert resp.status_code == 201, resp.text
    return activity, resp.json()


# ─── US-4: PUT growing past capacity → 409, record unchanged ─────────────


def test_update_over_capacity_returns_409(
    api_client, create_activity, create_client
) -> None:
    """US-4: growing a record past capacity via PUT → 409, record unchanged."""
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=2, n_visits=1
    )
    resp = api_client.put(f"/api/v1/records/{record['id']}", json={
        "activity_id": activity["id"],
        "client_id": record["client_id"],
        "comment": "x",
        "visits": [
            {"name": "A", "price": 1000, "status": "waiting"},
            {"name": "B", "price": 1000, "status": "waiting"},
            {"name": "C", "price": 1000, "status": "waiting"},
        ],
    })
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "ACTIVITY_AT_CAPACITY"
    # record unchanged: still 1 visit
    after = api_client.get(f"/api/v1/records/{record['id']}").json()
    assert len(after["visits"]) == 1


# ─── US-6: PUT shrinking → 200 (always allowed) ─────────────────────────


def test_update_shrink_succeeds(
    api_client, create_activity, create_client
) -> None:
    """US-6: shrinking a record's seats always succeeds."""
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=3, n_visits=3
    )
    resp = api_client.put(f"/api/v1/records/{record['id']}", json={
        "activity_id": activity["id"],
        "client_id": record["client_id"],
        "comment": "x",
        "visits": [{"name": "A", "price": 1000, "status": "waiting"}],
    })
    assert resp.status_code == 200
    assert len(resp.json()["visits"]) == 1


# ─── US-5: PATCH visits past capacity → 409 ──────────────────────────────


def test_patch_visits_over_capacity_returns_409(
    api_client, create_activity, create_client
) -> None:
    """US-5: patching visits past capacity → 409."""
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=2, n_visits=1
    )
    resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
        "visits": [
            {"name": "A", "price": 1000, "status": "waiting"},
            {"name": "B", "price": 1000, "status": "waiting"},
            {"name": "C", "price": 1000, "status": "waiting"},
        ],
    })
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "ACTIVITY_AT_CAPACITY"


# ─── US-7: PATCH comment-only on full activity → 200 (no check) ─────────


def test_patch_comment_only_on_full_activity_succeeds(
    api_client, create_activity, create_client
) -> None:
    """US-7: patching only comment on a full activity does NOT trigger capacity check."""
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=1, n_visits=1
    )
    resp = api_client.patch(
        f"/api/v1/records/{record['id']}", json={"comment": "updated note"}
    )
    assert resp.status_code == 200
    assert resp.json()["comment"] == "updated note"


# ─── US-9: edit visit fields on a full activity (same seat count) → 200 ──


def test_edit_fields_on_full_activity_same_seatcount_succeeds(
    api_client, create_activity, create_client, sample_tariff
) -> None:
    """US-9: on a full activity, changing price/tariff (same seat count) → 200."""
    # capacity=2, fill it exactly with ONE record holding 2 visits → occupied == capacity
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=2, n_visits=2
    )
    # sanity: activity is full
    act = api_client.get(f"/api/v1/activities/{activity['id']}").json()
    assert act["occupied"] == 2  # == capacity

    # --- PUT: same 2 visits but new price + tariff_id (seat count unchanged) ---
    put_resp = api_client.put(f"/api/v1/records/{record['id']}", json={
        "activity_id": activity["id"],
        "client_id": record["client_id"],
        "comment": "x",
        "visits": [
            {"name": "A", "price": 9999, "tariff_id": sample_tariff, "status": "waiting"},
            {"name": "B", "price": 8888, "tariff_id": sample_tariff, "status": "waiting"},
        ],
    })
    assert put_resp.status_code == 200, put_resp.text
    put_body = put_resp.json()
    assert len(put_body["visits"]) == 2
    assert {v["price"] for v in put_body["visits"]} == {9999, 8888}
    assert all(v["tariff_id"] == sample_tariff for v in put_body["visits"])

    # --- PATCH: same 2 visits, change price again (seat count still unchanged) ---
    patch_resp = api_client.patch(f"/api/v1/records/{record['id']}", json={
        "visits": [
            {"price": 100, "tariff_id": sample_tariff, "status": "waiting"},
            {"price": 200, "tariff_id": sample_tariff, "status": "waiting"},
        ],
    })
    assert patch_resp.status_code == 200, patch_resp.text
    assert {v["price"] for v in patch_resp.json()["visits"]} == {100, 200}


def test_relink_visitor_on_full_activity_succeeds(
    api_client, create_activity, create_client
) -> None:
    """US-9: on a full activity, re-linking a visit to another visitor_id (same seat count) → 200."""
    activity, record = _make_activity_with_record(
        api_client, create_activity, create_client, capacity=1, n_visits=1
    )
    # create another visitor via a throwaway record on a different activity
    other_client = create_client()
    other_activity = create_activity(capacity=5)
    seed = api_client.post("/api/v1/records", json={
        "activity_id": other_activity["id"],
        "client_id": other_client["id"],
        "comment": "seed",
        "visits": [{"name": "OtherPerson", "price": 1000, "status": "waiting"}],
    }).json()
    other_visitor_id = seed["visits"][0]["visitor_id"]
    assert other_visitor_id is not None

    # re-link the full-activity record's single visit to the other visitor (seat count stays 1)
    resp = api_client.put(f"/api/v1/records/{record['id']}", json={
        "activity_id": activity["id"],
        "client_id": record["client_id"],
        "comment": "x",
        "visits": [{"visitor_id": other_visitor_id, "price": 1000, "status": "waiting"}],
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["visits"][0]["visitor_id"] == other_visitor_id
