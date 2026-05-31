"""Tests for the Photos web API endpoint (public photos)."""

import asyncio
import uuid
from datetime import datetime

from fastapi.testclient import TestClient


class TestPhotosWebEndpoint:
    """GET /api/v1/photos/web — public photos endpoint."""

    def test_web_returns_only_public_active_photos(self) -> None:
        """GET /api/v1/photos/web returns only photos with is_public=true and is_active=true."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
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

            response = client.get("/api/v1/photos/web")

        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        filenames = [p["filename"] for p in photos]
        assert "public.jpg" in filenames
        assert "private.jpg" not in filenames
        assert "inactive.jpg" not in filenames

    def test_web_filter_by_activity_id(self) -> None:
        """GET /api/v1/photos/web?activity_id=X returns only photos for that activity."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            asyncio.run(_insert_photo_direct(
                id="act-a-01",
                filename="activity_a.jpg",
                activity_id="activity-111",
                is_public=True,
                is_active=True,
            ))
            asyncio.run(_insert_photo_direct(
                id="act-b-01",
                filename="activity_b.jpg",
                activity_id="activity-222",
                is_public=True,
                is_active=True,
            ))

            response = client.get(
                "/api/v1/photos/web",
                params={"activity_id": "activity-111"},
            )

        assert response.status_code == 200
        photos = response.json()
        filenames = [p["filename"] for p in photos]
        assert "activity_a.jpg" in filenames
        assert "activity_b.jpg" not in filenames

    def test_web_returns_empty_list_when_no_public_photos(self) -> None:
        """GET /api/v1/photos/web returns [] when no public active photos exist."""
        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            asyncio.run(_insert_photo_direct(
                id="private-only",
                filename="private.jpg",
                is_public=False,
                is_active=True,
            ))

            response = client.get("/api/v1/photos/web")

        assert response.status_code == 200
        assert response.json() == []

    def test_web_response_matches_photo_response_schema(self) -> None:
        """GET /api/v1/photos/web returns items conforming to PhotoResponse schema."""
        from src.main import create_app
        from src.schemas.photo import PhotoResponse

        app = create_app()
        with TestClient(app) as client:
            asyncio.run(_insert_photo_direct(
                id="schema-test",
                filename="schema_test.jpg",
                is_public=True,
                is_active=True,
            ))

            response = client.get("/api/v1/photos/web")
            assert response.status_code == 200
            photos = response.json()
            assert len(photos) == 1
            # Validate with schema
            photo = PhotoResponse.model_validate(photos[0])
            assert photo.filename == "schema_test.jpg"


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
