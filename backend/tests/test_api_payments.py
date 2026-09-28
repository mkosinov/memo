"""Tests for the Payments CRUD API endpoints."""

import pytest

pytestmark = pytest.mark.api

# --- Prerequisite payloads ---
MASTER_PAYLOAD = {
    "first_name": "Anna",
    "last_name": "Ivanova",
    "master": {"specialty": "oil", "color": "#5B8C7A"},
}

SERVICE_PAYLOAD = {
    "title": "Oil Painting",
    "description": "Learn oil painting",
    "image_url": "https://example.com/oil.jpg",
    "specialty": "oil",
    "min_age": 12,
    "max_age": 99,
    "duration": 90,
    "record_info": "Bring apron",
}

LOCATION_PAYLOAD = {
    "title": "Studio 1",
    "address": "123 Main St",
    "capacity": 20,
}

CLIENT_PAYLOAD = {
    "name": "Jane Doe",
    "phone": "+79991112233",
    "email": "jane@example.com",
    "channel": "telegram",
}

VISITOR_PAYLOAD = {"name": "Alice", "age": 28}

PAYMENT_PAYLOAD = {
    "record_id": "",  # filled in _create_record
    "amount": 3000,
    "method": "card",
}


def _create_record(api_client) -> str:
    """Create all prerequisites and return a record_id."""
    from datetime import UTC, datetime, timedelta

    master = api_client.post("/api/v1/staff", json=MASTER_PAYLOAD).json()
    service = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD).json()
    location = api_client.post("/api/v1/locations", json=LOCATION_PAYLOAD).json()
    created_client = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD).json()

    visitor_data = {**VISITOR_PAYLOAD, "client_id": created_client["id"]}
    visitor1 = api_client.post("/api/v1/visitors", json=visitor_data).json()

    start = datetime.now(UTC) + timedelta(days=1)
    activity = api_client.post(
        "/api/v1/activities",
        json={
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
        },
    ).json()

    record_payload = {
        "activity_id": activity["id"],
        "client_id": created_client["id"],
        "comment": "Test record",
        "visits": [
            {"visitor_id": visitor1["id"], "price": 1500, "status": "waiting"},
        ],
    }
    record_resp = api_client.post("/api/v1/records", json=record_payload)
    return record_resp.json()["id"]


class TestPaymentsCrud:
    """Payment-create created_at handling (CRUD covered by contract)."""

    def test_create_payment_with_created_at_persists_it(self, api_client) -> None:
        """POST /api/v1/payments with created_at uses the client-supplied timestamp."""
        record_id = _create_record(api_client)
        payload = {
            "record_id": record_id,
            "amount": 500,
            "method": "card",
            "created_at": "2026-06-01T12:00:00",
        }

        response = api_client.post("/api/v1/payments", json=payload)
        assert response.status_code == 201, f"Create failed: {response.text}"
        body = response.json()
        # Compare date/time components (allow for serialization format variations)
        from datetime import datetime
        created = datetime.fromisoformat(body["created_at"])
        assert created.year == 2026
        assert created.month == 6
        assert created.day == 1
        assert created.hour == 12
        assert created.minute == 0

        # Confirm persistence via GET
        get_resp = api_client.get(f"/api/v1/payments/{body['id']}")
        assert get_resp.status_code == 200
        get_created = datetime.fromisoformat(get_resp.json()["created_at"])
        assert get_created.year == 2026
        assert get_created.month == 6
        assert get_created.day == 1

    def test_create_payment_without_created_at_defaults_now(self, api_client) -> None:
        """POST /api/v1/payments without created_at uses server default (now)."""
        from datetime import datetime, timedelta

        record_id = _create_record(api_client)
        payload = {
            "record_id": record_id,
            "amount": 500,
            "method": "card",
        }

        before = datetime.utcnow()
        response = api_client.post("/api/v1/payments", json=payload)
        after = datetime.utcnow()

        assert response.status_code == 201, f"Create failed: {response.text}"
        body = response.json()
        created = datetime.fromisoformat(body["created_at"])
        # created_at should be within the test window (with 1-minute margin)
        assert created >= before - timedelta(minutes=1)
        assert created <= after + timedelta(minutes=1)


class TestPaymentTotals:
    """GET /api/v1/payments/totals — batch aggregate endpoint."""

    def _create_payment(self, api_client, record_id: str, amount: int) -> None:
        response = api_client.post(
            "/api/v1/payments",
            json={**PAYMENT_PAYLOAD, "record_id": record_id, "amount": amount},
        )
        assert response.status_code == 201

    def test_totals_multiple_records(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        self._create_payment(api_client, r1, 1500)
        self._create_payment(api_client, r2, 2000)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1), ("record_ids", r2)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 4500, r2: 2000}}

    def test_totals_record_without_payments_absent(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1), ("record_ids", r2)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 3000}}

    def test_totals_empty_record_ids_returns_empty(self, api_client) -> None:
        response = api_client.get("/api/v1/payments/totals")
        assert response.status_code == 200
        assert response.json() == {"totals": {}}

    def test_totals_over_cap_returns_422(self, api_client) -> None:
        params = [("record_ids", f"rec-{i}") for i in range(201)]
        response = api_client.get("/api/v1/payments/totals", params=params)
        assert response.status_code == 422

    def test_totals_excludes_deleted_payments(self, api_client) -> None:
        r1 = _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        list_resp = api_client.get("/api/v1/payments", params={"record_id": r1})
        payment_id = list_resp.json()["items"][0]["id"]
        del_resp = api_client.request(
            "DELETE", f"/api/v1/payments/{payment_id}", json={"expected": {}}
        )
        assert del_resp.status_code == 204
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {}}

    def test_totals_not_limited_by_list_pagination(self, api_client) -> None:
        """Regression #186: aggregate must include payments beyond the per_page<=100 list cap."""
        r1 = _create_record(api_client)
        for _ in range(105):
            self._create_payment(api_client, r1, 100)
        response = api_client.get(
            "/api/v1/payments/totals",
            params=[("record_ids", r1)],
        )
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 10500}}


# ─── GH #324 Task 5: the leaf SHORT set (spec §4/§10) ─────────────────────────


class TestPaymentDeleteFamilyShortSet:
    """DELETE /api/v1/payments/{id} — the leaf SHORT-form contract (GH
    #324 §10: bare 422, dry_run 204, commit ``{expected: {}}``, 404 of
    both kinds) + the payment leaf's entity extra: NO recompute (a
    payment is not part of the record status/seats, spec §4).

    The smoke level lives in ``test_api_delete_family_routes.py`` and
    the four FORM 422s in ``test_errors.py``; what this class adds:

    * the bare-DELETE 422 pins the row SURVIVES (leaf, busy-free — the
      silent hard-delete path is gone);
    * the commit branch's unknown-id 404 (with body) + the code shape;
    * BOTH 404 kinds in BOTH branches (scope-helper foreign AND
      nonexistent), not differing them;
    * no-recompute: after a commit the record's seats/status are
      untouched (the visit-side sibling recomputes — the payment side
      must not).
    """

    @staticmethod
    def _payment(api_client) -> dict:
        record_id = _create_record(api_client)
        resp = api_client.post(
            "/api/v1/payments",
            json={"record_id": record_id, "amount": 1500, "method": "card"},
        )
        assert resp.status_code == 201, resp.text
        return {"payment": resp.json(), "record_id": record_id}

    def test_bare_delete_returns_422_row_alive(self, api_client) -> None:
        """§4.1: no flag, no body → 422 expected_state_required; the row
        survives (the legacy bare hard delete is abolished)."""
        made = self._payment(api_client)

        resp = api_client.delete(f"/api/v1/payments/{made['payment']['id']}")

        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"
        assert (
            api_client.get(f"/api/v1/payments/{made['payment']['id']}").status_code
            == 200
        )

    def test_dry_run_returns_204_row_alive(self, api_client) -> None:
        """§4.4: a leaf previews empty → 204 WITHOUT deleting."""
        made = self._payment(api_client)

        resp = api_client.request(
            "DELETE", f"/api/v1/payments/{made['payment']['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204, resp.text
        assert (
            api_client.get(f"/api/v1/payments/{made['payment']['id']}").status_code
            == 200
        )

    def test_commit_unknown_id_with_body_returns_404_code(self, api_client) -> None:
        """§4.2: cannot-exist id WITH body → 404 PAYMENT_NOT_FOUND."""
        resp = api_client.request(
            "DELETE", "/api/v1/payments/00000000-0000-0000-0000-000000000000",
            json={"expected": {}},
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == "PAYMENT_NOT_FOUND"

    def test_commit_expected_empty_204_row_gone(self, api_client) -> None:
        """§4.5: the leaf commit ``{expected: {}}`` → 204, row gone."""
        made = self._payment(api_client)

        resp = api_client.request(
            "DELETE", f"/api/v1/payments/{made['payment']['id']}",
            json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert (
            api_client.get(f"/api/v1/payments/{made['payment']['id']}").status_code
            == 404
        )

    def test_scope_helper_foreign_id_404_both_branches(
        self, api_client, make_master,
    ) -> None:
        """§4.2: the probe runs through ``_payment_scoped_or_404`` — a
        scoped master's view of an admin-owned payment is the SAME 404
        as a nonexistent id, in BOTH branches; the row survives."""
        made = self._payment(api_client)
        master = make_master()
        url = f"/api/v1/payments/{made['payment']['id']}"

        for resp in (
            master["client"].request("DELETE", url, params={"dry_run": "true"}),
            master["client"].request("DELETE", url, json={"expected": {}}),
        ):
            assert resp.status_code == 404, resp.text
            assert resp.json()["detail"]["code"] == "PAYMENT_NOT_FOUND"
        assert api_client.get(url).status_code == 200

    def test_commit_triggers_no_record_recompute(self, api_client) -> None:
        """§4: the payment entity extra — NO recompute. Deleting the
        payment leaves the record's seats AND status untouched (unlike
        the visit sibling, a payment is not part of the record
        status/seats)."""
        made = self._payment(api_client)
        before = api_client.get(f"/api/v1/records/{made['record_id']}").json()

        resp = api_client.request(
            "DELETE", f"/api/v1/payments/{made['payment']['id']}",
            json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        after = api_client.get(f"/api/v1/records/{made['record_id']}").json()
        assert after["seats"] == before["seats"]
        assert after["status"] == before["status"]
