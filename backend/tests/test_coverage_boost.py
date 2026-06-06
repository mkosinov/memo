"""Coverage-boosting tests for services, repositories, and API endpoints.

Targets low-coverage modules identified by pytest-cov:
- src/services/record.py (phone flow, visitor resolution, update)
- src/services/service.py (CRUD with tariffs and tags)
- src/repositories/generic.py (list with filters, patch, delete)
- src/services/visit.py (get, update_status)
- src/services/activity.py (date filtering, count_records)
- src/services/visitor.py (list_by_client)
"""

from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.integration

# ─── Record Service: Phone Flow & Visitor Resolution ──────────────────────────


class TestRecordPhoneFlow:
    """Test the phone-based record creation flow in RecordService."""

    def test_create_record_with_new_phone_creates_client(self, api_client, create_activity):
        """Phone-based creation with unknown phone → creates new Client."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": "+79995559999",
            "visits": [
                {"name": "Мария", "age": 10, "price": 2000},
                {"name": "Иван", "age": 12, "price": 2000},
            ],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert body["client_id"] is not None
        assert body["seats"] == 2
        assert len(body["visits"]) == 2

        # Client was created with the phone
        client_resp = api_client.get(f"/api/v1/clients/{body['client_id']}")
        assert client_resp.status_code == 200
        assert client_resp.json()["phone"] == "+79995559999"

        # Visitors were created
        for visit in body["visits"]:
            v_resp = api_client.get(f"/api/v1/visitors/{visit['visitor_id']}")
            assert v_resp.status_code == 200

    def test_create_record_with_existing_phone_reuses_client(self, api_client, create_activity):
        """Phone-based creation with known phone → reuses existing Client."""
        # Create client first
        existing = api_client.post("/api/v1/clients", json={
            "name": "Existing Client",
            "phone": "+79995558888",
            "channel": "whatsapp",
        }).json()

        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": "+79995558888",
            "visits": [
                {"name": "Новый гость", "age": 8, "price": 1500},
            ],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        assert resp.json()["client_id"] == existing["id"]

    def test_create_record_with_name_based_visits(self, api_client, create_activity, create_client):
        """Name-based visits find-or-create Visitors by name + client_id."""
        activity = create_activity()
        client = create_client()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [
                {"name": "Анна", "age": 25, "price": 3500},
                {"name": "Пётр", "age": 30, "price": 3500},
            ],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert body["seats"] == 2
        assert len(body["visits"]) == 2

    def test_create_record_with_id_based_visits(self, api_client, create_activity, create_client):
        """ID-based visits link to existing Visitors directly."""
        activity = create_activity()
        client = create_client()

        # Create visitors
        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Visitor One", "age": 20,
        }).json()
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Visitor Two", "age": 25,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [
                {"visitor_id": v1["id"], "price": 2500, "status": "waiting"},
                {"visitor_id": v2["id"], "price": 2500, "status": "waiting"},
            ],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert body["seats"] == 2

    def test_create_record_phone_with_empty_visits(self, api_client, create_activity):
        """Phone-based creation with empty visits → seats=0, no visitors created."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "phone": "+79995557777",
            "visits": [],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert body["seats"] == 0
        assert body["visits"] == []

    def test_create_record_no_phone_no_client_id(self, api_client, create_activity):
        """Record with neither phone nor client_id → 422 (requires at least one)."""
        activity = create_activity()
        payload = {
            "activity_id": activity["id"],
            "visits": [
                {"name": "Один гость", "price": 3000},
            ],
        }
        resp = api_client.post("/api/v1/records", json=payload)
        # Schema requires at least phone or client_id
        assert resp.status_code == 422


class TestRecordUpdate:
    """Test the record update flow (RecordService.update)."""

    def test_update_record_replaces_all_visits(self, api_client, create_record):
        """PUT replaces all visits and recalculates seats."""
        record = create_record()
        activity_id = record["activity_id"]
        client_id = record["client_id"]

        # Create a new visitor
        new_visitor = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "New Visitor", "age": 22,
        }).json()

        update_payload = {
            "activity_id": activity_id,
            "client_id": client_id,
            "status": "confirmed",
            "comment": "Updated via test",
            "visits": [
                {"visitor_id": new_visitor["id"], "price": 4000, "status": "visited"},
            ],
        }
        resp = api_client.put(f"/api/v1/records/{record['id']}", json=update_payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "confirmed"
        assert body["comment"] == "Updated via test"
        assert body["seats"] == 1
        assert len(body["visits"]) == 1

    def test_update_record_to_empty_visits(self, api_client, create_record):
        """PUT with empty visits → seats=0."""
        record = create_record()
        update_payload = {
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "status": "cancelled",
            "visits": [],
        }
        resp = api_client.put(f"/api/v1/records/{record['id']}", json=update_payload)
        assert resp.status_code == 200
        assert resp.json()["seats"] == 0


# ─── Service Service: CRUD with Tariffs & Tags ───────────────────────────────


class TestServiceWithTariffsAndTags:
    """Test ServiceService.create and ServiceService.update with nested data."""

    def test_create_service_with_multiple_tariffs(self, api_client):
        """Create service with 3 tariffs."""
        payload = {
            "title": "Acrylic Painting",
            "description": "Learn acrylic painting",
            "image_url": "https://example.com/acrylic.jpg",
            "specialty": "painting",
            "min_age": 6,
            "max_age": 99,
            "duration": 120,
            "record_info": "Bring apron",
            "tariffs": [
                {"title": "Adult", "description": "Standard adult", "price": 3000},
                {"title": "Child", "description": "Discounted child", "price": 2000},
                {"title": "Individual", "description": "Private lesson", "price": 5000},
            ],
        }
        resp = api_client.post("/api/v1/services", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert len(body["tariffs"]) == 3
        assert body["tariffs"][0]["title"] == "Adult"
        assert body["tariffs"][1]["title"] == "Child"
        assert body["tariffs"][2]["title"] == "Individual"

    def test_create_service_with_tags_and_tariffs(self, api_client):
        """Create service with both tags and tariffs."""
        # Create tags
        tag1 = api_client.post("/api/v1/tags", json={"tag": "popular"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "new"}).json()

        payload = {
            "title": "Watercolor Art",
            "description": "Watercolor painting class",
            "image_url": "https://example.com/watercolor.jpg",
            "specialty": "watercolor",
            "min_age": 8,
            "max_age": 99,
            "duration": 90,
            "record_info": "All materials provided",
            "tariffs": [
                {"title": "Standard", "price": 2500},
            ],
            "tag_ids": [tag1["id"], tag2["id"]],
        }
        resp = api_client.post("/api/v1/services", json=payload)
        assert resp.status_code == 201
        body = resp.json()
        assert len(body["tariffs"]) == 1
        assert len(body["tags"]) == 2
        tag_names = {t["tag"] for t in body["tags"]}
        assert "popular" in tag_names
        assert "new" in tag_names

    def test_update_service_replaces_tariffs_and_tags(self, api_client):
        """PUT replaces all tariffs and tags."""
        # Create service with initial tags
        tag1 = api_client.post("/api/v1/tags", json={"tag": "initial"}).json()
        payload = {
            "title": "Ceramics",
            "description": "Clay sculpting",
            "image_url": "https://example.com/ceramics.jpg",
            "specialty": "ceramics",
            "min_age": 5,
            "max_age": 99,
            "duration": 60,
            "record_info": "",
            "tariffs": [{"title": "Basic", "price": 1500}],
            "tag_ids": [tag1["id"]],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        # Create new tag
        tag2 = api_client.post("/api/v1/tags", json={"tag": "updated"}).json()

        # Update with completely new tariffs and tags
        update_data = {
            "title": "Advanced Ceramics",
            "description": "Advanced clay techniques",
            "image_url": "https://example.com/ceramics2.jpg",
            "specialty": "ceramics",
            "min_age": 12,
            "max_age": 99,
            "duration": 120,
            "record_info": "Prerequisites required",
            "tariffs": [
                {"title": "Premium", "description": "Premium package", "price": 3000},
                {"title": "Standard", "description": "Standard package", "price": 2000},
            ],
            "tag_ids": [tag2["id"]],
        }
        resp = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Advanced Ceramics"
        assert len(body["tariffs"]) == 2
        assert body["tariffs"][0]["title"] == "Premium"
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "updated"

    def test_update_service_clears_all_tariffs(self, api_client):
        """PUT with empty tariffs clears all existing tariffs."""
        payload = {
            "title": "Ceramics",
            "description": "Clay sculpting",
            "image_url": "https://example.com/ceramics.jpg",
            "specialty": "ceramics",
            "min_age": 5,
            "max_age": 99,
            "duration": 60,
            "record_info": "",
            "tariffs": [{"title": "Basic", "price": 1500}, {"title": "Premium", "price": 3000}],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]
        assert len(create_resp.json()["tariffs"]) == 2

        update_data = {
            "title": "Ceramics",
            "description": "Clay sculpting",
            "image_url": "https://example.com/ceramics.jpg",
            "specialty": "ceramics",
            "min_age": 5,
            "max_age": 99,
            "duration": 60,
            "record_info": "",
            "tariffs": [],
        }
        resp = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert resp.status_code == 200
        assert len(resp.json()["tariffs"]) == 0


# ─── Activity Service: Date Filtering & count_records ────────────────────────


class TestActivityServiceDateFiltering:
    """Test ActivityService date filtering and record counting."""

    def test_list_activities_date_from_only(self, api_client):
        """List activities with only date_from filter."""
        prereqs = _create_prereqs(api_client)
        today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        next_week = today + timedelta(days=7)

        api_client.post("/api/v1/activities", json=_make_activity(prereqs, today))
        api_client.post("/api/v1/activities", json=_make_activity(prereqs, tomorrow))
        api_client.post("/api/v1/activities", json=_make_activity(prereqs, next_week))

        # Filter: only from tomorrow onwards
        resp = api_client.get(
            "/api/v1/activities",
            params={"date_from": tomorrow.strftime("%Y-%m-%d")},
        )
        assert resp.status_code == 200
        # Should include tomorrow and next_week (2 activities)
        assert len(resp.json()) == 2

    def test_list_activities_date_to_only(self, api_client):
        """List activities with only date_to filter."""
        prereqs = _create_prereqs(api_client)
        today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        next_week = today + timedelta(days=7)

        api_client.post("/api/v1/activities", json=_make_activity(prereqs, today))
        api_client.post("/api/v1/activities", json=_make_activity(prereqs, tomorrow))
        api_client.post("/api/v1/activities", json=_make_activity(prereqs, next_week))

        # Filter: only up to tomorrow
        resp = api_client.get(
            "/api/v1/activities",
            params={"date_to": tomorrow.strftime("%Y-%m-%d")},
        )
        assert resp.status_code == 200
        # Should include today and tomorrow (2 activities)
        assert len(resp.json()) == 2

    def test_activity_count_records_with_multiple_records(self, api_client, create_record):
        """count_records returns correct count when multiple records exist."""
        record1 = create_record()
        activity_id = record1["activity_id"]
        create_record(activity_id=activity_id)

        resp = api_client.get(f"/api/v1/activities/{activity_id}")
        assert resp.status_code == 200
        assert resp.json()["occupied"] == 2


# ─── Visit Service: get & update_status ──────────────────────────────────────


class TestVisitServiceDirect:
    """Test visit get and status update flows."""

    def test_get_visit_by_id(self, api_client, create_record):
        """GET /api/visits/{id} returns the visit."""
        record = create_record()
        visit_id = record["visits"][0]["id"]

        resp = api_client.get(f"/api/v1/visits/{visit_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == visit_id
        assert body["status"] == "waiting"

    def test_update_visit_status_to_visited(self, api_client, create_record):
        """PUT /api/visits/{id}/status updates status."""
        record = create_record()
        visit_id = record["visits"][0]["id"]

        resp = api_client.put(
            f"/api/v1/visits/{visit_id}/status",
            json={"status": "visited"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "visited"

    def test_update_visit_status_to_cancelled(self, api_client, create_record):
        """PUT /api/visits/{id}/status to cancelled."""
        record = create_record()
        visit_id = record["visits"][0]["id"]

        resp = api_client.put(
            f"/api/v1/visits/{visit_id}/status",
            json={"status": "cancelled"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"


# ─── Visitor Service: list_by_client ─────────────────────────────────────────


class TestVisitorServiceListByClient:
    """Test visitor listing by client_id."""

    def test_list_visitors_for_client(self, api_client, create_client):
        """GET /api/v1/clients/{client_id}/visitors returns active visitors."""
        client = create_client()
        api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Active One", "age": 20,
        })
        api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Active Two", "age": 25,
        })

        resp = api_client.get(f"/api/v1/clients/{client['id']}/visitors")
        assert resp.status_code == 200
        visitors = resp.json()
        assert len(visitors) == 2
        names = {v["name"] for v in visitors}
        assert "Active One" in names
        assert "Active Two" in names

    def test_list_visitors_excludes_deleted(self, api_client, create_client):
        """Soft-deleted visitors are excluded from client list."""
        client = create_client()
        api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Keep", "age": 20,
        })
        v2 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Delete", "age": 25,
        }).json()

        # Delete v2
        api_client.delete(f"/api/v1/visitors/{v2['id']}")

        resp = api_client.get(f"/api/v1/clients/{client['id']}/visitors")
        assert resp.status_code == 200
        visitors = resp.json()
        assert len(visitors) == 1
        assert visitors[0]["name"] == "Keep"


# ─── Generic Repository: list with filters, patch, delete ────────────────────


class TestRepositoryListFilters:
    """Test GenericRepository.list with various filter parameters."""

    def test_list_masters(self, api_client):
        """GET /api/v1/masters returns active masters."""
        api_client.post("/api/v1/masters", json={
            "first_name": "Test", "last_name": "Master", "color": "#FF0000",
            "position": "мастер", "specialty": "живопись",
        })
        resp = api_client.get("/api/v1/masters")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_list_locations(self, api_client):
        """GET /api/v1/locations returns active locations."""
        api_client.post("/api/v1/locations", json={
            "name": "Test Studio", "address": "123 Main St", "capacity": 20,
        })
        resp = api_client.get("/api/v1/locations")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_list_services(self, api_client):
        """GET /api/v1/services returns active services."""
        api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "Test", "image_url": "https://example.com/t.jpg",
            "specialty": "test", "min_age": 6, "max_age": 99, "duration": 60, "record_info": "",
        })
        resp = api_client.get("/api/v1/services")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_list_tags(self, api_client):
        """GET /api/v1/tags returns active tags."""
        api_client.post("/api/v1/tags", json={"tag": "test-tag"})
        resp = api_client.get("/api/v1/tags")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1


class TestRepositoryPatch:
    """Test GenericRepository.patch (partial update)."""

    def test_patch_activity_capacity(self, api_client):
        """PATCH /api/activities/{id} updates only capacity."""
        prereqs = _create_prereqs(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_make_activity(prereqs)
        )
        activity_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/activities/{activity_id}",
            json={"capacity": 50},
        )
        assert resp.status_code == 200
        assert resp.json()["capacity"] == 50
        # Other fields unchanged
        assert resp.json()["duration"] == 90

    def test_patch_activity_comment(self, api_client):
        """PATCH /api/activities/{id} updates only comment."""
        prereqs = _create_prereqs(api_client)
        create_resp = api_client.post(
            "/api/v1/activities", json=_make_activity(prereqs)
        )
        activity_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/activities/{activity_id}",
            json={"comment": "Updated comment only"},
        )
        assert resp.status_code == 200
        assert resp.json()["comment"] == "Updated comment only"


# ─── Additional API endpoint coverage ────────────────────────────────────────


class TestClientSearchFlow:
    """Test client phone search endpoint."""

    def test_search_client_by_phone_found(self, api_client, create_client):
        """GET /api/v1/clients/search?phone=... returns matching client."""
        create_client(phone="+79991234567")
        resp = api_client.get(
            "/api/v1/clients/search",
            params={"phone": "+79991234567"},
        )
        assert resp.status_code == 200
        assert resp.json()["phone"] == "+79991234567"

    def test_search_client_by_phone_not_found(self, api_client):
        """GET /api/v1/clients/search?phone=... → 404 if not found."""
        resp = api_client.get(
            "/api/v1/clients/search",
            params={"phone": "+00000000000"},
        )
        assert resp.status_code == 404


class TestPaymentCreation:
    """Test payment creation with various methods."""

    def test_create_payment_with_card(self, api_client, create_record):
        """POST /api/v1/payments with card method."""
        record = create_record()
        resp = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 5000,
            "method": "card",
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["amount"] == 5000
        assert body["method"] == "card"
        assert body["record_id"] == record["id"]

    def test_create_payment_with_cash(self, api_client, create_record):
        """POST /api/v1/payments with cash method."""
        record = create_record()
        resp = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 3000,
            "method": "cash",
        })
        assert resp.status_code == 201
        assert resp.json()["method"] == "cash"

    def test_create_payment_with_transfer(self, api_client, create_record):
        """POST /api/v1/payments with transfer method."""
        record = create_record()
        resp = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 4000,
            "method": "transfer",
        })
        assert resp.status_code == 201
        assert resp.json()["method"] == "transfer"

    def test_list_payments(self, api_client, create_record):
        """GET /api/v1/payments returns payments."""
        record = create_record()
        api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 2000,
            "method": "card",
        })
        resp = api_client.get("/api/v1/payments")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1


class TestRecordNotFound:
    """Test 404 responses for non-existent records."""

    def test_get_nonexistent_record(self, api_client):
        """GET /api/v1/records/{fake} → 404."""
        resp = api_client.get("/api/v1/records/nonexistent")
        assert resp.status_code == 404

    def test_update_nonexistent_record(self, api_client, create_activity):
        """PUT /api/v1/records/{fake} → 404."""
        activity = create_activity()
        resp = api_client.put("/api/v1/records/nonexistent", json={
            "activity_id": activity["id"],
            "status": "confirmed",
            "visits": [],
        })
        assert resp.status_code == 404

    def test_delete_nonexistent_record(self, api_client):
        """DELETE /api/v1/records/{fake} → 404."""
        resp = api_client.delete("/api/v1/records/nonexistent")
        assert resp.status_code == 404


class TestPhotoEndpoints:
    """Test photo listing endpoints."""

    def test_list_public_photos(self, api_client):
        """GET /api/v1/photos/web returns public photos."""
        resp = api_client.get("/api/v1/photos/web")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _create_prereqs(api_client) -> dict:
    """Create master, service, location and return IDs."""
    master = api_client.post("/api/v1/masters", json={
        "first_name": "Test", "last_name": "Artist", "color": "#00FF00",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Test Svc", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "test", "min_age": 6, "max_age": 99, "duration": 60, "record_info": "",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Test Loc", "address": "123 Main", "capacity": 20,
    }).json()
    return {
        "master_id": master["id"],
        "service_id": service["id"],
        "location_id": location["id"],
    }


def _make_activity(prereqs: dict, start: datetime | None = None) -> dict:
    """Build ActivityCreate payload."""
    if start is None:
        start = datetime.now(UTC) + timedelta(days=1)
    return {
        "master_id": prereqs["master_id"],
        "service_id": prereqs["service_id"],
        "location_id": prereqs["location_id"],
        "start": start.isoformat(),
        "duration": 90,
        "capacity": 10,
        "is_private": False,
    }
