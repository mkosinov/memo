"""Tests for Service.is_public field (GH #606 Task 1, mirror of #601).

Web-visibility flag: ``is_public = true`` → shown on the client site
(default), ``false`` → hidden from the site only, fully working in
admin. Distinct from the archive (``archived``) — see
docs/domain-rules/services.md → Invariants and
docs/specs/2026-11-13-adr015-dictionaries-606-design.md §3.6.

Covers:
  - Pydantic: ``is_public`` default-``True`` in ``ServiceBase``
    (inherited by Create/Update/Response), separate line in
    ``ServicePatch`` (``None`` = don't change)
  - API: create/get/PUT/PATCH with and without the flag (PUT is
    full-replace: absent flag → schema default ``true``)
  - Audit: toggling the flag journals a row (``is_public`` in
    ``_SERVICE_MARK_FIELDS`` — a flag-only PUT is not an empty diff)
  - DB: column exists, NOT NULL, server default 1 (true)
"""

import json

import pytest

from src.events import audit
from tests.conftest import query_db

pytestmark = pytest.mark.api

# Baseline create payload — the required ServiceBase scalars.
_CREATE_PAYLOAD = {
    "title": "Мастерская",
    "description": "о",
    "image_url": "https://example.com/x.jpg",
    "specialty": "живопись",
    "min_age": 6,
    "duration": 90,
    "record_info": "и",
}


# ─── Schema Tests ────────────────────────────────────────────────────────────


class TestServiceSchemaIsPublic:
    """Verify ServiceBase/Patch/Response carry ``is_public``."""

    def test_service_base_has_is_public(self) -> None:
        """ServiceBase schema accepts is_public as a bool."""
        from src.schemas.service import ServiceBase

        svc = ServiceBase(
            **_CREATE_PAYLOAD,
            is_public=False,
        )
        assert svc.is_public is False

    def test_service_base_is_public_defaults_to_true(self) -> None:
        """ServiceBase schema defaults is_public to True when omitted."""
        from src.schemas.service import ServiceBase

        svc = ServiceBase(**_CREATE_PAYLOAD)
        assert svc.is_public is True

    def test_service_update_accepts_is_public(self) -> None:
        """ServiceUpdate inherits is_public (full PUT contract, #606 §3.6)."""
        from src.schemas.service import ServiceUpdate

        upd = ServiceUpdate(**_CREATE_PAYLOAD, is_public=False)
        assert upd.is_public is False

    def test_service_patch_accepts_is_public(self) -> None:
        """ServicePatch carries is_public separately (no Base inheritance)."""
        from src.schemas.service import ServicePatch

        patch = ServicePatch(is_public=False)
        assert patch.is_public is False

    def test_service_patch_is_public_defaults_to_none(self) -> None:
        """ServicePatch.is_public defaults to None (= don't change)."""
        from src.schemas.service import ServicePatch

        assert ServicePatch().is_public is None

    def test_service_response_serializes_is_public(self) -> None:
        """ServiceResponse serializes is_public to JSON."""
        from datetime import UTC, datetime

        from src.schemas.service import ServiceResponse

        resp = ServiceResponse(
            id="test-id",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=True,
            is_public=False,
            **_CREATE_PAYLOAD,
        )
        dump = resp.model_dump()
        assert dump["is_public"] is False

    def test_service_response_from_attributes_reads_is_public(self) -> None:
        """ServiceResponse picks is_public up from ORM attributes."""
        from datetime import UTC, datetime
        from types import SimpleNamespace

        from src.schemas.service import ServiceResponse

        orm = SimpleNamespace(
            id="svc-1",
            title="Мастерская",
            description="о",
            image_url="https://example.com/x.jpg",
            specialty="живопись",
            min_age=6,
            max_age=None,
            duration=90,
            record_info="и",
            is_public=False,
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=True,
            tariffs=[],
            tags=[],
            materials=[],
        )
        resp = ServiceResponse.model_validate(orm)
        assert resp.is_public is False


# ─── API Tests ───────────────────────────────────────────────────────────────


class TestServiceApiIsPublic:
    """CRUD tests verifying is_public flows through the API."""

    def test_create_service_with_is_public_false(self, api_client) -> None:
        """POST /api/v1/services with is_public=false returns it."""
        resp = api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "title": "Скрытая услуга", "is_public": False},
        )
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_create_service_without_is_public_defaults_true(
        self, api_client
    ) -> None:
        """POST /api/v1/services omitting is_public → true (back-compat)."""
        resp = api_client.post("/api/v1/services", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201, f"Create failed: {resp.text}"
        assert resp.json()["is_public"] is True

    def test_get_service_returns_is_public(self, api_client) -> None:
        """GET /api/v1/services/{id} includes is_public."""
        create_resp = api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "title": "Глина", "is_public": False},
        )
        svc_id = create_resp.json()["id"]

        resp = api_client.get(f"/api/v1/services/{svc_id}")
        assert resp.status_code == 200
        assert resp.json()["is_public"] is False

    def test_put_service_sets_is_public_false(self, api_client) -> None:
        """PUT /api/v1/services/{id} with is_public=false updates it."""
        create_resp = api_client.post("/api/v1/services", json=_CREATE_PAYLOAD)
        svc_id = create_resp.json()["id"]
        assert create_resp.json()["is_public"] is True

        resp = api_client.put(
            f"/api/v1/services/{svc_id}",
            json={**_CREATE_PAYLOAD, "is_public": False},
        )
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_put_service_without_is_public_applies_default_true(
        self, api_client
    ) -> None:
        """PUT omitting is_public → schema default true (full replacement)."""
        create_resp = api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "is_public": False},
        )
        svc_id = create_resp.json()["id"]
        assert create_resp.json()["is_public"] is False

        resp = api_client.put(f"/api/v1/services/{svc_id}", json=_CREATE_PAYLOAD)
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert resp.json()["is_public"] is True

    def test_patch_service_sets_is_public_false(self, api_client) -> None:
        """PATCH /api/v1/services/{id} with is_public=false updates it."""
        create_resp = api_client.post("/api/v1/services", json=_CREATE_PAYLOAD)
        svc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/services/{svc_id}",
            json={"is_public": False},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_patch_service_without_is_public_keeps_false(
        self, api_client
    ) -> None:
        """PATCH omitting is_public leaves a hidden service hidden."""
        create_resp = api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "is_public": False},
        )
        svc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/services/{svc_id}",
            json={"title": "Мастерская 2"},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        body = resp.json()
        assert body["title"] == "Мастерская 2"
        assert body["is_public"] is False

    def test_patch_service_explicit_null_is_public_keeps_value(
        self, api_client
    ) -> None:
        """PATCH {"is_public": null} means 'don't change' (NOT NULL guard)."""
        create_resp = api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "is_public": False},
        )
        svc_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/services/{svc_id}",
            json={"is_public": None},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["is_public"] is False

    def test_list_services_includes_is_public(self, api_client) -> None:
        """GET /api/v1/services returns is_public in list items."""
        api_client.post(
            "/api/v1/services",
            json={**_CREATE_PAYLOAD, "title": "Hidden", "is_public": False},
        )
        resp = api_client.get("/api/v1/services")
        assert resp.status_code == 200
        services = resp.json()["items"]
        assert any(svc["is_public"] is False for svc in services)


# ─── Audit Tests (service level — the test_audit_explicit.py harness) ────────


@pytest.fixture
def audit_rows():
    """Factory: read all audit_logs rows (fresh sync connection per call)."""
    def read() -> list[dict]:
        return query_db(
            "SELECT user_id, user_role, action, entity, entity_id, "
            "entity_label, changes FROM audit_logs ORDER BY rowid"
        )

    return read


@pytest.fixture
def real_user():
    """A real users row (FK target for audit_logs.user_id)."""
    from tests.conftest import insert_user

    return insert_user("+79990009998", "x", role="admin")


@pytest.fixture
def actor(real_user):
    """Open the actor contextvar around a test."""
    token = audit.set_actor(user_id=real_user["id"], roles=["admin"])
    yield real_user
    audit.reset_actor(token)


def _insert_service(
    svc_id: str, title: str, specialty: str = "живопись"
) -> None:
    """Seed a service row directly (no service call → no journal row)."""
    query_db(
        f"INSERT INTO services (id, title, description, image_url, specialty, "
        f"min_age, duration, record_info, is_active, is_public, created_at, "
        f"updated_at) VALUES ('{svc_id}', '{title}', 'о', "
        f"'https://e.com/x.jpg', '{specialty}', 6, 90, 'и', 1, 1, "
        f"datetime('now'), datetime('now'))"
    )


class TestServiceAuditIsPublic:
    """Toggling is_public journals an audit row (#606 §3.6: the explicit
    ``_SERVICE_MARK_FIELDS`` list must carry the flag — a flag-only PUT
    is not an empty diff)."""

    async def test_patch_is_public_toggle_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.service import ServicePatch
        from src.services.service import get_service_service

        _insert_service("svc-isp-p", "Неизменное название")
        before = len(audit_rows())
        patched = await get_service_service().patch(
            db_session, "svc-isp-p", ServicePatch(is_public=False),
        )
        assert patched is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "services", "svc-isp-p")
        ]
        assert json.loads(rows[0]["changes"]) == {"is_public": [True, False]}

    async def test_put_flag_only_change_is_not_empty_diff(
        self, db_session, actor, audit_rows
    ) -> None:
        """A PUT that changes ONLY the flag journals the diff row (same
        values elsewhere — without the flag in the mark fields this PUT
        would be an invisible no-op, #606 §3.6)."""
        from src.schemas.service import ServiceUpdate
        from src.services.service import get_service_service

        _insert_service("svc-isp-u", "Неизменное название")
        before = len(audit_rows())
        updated = await get_service_service().update(
            db_session,
            "svc-isp-u",
            ServiceUpdate(
                title="Неизменное название",
                description="о",
                image_url="https://e.com/x.jpg",
                specialty="живопись",
                min_age=6,
                duration=90,
                record_info="и",
                is_public=False,
            ),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "services", "svc-isp-u")
        ]
        assert json.loads(rows[0]["changes"]) == {"is_public": [True, False]}


# ─── DB Column Tests ─────────────────────────────────────────────────────────


class TestServiceDbIsPublic:
    """Verify the SQLite column exists with correct properties."""

    def test_is_public_column_exists(self) -> None:
        """services table has an is_public column."""
        rows = query_db("PRAGMA table_info(services)")
        columns = {r["name"] for r in rows}
        assert "is_public" in columns

    def test_is_public_column_is_not_null(self) -> None:
        """is_public column is NOT NULL (notnull == 1)."""
        rows = query_db("PRAGMA table_info(services)")
        col = next(r for r in rows if r["name"] == "is_public")
        assert col["notnull"] == 1, (
            f"Expected NOT NULL, got notnull={col['notnull']}"
        )

    def test_is_public_server_default_is_true(self) -> None:
        """is_public column server default is 1 (true) — existing rows stay
        visible when the migration adds the column (#606 §9)."""
        rows = query_db("PRAGMA table_info(services)")
        col = next(r for r in rows if r["name"] == "is_public")
        assert col["dflt_value"] in ("1", "true"), (
            f"Expected server default 1/true, got {col['dflt_value']!r}"
        )
