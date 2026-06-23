"""Verify that the API rejects a 'status' field in Record payloads (422)."""
import pytest


def test_post_rejects_status_field(api_client, create_activity):
    """POST /api/v1/records with status field → 422 (extra field forbidden)."""
    activity = create_activity()
    # Build a valid record payload (without status) then add status
    payload = {
        "activity_id": activity["id"],
        "visits": [{"name": "Test", "price": 3500}],
        "status": "visited",  # type: ignore[assignment]
    }
    response = api_client.post("/api/v1/records", json=payload)
    assert response.status_code == 422
    assert "status" in response.text or "extra" in response.text.lower()


def test_put_rejects_status_field(api_client, create_record):
    """PUT /api/v1/records/{id} with status field → 422 (extra field forbidden)."""
    record = create_record()
    update_payload = {
        "activity_id": record["activity_id"],
        "client_id": record["client_id"],
        "visits": record["visits"],
        "status": "cancelled",  # type: ignore[dict-item]
    }
    response = api_client.put(f"/api/v1/records/{record['id']}", json=update_payload)
    assert response.status_code == 422


def test_patch_rejects_status_field(api_client, create_record):
    """PATCH /api/v1/records/{id} with status field → 422 (extra field forbidden)."""
    record = create_record()
    response = api_client.patch(
        f"/api/v1/records/{record['id']}",
        json={"status": "visited"},
    )
    assert response.status_code == 422
