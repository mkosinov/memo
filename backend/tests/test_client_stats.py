"""Tests for GET /api/v1/clients with stats aggregation, filtering, pagination, sorting.

TDD RED phase — these tests MUST fail before any production code is written.
"""

import pytest


# ─── Helper: create full data chain (client + record + visits + payments) ──────

def _create_client_with_record(api_client, create_activity, create_client, **overrides):
    """Create a client linked to a record with visits. Returns (client_json, record_json)."""
    activity = create_activity()
    client = create_client(**overrides.get("client", {}))
    visits = overrides.get("visits", [{"name": client["name"], "price": 3500, "status": "waiting"}])
    payload = {
        "activity_id": activity["id"],
        "client_id": client["id"],
        "comment": overrides.get("comment", "Test"),
        "visits": visits,
    }
    resp = api_client.post("/api/v1/records", json=payload)
    assert resp.status_code == 201, f"create_record failed: {resp.text}"
    return client, resp.json()


def _add_payment(api_client, record_id, amount=3000, method="card"):
    """Add a payment to a record."""
    resp = api_client.post("/api/v1/payments", json={
        "record_id": record_id,
        "amount": amount,
        "method": method,
    })
    assert resp.status_code == 201, f"create_payment failed: {resp.text}"
    return resp.json()


# ─── Response Shape Tests ─────────────────────────────────────────────────────

class TestClientListResponseShape:
    """Verify the response shape matches ClientListResponse schema."""

    def test_list_returns_paginated_response(self, api_client) -> None:
        """GET /api/v1/clients returns {items, total, page, per_page}."""
        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body, f"Missing 'items' key: {body.keys()}"
        assert "total" in body, f"Missing 'total' key: {body.keys()}"
        assert "page" in body, f"Missing 'page' key: {body.keys()}"
        assert "per_page" in body, f"Missing 'per_page' key: {body.keys()}"
        assert isinstance(body["items"], list)
        assert isinstance(body["total"], int)
        assert body["page"] == 1
        assert body["per_page"] == 20

    def test_items_contain_stats_fields(self, api_client, create_activity, create_client) -> None:
        """Each item in items[] has stats fields."""
        client, record = _create_client_with_record(api_client, create_activity, create_client)

        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) >= 1

        # Find our client
        our_client = next(c for c in items if c["id"] == client["id"])
        assert "visits_count" in our_client, f"Missing visits_count: {our_client.keys()}"
        assert "last_visit" in our_client, f"Missing last_visit: {our_client.keys()}"
        assert "total_paid" in our_client, f"Missing total_paid: {our_client.keys()}"
        assert "missed_visits" in our_client, f"Missing missed_visits: {our_client.keys()}"


# ─── Stats Aggregation Tests ──────────────────────────────────────────────────

class TestClientStatsAggregation:
    """Verify stats are computed correctly from records/visits/payments."""

    def test_visits_count_with_single_record(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 1 record (1 visit) has visits_count=1."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest", "price": 3500, "status": "visited"}],
        )
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["visits_count"] == 1

    def test_visits_count_with_multiple_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 2 records (each 1 visit) has visits_count=2."""
        client1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest", "price": 3500, "status": "visited"}],
        )
        # Create a second record for the same client
        activity2 = create_activity()
        resp2 = api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": client1["id"],
            "comment": "Second",
            "visits": [{"name": "Guest2", "price": 2500, "status": "waiting"}],
        })
        assert resp2.status_code == 201

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client1["id"])
        assert item["visits_count"] == 2

    def test_total_paid_zero_when_no_payments(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with visits but no payments has total_paid=0."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest", "price": 3500, "status": "waiting"}],
        )
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["total_paid"] == 0

    def test_total_paid_aggregates_payments(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with payments totaling 5000 has total_paid=5000."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest", "price": 3500, "status": "visited"}],
        )
        _add_payment(api_client, record["id"], amount=2000, method="card")
        _add_payment(api_client, record["id"], amount=3000, method="cash")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["total_paid"] == 5000

    def test_missed_visits_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 2 missed visits has missed_visits=2."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[
                {"name": "Guest1", "price": 3500, "status": "missed"},
                {"name": "Guest2", "price": 2500, "status": "missed"},
            ],
        )
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["missed_visits"] == 2

    def test_client_without_records_has_zero_stats(
        self, api_client, create_client
    ) -> None:
        """Client with no records has all stats at zero."""
        client = create_client(name="No Records Client")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["visits_count"] == 0
        assert item["total_paid"] == 0
        assert item["missed_visits"] == 0


# ─── Pagination Tests ─────────────────────────────────────────────────────────

class TestClientListPagination:
    """Verify pagination behavior."""

    def test_default_page_size(
        self, api_client, create_activity, create_client
    ) -> None:
        """Default per_page is 20."""
        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200
        assert resp.json()["per_page"] == 20

    def test_pagination_returns_correct_page(
        self, api_client, create_activity, create_client
    ) -> None:
        """page=1 returns first page of results."""
        for i in range(3):
            _create_client_with_record(
                api_client, create_activity, create_client,
                client={"name": f"Client {i}"},
            )

        resp = api_client.get("/api/v1/clients", params={"page": 1, "per_page": 2})
        body = resp.json()
        assert body["page"] == 1
        assert body["per_page"] == 2
        assert len(body["items"]) == 2

    def test_pagination_second_page(
        self, api_client, create_activity, create_client
    ) -> None:
        """page=2 returns the second page."""
        clients = []
        for i in range(3):
            c, _ = _create_client_with_record(
                api_client, create_activity, create_client,
                client={"name": f"PageClient {i}"},
            )
            clients.append(c)

        resp = api_client.get("/api/v1/clients", params={"page": 2, "per_page": 2})
        body = resp.json()
        assert body["page"] == 2
        assert len(body["items"]) >= 1  # At least 1 on page 2

    def test_total_reflects_all_active_clients(
        self, api_client, create_activity, create_client
    ) -> None:
        """total field counts all matching clients, not just current page."""
        for i in range(5):
            _create_client_with_record(
                api_client, create_activity, create_client,
                client={"name": f"TotalClient {i}"},
            )

        resp = api_client.get("/api/v1/clients", params={"per_page": 2})
        body = resp.json()
        assert body["total"] >= 5

    def test_per_page_max_100(
        self, api_client
    ) -> None:
        """per_page capped at 100 by schema validation."""
        resp = api_client.get("/api/v1/clients", params={"per_page": 101})
        assert resp.status_code == 422


# ─── Search / Filter Tests ────────────────────────────────────────────────────

class TestClientListSearch:
    """Verify search and filter behavior."""

    def test_search_by_name(
        self, api_client, create_activity, create_client
    ) -> None:
        """search param matches client name (case-insensitive)."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Анна Иванова", "phone": "+79991000001"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Борис Петров", "phone": "+79991000002"},
        )

        resp = api_client.get("/api/v1/clients", params={"search": "Анна"})
        body = resp.json()
        names = [c["name"] for c in body["items"]]
        assert "Анна Иванова" in names
        assert "Борис Петров" not in names

    def test_search_by_phone(
        self, api_client, create_activity, create_client
    ) -> None:
        """search param matches client phone."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Phone Client", "phone": "+79993001122"},
        )

        resp = api_client.get("/api/v1/clients", params={"search": "+79993001122"})
        body = resp.json()
        assert body["total"] >= 1
        assert body["items"][0]["phone"] == "+79993001122"

    def test_search_no_results(
        self, api_client
    ) -> None:
        """search with no matches returns empty items."""
        resp = api_client.get("/api/v1/clients", params={"search": "ZZZZNOTEXIST"})
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0


# ─── Sort Tests ───────────────────────────────────────────────────────────────

class TestClientListSort:
    """Verify sorting behavior."""

    def test_sort_by_name_asc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=name&sort_order=asc returns clients alphabetically."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Charlie", "phone": "+79995000001"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Alice", "phone": "+79995000002"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Bob", "phone": "+79995000003"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "name", "sort_order": "asc", "per_page": 100,
        })
        items = resp.json()["items"]
        names = [c["name"] for c in items if c["name"] in ("Alice", "Bob", "Charlie")]
        assert names == sorted(names)

    def test_sort_by_name_desc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=name&sort_order=desc returns clients reverse-alphabetically."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Alice", "phone": "+79995000010"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Charlie", "phone": "+79995000011"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "name", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        names = [c["name"] for c in items if c["name"] in ("Alice", "Charlie")]
        assert names == sorted(names, reverse=True)

    def test_sort_by_visits_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=visits_count orders by number of visits."""
        # Client with 1 visit
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "OneVisit", "phone": "+79996000001"},
            visits=[{"name": "Guest", "price": 3500, "status": "waiting"}],
        )
        # Client with 2 visits
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "TwoVisits", "phone": "+79996000002"},
            visits=[
                {"name": "G1", "price": 3500, "status": "visited"},
                {"name": "G2", "price": 2500, "status": "visited"},
            ],
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "visits_count", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        # Our two clients should have TwoVisits before OneVisit
        relevant = [c for c in items if c["name"] in ("OneVisit", "TwoVisits")]
        assert len(relevant) == 2
        assert relevant[0]["visits_count"] >= relevant[1]["visits_count"]
