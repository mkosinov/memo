"""Tests for Location.short_title field.

Covers:
  - Pydantic schema: short_title is optional in Base/Create/Update/Response
  - API: create/update/get with short_title
  - API: create without short_title → null
  - DB: column exists, nullable, VARCHAR(50)
"""

import sqlite3

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


# ─── Schema Tests ────────────────────────────────────────────────────────────


class TestLocationSchemaShortTitle:
    """Verify LocationBase includes short_title as optional field."""

    def test_location_base_has_short_title(self) -> None:
        """LocationBase schema accepts short_title as optional str."""
        from src.schemas.location import LocationBase

        loc = LocationBase(name="Test", capacity=10, short_title="T")
        assert loc.short_title == "T"

    def test_location_base_short_title_defaults_to_none(self) -> None:
        """LocationBase schema defaults short_title to None when omitted."""
        from src.schemas.location import LocationBase

        loc = LocationBase(name="Test", capacity=10)
        assert loc.short_title is None

    def test_location_response_includes_short_title(self) -> None:
        """LocationResponse can be created with short_title."""
        from datetime import datetime

        from src.schemas.location import LocationResponse

        resp = LocationResponse(
            id="test-id",
            name="Test Studio",
            capacity=20,
            short_title="TS",
            created_at=datetime.now(),
            updated_at=datetime.now(),
            is_active=True,
        )
        assert resp.short_title == "TS"

    def test_location_response_short_title_optional(self) -> None:
        """LocationResponse allows short_title=None."""
        from datetime import datetime

        from src.schemas.location import LocationResponse

        resp = LocationResponse(
            id="test-id",
            name="Test Studio",
            capacity=20,
            created_at=datetime.now(),
            updated_at=datetime.now(),
            is_active=True,
        )
        assert resp.short_title is None


# ─── API Tests ───────────────────────────────────────────────────────────────


class TestLocationApiShortTitle:
    """CRUD tests verifying short_title flows through the API."""

    def test_create_location_with_short_title(self, api_client) -> None:
        """POST /api/v1/locations with short_title returns it."""
        resp = api_client.post(
            "/api/v1/locations",
            json={
                "name": "Гранд Отель Поляна 1389",
                "capacity": 30,
                "short_title": "Гранд",
            },
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        body = resp.json()
        assert body["short_title"] == "Гранд"

    def test_create_location_without_short_title_returns_null(
        self, api_client
    ) -> None:
        """POST /api/v1/locations omitting short_title → null."""
        resp = api_client.post(
            "/api/v1/locations",
            json={"name": "Альпика", "capacity": 15},
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        assert resp.json()["short_title"] is None

    def test_get_location_returns_short_title(self, api_client) -> None:
        """GET /api/v1/locations/{id} includes short_title."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={
                "name": "Polyana 1389",
                "capacity": 25,
                "short_title": "Polyana",
            },
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.get(f"/api/v1/locations/{loc_id}")
        assert resp.status_code == 200
        assert resp.json()["short_title"] == "Polyana"

    def test_update_location_sets_short_title(self, api_client) -> None:
        """PUT /api/v1/locations/{id} with short_title updates it."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"name": "Studio", "capacity": 10},
        )
        loc_id = create_resp.json()["id"]
        assert create_resp.json()["short_title"] is None

        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={
                # #207 §3.2: is_active removed from LocationUpdate (PUT) —
                # archive/restore only via POST endpoints.
                "name": "Studio",
                "capacity": 10,
                "short_title": "ST",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["short_title"] == "ST"

    def test_update_location_clears_short_title(self, api_client) -> None:
        """PUT /api/v1/locations/{id} with short_title=None clears it."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={
                "name": "Studio",
                "capacity": 10,
                "short_title": "S",
            },
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={
                # #207 §3.2: is_active removed from LocationUpdate (PUT).
                "name": "Studio",
                "capacity": 10,
                "short_title": None,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["short_title"] is None

    def test_list_locations_includes_short_title(self, api_client) -> None:
        """GET /api/v1/locations returns short_title in list items."""
        api_client.post(
            "/api/v1/locations",
            json={
                "name": "Test",
                "capacity": 5,
                "short_title": "T",
            },
        )
        resp = api_client.get("/api/v1/locations")
        assert resp.status_code == 200
        locations = resp.json()["items"]
        assert any(loc["short_title"] == "T" for loc in locations)


# ─── DB Column Tests ─────────────────────────────────────────────────────────


class TestLocationDbShortTitle:
    """Verify the SQLite column exists with correct properties."""

    def test_short_title_column_exists(self) -> None:
        """locations table has a short_title column."""
        rows = query_db("PRAGMA table_info(locations)")
        columns = {r["name"] for r in rows}
        assert "short_title" in columns

    def test_short_title_column_is_nullable(self) -> None:
        """short_title column is nullable (notnul == 0)."""
        rows = query_db("PRAGMA table_info(locations)")
        col = next(r for r in rows if r["name"] == "short_title")
        assert col["notnull"] == 0, f"Expected nullable, got notnull={col['notnull']}"

    def test_short_title_column_type_is_text(self) -> None:
        """short_title column type is varchar(50) or text (SQLite normalizes)."""
        rows = query_db("PRAGMA table_info(locations)")
        col = next(r for r in rows if r["name"] == "short_title")
        # SQLite stores VARCHAR(50) as "varchar(50)" in PRAGMA
        assert "varchar" in col["type"].lower() or col["type"].lower() == "text"
