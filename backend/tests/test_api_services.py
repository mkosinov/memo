"""Tests for the Services CRUD API endpoints with nested Tariffs and Tags."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

SERVICE_PAYLOAD = {
    "title": "Oil Painting for Beginners",
    "description": "Learn the basics of oil painting",
    "image_url": "https://example.com/oil-painting.jpg",
    "specialty": "oil",
    "min_age": 12,
    "max_age": 99,
    "duration": 90,
    "record_info": "Bring your own apron",
    "material_hint": "Масляные краски, холст на подрамнике 40×50 см",
}

TAG_PAYLOAD = {"tag": "beginner"}

TARIFF_PAYLOAD = {
    "title": "Standard",
    "description": "Standard tariff",
    "price": 1500,
}


def _create_tag(api_client) -> str:
    """Create a tag via POST /api/tags and return its ID."""
    response = api_client.post("/api/v1/tags", json=TAG_PAYLOAD)
    assert response.status_code == 201
    return response.json()["id"]


class TestServicesCrud:
    """Full CRUD round-trip for /api/services."""

    def test_create_service(self, api_client) -> None:
        """POST /api/services creates a service and returns 201."""
        response = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)

        assert response.status_code == 201
        body = response.json()
        assert body["title"] == "Oil Painting for Beginners"
        assert body["description"] == "Learn the basics of oil painting"
        assert body["specialty"] == "oil"
        assert body["min_age"] == 12
        assert body["max_age"] == 99
        assert body["duration"] == 90
        assert "id" in body
        assert "created_at" in body
        assert "updated_at" in body
        assert body["is_active"] is True
        assert body["tariffs"] == []
        assert body["tags"] == []
        assert body["material_hint"] == "Масляные краски, холст на подрамнике 40×50 см"

    def test_create_service_without_material_hint(self, api_client) -> None:
        """POST /api/services omitting material_hint defaults to None."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "material_hint"}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        assert response.json()["material_hint"] is None

    def test_create_service_with_tariffs_and_tags(self, api_client) -> None:
        """POST /api/services creates service with nested tariffs and tag links."""
        tag_id = _create_tag(api_client)

        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Standard"
        assert body["tariffs"][0]["price"] == 1500
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "beginner"

    def test_list_services_includes_created(self, api_client) -> None:
        """GET /api/services returns a list containing the created service."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        response = api_client.get("/api/v1/services")
        assert response.status_code == 200
        body = response.json()
        services = body["items"]
        assert body["total"] >= 1
        ids = [s["id"] for s in services]
        assert service_id in ids

    def test_get_service_by_id(self, api_client) -> None:
        """GET /api/services/{id} returns the specific service with tariffs and tags."""
        tag_id = _create_tag(api_client)
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == service_id
        assert body["title"] == "Oil Painting for Beginners"
        assert len(body["tariffs"]) == 1
        assert len(body["tags"]) == 1

    def test_update_service(self, api_client) -> None:
        """PUT /api/services/{id} updates all fields, replaces tariffs and tags."""
        tag_id = _create_tag(api_client)
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
            "tag_ids": [tag_id],
        }
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        # Create a second tag
        tag2_resp = api_client.post("/api/v1/tags", json={"tag": "advanced"})
        tag2_id = tag2_resp.json()["id"]

        update_data = {
            "is_active": True,
            "title": "Advanced Oil Painting",
            "description": "Master oil painting techniques",
            "image_url": "https://example.com/advanced-oil.jpg",
            "specialty": "oil",
            "min_age": 18,
            "max_age": 99,
            "duration": 120,
            "record_info": "Advanced students only",
            "tariffs": [
                {"title": "Premium", "description": "Premium tariff", "price": 2500}
            ],
            "tag_ids": [tag2_id],
        }
        response = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Advanced Oil Painting"
        assert body["min_age"] == 18
        assert body["duration"] == 120
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Premium"
        assert body["tariffs"][0]["price"] == 2500
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "advanced"

    def test_delete_service_soft_deletes(self, api_client) -> None:
        """DELETE /api/services/{id} soft-deletes and list excludes it."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        # Delete
        response = api_client.delete(f"/api/v1/services/{service_id}")
        assert response.status_code == 204

        # GET by id should still return it (soft delete)
        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # List should NOT include the deleted service
        response = api_client.get("/api/v1/services")
        body = response.json()
        ids = [s["id"] for s in body["items"]]
        assert service_id not in ids

    def test_get_nonexistent_service_returns_404(self, api_client) -> None:
        """GET /api/services/{fake_id} returns 404."""
        response = api_client.get("/api/v1/services/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_service_returns_404(self, api_client) -> None:
        """PUT /api/services/{fake_id} returns 404."""
        response = api_client.put(
            "/api/v1/services/nonexistent-id",
            json={**SERVICE_PAYLOAD, "is_active": True},
        )
        assert response.status_code == 404

    def test_update_service_without_is_active_returns_422(self, api_client) -> None:
        """PUT /api/v1/services/{id} without is_active → 422 (canonical PUT, GH #178)."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        response = api_client.put(f"/api/v1/services/{service_id}", json=SERVICE_PAYLOAD)
        assert response.status_code == 422

    def test_delete_nonexistent_service_returns_404(self, api_client) -> None:
        """DELETE /api/services/{fake_id} returns 404."""
        response = api_client.delete("/api/v1/services/nonexistent-id")
        assert response.status_code == 404


class TestServiceMaxAgeNullable:
    """Test that max_age is nullable — null means 'no upper age limit'."""

    def test_create_service_without_max_age(self, api_client) -> None:
        """POST /api/services without max_age returns max_age as null."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "max_age"}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["max_age"] is None
        assert body["min_age"] == 12

    def test_create_service_with_max_age(self, api_client) -> None:
        """POST /api/services with max_age=12 returns max_age as 12."""
        payload = {**SERVICE_PAYLOAD, "max_age": 12}
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["max_age"] == 12

    def test_update_service_set_max_age_to_null(self, api_client) -> None:
        """PUT /api/services/{id} can set max_age to null."""
        # Create with max_age
        payload = {**SERVICE_PAYLOAD, "max_age": 12}
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]
        assert create_resp.json()["max_age"] == 12

        # Update to null
        update_data = {**SERVICE_PAYLOAD, "max_age": None, "is_active": True}
        response = api_client.put(f"/api/v1/services/{service_id}", json=update_data)
        assert response.status_code == 200
        assert response.json()["max_age"] is None

    def test_create_service_null_max_age_serializes_correctly(self, api_client) -> None:
        """GET /api/services/{id} returns null max_age in JSON."""
        payload = {k: v for k, v in SERVICE_PAYLOAD.items() if k != "max_age"}
        create_resp = api_client.post("/api/v1/services", json=payload)
        service_id = create_resp.json()["id"]

        response = api_client.get(f"/api/v1/services/{service_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["max_age"] is None
        # min_age still present
        assert body["min_age"] == 12


class TestServicePatch:
    """Tests for PATCH /api/v1/services/{id}."""

    def test_patch_service_not_found_404(self, api_client) -> None:
        """PATCH nonexistent service returns 404."""
        response = api_client.patch("/api/v1/services/nonexistent-id", json={"duration": 120})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "SERVICE_NOT_FOUND"

    def test_patch_service_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "tag1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "tag2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "tag3"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "tag3"

    def test_patch_service_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"duration": 60})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve"

    def test_patch_service_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []

    def test_patch_service_max_age_to_null(self, api_client) -> None:
        """PATCH {"max_age": null} sets max_age to null (nullable field)."""
        create = api_client.post("/api/v1/services", json={
            **SERVICE_PAYLOAD, "max_age": 50,
        })
        service_id = create.json()["id"]
        assert create.json()["max_age"] == 50

        response = api_client.patch(
            f"/api/v1/services/{service_id}",
            json={"max_age": None},
        )
        assert response.status_code == 200
        assert response.json()["max_age"] is None

    def test_patch_service_empty_body_noop(self, api_client) -> None:
        """PATCH {} leaves all fields unchanged."""
        create = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create.json()["id"]
        original = create.json()

        response = api_client.patch(f"/api/v1/services/{service_id}", json={})
        assert response.status_code == 200
        patched = response.json()

        assert patched["title"] == original["title"]
        assert patched["description"] == original["description"]
        assert patched["max_age"] == original["max_age"]
        assert patched["duration"] == original["duration"]
        assert patched["min_age"] == original["min_age"]

    def test_patch_service_null_title_stripped(self, api_client) -> None:
        """PATCH {"title": null} leaves title unchanged (NOT NULL field, null silently stripped)."""
        create = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create.json()["id"]
        original_title = create.json()["title"]

        response = api_client.patch(
            f"/api/v1/services/{service_id}",
            json={"title": None},
        )
        assert response.status_code == 200
        assert response.json()["title"] == original_title


class TestServiceListStatusFilter:
    """GET /api/v1/services?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows —
    that's already covered by ``test_list_services_includes_created``. These
    tests exercise the two new capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(
        self, api_client, create_service
    ) -> None:
        """?status=archived hides active services, surfaces soft-deleted ones."""
        active = create_service()
        archived = create_service()
        api_client.delete(f"/api/v1/services/{archived['id']}")

        resp = api_client.get("/api/v1/services?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [s["id"] for s in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        assert body["items"][0]["is_active"] is False
        # Eager-loaded relationships still present on archived rows
        assert "tariffs" in body["items"][0]
        assert "tags" in body["items"][0]

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_service
    ) -> None:
        """?status=all returns every row regardless of is_active."""
        active = create_service()
        archived = create_service()
        api_client.delete(f"/api/v1/services/{archived['id']}")

        resp = api_client.get("/api/v1/services?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [s["id"] for s in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(
        self, api_client, create_service
    ) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = create_service()
        archived = create_service()
        api_client.delete(f"/api/v1/services/{archived['id']}")

        explicit = api_client.get("/api/v1/services?status=active").json()
        default = api_client.get("/api/v1/services").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/services?status=foo")
        assert resp.status_code == 422


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/services/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §4  — Service FK deps: activities=block, tariffs=auto-cascade,
              photos=auto-nullify, service_tags=auto-cascade.
      * §5  — 409 Conflict response (counters + sums only).
      * §6  — DELETE with resolutions body (executor = Task 10).
      * §14 — acceptance criteria.
    """

    def test_delete_service_with_activities_no_body_returns_409(
        self, api_client, create_activity
    ) -> None:
        """No body + blocking dep (activities) → 409 + dependency tree (spec §5)."""
        activity = create_activity()
        service_id = activity["service_id"]

        resp = api_client.delete(f"/api/v1/services/{service_id}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert "activities" in deps
        assert deps["activities"]["count"] == 1
        assert deps["activities"]["allowed_actions"] == []
        assert deps["activities"]["message"] is not None
        # Row untouched.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_delete_service_with_auto_deps_no_body_returns_409(
        self, api_client, create_service
    ) -> None:
        """No body + all-auto deps (tariffs+photos+service_tags, NO activities)
        → 409 + dependency tree (spec §5).

        All Service non-block deps are AUTO (tariffs cascade, photos nullify,
        service_tags cascade). The dry-run still surfaces them for informed
        consent — the user's ``resolutions`` body would be ``{}`` to execute.
        """
        tag_id = _create_tag(api_client)
        service = create_service(
            tariffs=[TARIFF_PAYLOAD], tag_ids=[tag_id]
        )
        service_id = service["id"]
        # Add a photo linked to this service (auto-nullify dep).
        photo_resp = api_client.post(
            "/api/v1/photos",
            json={"filename": f"svc-{service_id[:8]}.jpg", "service_id": service_id},
        )
        assert photo_resp.status_code == 201
        photo_id = photo_resp.json()["id"]

        resp = api_client.delete(f"/api/v1/services/{service_id}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        # All non-auto deps are absent from tree (zero-count filters):
        # activities (count 0) is skipped.
        assert "activities" not in deps
        # tariffs (auto cascade) — shown for consent.
        assert deps["tariffs"]["count"] == 1
        assert deps["tariffs"]["allowed_actions"] == ["cascade"]
        # photos (auto nullify) — shown for consent.
        assert deps["photos"]["count"] == 1
        assert deps["photos"]["allowed_actions"] == ["nullify"]
        # service_tags (auto cascade) — shown for consent.
        assert deps["service_tags"]["count"] == 1
        assert deps["service_tags"]["allowed_actions"] == ["cascade"]
        # Row + photo + tariff + tag join untouched (dry-run).
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200
        assert query_db(f"SELECT service_id FROM photos WHERE id='{photo_id}'")[0][
            "service_id"
        ] == service_id

    def test_delete_bare_service_no_body_returns_204_and_row_gone(
        self, api_client, create_service
    ) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2)."""
        service = create_service()

        resp = api_client.delete(f"/api/v1/services/{service['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 404

    def test_delete_service_with_activities_with_body_returns_422_blocking(
        self, api_client, create_activity
    ) -> None:
        """With body + blocking dep (activities) → 422 'archive instead' (spec §6.4)."""
        activity = create_activity()
        service_id = activity["service_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}", json={}
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_delete_service_with_auto_deps_with_body_executes_204(
        self, api_client, create_service
    ) -> None:
        """With body ``{}`` + all-auto deps → 204 execute.

        EXPECTED RED until Task 10 lands ``ArchiveService.resolve_delete``.

        Outcomes (spec §6 execution order nullify → cascade → hard delete):
        * photos: ``service_id`` SET NULL (photo survives, auto-nullify).
        * tariffs: hard-deleted (auto-cascade).
        * service_tags: hard-deleted (auto-cascade).
        * service: hard-deleted.
        """
        tag_id = _create_tag(api_client)
        service = create_service(
            tariffs=[TARIFF_PAYLOAD], tag_ids=[tag_id]
        )
        service_id = service["id"]
        # Capture tariff + photo IDs before delete.
        tariff_id_before = query_db(
            f"SELECT id FROM tariffs WHERE service_id='{service_id}'"
        )[0]["id"]
        photo_resp = api_client.post(
            "/api/v1/photos",
            json={"filename": f"svc-{service_id[:8]}.jpg", "service_id": service_id},
        )
        photo_id = photo_resp.json()["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}", json={}
        )

        assert resp.status_code == 204
        # Service row gone.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 404
        # Tariffs hard-deleted (auto-cascade).
        assert query_db(f"SELECT * FROM tariffs WHERE id='{tariff_id_before}'") == []
        # service_tags join rows hard-deleted (auto-cascade).
        assert (
            query_db(
                f"SELECT * FROM service_tags WHERE service_id='{service_id}'"
            )
            == []
        )
        # Photo survives with service_id=NULL (auto-nullify).
        photo_rows = query_db(f"SELECT service_id FROM photos WHERE id='{photo_id}'")
        assert len(photo_rows) == 1
        assert photo_rows[0]["service_id"] is None

    def test_delete_nonexistent_service_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/services/nonexistent-service-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "SERVICE_NOT_FOUND"

    def test_delete_nonexistent_service_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → AttributeError today).
        """
        resp = api_client.request(
            "DELETE", "/api/v1/services/nonexistent-service-id", json={}
        )
        assert resp.status_code == 404
