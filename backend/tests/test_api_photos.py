"""Tests for the Photos web API endpoint (public photos)."""

import asyncio
from datetime import datetime

import pytest

pytestmark = pytest.mark.api


class TestPhotosWebEndpoint:
    """GET /api/v1/photos/web — public photos endpoint."""

    def test_web_returns_only_public_active_photos(self, api_client) -> None:
        """GET /api/v1/photos/web returns only photos with is_public=true and is_active=true."""
        # Insert test photos directly
        asyncio.run(_insert_photo_direct(
            id="public-01",
            filename="public.jpg",
            is_public=True,
            is_active=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="private-01",
            filename="private.jpg",
            is_public=False,
            is_active=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="inactive-01",
            filename="inactive.jpg",
            is_public=True,
            is_active=False,
        ))

        response = api_client.get("/api/v1/photos/web")

        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        filenames = [p["filename"] for p in photos]
        assert "public.jpg" in filenames
        assert "private.jpg" not in filenames
        assert "inactive.jpg" not in filenames

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
            is_active=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="act-b-01",
            filename="activity_b.jpg",
            activity_id=activity_b["id"],
            is_public=True,
            is_active=True,
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
        """GET /api/v1/photos/web returns [] when no public active photos exist."""
        asyncio.run(_insert_photo_direct(
            id="private-only",
            filename="private.jpg",
            is_public=False,
            is_active=True,
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
            is_active=True,
        ))

        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert len(photos) == 1
        # Validate with schema
        photo = PhotoResponse.model_validate(photos[0])
        assert photo.filename == "schema_test.jpg"


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
        """DELETE /api/v1/photos/{id} soft-deletes a photo."""
        create = api_client.post("/api/v1/photos", json={"filename": "delete-me.jpg"})
        photo_id = create.json()["id"]
        response = api_client.delete(f"/api/v1/photos/{photo_id}")
        assert response.status_code == 204

    def test_delete_photo_not_found(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.delete("/api/v1/photos/nonexistent-id")
        assert response.status_code == 404

    def test_deleted_photo_not_in_list(self, api_client) -> None:
        """Soft-deleted photo no longer appears in GET /api/v1/photos."""
        create = api_client.post("/api/v1/photos", json={"filename": "will-delete.jpg"})
        photo_id = create.json()["id"]
        api_client.delete(f"/api/v1/photos/{photo_id}")
        response = api_client.get("/api/v1/photos")
        filenames = [p["filename"] for p in response.json()]
        assert "will-delete.jpg" not in filenames

    def test_list_public_photos_unchanged(self, api_client) -> None:
        """GET /api/v1/photos/web still returns only public active photos."""
        api_client.post("/api/v1/photos", json={"filename": "private.jpg", "is_public": False})
        api_client.post("/api/v1/photos", json={"filename": "public.jpg", "is_public": True})
        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert all(p["is_public"] for p in photos)


async def _insert_photo_direct(
    id: str,
    filename: str,
    is_public: bool = False,
    is_active: bool = True,
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
            is_active=is_active,
            activity_id=activity_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(photo)
        await session.commit()
