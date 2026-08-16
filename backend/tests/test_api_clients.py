"""Tests for the Clients CRUD API endpoints."""

import pytest

from tests.conftest import query_db
from tests.generic_contract import _serialized_keys

pytestmark = pytest.mark.api

CLIENT_PAYLOAD = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "telegram",
}


def _client_stats(api_client, client_id: str) -> tuple:
    """(records_count, total_paid) for one client from the stats list endpoint."""
    items = api_client.get("/api/v1/clients").json()["items"]
    row = next(c for c in items if c["id"] == client_id)
    return row["records_count"], row["total_paid"]


# ─── Archive/Restore endpoints (Task 11, #207 §2/§4.2/§14) ────────────────────


class TestArchiveRestoreEndpoints:
    """POST /api/v1/clients/{id}/archive + POST /{id}/restore — Task 11 (#207 §2/§14).

    Both endpoints return HTTP 200 with the re-fetched body (``archived``
    computed from ``is_active``). Idempotent. ``?status=archived`` lists
    archived rows after ``POST /archive``.
    """

    ENTITY_PATH = "/api/v1/clients"
    NOT_FOUND_CODE = "CLIENT_NOT_FOUND"

    def test_archive_returns_200_with_archived_true_and_db_is_active_false(
        self, api_client, create_client
    ) -> None:
        client = create_client()

        resp = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        assert resp.status_code == 200, f"archive failed: {resp.text}"
        body = resp.json()
        assert body["id"] == client["id"]
        assert body["archived"] is True
        rows = query_db(f"SELECT is_active FROM clients WHERE id='{client['id']}'")
        assert rows[0]["is_active"] == 0

    def test_restore_returns_200_with_archived_false_and_db_is_active_true(
        self, api_client, create_client
    ) -> None:
        client = create_client()
        api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/restore")

        assert resp.status_code == 200, f"restore failed: {resp.text}"
        body = resp.json()
        assert body["archived"] is False
        rows = query_db(f"SELECT is_active FROM clients WHERE id='{client['id']}'")
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
        self, api_client, create_client
    ) -> None:
        client = create_client()
        first = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")
        assert first.status_code == 200

        second = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        assert second.status_code == 200
        assert second.json()["archived"] is True

    def test_restore_already_active_is_idempotent_200(
        self, api_client, create_client
    ) -> None:
        client = create_client()  # starts active

        resp = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/restore")

        assert resp.status_code == 200
        assert resp.json()["archived"] is False

    def test_status_archived_returns_archived_row_after_archive_endpoint(
        self, api_client, create_client
    ) -> None:
        client = create_client()
        api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        archived_list = api_client.get(f"{self.ENTITY_PATH}?status=archived").json()
        active_list = api_client.get(f"{self.ENTITY_PATH}?status=active").json()

        archived_ids = [c["id"] for c in archived_list["items"]]
        active_ids = [c["id"] for c in active_list["items"]]
        assert client["id"] in archived_ids
        assert client["id"] not in active_ids


class TestArchiveRestoreNoUserCascade:
    """Non-master entities MUST NOT touch the users table on archive/restore (#207 §4.2).

    Only Master cascades. Client has no link to the users table — verify by
    creating a user (is_active=true) then asserting users.is_active is
    unchanged after archive/restore.
    """

    ENTITY_PATH = "/api/v1/clients"

    def test_archive_does_not_modify_users_is_active(
        self, api_client, create_client, _user
    ) -> None:
        client = create_client()

        resp = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1

    def test_restore_does_not_modify_users_is_active(
        self, api_client, create_client, _user
    ) -> None:
        client = create_client()
        api_client.post(f"{self.ENTITY_PATH}/{client['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{client['id']}/restore")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1


class TestClientsCrud:
    """Search-by-phone and scoped client-visitors sub-routes for /api/clients."""

    def test_search_client_by_phone_found(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns the matching client."""
        # Create a client
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        assert create_resp.status_code == 201

        # Search by phone
        response = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79991234567"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["phone"] == "+79991234567"
        assert body["name"] == "John Smith"
        assert body["email"] == "john@example.com"
        assert body["channel"] == "telegram"
        assert "id" in body
        # #207 §3.1: `archived` is the inverted serialized field; `is_active`
        # itself is Field(exclude=True) and never in the JSON body.
        assert body["archived"] is False

    def test_search_client_by_phone_not_found(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for unknown phone."""
        response = api_client.get(
            "/api/v1/clients/search", params={"phone": "+00000000000"}
        )
        assert response.status_code == 404

    def test_search_client_by_phone_excludes_inactive(self, api_client) -> None:
        """GET /api/v1/clients/search?phone=... returns 404 for soft-deleted client."""
        # Create then soft-delete
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        api_client.delete(f"/api/v1/clients/{client_id}")

        # Search should not find the deleted client
        response = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79991234567"}
        )
        assert response.status_code == 404

    def test_list_visitors_for_client(self, api_client) -> None:
        """GET /api/clients/{id}/visitors returns visitors for that client."""
        # Create a client
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        # Create a visitor for this client
        visitor_payload = {
            "client_id": client_id,
            "name": "Alice Smith",
            "age": 30,
        }
        api_client.post("/api/v1/visitors", json=visitor_payload)

        # List visitors for this client
        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        visitors = response.json()
        assert isinstance(visitors, list)
        assert len(visitors) == 1
        assert visitors[0]["name"] == "Alice Smith"
        assert visitors[0]["age"] == 30

    def test_list_visitors_for_nonexistent_client(self, api_client) -> None:
        """GET /api/clients/{id}/visitors returns empty list for nonexistent client."""
        response = api_client.get("/api/v1/clients/nonexistent-id/visitors")
        assert response.status_code == 200
        assert response.json() == []


# ─── Create Edge Cases ────────────────────────────────────────────────────────


class TestClientCreateEdgeCases:
    """Edge cases for POST /api/v1/clients."""

    def test_create_client_with_empty_body(self, api_client) -> None:
        """POST with empty body creates client with all null fields."""
        resp = api_client.post("/api/v1/clients", json={})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None
        assert body["email"] is None
        assert body["channel"] is None
        # #207 §3.1: `archived` (inverted) — active by default.
        assert body["archived"] is False

    def test_create_client_with_only_name(self, api_client) -> None:
        """POST with only name creates client."""
        resp = api_client.post("/api/v1/clients", json={"name": "Solo"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Solo"
        assert body["phone"] is None

    def test_create_client_with_only_phone(self, api_client) -> None:
        """POST with only phone creates client."""
        resp = api_client.post("/api/v1/clients", json={"phone": "+79990001111"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["phone"] == "+79990001111"
        assert body["name"] is None

    def test_create_client_all_channels(self, api_client) -> None:
        """POST with each valid channel value succeeds."""
        for channel in ("telegram", "max", "whatsapp"):
            resp = api_client.post(
                "/api/v1/clients",
                json={"name": f"Ch {channel}", "channel": channel},
            )
            assert resp.status_code == 201, f"Channel '{channel}' rejected: {resp.text}"
            assert resp.json()["channel"] == channel

    def test_create_client_invalid_channel_returns_422(self, api_client) -> None:
        """POST with invalid channel returns 422."""
        resp = api_client.post(
            "/api/v1/clients",
            json={"name": "Bad", "channel": "instagram"},
        )
        assert resp.status_code == 422

    def test_create_client_null_channel_explicit(self, api_client) -> None:
        """POST with explicit null channel creates client with null channel."""
        resp = api_client.post(
            "/api/v1/clients",
            json={"name": "Null Ch", "channel": None},
        )
        assert resp.status_code == 201
        assert resp.json()["channel"] is None

    def test_create_client_response_has_all_fields(self, api_client) -> None:
        """POST response contains id, created_at, updated_at, archived (#207 §3.1)."""
        resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        body = resp.json()
        assert isinstance(body["id"], str)
        assert len(body["id"]) > 0
        assert "created_at" in body
        assert "updated_at" in body
        # #207 §3.1: `archived` (inverted is_active) — active by default.
        assert body["archived"] is False

    def test_create_two_clients_different_ids(self, api_client) -> None:
        """Two created clients have different IDs."""
        r1 = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        r2 = api_client.post(
            "/api/v1/clients",
            json={**CLIENT_PAYLOAD, "phone": "+79999999999"},
        )
        assert r1.json()["id"] != r2.json()["id"]


# ─── PATCH Edge Cases ─────────────────────────────────────────────────────────


class TestPatchClientEdgeCases:
    """Edge cases for PATCH /api/v1/clients/{id}."""

    def test_patch_invalid_channel_returns_422(self, api_client) -> None:
        """PATCH with invalid channel value returns 422."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"channel": "instagram"}
        )
        assert resp.status_code == 422


# ─── PUT Edge Cases ───────────────────────────────────────────────────────────


class TestPutClientEdgeCases:
    """Edge cases for PUT /api/v1/clients/{id}."""

    def test_put_sets_all_nullable_to_null(self, api_client, create_record) -> None:
        """PUT with explicit null in all 4 fields = deliberate data wipe (GH #201
        canonical pin): personal fields become NULL; payments/stats by client_id
        joins stay intact."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        record = create_record(client_id=client_id)
        api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": 1500, "method": "cash",
        })
        stats_before = _client_stats(api_client, client_id)

        # #207 §3.2: is_active removed from ClientUpdate — PUT body is now the
        # 4 personal keys only (is_active would 422 via extra="forbid").
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            "name": None,
            "phone": None,
            "email": None,
            "channel": None,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None
        assert body["email"] is None
        assert body["channel"] is None
        # stats intact: records_count/total_paid unchanged after the wipe
        assert _client_stats(api_client, client_id) == stats_before

    def test_put_invalid_channel_returns_422(self, api_client) -> None:
        """PUT with invalid channel returns 422."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            **CLIENT_PAYLOAD,
            "channel": "invalid_channel",
        })
        assert resp.status_code == 422

    def test_put_empty_body_returns_422(self, api_client) -> None:
        """PUT {} → 422 (GH #201): all 4 keys required — silent full-wipe impossible."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={})
        assert resp.status_code == 422

    def test_put_is_active_only_returns_422(self, api_client) -> None:
        """PUT {is_active} only → 422: personal keys are required, AND a stray
        is_active is itself rejected post-#207 (#178 closed). Either reason
        fires before the body reaches the service."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={"is_active": True})
        assert resp.status_code == 422


# ─── Search Edge Cases ────────────────────────────────────────────────────────


class TestSearchClientEdgeCases:
    """Edge cases for GET /api/v1/clients/search."""

    def test_search_is_case_insensitive(self, api_client) -> None:
        """Phone search matches regardless of case."""
        api_client.post(
            "/api/v1/clients",
            json={"name": "CaseTest", "phone": "+79998887766"},
        )
        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79998887766"}
        )
        assert resp.status_code == 200
        assert resp.json()["phone"] == "+79998887766"

    def test_search_missing_phone_param_returns_422(self, api_client) -> None:
        """GET /search without phone param returns 422."""
        resp = api_client.get("/api/v1/clients/search")
        assert resp.status_code == 422

    def test_search_short_phone_returns_422(self, api_client) -> None:
        """GET /search with phone < 3 chars returns 422 (min_length=3)."""
        resp = api_client.get("/api/v1/clients/search", params={"phone": "ab"})
        assert resp.status_code == 422


# ─── Phone Search active-only regression (spec §5.5, #195) ────────────────────


class TestPhoneSearchActiveOnlyRegression:
    """Lock spec §5.5: GET /api/v1/clients/search?phone=X must always be
    active-only — archived clients must NEVER surface via phone search.

    This is a regression guard for the #195 archive-status refactor: although
    the list filter gained a `status=all` mode, the phone search endpoint
    is required to keep excluding soft-deleted clients.
    """

    def test_archived_client_phone_search_returns_404(
        self, api_client, create_client
    ) -> None:
        """Archive a client with a known phone → search must 404."""
        client = create_client(phone="+79990009988", name="To Archive")
        api_client.delete(f"/api/v1/clients/{client['id']}")

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79990009988"}
        )
        assert resp.status_code == 404

    def test_active_client_phone_search_returns_200(
        self, api_client, create_client
    ) -> None:
        """Active client with the same phone number stays searchable."""
        client = create_client(phone="+79990008877", name="Stays Active")

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": "+79990008877"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == client["id"]
        # #207 §3.1: serialized `archived` (inverted); active row → False.
        assert body["archived"] is False

    def test_archived_excluded_even_if_partner_active(
        self, api_client, create_client
    ) -> None:
        """Two clients share a phone; the archived one is never returned.

        Post-#207 the archive state is set via the dedicated ``POST /archive``
        endpoint (Task 11) — DELETE is now hard and would just remove the
        row. Both states produce the same observable behavior for phone search
        (archived/deleted partner never surfaces); using archive keeps the
        test's stated premise (one partner archived, not deleted) honest.
        """
        shared = "+79990007766"
        active_client = create_client(phone=shared, name="Active Sharer")
        archived_client = create_client(phone=shared, name="Archived Sharer")
        # #207 §2/§10: archive lifecycle via dedicated endpoint, NOT DELETE.
        archive_resp = api_client.post(f"/api/v1/clients/{archived_client['id']}/archive")
        assert archive_resp.status_code == 200
        assert archive_resp.json()["archived"] is True

        resp = api_client.get(
            "/api/v1/clients/search", params={"phone": shared}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == active_client["id"]
        assert body["archived"] is False


# ─── Response Contract ────────────────────────────────────────────────────────


class TestClientResponseContract:
    """Verify API responses match the serialized Pydantic schemas.

    #207 §3.1: ``ClientResponse.is_active: bool = Field(..., exclude=True)`` is a
    REQUIRED input field but NEVER serialized to JSON. The API emits ``archived``
    (a ``@computed_field`` absent from ``model_fields``). ``model_validate(body)``
    therefore raises (the body lacks the required ``is_active``), and the
    generic ``_assert_exact_response_keys`` would miss ``archived`` while
    expecting ``is_active``. The wire-shape contract is the SERIALIZED field
    set (via ``_serialized_keys`` from ``tests.generic_contract``).
    """

    def test_single_client_response_validates(self, api_client) -> None:
        """GET /api/v1/clients/{id} body has exactly the serialized
        ClientResponse keys — locks the contract without ``model_validate``."""
        from src.schemas.client import ClientResponse

        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]

        resp = api_client.get(f"/api/v1/clients/{client_id}")
        body = resp.json()
        assert set(body.keys()) == _serialized_keys(ClientResponse), (
            f"single GET body keys mismatch serialized ClientResponse: "
            f"missing={_serialized_keys(ClientResponse) - set(body.keys())}, "
            f"extra={set(body.keys()) - _serialized_keys(ClientResponse)}"
        )
        assert body["id"] == client_id

    def test_list_client_items_validate(self, api_client) -> None:
        """Each GET /api/v1/clients item has exactly the serialized ClientWithStats keys."""
        from src.schemas.client import ClientWithStats

        api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)

        resp = api_client.get("/api/v1/clients")
        expected = _serialized_keys(ClientWithStats)
        for item in resp.json()["items"]:
            assert set(item.keys()) == expected, (
                f"list item keys mismatch serialized ClientWithStats: "
                f"missing={expected - set(item.keys())}, "
                f"extra={set(item.keys()) - expected}"
            )

    def test_create_response_validates(self, api_client) -> None:
        """POST response body has exactly the serialized ClientResponse keys."""
        from src.schemas.client import ClientResponse

        resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        body = resp.json()
        assert set(body.keys()) == _serialized_keys(ClientResponse), (
            f"POST body keys mismatch serialized ClientResponse: "
            f"missing={_serialized_keys(ClientResponse) - set(body.keys())}, "
            f"extra={set(body.keys()) - _serialized_keys(ClientResponse)}"
        )
        assert body["name"] == "John Smith"


# ─── Channel Tolerance (Issue #60) ─────────────────────────────────────────


class TestClientChannelTolerance:
    """Issue #60: GET /api/v1/clients must tolerate any channel value in DB.

    Channel enum has telegram/max/whatsapp, but DB has instagram/vk/website.
    Response schema must accept any string from DB.
    """

    def test_get_clients_with_unknown_channel_returns_200(self, api_client) -> None:
        """Insert client with channel='instagram' via SQL, GET must return 200."""
        import sqlite3
        import uuid as _uuid

        from tests.conftest import _db_file

        client_id = str(_uuid.uuid4())
        # Bypass API validation by inserting directly via SQL
        # (DB column is String(50), so any value is accepted at DB level)
        conn = sqlite3.connect(_db_file.name)
        conn.execute(
            "INSERT INTO clients (id, name, phone, email, channel, "
            "created_at, updated_at, is_active) VALUES "
            "(?, 'Instagram User', '+79990000001', NULL, 'instagram', "
            "datetime('now'), datetime('now'), 1)",
            (client_id,),
        )
        conn.commit()
        conn.close()

        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        body = resp.json()
        # Find the client with the unknown channel
        matching = [c for c in body["items"] if c["id"] == client_id]
        assert len(matching) == 1
        assert matching[0]["channel"] == "instagram"

    def test_post_client_with_unknown_channel_returns_422(self, api_client) -> None:
        """POST must still REJECT unknown channel — input schema keeps enum."""
        import uuid as _uuid

        resp = api_client.post(
            "/api/v1/clients",
            json={
                "name": "Bad Channel",
                "phone": f"+7999{_uuid.uuid4().hex[:7]}",
                "channel": "instagram",
            },
        )
        assert resp.status_code == 422, (
            f"Expected 422 for unknown channel, got {resp.status_code}: {resp.text}"
        )


# ─── Unified DELETE route (Tasks 9 + 10 of #207) ──────────────────────────────


def _link_client_tag(api_client, client_id: str, tag_name: str | None = None) -> str:
    """Insert a ``client_tags`` join row directly via SQL and return the tag id.

    The clients API does not expose tag linking on create/update, so we go via
    ``query_db`` to seed the auto-cascade dep (FK-ON-safe: both ids exist).
    """
    tag_name = tag_name or f"ct-{client_id[:8]}"
    tag_id = api_client.post("/api/v1/tags", json={"tag": tag_name}).json()["id"]
    query_db(
        f"INSERT INTO client_tags (client_id, tag_id) "
        f"VALUES ('{client_id}', '{tag_id}')"
    )
    return tag_id


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/clients/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §4  — Client FK deps: records=nullify (user choice), visitors=cascade
              (user choice, cascades through visits/photos/visitor_tags per
              VisitorService._delete_cascade), client_tags=auto cascade.
      * §5  — 409 Conflict response (counters + ``cascade_preview``).
      * §6  — DELETE with resolutions body (executor = Task 10).
      * §8  — atomicity (single outer ``@transactional``; loop calls the
              non-decorated ``VisitorService._delete_cascade`` on a shared
              session — NO per-visitor commit).
      * S4  — User scenario at §12.S4 (records survive nullify; visitors
              + visits + client_tags gone; payments survive with records).
    """

    def test_delete_bare_client_no_body_returns_204_and_row_gone(
        self, api_client, create_client
    ) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2)."""
        client = create_client()

        resp = api_client.delete(f"/api/v1/clients/{client['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/clients/{client['id']}").status_code == 404

    def test_delete_nonexistent_client_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/clients/nonexistent-client-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "CLIENT_NOT_FOUND"

    def test_delete_nonexistent_client_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → AttributeError today).
        """
        resp = api_client.request(
            "DELETE",
            "/api/v1/clients/nonexistent-client-id",
            json={"records": "nullify", "visitors": "cascade"},
        )
        assert resp.status_code == 404

    def test_delete_client_with_deps_no_body_returns_409(
        self, api_client, create_record
    ) -> None:
        """No body + deps (records + visitors + client_tags) → 409 + tree (spec §5).

        The 409 carries counters and the ``cascade_preview`` for visitors (visits
        count only — payments EXCLUDED per §5, since they are record-scoped and
        survive the records nullify).
        """
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        client_id = record["client_id"]
        _link_client_tag(api_client, client_id, tag_name=f"ct-{client_id[:8]}")

        resp = api_client.delete(f"/api/v1/clients/{client_id}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["records"]["count"] == 1
        assert deps["records"]["allowed_actions"] == ["nullify"]
        assert deps["visitors"]["count"] == 1
        assert deps["visitors"]["allowed_actions"] == ["cascade"]
        # cascade_preview exists on visitors with downstream visits count.
        assert deps["visitors"]["cascade_preview"] == {"visits": 1}
        assert deps["client_tags"]["count"] == 1
        assert deps["client_tags"]["allowed_actions"] == ["cascade"]
        # Row untouched (dry-run modifies nothing).
        assert api_client.get(f"/api/v1/clients/{client_id}").status_code == 200

    def test_delete_client_with_cascade_resolutions_executes_204(
        self, api_client, create_record
    ) -> None:
        """S4 scenario: DELETE with body → atomic nullify (records) + cascade
        (visitors, visits, photos SET NULL, visitor_tags) + auto cascade
        (client_tags) + hard delete client.

        EXPECTED RED until Task 10 lands ``ClientService.resolve_delete``.

        Per spec §12.S4 / §8 atomicity: ONE outer ``@transactional``; the
        VisitorService._delete_cascade reuses the SHARED session (no
        per-visitor commit).
        """
        # 1 record + 2 visits + 2 visitors (Alice, Bob) for one client.
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        client_id = record["client_id"]
        record_id = record["id"]
        # Capture visitor IDs.
        visitors = query_db(
            f"SELECT id FROM visitors WHERE client_id='{client_id}' ORDER BY id"
        )
        assert len(visitors) == 2
        alice_vid = visitors[0]["id"]
        bob_vid = visitors[1]["id"]
        # Capture visit IDs (one per visitor).
        alice_visit = query_db(
            f"SELECT id FROM visits WHERE visitor_id='{alice_vid}'"
        )
        bob_visit = query_db(
            f"SELECT id FROM visits WHERE visitor_id='{bob_vid}'"
        )
        assert len(alice_visit) == 1
        assert len(bob_visit) == 1
        alice_visit_id = alice_visit[0]["id"]
        bob_visit_id = bob_visit[0]["id"]
        # Payment on the record (record-scoped — survives the records nullify).
        apipayment = api_client.post(
            "/api/v1/payments",
            json={"record_id": record_id, "amount": 1000, "method": "cash"},
        )
        assert apipayment.status_code == 201
        payment_id = apipayment.json()["id"]
        # Tag link (auto-cascade).
        _link_client_tag(api_client, client_id, tag_name=f"ct-{client_id[:8]}")

        # No-body dry-run → 409 (deps present).
        resp = api_client.delete(f"/api/v1/clients/{client_id}")
        assert resp.status_code == 409

        # With-body execute → 204.
        resp = api_client.request(
            "DELETE",
            f"/api/v1/clients/{client_id}",
            json={"records": "nullify", "visitors": "cascade"},
        )
        assert resp.status_code == 204

        # S4 outcome assertions:
        # records survive with client_id=NULL (nullify).
        rec_rows = query_db(
            f"SELECT client_id FROM records WHERE id='{record_id}'"
        )
        assert len(rec_rows) == 1
        assert rec_rows[0]["client_id"] is None
        # payments survive (record-scoped — NOT part of visitors cascade).
        pay_rows = query_db(f"SELECT * FROM payments WHERE id='{payment_id}'")
        assert len(pay_rows) == 1
        # visitors + visits + visitor_tags + client_tags gone.
        assert query_db(f"SELECT * FROM visitors WHERE id='{alice_vid}'") == []
        assert query_db(f"SELECT * FROM visitors WHERE id='{bob_vid}'") == []
        assert query_db(f"SELECT * FROM visits WHERE id='{alice_visit_id}'") == []
        assert query_db(f"SELECT * FROM visits WHERE id='{bob_visit_id}'") == []
        assert query_db(
            f"SELECT * FROM visitor_tags WHERE visitor_id IN ('{alice_vid}','{bob_vid}')"
        ) == []
        assert query_db(
            f"SELECT * FROM client_tags WHERE client_id='{client_id}'"
        ) == []
        # client row physically gone.
        assert api_client.get(f"/api/v1/clients/{client_id}").status_code == 404

    def test_delete_client_with_wrong_action_returns_422(
        self, api_client, create_record
    ) -> None:
        """§6 rule 1: ``records: "cascade"`` (records only allows nullify) → 422."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        client_id = record["client_id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/clients/{client_id}",
            json={"records": "cascade", "visitors": "cascade"},
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/clients/{client_id}").status_code == 200

    def test_delete_client_with_missing_dep_returns_422(
        self, api_client, create_record
    ) -> None:
        """§6 rule 2: body omits ``visitors`` (a required non-auto dep) → 422."""
        record = create_record(
            visits=[{"name": "Alice", "price": 3500, "status": "waiting"}]
        )
        client_id = record["client_id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/clients/{client_id}",
            json={"records": "nullify"},  # no visitors resolution
        )

        assert resp.status_code == 422
        assert api_client.get(f"/api/v1/clients/{client_id}").status_code == 200

    def test_delete_client_cascade_failure_rolls_back_atomically(
        self, api_client, create_record, monkeypatch
    ) -> None:
        """§8 atomicity: mid-cascade failure (``_delete_cascade`` raise on 2nd
        visitor) rolls back the WHOLE outer transaction — client still present,
        records still linked (NOT nullified), first visitor NOT deleted.

        EXPECTED RED until Task 10 — until ``ClientService.resolve_delete``
        wires the VisitorService loop AND runs in one outer ``@transactional``,
        a mid-loop raise either (a) is unreachable (executor doesn't exist) →
        500/AttributeError, or (b) commits per-visitor → first visitor lost.

        NB: the api_client fixture uses the default ``raise_server_exceptions=
        True``, so the unhandled ``RuntimeError`` bubbles up to the test client
        (Starlette re-raises before FastAPI's ``exception_handler(Exception)``
        can convert it to 500). We expect that exactly — the spec §8 contract
        is "rollback on mid-cascade failure", not "200/422 status code". The
        response status is whatever FastAPI decided to do; the IMPORTANT part
        is the DB-level rollback observation afterwards.
        """
        record = create_record(
            visits=[
                {"name": "Alice", "price": 3500, "status": "waiting"},
                {"name": "Bob", "price": 2500, "status": "waiting"},
            ]
        )
        client_id = record["client_id"]
        record_id = record["id"]
        visitors = query_db(
            f"SELECT id FROM visitors WHERE client_id='{client_id}' ORDER BY id"
        )
        assert len(visitors) == 2

        # Patch VisitorService singleton: 2nd _delete_cascade call raises.
        from src.services.visitor import get_visitor_service

        visitor_service = get_visitor_service()
        original = visitor_service._delete_cascade
        call_count = {"n": 0}

        async def patched(db_session, visitor_id):
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise RuntimeError("mid-cascade simulated failure")
            return await original(db_session, visitor_id)

        monkeypatch.setattr(visitor_service, "_delete_cascade", patched)

        # The unhandled RuntimeError bubbles to the test client (above). The
        # outer ``@transactional`` in ``resolve_delete`` saw the raise, skipped
        # its commit, and ``get_db_session`` rolls back the session on exit —
        # leaving the DB state atomic (NO mid-loop commit).
        with pytest.raises(RuntimeError, match="mid-cascade"):
            api_client.request(
                "DELETE",
                f"/api/v1/clients/{client_id}",
                json={"records": "nullify", "visitors": "cascade"},
            )

        # Atomicity: rollback restored client + records + BOTH visitors.
        # (If the loop had committed per-visitor, the 1st visitor would be
        # gone and the records would be NULL — spec §8 BLOCKER-class guards
        # precisely against that.)
        assert api_client.get(f"/api/v1/clients/{client_id}").status_code == 200
        rec = query_db(f"SELECT client_id FROM records WHERE id='{record_id}'")
        assert rec[0]["client_id"] == client_id  # NULL was rolled back.
        assert (
            len(query_db(f"SELECT * FROM visitors WHERE client_id='{client_id}'"))
            == 2
        )
        # The 1st-processed visitor survived the rollback (NO mid-loop commit).
        assert call_count["n"] == 2
