"""Tests for the Services CRUD API endpoints with nested Tariffs and Tags."""

from uuid import uuid4

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
}

TAG_PAYLOAD = {"title": "beginner"}

TARIFF_PAYLOAD = {
    "title": "Standard",
    "description": "Standard tariff",
    "price": 1500,
}


class TestTariffAudience:
    """#284: ``audience`` typed enum on nested Tariff schemas (GH #284 Task 2).

    Contract: absent field → ``all`` (backward compat), explicit
    ``kid``/``adult``/``all`` round-trip, garbage string → 422 (no silent
    junk writes). Follows the pattern of Task 1 (enum + DB column exist
    already) — this pins the schema layer only.
    """

    def test_create_tariff_without_audience_defaults_all(self, api_client) -> None:
        """POST without audience → response audience == 'all' (old clients ok)."""
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [TARIFF_PAYLOAD],
        }
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        assert response.json()["tariffs"][0]["audience"] == "all"

    def test_create_tariff_explicit_audience_round_trip(self, api_client) -> None:
        """POST with audience='kid' → echoed back as 'kid' in response."""
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [{**TARIFF_PAYLOAD, "audience": "kid"}],
        }
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 201
        assert response.json()["tariffs"][0]["audience"] == "kid"

    def test_update_tariff_audience_round_trip(self, api_client) -> None:
        """PUT replacing tariffs with audience='adult' → echoed as 'adult'."""
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        assert create_resp.status_code == 201
        service_id = create_resp.json()["id"]

        response = api_client.put(
            f"/api/v1/services/{service_id}",
            json={
                **SERVICE_PAYLOAD,
                "tariffs": [{**TARIFF_PAYLOAD, "audience": "adult"}],
            },
        )

        assert response.status_code == 200
        assert response.json()["tariffs"][0]["audience"] == "adult"

    def test_create_tariff_unknown_audience_422(self, api_client) -> None:
        """POST with audience='seniors' (garbage) → 422, service not created."""
        payload = {
            **SERVICE_PAYLOAD,
            "tariffs": [{**TARIFF_PAYLOAD, "audience": "seniors"}],
        }
        response = api_client.post("/api/v1/services", json=payload)

        assert response.status_code == 422


def _create_tag(api_client) -> str:
    """Create a tag via POST /api/tags and return its ID."""
    response = api_client.post("/api/v1/tags", json=TAG_PAYLOAD)
    assert response.status_code == 201
    return response.json()["id"]


def _archive_service(service_id: str) -> None:
    """Archive a service row directly in the DB (sets is_active=0).

    Mirrors the ``_archive_material`` helper in ``test_api_materials.py`` (#207
    Task 13 Part B1): ``DELETE /services/{id}`` is now HARD (Task 2/3 of #207 —
    no row left to list under ``?status=archived``). Status-filter tests that
    need an archived row touch the ``is_active`` column directly via
    ``query_db`` (the same write the ``POST /{id}/archive`` endpoint performs
    via ``ArchiveService.archive`` → ``repo.patch({is_active: False})`` in
    Task 11 — kept as a direct DB write here to avoid coupling the filter test
    to the archive endpoint, which has its own coverage in
    ``TestArchiveRestoreEndpoints``).
    """
    query_db(f"UPDATE services SET is_active=0 WHERE id='{service_id}'")


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
        # #207 §3.1: Response exposes `archived` (inverted from is_active),
        # `is_active` itself is Field(exclude=True) and never serializes.
        assert body["archived"] is False
        assert body["tariffs"] == []
        assert body["tags"] == []
        # GH #223 Task 13: material_hint is retired — never serialized.
        assert "material_hint" not in body

    def test_create_service_with_stray_material_hint_stripped(
        self, api_client
    ) -> None:
        """GH #223 Task 13 regression: POST carrying material_hint → 201.

        ServiceCreate ignores extras (Pydantic default), so a legacy client
        still sending the retired field gets a 201 — but the field is absent
        from the response (retired from ServiceResponse).
        """
        response = api_client.post(
            "/api/v1/services",
            json={**SERVICE_PAYLOAD, "material_hint": "legacy hint"},
        )

        assert response.status_code == 201
        assert "material_hint" not in response.json()

    def test_update_service_with_stray_material_hint_422(
        self, api_client
    ) -> None:
        """GH #223 Task 13 regression: PUT carrying material_hint → 422.

        ServiceUpdate is extra="forbid" — a legacy admin still sending
        material_hint gets a 422 (known breaking change, spec §10).
        """
        created = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        assert created.status_code == 201
        service_id = created.json()["id"]

        response = api_client.put(
            f"/api/v1/services/{service_id}",
            json={**SERVICE_PAYLOAD, "material_hint": "legacy hint"},
        )

        assert response.status_code == 422

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
        assert body["tags"][0]["title"] == "beginner"

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
        tag2_resp = api_client.post("/api/v1/tags", json={"title": "advanced"})
        tag2_id = tag2_resp.json()["id"]

        update_data = {
            # #207 §3.2: is_active removed from ServiceUpdate (PUT) —
            # archive/restore only via POST /{id}/archive + /{id}/restore.
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
        assert body["tags"][0]["title"] == "advanced"

    def test_get_nonexistent_service_returns_404(self, api_client) -> None:
        """GET /api/services/{fake_id} returns 404."""
        response = api_client.get("/api/v1/services/nonexistent-id")
        assert response.status_code == 404

    def test_update_nonexistent_service_returns_404(self, api_client) -> None:
        """PUT /api/services/{fake_id} returns 404."""
        # #207 §3.2: is_active removed from ServiceUpdate — body must pass
        # schema validation (no is_active) so a missing-entity 404 wins over
        # an extra-field 422.
        response = api_client.put(
            "/api/v1/services/nonexistent-id",
            json=SERVICE_PAYLOAD,
        )
        assert response.status_code == 404

    def test_update_service_without_is_active_succeeds_200(self, api_client) -> None:
        """PUT /api/v1/services/{id} without is_active now SUCCEEDS (200).

        #207 §3.2 (auto-closes #178): ``is_active`` was removed from
        ``ServiceUpdate``. The old #178 canonical-PUT contract required
        ``is_active`` (omission → 422); the inverted contract is the opposite —
        PUT without ``is_active`` is the normal path, and a stray
        ``is_active`` would now 422 (pinned by
        ``test_put_service_rejects_is_active`` in ``test_put_is_active.py``
        + ``test_update_rejects_is_active.py``). The service stays active after
        the update (PUT is a full-replace that no longer touches the lifecycle
        flag).
        """
        create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
        service_id = create_resp.json()["id"]

        response = api_client.put(f"/api/v1/services/{service_id}", json=SERVICE_PAYLOAD)
        assert response.status_code == 200
        assert response.json()["archived"] is False

    def test_delete_nonexistent_service_returns_404(self, api_client) -> None:
        """DELETE /api/services/{fake_id} with the commit body → 404.

        GH #345 §4.1: the bare no-body DELETE is abolished — the 404 probe
        only runs for a well-formed commit (``expected`` present).
        """
        response = api_client.request(
            "DELETE", "/api/v1/services/nonexistent-id", json={"expected": {}},
        )
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
        # #207 §3.2: is_active removed from ServiceUpdate — drop the field so
        # the PUT validates (a stray is_active would 422 obscuring the max_age
        # nullification behavior under test).
        update_data = {**SERVICE_PAYLOAD, "max_age": None}
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
        tag1 = api_client.post("/api/v1/tags", json={"title": "tag1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"title": "tag2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"title": "tag3"}).json()

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
        assert tags[0]["title"] == "tag3"

    def test_patch_service_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"title": "preserve"}).json()

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
        assert tags[0]["title"] == "preserve"

    def test_patch_service_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"title": "remove"}).json()

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
        """?status=archived hides active services, surfaces archived ones.

        #207 Task 13 Part B1: archival is via the ``_archive_service`` DB helper
        (DELETE is now hard — leaves no row to list).
        """
        active = create_service()
        archived = create_service()
        _archive_service(archived["id"])

        resp = api_client.get("/api/v1/services?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [s["id"] for s in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        # #207 §3.1: `archived` is the inverted serialized field (True = in
        # archive). `is_active` itself never serializes (Field exclude=True).
        assert body["items"][0]["archived"] is True
        # Eager-loaded relationships still present on archived rows
        assert "tariffs" in body["items"][0]
        assert "tags" in body["items"][0]

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_service
    ) -> None:
        """?status=all returns every row regardless of is_active."""
        active = create_service()
        archived = create_service()
        _archive_service(archived["id"])

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
        _archive_service(archived["id"])

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
    """DELETE /api/v1/services/{id} — unified delete contract (GH #345,
    one-to-one mirror of ``tags.py:216-300`` / #318 D2).

    Modes (spec §4.1):
      * ``?dry_run=true`` — PURE preview: existence probe → missing → 404;
        ``collect_dependencies`` → empty → 204 WITHOUT deleting; non-empty
        → 409 + dependency tree. Never modifies rows; combined with a
        ``resolutions`` body → 422 ``dry_run_with_resolutions_forbidden``
        (checked before the probe).
      * No body, no flag → 422 ``expected_state_required`` — bare DELETE
        is abolished (the legacy execute-if-clean path is gone, S6).
      * Body ``{resolutions?, expected}`` — the deferred-delete commit:
        existence probe → ``collect_dependencies`` → expected id-set
        verification (subset semantics; Service non-auto deps: activities
        only) → resolutions validation → ``resolve_delete`` → 204;
        missing id → 404.

    Domain matrix (spec §4.4): ``activities`` is the ONLY non-auto dep —
    blocked (``allowed_actions: []``) → a successful commit with
    ``resolutions`` is unreachable (blocked at any body → 422; a clean or
    all-auto service commits with ``{expected: {}}``).
    """

    # ── bare DELETE (no flag, no body) → 422 expected_state_required ─────

    def test_bare_delete_blocked_service_returns_422_row_alive(
        self, api_client, create_activity,
    ) -> None:
        """S6: bare DELETE on a service with activities → 422, row alive."""
        service_id = create_activity()["service_id"]

        resp = api_client.delete(f"/api/v1/services/{service_id}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_bare_delete_clean_service_returns_422(
        self, api_client, create_service,
    ) -> None:
        """S6: bare DELETE executes nowhere — even a clean service refuses."""
        service = create_service(title="svc-clean-bare")

        resp = api_client.delete(f"/api/v1/services/{service['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    def test_bare_delete_unknown_id_returns_422_before_404(
        self, api_client,
    ) -> None:
        """S6: form check precedes the existence probe — 422, not 404."""
        resp = api_client.delete("/api/v1/services/nonexistent-service-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_resolutions_body_without_expected_returns_422(
        self, api_client, create_service,
    ) -> None:
        """S6: resolutions-only body is the rejected legacy shape."""
        service = create_service(title="svc-res-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}",
            json={"resolutions": {}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    def test_delete_unknown_keys_body_without_expected_returns_422(
        self, api_client, create_service,
    ) -> None:
        """S6: unknown-keys-only body has no ``expected`` — same 422."""
        service = create_service(title="svc-unknown-keys")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}",
            json={"bogus_key": "whatever"},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_blocked_service_returns_409_tree_row_alive(
        self, api_client, create_activity,
    ) -> None:
        """S6: dry-run on a service with activities → 409 has_dependencies.

        ``activities`` is a blocked non-auto node: counters only, NO items
        (spec §4.3 fixed boundary — blocked nodes are never confirmed, no
        item collectors for activities from the parent side).
        """
        service_id = create_activity()["service_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["activities"]["count"] == 1
        assert deps["activities"]["allowed_actions"] == []
        assert deps["activities"]["auto"] is False
        assert deps["activities"]["message"] is not None
        # §4.3: no items for the activities node (exclude_none omits it).
        assert "items" not in deps["activities"]
        # Row untouched.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_dry_run_all_auto_service_returns_409_tree_row_alive(
        self, api_client, create_service,
    ) -> None:
        """S2(б): dry-run on an all-auto service (tariffs+photos+
        service_tags+service_materials, NO activities) → 409 for informed
        consent; nothing is modified."""
        tag_id = _create_tag(api_client)
        material_id = api_client.post(
            "/api/v1/materials", json={"title": "Сухая пастель", "description": "мелки"},
        ).json()["id"]
        service = create_service(
            title="svc-all-auto", tariffs=[TARIFF_PAYLOAD], tag_ids=[tag_id],
            materials=[{"material_id": material_id}],
        )
        service_id = service["id"]
        photo_id = api_client.post(
            "/api/v1/photos",
            json={"filename": f"dry-{service_id[:8]}.jpg", "service_id": service_id},
        ).json()["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert "activities" not in deps  # zero-count dep is skipped
        assert deps["tariffs"]["count"] == 1
        assert deps["tariffs"]["allowed_actions"] == ["cascade"]
        assert deps["photos"]["count"] == 1
        assert deps["photos"]["allowed_actions"] == ["nullify"]
        assert deps["service_tags"]["count"] == 1
        assert deps["service_materials"]["count"] == 1
        # Nothing modified: row + tariff + join + photo link alive.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200
        assert query_db(f"SELECT service_id FROM photos WHERE id='{photo_id}'")[
            0
        ]["service_id"] == service_id
        assert query_db(f"SELECT * FROM tariffs WHERE service_id='{service_id}'")

    def test_dry_run_clean_service_returns_204_and_row_alive(
        self, api_client, create_service,
    ) -> None:
        """S2(а): dry-run on a clean service → 204 WITHOUT deleting."""
        service = create_service(title="svc-preview-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    def test_dry_run_unknown_service_returns_404(self, api_client) -> None:
        """S6: dry-run probes existence — missing service → 404."""
        resp = api_client.request(
            "DELETE", "/api/v1/services/nonexistent-service-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "SERVICE_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client, create_service,
    ) -> None:
        """S6: dry_run + resolutions → 422; combo checked before the probe."""
        service = create_service(title="svc-combo")

        for service_id in (service["id"], "nonexistent-service-id"):
            resp = api_client.request(
                "DELETE", f"/api/v1/services/{service_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"tariffs": "cascade"}},
            )
            assert resp.status_code == 422, f"{service_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    def test_dry_run_with_expected_only_body_silently_ignored(
        self, api_client, create_service,
    ) -> None:
        """Combinatorics: dry_run + expected-only body → preview proceeds."""
        service = create_service(title="svc-expected-only-preview")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    # ── body commit: existence + expected id-set verification ─────────────

    def test_commit_unknown_service_with_body_returns_404(
        self, api_client,
    ) -> None:
        """S6: nonexistent id WITH body → 404 (probe after the form)."""
        resp = api_client.request(
            "DELETE", "/api/v1/services/nonexistent-service-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "SERVICE_NOT_FOUND"

    def test_commit_clean_service_expected_empty_returns_204(
        self, api_client, create_service,
    ) -> None:
        """S2(а): clean path — ``{expected: {}}`` → 204 hard delete."""
        service = create_service(title="svc-commit-clean")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 404

    def test_commit_all_auto_service_expected_empty_executes_204(
        self, api_client, create_service,
    ) -> None:
        """S2(б): all-auto deps + commit ``{expected: {}}`` → 204.

        Outcomes (spec §6 execution order nullify → cascade → hard delete):
        * photos: ``service_id`` SET NULL (photo survives, auto-nullify);
        * tariffs: hard-deleted (auto-cascade);
        * service_tags: hard-deleted (auto-cascade);
        * service_materials: hard-deleted, MATERIAL survives;
        * service: hard-deleted.
        """
        tag_id = _create_tag(api_client)
        material_id = api_client.post(
            "/api/v1/materials", json={"title": "Тушь", "description": "пергамент"},
        ).json()["id"]
        service = create_service(
            title="svc-commit-all-auto", tariffs=[TARIFF_PAYLOAD],
            tag_ids=[tag_id], materials=[{"material_id": material_id}],
        )
        service_id = service["id"]
        tariff_id_before = query_db(
            f"SELECT id FROM tariffs WHERE service_id='{service_id}'"
        )[0]["id"]
        photo_id = api_client.post(
            "/api/v1/photos",
            json={"filename": f"cx-{service_id[:8]}.jpg", "service_id": service_id},
        ).json()["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}", json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 404
        # Tariffs hard-deleted (auto-cascade).
        assert query_db(f"SELECT * FROM tariffs WHERE id='{tariff_id_before}'") == []
        # service_tags + service_materials join rows hard-deleted.
        assert (
            query_db(f"SELECT * FROM service_tags WHERE service_id='{service_id}'")
            == []
        )
        assert (
            query_db(
                f"SELECT * FROM service_materials WHERE service_id='{service_id}'"
            )
            == []
        )
        # Photo survives with service_id=NULL (auto-nullify).
        photo_rows = query_db(f"SELECT service_id FROM photos WHERE id='{photo_id}'")
        assert len(photo_rows) == 1
        assert photo_rows[0]["service_id"] is None
        # Material SURVIVES the service-side cascade (GH #223 §7).
        mat = api_client.get(f"/api/v1/materials/{material_id}")
        assert mat.status_code == 200
        assert mat.json()["used_in_services_count"] == 0

    def test_commit_appeared_activity_returns_409_stale(
        self, api_client, create_master, create_location, create_service,
    ) -> None:
        """S5: an activity that APPEARED after the (clean) dry-run window
        → 409 ``stale_dependencies`` — the expected-subset check catches
        the race BEFORE the blocked-422 could fire."""
        from datetime import UTC, datetime, timedelta

        service = create_service(title="svc-race-appeared")
        service_id = service["id"]

        # Mid-window race: an activity appears via the API.
        api_client.post("/api/v1/activities", json={
            "master_id": create_master()["id"],
            "service_id": service_id,
            "location_id": create_location()["id"],
            "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        })

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}", json={"expected": {}},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["activities"]["count"] == 1
        # Nothing deleted — service AND the racing activity alive.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_commit_disappeared_activity_subset_passes_204(
        self, api_client, create_activity,
    ) -> None:
        """S5: dep removed mid-window → subset semantics → 204 (delete
        less than confirmed is OK). The confirmed activity disappears via
        its own commit before the service commit lands."""
        activity = create_activity()
        service_id = activity["service_id"]

        # The confirmed activity dies first (its own deferred-delete commit).
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )
        assert act_resp.status_code == 204, act_resp.text

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 404

    def test_commit_blocked_service_any_body_returns_422(
        self, api_client, create_activity,
    ) -> None:
        """S6: blocked dep (activities) at any body → 422 'archive instead'.

        The expected-check passes (the activity IS confirmed) — the 422
        comes from the resolutions validation inside ``resolve_delete``.
        """
        activity = create_activity()
        service_id = activity["service_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 422, resp.text
        # Row untouched.
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_commit_stale_beats_blocked_resolutions_returns_409_not_422(
        self, api_client, create_activity,
    ) -> None:
        """Order pin (#285 D7 mirror): a stale expected → 409 even when
        the resolutions/blocked branch would also 422."""
        activity = create_activity()
        service_id = activity["service_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            json={"expected": {}},  # stale: an activity exists on the server
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_commit_unknown_body_keys_silently_ignored(
        self, api_client, create_service,
    ) -> None:
        """S6: unknown body keys (with ``expected`` present) ignored → 204."""
        service = create_service(title="svc-unknown-keys-commit")

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service['id']}",
            json={"expected": {}, "bogus_key": "whatever"},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 404

    def test_commit_swapped_activity_id_returns_409(
        self, api_client, create_activity,
    ) -> None:
        """S5 rev6 mirror: a ghost id at an unchanged counter → 409
        (id-sets, not counters — the swap is caught)."""
        from uuid import uuid4

        activity = create_activity()
        service_id = activity["service_id"]
        ghost = str(uuid4())

        # Swap: delete the confirmed activity, create another one on the
        # SAME service — the counter stays 1, the id-set does not match.
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}", json={"expected": {}},
        )
        assert act_resp.status_code == 204
        from datetime import UTC, datetime, timedelta

        swapped = api_client.post("/api/v1/activities", json={
            "master_id": activity["master_id"],
            "service_id": service_id,
            "location_id": activity["location_id"],
            "start": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        })
        assert swapped.status_code == 201, swapped.text

        resp = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            json={"expected": {"activities": [ghost]}},
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200

    def test_commit_expected_carries_all_ids_beyond_ten(
        self, api_client, create_master, create_location, create_service,
    ) -> None:
        """>10 items pin (spec §4.2): ``expected`` carries ALL ids of the
        dependency tree, not the rendered top-10 rows.

        12 activities on one service; a commit confirming only the first
        10 id-sets → 409 ``stale_dependencies`` (ids 11–12 appeared from
        the check's point of view — mid-window race semantics).
        """
        from datetime import UTC, datetime, timedelta

        service = create_service(title="svc-12-activities")
        service_id = service["id"]
        master_id = create_master()["id"]
        location_id = create_location()["id"]
        activity_ids = []
        for i in range(12):
            resp = api_client.post("/api/v1/activities", json={
                "master_id": master_id,
                "service_id": service_id,
                "location_id": location_id,
                "start": (
                    datetime.now(UTC) + timedelta(days=3, hours=i)
                ).isoformat(),
                "duration": 60, "capacity": 10, "is_private": False,
            })
            assert resp.status_code == 201, resp.text
            activity_ids.append(resp.json()["id"])

        # Confirm only the first 10 → the remaining 2 are "new" → 409.
        partial = api_client.request(
            "DELETE", f"/api/v1/services/{service_id}",
            json={"expected": {"activities": activity_ids[:10]}},
        )
        assert partial.status_code == 409, partial.text
        assert partial.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/services/{service_id}").status_code == 200


class TestArchiveRestoreEndpoints:
    """POST /api/v1/services/{id}/archive + POST /{id}/restore — Task 11 (#207 §2/§14).

    Both endpoints return HTTP 200 with the re-fetched body (``archived``
    computed from ``is_active``). Idempotent. ``?status=archived`` lists
    archived rows after ``POST /archive``.
    """

    ENTITY_PATH = "/api/v1/services"
    NOT_FOUND_CODE = "SERVICE_NOT_FOUND"

    def test_archive_returns_200_with_archived_true_and_db_is_active_false(
        self, api_client, create_service
    ) -> None:
        service = create_service()

        resp = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        assert resp.status_code == 200, f"archive failed: {resp.text}"
        body = resp.json()
        assert body["id"] == service["id"]
        assert body["archived"] is True
        rows = query_db(
            f"SELECT is_active FROM services WHERE id='{service['id']}'"
        )
        assert rows[0]["is_active"] == 0

    def test_restore_returns_200_with_archived_false_and_db_is_active_true(
        self, api_client, create_service
    ) -> None:
        service = create_service()
        api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/restore")

        assert resp.status_code == 200, f"restore failed: {resp.text}"
        body = resp.json()
        assert body["archived"] is False
        rows = query_db(
            f"SELECT is_active FROM services WHERE id='{service['id']}'"
        )
        assert rows[0]["is_active"] == 1

    def test_archive_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.post(f"{self.ENTITY_PATH}/nonexistent-id/archive")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == self.NOT_FOUND_CODE

    def test_restore_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.post(f"{self.ENTITY_PATH}/nonexistent-id/restore")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == self.NOT_FOUND_CODE

    def test_archive_already_archived_is_idempotent_200(
        self, api_client, create_service
    ) -> None:
        service = create_service()
        first = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")
        assert first.status_code == 200

        second = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        assert second.status_code == 200
        assert second.json()["archived"] is True

    def test_restore_already_active_is_idempotent_200(
        self, api_client, create_service
    ) -> None:
        service = create_service()  # starts active

        resp = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/restore")

        assert resp.status_code == 200
        assert resp.json()["archived"] is False

    def test_status_archived_returns_archived_row_after_archive_endpoint(
        self, api_client, create_service
    ) -> None:
        service = create_service()
        api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        archived_list = api_client.get(f"{self.ENTITY_PATH}?status=archived").json()
        active_list = api_client.get(f"{self.ENTITY_PATH}?status=active").json()

        archived_ids = [m["id"] for m in archived_list["items"]]
        active_ids = [m["id"] for m in active_list["items"]]
        assert service["id"] in archived_ids
        assert service["id"] not in active_ids


class TestArchiveRestoreNoUserCascade:
    """Non-master entities MUST NOT touch the users table on archive/restore (#207 §4.2).

    Only Master cascades. Service has no link to the users table — verify by
    creating a user (is_active=true) then asserting users.is_active is
    unchanged after archive/restore.
    """

    ENTITY_PATH = "/api/v1/services"

    def test_archive_does_not_modify_users_is_active(
        self, api_client, create_service, _user
    ) -> None:
        service = create_service()

        resp = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1

    def test_restore_does_not_modify_users_is_active(
        self, api_client, create_service, _user
    ) -> None:
        service = create_service()
        api_client.post(f"{self.ENTITY_PATH}/{service['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{service['id']}/restore")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1


class TestServiceAllEndpoint:
    """GET /api/v1/services/all — bare array (GH #205 Task 2).

    Minimal smoke: returns a bare JSON array (not an envelope) containing
    created services (with nested tariffs+tags). Full generic contract
    lands in Task 4.
    """

    def test_all_returns_bare_array(self, api_client, create_service) -> None:
        created = create_service()
        resp = api_client.get("/api/v1/services/all")
        assert resp.status_code == 200, f"GET /all failed: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must return a bare array, not an envelope"
        assert any(item["id"] == created["id"] for item in body)


class TestServiceMaterialsNestedRead:
    """Nested ``materials`` on service reads (GH #223 Task 1, spec §3.1/§3.3/§5).

    Link rows are inserted directly via SQL (the write path lands in Task 4).
    Insertion order deliberately differs from title order: «Акрил» is
    inserted FIRST, but «Акварель» sorts before it («в» < «р»), so the
    expected order is [«Акварель», «Акрил»] — a loader-order passthrough
    would fail the title-ASC assertion.
    """

    def _create_material(self, api_client, title: str, description: str) -> dict:
        resp = api_client.post(
            "/api/v1/materials", json={"title": title, "description": description}
        )
        assert resp.status_code == 201, f"create material failed: {resp.text}"
        return resp.json()

    def _link(self, service_id: str, material_id: str, note: str | None) -> None:
        note_sql = "NULL" if note is None else f"'{note}'"
        query_db(
            "INSERT INTO service_materials (service_id, material_id, note) "
            f"VALUES ('{service_id}', '{material_id}', {note_sql})"
        )

    def test_get_returns_materials_ordered_by_title_with_notes(
        self, api_client, create_service
    ) -> None:
        """GET /{id}: materials ordered title ASC, note carried, description included."""
        service = create_service()
        watercolor = self._create_material(api_client, "Акварель", "Краски на воде")
        acrylic = self._create_material(api_client, "Акрил", "Быстросохнущие краски")
        # Insert acrylic FIRST — title ASC must still put watercolor first.
        self._link(service["id"], acrylic["id"], None)
        self._link(service["id"], watercolor["id"], "Бумага 300 г/м²")

        resp = api_client.get(f"/api/v1/services/{service['id']}")

        assert resp.status_code == 200, f"GET failed: {resp.text}"
        materials = resp.json()["materials"]
        assert [m["id"] for m in materials] == [watercolor["id"], acrylic["id"]]
        assert materials[0]["title"] == "Акварель"
        assert materials[0]["description"] == "Краски на воде"
        assert materials[0]["note"] == "Бумага 300 г/м²"
        assert materials[1]["title"] == "Акрил"
        assert materials[1]["note"] is None

    def test_get_service_without_links_returns_empty_materials(
        self, api_client, create_service
    ) -> None:
        """GET /{id} for a service with zero links → ``materials: []``."""
        service = create_service()

        resp = api_client.get(f"/api/v1/services/{service['id']}")

        assert resp.status_code == 200
        assert resp.json()["materials"] == []

    def test_list_and_all_include_nested_materials(
        self, api_client, create_service
    ) -> None:
        """Paginated list and bare /all both carry the nested materials payload."""
        service = create_service(title="A-linked")
        unlinked = create_service(title="B-unlinked")
        acrylic = self._create_material(api_client, "Акрил", "Быстросохнущие краски")
        self._link(service["id"], acrylic["id"], None)

        list_resp = api_client.get("/api/v1/services")
        assert list_resp.status_code == 200
        by_id = {s["id"]: s for s in list_resp.json()["items"]}
        assert by_id[service["id"]]["materials"] == [
            {
                "id": acrylic["id"],
                "title": "Акрил",
                "description": "Быстросохнущие краски",
                "note": None,
            }
        ]
        assert by_id[unlinked["id"]]["materials"] == []

        all_resp = api_client.get("/api/v1/services/all")
        assert all_resp.status_code == 200
        all_by_id = {s["id"]: s for s in all_resp.json()}
        assert all_by_id[service["id"]]["materials"][0]["id"] == acrylic["id"]
        assert all_by_id[unlinked["id"]]["materials"] == []


class TestServiceMaterialsWrite:
    """Write path for service→material links (GH #223 Task 4, spec §4).

    POST/PUT: ``materials`` creates/hard-replaces links. PATCH: absent/null →
    preserve; sent (incl. ``[]``) → hard-replace; ``[]`` → clear all. Unknown
    ``material_id`` → 422 VALIDATION_ERROR naming the offending id; duplicate
    ids within one list → 422; whitespace-only note normalizes to NULL (spec
    §4); archived materials are valid link targets (archive = lifecycle flag,
    not existence — spec §4).
    """

    def _create_material(self, api_client, title: str, description: str = "Описание") -> dict:
        resp = api_client.post(
            "/api/v1/materials", json={"title": title, "description": description}
        )
        assert resp.status_code == 201, f"create material failed: {resp.text}"
        return resp.json()

    def _materials_of(self, api_client, service_id: str) -> list[dict]:
        resp = api_client.get(f"/api/v1/services/{service_id}")
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        return resp.json()["materials"]

    def test_post_with_materials_creates_links(self, api_client) -> None:
        """POST with materials → 201; response and GET both carry the links."""
        mat = self._create_material(api_client, "Акварель", "Краски на воде")
        expected = [{
            "id": mat["id"], "title": "Акварель",
            "description": "Краски на воде", "note": "Бумага 300 г/м²",
        }]

        resp = api_client.post("/api/v1/services", json={
            **SERVICE_PAYLOAD,
            "materials": [{"material_id": mat["id"], "note": "Бумага 300 г/м²"}],
        })

        assert resp.status_code == 201, f"POST failed: {resp.text}"
        assert resp.json()["materials"] == expected
        assert self._materials_of(api_client, resp.json()["id"]) == expected

    def test_post_without_materials_creates_unlinked_service(
        self, api_client, create_service
    ) -> None:
        """POST without materials (the default) → unlinked service, no error."""
        assert create_service()["materials"] == []

    def test_put_empty_list_clears_links(self, api_client, create_service) -> None:
        """PUT with materials: [] → all links cleared (hard-replace semantics)."""
        mat = self._create_material(api_client, "Акварель")
        service = create_service(materials=[{"material_id": mat["id"]}])
        assert self._materials_of(api_client, service["id"]) != []

        resp = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={**SERVICE_PAYLOAD, "materials": []},
        )

        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert resp.json()["materials"] == []
        assert self._materials_of(api_client, service["id"]) == []

    def test_put_replaces_link_set(self, api_client, create_service) -> None:
        """PUT hard-replaces the whole set: dropped id gone, kept id's note cleared."""
        a = self._create_material(api_client, "Акварель")
        b = self._create_material(api_client, "Акрил")
        c = self._create_material(api_client, "Масло")
        service = create_service(materials=[
            {"material_id": a["id"]},
            {"material_id": b["id"], "note": "старая заметка"},
        ])

        resp = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={
                **SERVICE_PAYLOAD,
                "materials": [{"material_id": b["id"]}, {"material_id": c["id"], "note": "новая"}],
            },
        )

        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        # Ordered title ASC (spec §3.3): Акрил < Масло; Акварель dropped;
        # b's old note replaced (re-sent without one → NULL).
        assert [(m["id"], m["note"]) for m in resp.json()["materials"]] == [
            (b["id"], None), (c["id"], "новая"),
        ]
        assert self._materials_of(api_client, service["id"]) == resp.json()["materials"]

    def test_patch_without_materials_preserves_links(
        self, api_client, create_service
    ) -> None:
        """PATCH without the materials key → links untouched (exclude_unset idiom)."""
        mat = self._create_material(api_client, "Акварель")
        service = create_service(materials=[{"material_id": mat["id"], "note": "заметка"}])

        resp = api_client.patch(
            f"/api/v1/services/{service['id']}", json={"title": "Переименованная"}
        )

        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["title"] == "Переименованная"
        assert [(m["id"], m["note"]) for m in resp.json()["materials"]] == [
            (mat["id"], "заметка")
        ]
        assert self._materials_of(api_client, service["id"]) == [{
            "id": mat["id"], "title": "Акварель",
            "description": "Описание", "note": "заметка",
        }]

    def test_patch_null_materials_preserves_links(
        self, api_client, create_service
    ) -> None:
        """PATCH with materials: null → preserve (spec §4: absent/null → preserve)."""
        mat = self._create_material(api_client, "Акварель")
        service = create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.patch(
            f"/api/v1/services/{service['id']}", json={"materials": None}
        )

        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert [m["id"] for m in resp.json()["materials"]] == [mat["id"]]

    def test_patch_empty_list_clears_links(self, api_client, create_service) -> None:
        """PATCH with materials: [] → clear all links."""
        mat = self._create_material(api_client, "Акварель")
        service = create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.patch(
            f"/api/v1/services/{service['id']}", json={"materials": []}
        )

        assert resp.status_code == 200, f"PATCH failed: {resp.text}"
        assert resp.json()["materials"] == []
        assert self._materials_of(api_client, service["id"]) == []

    def test_unknown_material_id_422(self, api_client, create_service) -> None:
        """Unknown material_id → 422 VALIDATION_ERROR, id named, nothing written."""
        service = create_service()
        bogus = "bogus-material-id"

        resp = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={**SERVICE_PAYLOAD, "materials": [{"material_id": bogus}]},
        )

        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert bogus in detail["message"]
        assert self._materials_of(api_client, service["id"]) == []

    def test_duplicate_material_id_422(self, api_client) -> None:
        """Same material_id twice in one list → 422 VALIDATION_ERROR, id named."""
        mat = self._create_material(api_client, "Акварель")

        resp = api_client.post("/api/v1/services", json={
            **SERVICE_PAYLOAD,
            "materials": [{"material_id": mat["id"]}, {"material_id": mat["id"]}],
        })

        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert mat["id"] in detail["message"]

    def test_whitespace_note_stored_as_null(
        self, api_client, create_service
    ) -> None:
        """Whitespace-only note → stored as NULL; GET returns note: null (spec §4)."""
        mat = self._create_material(api_client, "Акварель")
        service = create_service(materials=[{"material_id": mat["id"], "note": "  "}])

        materials = self._materials_of(api_client, service["id"])
        assert materials[0]["note"] is None
        rows = query_db(
            f"SELECT note FROM service_materials WHERE service_id='{service['id']}'"
        )
        assert rows[0]["note"] is None

    def test_archived_material_is_valid_link_target(
        self, api_client, create_service
    ) -> None:
        """Archived material id links successfully (archive ≠ nonexistence, spec §4)."""
        mat = self._create_material(api_client, "Акварель")
        arch = api_client.post(f"/api/v1/materials/{mat['id']}/archive")
        assert arch.status_code == 200, f"archive failed: {arch.text}"
        service = create_service()

        resp = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={**SERVICE_PAYLOAD, "materials": [{"material_id": mat["id"]}]},
        )

        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        assert [m["id"] for m in resp.json()["materials"]] == [mat["id"]]
        assert self._materials_of(api_client, service["id"])[0]["id"] == mat["id"]


class TestServiceListMaterialFilter:
    """``?material_id=`` filter on GET /api/v1/services (GH #223 Task 6, spec §5).

    Filter semantics (not error semantics): linked services only; ``total``
    reflects the filtered count (predicate lands BEFORE the COUNT); composable
    with ``q``/``status``/pagination. Invalid UUID → 422 (param type
    validation); valid-but-unknown id → 200 with an EMPTY page (the client
    cannot distinguish "no such material" from "no services use it").
    Archived material ids still filter — links survive archive (spec §7).
    """

    def _create_material(self, api_client, title: str = "Акварель") -> dict:
        resp = api_client.post(
            "/api/v1/materials", json={"title": title, "description": "Описание"}
        )
        assert resp.status_code == 201, f"create material failed: {resp.text}"
        return resp.json()

    def _ids(self, resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [s["id"] for s in resp.json()["items"]]

    def test_material_id_filters_linked_service_in(
        self, api_client, create_service
    ) -> None:
        """Linked service listed; unlinked service excluded (spec §5)."""
        mat = self._create_material(api_client)
        linked = create_service(title="A-linked", materials=[{"material_id": mat["id"]}])
        unlinked = create_service(title="B-unlinked")

        ids = self._ids(api_client.get(f"/api/v1/services?material_id={mat['id']}"))

        assert ids == [linked["id"]]
        assert unlinked["id"] not in ids

    def test_total_reflects_filtered_count(
        self, api_client, create_service
    ) -> None:
        """``total`` counts only linked services, not the whole table."""
        mat = self._create_material(api_client)
        create_service(materials=[{"material_id": mat["id"]}])
        create_service(materials=[{"material_id": mat["id"]}])
        create_service()  # unlinked — must not count

        body = api_client.get(f"/api/v1/services?material_id={mat['id']}").json()

        assert body["total"] == 2
        assert len(body["items"]) == 2

    def test_composable_with_q(self, api_client, create_service) -> None:
        """``q`` ANDs with the material filter (spec §5 composability)."""
        mat = self._create_material(api_client)
        a = create_service(
            title="Alpha Watercolor", materials=[{"material_id": mat["id"]}]
        )
        create_service(title="Beta Sculpture", materials=[{"material_id": mat["id"]}])
        create_service(title="Gamma Watercolor")  # matches q, not the filter

        ids = self._ids(
            api_client.get(f"/api/v1/services?material_id={mat['id']}&q=watercolor")
        )

        assert ids == [a["id"]]

    def test_composable_with_status(self, api_client, create_service) -> None:
        """``status`` ANDs with the material filter — all three modes."""
        mat = self._create_material(api_client)
        active = create_service(
            title="A-active", materials=[{"material_id": mat["id"]}]
        )
        archived = create_service(
            title="B-archived", materials=[{"material_id": mat["id"]}]
        )
        _archive_service(archived["id"])
        create_service(title="0-unlinked")  # active but unlinked — must not surface

        assert self._ids(
            api_client.get(f"/api/v1/services?material_id={mat['id']}")
        ) == [active["id"]]
        assert self._ids(
            api_client.get(f"/api/v1/services?material_id={mat['id']}&status=archived")
        ) == [archived["id"]]
        assert self._ids(
            api_client.get(f"/api/v1/services?material_id={mat['id']}&status=all")
        ) == [active["id"], archived["id"]]

    def test_composable_with_pagination(
        self, api_client, create_service
    ) -> None:
        """limit/offset slice the filtered set; ``total`` stays un-sliced."""
        mat = self._create_material(api_client)
        create_service(title="A", materials=[{"material_id": mat["id"]}])
        create_service(title="B", materials=[{"material_id": mat["id"]}])
        create_service(title="C", materials=[{"material_id": mat["id"]}])
        create_service(title="0-unlinked")  # must never surface in any page

        page1 = api_client.get(
            f"/api/v1/services?material_id={mat['id']}&per_page=2&page=1"
        ).json()
        page2 = api_client.get(
            f"/api/v1/services?material_id={mat['id']}&per_page=2&page=2"
        ).json()

        assert [s["title"] for s in page1["items"]] == ["A", "B"]
        assert page1["total"] == 3
        assert [s["title"] for s in page2["items"]] == ["C"]
        assert page2["total"] == 3

    def test_invalid_uuid_returns_422(self, api_client) -> None:
        """``?material_id=not-a-uuid`` → 422 VALIDATION_ERROR (spec §5)."""
        resp = api_client.get("/api/v1/services?material_id=not-a-uuid")

        assert resp.status_code == 422

    def test_unknown_material_id_returns_empty_page(
        self, api_client, create_service
    ) -> None:
        """Valid-but-unknown id → 200 ``{"items": [], "total": 0}`` (spec §5)."""
        create_service()  # exists — must still not surface

        resp = api_client.get(f"/api/v1/services?material_id={uuid4()}")

        assert resp.status_code == 200
        assert resp.json() == {"items": [], "total": 0, "page": 1, "per_page": 20}

    def test_archived_material_id_still_filters(
        self, api_client, create_service
    ) -> None:
        """Archiving a material keeps its links → filter still matches (spec §7)."""
        mat = self._create_material(api_client)
        linked = create_service(materials=[{"material_id": mat["id"]}])
        create_service(title="0-unlinked")  # counterexample: must not surface
        arch = api_client.post(f"/api/v1/materials/{mat['id']}/archive")
        assert arch.status_code == 200, f"archive failed: {arch.text}"

        ids = self._ids(api_client.get(f"/api/v1/services?material_id={mat['id']}"))

        assert ids == [linked["id"]]


class TestServiceListSorting:
    """Server-side sorting on GET /api/v1/services (#205 Task 3).

    sort_by whitelist: title, duration, age, tariffs, specialty, archived,
    created_at. sort_order: asc/desc. Unknown → 422.
    Default (sort_by=None): title ASC, id ASC (spec §4.4 — NEW, was unspecified).
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [s["id"] for s in resp.json()["items"]]

    def test_sort_title_asc_desc(self, api_client, create_service) -> None:
        """sort_by=title → [title]; asc/desc both differ from insertion order."""
        s_z = create_service(title="Zebra")  # inserted first
        s_a = create_service(title="Apple")
        s_m = create_service(title="Moon")

        asc = self._ids(api_client.get("/api/v1/services?sort_by=title&sort_order=asc"))
        assert asc.index(s_a["id"]) < asc.index(s_m["id"]) < asc.index(s_z["id"])

        desc = self._ids(api_client.get("/api/v1/services?sort_by=title&sort_order=desc"))
        assert desc.index(s_z["id"]) < desc.index(s_m["id"]) < desc.index(s_a["id"])

    def test_sort_tariffs_count_asc_desc(self, api_client, create_service) -> None:
        """sort_by=tariffs → correlated COUNT subquery. asc = fewer first."""
        s2 = create_service(title="Two", tariffs=[
            {"title": "T1", "price": 1000},
            {"title": "T2", "price": 2000},
        ])
        s0 = create_service(title="Zero")
        s1 = create_service(title="One", tariffs=[
            {"title": "T1", "price": 1000},
        ])

        asc = self._ids(api_client.get("/api/v1/services?sort_by=tariffs&sort_order=asc"))
        assert asc.index(s0["id"]) < asc.index(s1["id"]) < asc.index(s2["id"])

        desc = self._ids(api_client.get("/api/v1/services?sort_by=tariffs&sort_order=desc"))
        assert desc.index(s2["id"]) < desc.index(s1["id"]) < desc.index(s0["id"])

    def test_sort_archived_asc_desc(self, api_client, create_service) -> None:
        """sort_by=archived → [is_active]; asc = archived-first, desc = active-first."""
        arch_a = create_service(title="ArchA")
        active = create_service(title="Activ")
        arch_b = create_service(title="ArchB")
        _archive_service(arch_a["id"])
        _archive_service(arch_b["id"])

        asc = self._ids(api_client.get("/api/v1/services?status=all&sort_by=archived&sort_order=asc"))
        assert asc.index(arch_a["id"]) < asc.index(active["id"])
        assert asc.index(arch_b["id"]) < asc.index(active["id"])

        desc = self._ids(api_client.get("/api/v1/services?status=all&sort_by=archived&sort_order=desc"))
        assert desc.index(active["id"]) < desc.index(arch_a["id"])
        assert desc.index(active["id"]) < desc.index(arch_b["id"])

    def test_sort_invalid_key_422(self, api_client) -> None:
        """sort_by=bogus → 422 from Literal validation."""
        resp = api_client.get("/api/v1/services?sort_by=bogus")
        assert resp.status_code == 422

    def test_sort_material_hint_removed_422(self, api_client) -> None:
        """GH #223 Task 13 regression: `material_hint` left the whitelist.

        The column/sort key is retired (spec §10 — known breaking change;
        admin stopped sending it in the same release). Old clients that
        still send `sort_by=material_hint` now get 422 via Literal
        validation, exactly like any other unknown key.
        """
        resp = api_client.get("/api/v1/services?sort_by=material_hint")
        assert resp.status_code == 422

    def test_default_order_locked(self, api_client, create_service) -> None:
        """Default (no sort params): title ASC, id ASC (NEW per spec §4.4).
        Insertion order differs from title-ASC so the old unspecified DB
        order (insertion/rowid) would return a different sequence."""
        create_service(title="Banana")  # inserted first
        create_service(title="Apple")

        resp = api_client.get("/api/v1/services")
        assert resp.status_code == 200
        titles = [s["title"] for s in resp.json()["items"]]
        assert titles == ["Apple", "Banana"]  # title ASC, not insertion order
