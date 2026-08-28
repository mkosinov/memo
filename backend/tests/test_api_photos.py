"""Tests for the Photos web API endpoint (public photos)."""

import asyncio
from datetime import datetime

import pytest

pytestmark = pytest.mark.api


class TestPhotosWebEndpoint:
    """GET /api/v1/photos/web — public photos endpoint."""

    def test_web_returns_only_public_photos(self, api_client) -> None:
        """GET /api/v1/photos/web returns only photos with is_public=true."""
        # Insert test photos directly
        asyncio.run(_insert_photo_direct(
            id="public-01",
            filename="public.jpg",
            is_public=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="private-01",
            filename="private.jpg",
            is_public=False,
        ))

        response = api_client.get("/api/v1/photos/web")

        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        filenames = [p["filename"] for p in photos]
        assert "public.jpg" in filenames
        assert "private.jpg" not in filenames

    def test_web_filter_by_activity_id(self, api_client, create_activity) -> None:
        """GET /api/v1/photos/web?activity_id=X returns only photos for that activity."""
        # Create real activities to satisfy FK constraints
        activity_a = create_activity()
        activity_b = create_activity()

        asyncio.run(_insert_photo_direct(
            id="act-a-01",
            filename="activity_a.jpg",
            activity_id=activity_a["id"],
            is_public=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="act-b-01",
            filename="activity_b.jpg",
            activity_id=activity_b["id"],
            is_public=True,
        ))

        response = api_client.get(
            "/api/v1/photos/web",
            params={"activity_id": activity_a["id"]},
        )

        assert response.status_code == 200
        photos = response.json()
        filenames = [p["filename"] for p in photos]
        assert "activity_a.jpg" in filenames
        assert "activity_b.jpg" not in filenames

    def test_web_returns_empty_list_when_no_public_photos(self, api_client) -> None:
        """GET /api/v1/photos/web returns [] when no public photos exist."""
        asyncio.run(_insert_photo_direct(
            id="private-only",
            filename="private.jpg",
            is_public=False,
        ))

        response = api_client.get("/api/v1/photos/web")

        assert response.status_code == 200
        assert response.json() == []

    def test_web_response_matches_photo_response_schema(self, api_client) -> None:
        """GET /api/v1/photos/web returns items conforming to PhotoResponse schema."""
        from src.schemas.photo import PhotoResponse

        asyncio.run(_insert_photo_direct(
            id="schema-test",
            filename="schema_test.jpg",
            is_public=True,
        ))

        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert len(photos) == 1
        # Validate with schema
        photo = PhotoResponse.model_validate(photos[0])
        assert photo.filename == "schema_test.jpg"


# Owner IDs for the two-owners 422 test — the multiple-owner validator
# fires before any DB access, so arbitrary UUIDs are sufficient.
C1 = "11111111-1111-1111-1111-111111111111"
S1 = "22222222-2222-2222-2222-222222222222"


class TestPhotosListParams:
    """GET /api/v1/photos — query param validation (#211 Task 2)."""

    @pytest.mark.parametrize("bad", [
        {"page": 0},
        {"per_page": 0},
        {"per_page": 101},
        {"q": "a"},
        {"q": "x" * 101},
        {"sort_by": "client_id"},
        {"sort_order": "up"},
    ])
    def test_photos_list_params_422(self, api_client, bad) -> None:
        """Invalid page/per_page/q/sort values return 422."""
        response = api_client.get("/api/v1/photos", params=bad)
        assert response.status_code == 422

    def test_photo_create_two_owners_422(self, api_client) -> None:
        """POST with two owner IDs (client_id + service_id) returns 422."""
        response = api_client.post("/api/v1/photos", json={
            "filename": "a.jpg",
            "client_id": C1,
            "service_id": S1,
        })
        assert response.status_code == 422


class TestPhotosCRUD:
    """Full CRUD tests for photo endpoints."""

    def test_list_photos_empty(self, api_client) -> None:
        """GET /api/v1/photos returns empty list when no photos exist."""
        response = api_client.get("/api/v1/photos")
        assert response.status_code == 200
        assert response.json() == []

    def test_create_photo(self, api_client) -> None:
        """POST /api/v1/photos creates a new photo."""
        response = api_client.post("/api/v1/photos", json={
            "filename": "test-photo.jpg",
            "is_public": True,
        })
        assert response.status_code == 201
        data = response.json()
        assert data["filename"] == "test-photo.jpg"
        assert data["is_public"] is True
        assert "id" in data

    def test_get_photo(self, api_client) -> None:
        """GET /api/v1/photos/{id} returns a single photo."""
        create = api_client.post("/api/v1/photos", json={"filename": "get-me.jpg"})
        photo_id = create.json()["id"]
        response = api_client.get(f"/api/v1/photos/{photo_id}")
        assert response.status_code == 200
        assert response.json()["filename"] == "get-me.jpg"

    def test_get_photo_not_found(self, api_client) -> None:
        """GET /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.get("/api/v1/photos/nonexistent-id")
        assert response.status_code == 404

    def test_update_photo(self, api_client) -> None:
        """PUT /api/v1/photos/{id} updates a photo."""
        create = api_client.post("/api/v1/photos", json={"filename": "old.jpg"})
        photo_id = create.json()["id"]
        response = api_client.put(f"/api/v1/photos/{photo_id}", json={
            "filename": "new.jpg",
            "is_public": True,
        })
        assert response.status_code == 200
        assert response.json()["filename"] == "new.jpg"
        assert response.json()["is_public"] is True

    def test_update_photo_not_found(self, api_client) -> None:
        """PUT /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.put("/api/v1/photos/nonexistent-id", json={
            "filename": "new.jpg",
        })
        assert response.status_code == 404

    def test_delete_photo(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} hard-deletes a photo."""
        create = api_client.post("/api/v1/photos", json={"filename": "delete-me.jpg"})
        photo_id = create.json()["id"]
        response = api_client.delete(f"/api/v1/photos/{photo_id}")
        assert response.status_code == 204

    def test_delete_photo_not_found(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.delete("/api/v1/photos/nonexistent-id")
        assert response.status_code == 404

    def test_deleted_photo_not_in_list(self, api_client) -> None:
        """Deleted photo no longer appears in GET /api/v1/photos."""
        create = api_client.post("/api/v1/photos", json={"filename": "will-delete.jpg"})
        photo_id = create.json()["id"]
        api_client.delete(f"/api/v1/photos/{photo_id}")
        response = api_client.get("/api/v1/photos")
        filenames = [p["filename"] for p in response.json()]
        assert "will-delete.jpg" not in filenames

    def test_list_public_photos_unchanged(self, api_client) -> None:
        """GET /api/v1/photos/web still returns only public photos."""
        api_client.post("/api/v1/photos", json={"filename": "private.jpg", "is_public": False})
        api_client.post("/api/v1/photos", json={"filename": "public.jpg", "is_public": True})
        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert all(p["is_public"] for p in photos)


class TestPhotoPatch:
    """Tests for PATCH /api/v1/photos/{id}."""

    def test_patch_photo_not_found_404(self, api_client) -> None:
        """PATCH nonexistent photo returns 404."""
        response = api_client.patch("/api/v1/photos/nonexistent-id", json={"is_public": True})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "PHOTO_NOT_FOUND"

    def test_patch_photo_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-3"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        photo_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "photo-tag-3"

    def test_patch_photo_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve-photo"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"is_public": False})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve-photo"

    def test_patch_photo_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove-photo"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []

    def test_patch_photo_visitor_id_to_null(self, api_client) -> None:
        """PATCH {"visitor_id": null} sets visitor_id to null (nullable field)."""
        # Create a visitor to link the photo to
        client_resp = api_client.post("/api/v1/clients", json={
            "name": "PhotoClient", "phone": "+79991112233",
        })
        client_id = client_resp.json()["id"]
        visitor_resp = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "PhotoVisitor", "age": 25,
        })
        visitor_id = visitor_resp.json()["id"]

        create = api_client.post("/api/v1/photos", json={
            "filename": "linked.jpg",
            "visitor_id": visitor_id,
            "is_public": True,
        })
        photo_id = create.json()["id"]
        assert create.json()["visitor_id"] == visitor_id

        response = api_client.patch(
            f"/api/v1/photos/{photo_id}",
            json={"visitor_id": None},
        )
        assert response.status_code == 200
        assert response.json()["visitor_id"] is None

    def test_patch_photo_empty_body_noop(self, api_client) -> None:
        """PATCH {} leaves all fields unchanged."""
        create = api_client.post("/api/v1/photos", json={
            "filename": "noop.jpg", "is_public": True,
        })
        photo_id = create.json()["id"]
        original = create.json()

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={})
        assert response.status_code == 200
        patched = response.json()

        assert patched["filename"] == original["filename"]
        assert patched["is_public"] == original["is_public"]
        assert patched["visitor_id"] == original["visitor_id"]

    def test_patch_photo_null_filename_stripped(self, api_client) -> None:
        """PATCH {"filename": null} leaves filename unchanged (NOT NULL field, null silently stripped)."""
        create = api_client.post("/api/v1/photos", json={
            "filename": "keep-me.jpg", "is_public": False,
        })
        photo_id = create.json()["id"]
        original_filename = create.json()["filename"]

        response = api_client.patch(
            f"/api/v1/photos/{photo_id}",
            json={"filename": None},
        )
        assert response.status_code == 200
        assert response.json()["filename"] == original_filename


async def _insert_photo_direct(
    id: str,
    filename: str,
    is_public: bool = False,
    activity_id: str | None = None,
) -> None:
    """Insert a Photo directly into the database."""
    from src.db import db_manager
    from src.models.photo import Photo

    async with db_manager.async_session() as session:
        photo = Photo(
            id=id,
            filename=filename,
            is_public=is_public,
            activity_id=activity_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(photo)
        await session.commit()
