"""Tests for UserSettings Pydantic schemas."""

from datetime import datetime

import pytest

pytestmark = pytest.mark.pure_unit


class TestUserSettingsResponse:
    """UserSettingsResponse schema construction and validation."""

    def test_response_all_fields(self):
        """UserSettingsResponse works with all fields provided."""
        from src.schemas.user_settings import UserSettingsResponse

        now = datetime.utcnow()
        schema = UserSettingsResponse(
            id="settings-uuid-123",
            user_id="user-uuid-456",
            theme="dark",
            language="en",
            column_order_masters=["first_name", "last_name", "color"],
            column_order_locations=["name", "address", "capacity"],
            created_at=now,
            updated_at=now,
        )
        assert schema.id == "settings-uuid-123"
        assert schema.user_id == "user-uuid-456"
        assert schema.theme == "dark"
        assert schema.language == "en"
        assert schema.column_order_masters == ["first_name", "last_name", "color"]
        assert schema.column_order_locations == ["name", "address", "capacity"]

    def test_response_from_attributes(self):
        """UserSettingsResponse can be built from ORM via from_attributes."""
        from src.schemas.user_settings import UserSettingsResponse

        class FakeUserSettings:
            id = "orm-id"
            user_id = "orm-user"
            theme = "light"
            language = "ru"
            column_order_masters = ["first_name", "color"]
            column_order_locations = ["name", "address"]
            created_at = datetime.utcnow()
            updated_at = datetime.utcnow()

        schema = UserSettingsResponse.model_validate(FakeUserSettings())
        assert schema.id == "orm-id"
        assert schema.theme == "light"
        assert schema.column_order_masters == ["first_name", "color"]


class TestUserSettingsCreate:
    """UserSettingsCreate schema with defaults."""

    def test_create_defaults(self):
        """UserSettingsCreate defaults theme=light, language=ru, empty column orders."""
        from src.schemas.user_settings import UserSettingsCreate

        schema = UserSettingsCreate(user_id="user-123")
        assert schema.user_id == "user-123"
        assert schema.theme == "light"
        assert schema.language == "ru"
        assert schema.column_order_masters == []
        assert schema.column_order_locations == []

    def test_create_all_fields(self):
        """UserSettingsCreate works with all fields provided."""
        from src.schemas.user_settings import UserSettingsCreate

        schema = UserSettingsCreate(
            user_id="user-456",
            theme="dark",
            language="en",
            column_order_masters=["color", "position"],
            column_order_locations=["name", "capacity"],
        )
        assert schema.user_id == "user-456"
        assert schema.theme == "dark"
        assert schema.language == "en"

    def test_create_requires_user_id(self):
        """UserSettingsCreate fails without user_id."""
        from src.schemas.user_settings import UserSettingsCreate
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            UserSettingsCreate()


class TestUserSettingsUpdate:
    """UserSettingsUpdate schema with all optional fields."""

    def test_update_empty(self):
        """Empty update is valid (no changes)."""
        from src.schemas.user_settings import UserSettingsUpdate

        schema = UserSettingsUpdate()
        assert schema.theme is None
        assert schema.language is None
        assert schema.column_order_masters is None
        assert schema.column_order_locations is None

    def test_update_theme_only(self):
        """Update with only theme."""
        from src.schemas.user_settings import UserSettingsUpdate

        schema = UserSettingsUpdate(theme="dark")
        assert schema.theme == "dark"
        assert schema.language is None
        assert schema.column_order_masters is None

    def test_update_columns_only(self):
        """Update with only column orders."""
        from src.schemas.user_settings import UserSettingsUpdate

        schema = UserSettingsUpdate(
            column_order_masters=["last_name", "first_name"],
            column_order_locations=["address"],
        )
        assert schema.column_order_masters == ["last_name", "first_name"]
        assert schema.column_order_locations == ["address"]
        assert schema.theme is None
        assert schema.language is None

    def test_update_all_fields(self):
        """Update with all fields."""
        from src.schemas.user_settings import UserSettingsUpdate

        schema = UserSettingsUpdate(
            theme="dark",
            language="en",
            column_order_masters=["color"],
            column_order_locations=["name"],
        )
        assert schema.theme == "dark"
        assert schema.language == "en"
