"""Tests for Location.is_public field (GH #601 Task 1).

Web-visibility flag: ``is_public = true`` → shown on the client site
(default), ``false`` → hidden from the site only, fully working in admin.
Distinct from the archive (``archived``) — see
docs/domain-rules/locations.md → Invariants.

Covers:
  - Pydantic: ``is_public`` optional-with-default-``True`` in
    ``LocationBase`` (inherited by Create/Update), separate in
    ``LocationPatch`` (``None`` = don't change), serialized by
    ``LocationResponse``
  - API: create/get/PUT/PATCH with and without the flag
  - DB: column exists, NOT NULL, server default 1 (true)
"""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


# ─── Schema Tests ────────────────────────────────────────────────────────────


class TestLocationSchemaIsPublic:
    """Verify LocationBase/Patch/Response carry ``is_public``."""

    def test_location_base_has_is_public(self) -> None:
        """LocationBase schema accepts is_public as a bool."""
        from src.schemas.location import LocationBase

        loc = LocationBase(title="Test", capacity=10, is_public=False)
        assert loc.is_public is False

    def test_location_base_is_public_defaults_to_true(self) -> None:
        """LocationBase schema defaults is_public to True when omitted."""
        from src.schemas.location import LocationBase

        loc = LocationBase(title="Test", capacity=10)
        assert loc.is_public is True

    def test_location_update_accepts_is_public(self) -> None:
        """LocationUpdate inherits is_public (full PUT contract, #601 §2.1)."""
        from src.schemas.location import LocationUpdate

        upd = LocationUpdate(title="Test", capacity=10, is_public=False)
        assert upd.is_public is False

    def test_location_patch_accepts_is_public(self) -> None:
        """LocationPatch carries is_public separately (no Base inheritance)."""
        from src.schemas.location import LocationPatch

        patch = LocationPatch(is_public=False)
        assert patch.is_public is False

    def test_location_patch_is_public_defaults_to_none(self) -> None:
        """LocationPatch.is_public defaults to None (= don't change)."""
        from src.schemas.location import LocationPatch

        assert LocationPatch().is_public is None

    def test_location_response_serializes_is_public(self) -> None:
        """LocationResponse serializes is_public to JSON."""
        from src.schemas.location import LocationResponse
        from src.util.utc import utc_now

        resp = LocationResponse(
            id="test-id",
            title="Studio",
            capacity=20,
            created_at=utc_now(),
            updated_at=utc_now(),
            is_active=True,
            is_public=False,
        )
        dump = resp.model_dump()
        assert dump["is_public"] is False

    def test_location_response_from_attributes_reads_is_public(self) -> None:
        """LocationResponse picks is_public up from ORM attributes."""
        from types import SimpleNamespace
        from datetime import UTC, datetime

        from src.schemas.location import LocationResponse

        orm = SimpleNamespace(
            id="loc-1",
            title="Studio A",
            short_title=None,
            address=None,
            description=None,
            capacity=10,
            yandex_map_url=None,
            review_url=None,
            record_info=None,
            image_url=None,
            location_hint=None,
            sort_order=0,
            is_public=False,
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=True,
        )
        resp = LocationResponse.model_validate(orm)
        assert resp.is_public is False


# ─── API Tests ───────────────────────────────────────────────────────────────


class TestLocationApiIsPublic:
    """CRUD tests verifying is_public flows through the API."""

    def test_create_location_with_is_public_false(self, api_client) -> None:
        """POST /api/v1/locations with is_public=false returns it."""
        resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Скрытая студия", "capacity": 30, "is_public": False},
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_create_location_without_is_public_defaults_true(
        self, api_client
    ) -> None:
        """POST /api/v1/locations omitting is_public → true (back-compat)."""
        resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Обычная студия", "capacity": 15},
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        assert resp.json()["is_public"] is True

    def test_get_location_returns_is_public(self, api_client) -> None:
        """GET /api/v1/locations/{id} includes is_public."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Polyana", "capacity": 25, "is_public": False},
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.get(f"/api/v1/locations/{loc_id}")
        assert resp.status_code == 200
        assert resp.json()["is_public"] is False

    def test_put_location_sets_is_public_false(self, api_client) -> None:
        """PUT /api/v1/locations/{id} with is_public=false updates it."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Studio", "capacity": 10},
        )
        loc_id = create_resp.json()["id"]
        assert create_resp.json()["is_public"] is True

        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={"title": "Studio", "capacity": 10, "is_public": False},
        )
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_put_location_without_is_public_applies_default_true(
        self, api_client
    ) -> None:
        """PUT omitting is_public → schema default true (full replacement)."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Studio", "capacity": 10, "is_public": False},
        )
        loc_id = create_resp.json()["id"]
        assert create_resp.json()["is_public"] is False

        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={"title": "Studio", "capacity": 10},
        )
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert resp.json()["is_public"] is True

    def test_patch_location_sets_is_public_false(self, api_client) -> None:
        """PATCH /api/v1/locations/{id} with is_public=false updates it."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Studio", "capacity": 10},
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/locations/{loc_id}",
            json={"is_public": False},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_patch_location_without_is_public_keeps_false(
        self, api_client
    ) -> None:
        """PATCH omitting is_public leaves a hidden location hidden."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Studio", "capacity": 10, "is_public": False},
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/locations/{loc_id}",
            json={"title": "Studio Renamed"},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        body = resp.json()
        assert body["title"] == "Studio Renamed"
        assert body["is_public"] is False

    def test_patch_location_explicit_null_is_public_keeps_value(
        self, api_client
    ) -> None:
        """PATCH {"is_public": null} means 'don't change' (NOT NULL guard)."""
        create_resp = api_client.post(
            "/api/v1/locations",
            json={"title": "Studio", "capacity": 10, "is_public": False},
        )
        loc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/locations/{loc_id}",
            json={"is_public": None},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_list_locations_includes_is_public(self, api_client) -> None:
        """GET /api/v1/locations returns is_public in list items."""
        api_client.post(
            "/api/v1/locations",
            json={"title": "Hidden", "capacity": 5, "is_public": False},
        )
        resp = api_client.get("/api/v1/locations")
        assert resp.status_code == 200
        locations = resp.json()["items"]
        assert any(loc["is_public"] is False for loc in locations)


# ─── DB Column Tests ─────────────────────────────────────────────────────────


class TestLocationDbIsPublic:
    """Verify the SQLite column exists with correct properties."""

    def test_is_public_column_exists(self) -> None:
        """locations table has an is_public column."""
        rows = query_db("PRAGMA table_info(locations)")
        columns = {r["name"] for r in rows}
        assert "is_public" in columns

    def test_is_public_column_is_not_null(self) -> None:
        """is_public column is NOT NULL (notnull == 1)."""
        rows = query_db("PRAGMA table_info(locations)")
        col = next(r for r in rows if r["name"] == "is_public")
        assert col["notnull"] == 1, (
            f"Expected NOT NULL, got notnull={col['notnull']}"
        )

    def test_is_public_server_default_is_true(self) -> None:
        """is_public column server default is 1 (true) — existing rows stay
        visible when the migration adds the column (#601 §7)."""
        rows = query_db("PRAGMA table_info(locations)")
        col = next(r for r in rows if r["name"] == "is_public")
        assert col["dflt_value"] in ("1", "true"), (
            f"Expected server default 1/true, got {col['dflt_value']!r}"
        )
