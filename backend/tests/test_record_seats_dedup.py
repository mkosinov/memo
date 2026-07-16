"""US-8: create/update/patch compute identical final seats (single source of truth)."""
import pytest

pytestmark = pytest.mark.api


def test_create_update_patch_seats_are_consistent(api_client, create_activity, create_client) -> None:
    activity = create_activity(capacity=10)
    client = create_client()
    two_visits = [
        {"name": "A", "price": 1000, "status": "waiting"},
        {"name": "B", "price": 1000, "status": "waiting"},
    ]

    # create with 2 visits + anonym_visits=1 → seats должно быть 3
    created = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"], "client_id": client["id"],
        "comment": "x", "visits": two_visits, "anonym_visits": 1,
    }).json()
    assert created["seats"] == 3, f"create seats={created['seats']}"

    # update to the same shape → same seats
    updated = api_client.put(f"/api/v1/records/{created['id']}", json={
        "activity_id": activity["id"], "client_id": client["id"],
        "comment": "x", "visits": two_visits, "anonym_visits": 1,
    }).json()
    assert updated["seats"] == 3, f"update seats={updated['seats']}"

    # patch visits to the same shape → same seats
    patched = api_client.patch(f"/api/v1/records/{created['id']}", json={
        "visits": two_visits, "anonym_visits": 1,
    }).json()
    assert patched["seats"] == 3, f"patch seats={patched['seats']}"
