"""Tests for photo Pydantic schemas."""

from datetime import datetime

import pytest

pytestmark = pytest.mark.pure_unit


class TestPhotoResponse:
    """PhotoResponse schema creation and validation."""

    def test_photo_response_construct(self):
        """PhotoResponse can be constructed with all required fields."""
        from src.schemas.photo import PhotoResponse

        now = datetime.utcnow()
        schema = PhotoResponse(
            id="123e4567-e89b-12d3-a456-426614174000",
            filename="photo_001.jpg",
            visitor_id=None,
            service_id=None,
            activity_id=None,
            is_public=True,
            created_at=now,
            updated_at=now,
        )
        assert schema.id == "123e4567-e89b-12d3-a456-426614174000"
        assert schema.filename == "photo_001.jpg"
        assert schema.is_public is True

    def test_photo_response_default_is_public(self):
        """PhotoResponse defaults is_public to False."""
        from src.schemas.photo import PhotoResponse

        now = datetime.utcnow()
        schema = PhotoResponse(
            id="abc",
            filename="pic.jpg",
            created_at=now,
            updated_at=now,
        )
        assert schema.is_public is False

    def test_photo_response_from_orm(self):
        """PhotoResponse can be built from a Photo ORM instance via from_attributes."""
        from src.models.photo import Photo
        from src.schemas.photo import PhotoResponse

        now = datetime.utcnow()
        photo = Photo(
            id="test-uuid-1234",
            filename="orm_test.jpg",
            is_public=True,
            created_at=now,
            updated_at=now,
        )
        schema = PhotoResponse.model_validate(photo)
        assert schema.filename == "orm_test.jpg"
        assert schema.is_public is True
        assert schema.id == "test-uuid-1234"
        assert isinstance(schema.created_at, datetime)
