"""Tests for GET /api/v1/clients with stats aggregation, filtering, pagination, sorting.

TDD RED phase — these tests MUST fail before any production code is written.
"""

import pytest

pytestmark = pytest.mark.integration


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
        assert "records_count" in our_client, f"Missing records_count: {our_client.keys()}"
        assert "last_record" in our_client, f"Missing last_record: {our_client.keys()}"
        assert "total_paid" in our_client, f"Missing total_paid: {our_client.keys()}"
        assert "missed_records" in our_client, f"Missing missed_records: {our_client.keys()}"


# ─── Stats Aggregation Tests ──────────────────────────────────────────────────

class TestClientStatsAggregation:
    """Verify stats are computed correctly from records/visits/payments."""

    def test_records_count_with_single_record(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 1 record (1 visit) has records_count=1."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest", "price": 3500, "status": "visited"}],
        )
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["records_count"] == 1

    def test_records_count_with_multiple_visits_in_one_record(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 1 record (2 visits) has records_count=1 (counts records, not visits)."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[
                {"name": "Guest1", "price": 3500, "status": "visited"},
                {"name": "Guest2", "price": 2500, "status": "visited"},
            ],
        )
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["records_count"] == 1  # Should count 1 record, not 2 visits

    def test_records_count_with_multiple_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 2 records (each 1 visit) has records_count=2."""
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
        assert item["records_count"] == 2

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

    def test_missed_records_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """Client with 2 records, each having 1 missed visit, has missed_records=2."""
        client, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            visits=[{"name": "Guest1", "price": 3500, "status": "missed"}],
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": client["id"],
            "comment": "Second",
            "visits": [{"name": "Guest2", "price": 2500, "status": "missed"}],
        })
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["missed_records"] == 2

    def test_client_without_records_has_zero_stats(
        self, api_client, create_client
    ) -> None:
        """Client with no records has all stats at zero."""
        client = create_client(name="No Records Client")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["records_count"] == 0
        assert item["total_paid"] == 0
        assert item["missed_records"] == 0


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

    def test_search_is_case_insensitive(
        self, api_client, create_activity, create_client
    ) -> None:
        """search matches regardless of case (ilike)."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "John Smith", "phone": "+79991000003"},
        )

        # Search with different case
        resp = api_client.get("/api/v1/clients", params={"search": "john"})
        body = resp.json()
        names = [c["name"] for c in body["items"]]
        assert "John Smith" in names

    def test_search_is_substring(
        self, api_client, create_activity, create_client
    ) -> None:
        """search matches partial substrings."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Alexandra Petrova", "phone": "+79991000004"},
        )

        # Search for partial name
        resp = api_client.get("/api/v1/clients", params={"search": "alex"})
        body = resp.json()
        names = [c["name"] for c in body["items"]]
        assert "Alexandra Petrova" in names


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

    def test_sort_by_records_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=records_count orders by number of records."""
        # Client with 1 record
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "OneVisit", "phone": "+79996000001"},
            visits=[{"name": "Guest", "price": 3500, "status": "waiting"}],
        )
        # Client with 2 records
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "TwoVisits", "phone": "+79996000002"},
            visits=[{"name": "G1", "price": 3500, "status": "visited"}],
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Extra",
            "visits": [{"name": "G2", "price": 2500, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "records_count", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        # Our two clients should have TwoVisits before OneVisit
        relevant = [c for c in items if c["name"] in ("OneVisit", "TwoVisits")]
        assert len(relevant) == 2
        assert relevant[0]["records_count"] >= relevant[1]["records_count"]


# ─── Filter Tests ─────────────────────────────────────────────────────────────

class TestClientListFilterIsActive:
    """Verify is_active filter."""

    def test_filter_is_active_true(self, api_client, create_client) -> None:
        """is_active=true returns only active clients."""
        active = create_client(name="Active One")
        # Create and delete another to have an inactive one
        inactive = create_client(name="Inactive One")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients", params={"is_active": "true"})
        ids = [c["id"] for c in resp.json()["items"]]
        assert active["id"] in ids
        assert inactive["id"] not in ids

    def test_filter_is_active_false(self, api_client, create_client) -> None:
        """is_active=false returns only soft-deleted clients."""
        active = create_client(name="Active Two")
        inactive = create_client(name="Inactive Two")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients", params={"is_active": "false"})
        ids = [c["id"] for c in resp.json()["items"]]
        assert inactive["id"] in ids
        assert active["id"] not in ids

    def test_filter_is_active_none_returns_all(self, api_client, create_client) -> None:
        """No is_active filter returns all active clients (default behavior)."""
        create_client(name="Default Client")
        resp = api_client.get("/api/v1/clients")
        assert resp.json()["total"] >= 1


class TestClientListFilterDateRanges:
    """Verify date range filters."""

    def test_filter_created_from(self, api_client, create_client) -> None:
        """created_from filters clients created on or after date."""
        client = create_client(name="DateFilter")
        resp = api_client.get(
            "/api/v1/clients", params={"created_from": "2020-01-01"}
        )
        ids = [c["id"] for c in resp.json()["items"]]
        assert client["id"] in ids

    def test_filter_created_to_future(self, api_client, create_client) -> None:
        """created_to with future date includes recently created clients."""
        client = create_client(name="FutureFilter")
        resp = api_client.get(
            "/api/v1/clients", params={"created_to": "2099-12-31"}
        )
        ids = [c["id"] for c in resp.json()["items"]]
        assert client["id"] in ids

    def test_filter_created_to_past_excludes_recent(self, api_client, create_client) -> None:
        """created_to with past date excludes recently created clients."""
        client = create_client(name="PastExcl")
        resp = api_client.get(
            "/api/v1/clients", params={"created_to": "2020-01-01"}
        )
        ids = [c["id"] for c in resp.json()["items"]]
        assert client["id"] not in ids

    def test_filter_updated_from(self, api_client, create_client) -> None:
        """updated_from filters clients updated on or after date."""
        client = create_client(name="UpdateFilter")
        resp = api_client.get(
            "/api/v1/clients", params={"updated_from": "2020-01-01"}
        )
        ids = [c["id"] for c in resp.json()["items"]]
        assert client["id"] in ids

    def test_filter_combined_date_range(self, api_client, create_client) -> None:
        """created_from + created_to narrows results."""
        client = create_client(name="RangeFilter")
        resp = api_client.get("/api/v1/clients", params={
            "created_from": "2020-01-01",
            "created_to": "2099-12-31",
        })
        ids = [c["id"] for c in resp.json()["items"]]
        assert client["id"] in ids


class TestClientListFilterStats:
    """Verify stats-based filters."""

    def test_filter_min_records(self, api_client, create_activity, create_client) -> None:
        """min_records=2 returns only clients with >= 2 records."""
        # Client with 1 record
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MinVisit1", "phone": "+79997000001"},
        )
        # Client with 2 records
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MinVisit2", "phone": "+79997000002"},
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Extra",
            "visits": [{"name": "G2", "price": 3000, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients", params={"min_records": "2", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c2["id"] in ids
        assert c1["id"] not in ids

    def test_filter_max_records(self, api_client, create_activity, create_client) -> None:
        """max_records=1 returns only clients with <= 1 record."""
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MaxV1", "phone": "+79997000010"},
        )
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MaxV2", "phone": "+79997000011"},
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Extra",
            "visits": [{"name": "G2", "price": 3000, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients", params={"max_records": "1", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c1["id"] in ids
        assert c2["id"] not in ids

    def test_filter_min_paid(self, api_client, create_activity, create_client) -> None:
        """min_paid=4000 returns clients with total_paid >= 4000."""
        c1, r1 = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MinPaid1", "phone": "+79997000020"},
        )
        c2, r2 = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MinPaid2", "phone": "+79997000021"},
        )
        _add_payment(api_client, r1["id"], amount=2000)  # total 2000
        _add_payment(api_client, r2["id"], amount=5000)  # total 5000

        resp = api_client.get("/api/v1/clients", params={"min_paid": "4000", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c2["id"] in ids
        assert c1["id"] not in ids

    def test_filter_max_paid(self, api_client, create_activity, create_client) -> None:
        """max_paid=3000 returns clients with total_paid <= 3000."""
        c1, r1 = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MaxPaid1", "phone": "+79997000030"},
        )
        c2, r2 = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MaxPaid2", "phone": "+79997000031"},
        )
        _add_payment(api_client, r1["id"], amount=1000)  # total 1000
        _add_payment(api_client, r2["id"], amount=5000)  # total 5000

        resp = api_client.get("/api/v1/clients", params={"max_paid": "3000", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c1["id"] in ids
        assert c2["id"] not in ids

    def test_filter_missed_from(self, api_client, create_activity, create_client) -> None:
        """missed_from=2 returns clients with >= 2 missed records."""
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Miss1", "phone": "+79997000040"},
            visits=[{"name": "G1", "price": 3500, "status": "missed"}],
        )
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Miss2", "phone": "+79997000041"},
            visits=[{"name": "G1", "price": 3500, "status": "missed"}],
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Second missed record",
            "visits": [{"name": "G2", "price": 2500, "status": "missed"}],
        })

        resp = api_client.get("/api/v1/clients", params={"missed_from": "2", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c2["id"] in ids
        assert c1["id"] not in ids

    def test_filter_missed_to(self, api_client, create_activity, create_client) -> None:
        """missed_to=0 returns clients with <= 0 missed visits."""
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "NoMiss", "phone": "+79997000050"},
            visits=[{"name": "G1", "price": 3500, "status": "visited"}],
        )
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "HasMiss", "phone": "+79997000051"},
            visits=[{"name": "G1", "price": 3500, "status": "missed"}],
        )

        resp = api_client.get("/api/v1/clients", params={"missed_to": "0", "per_page": 100})
        ids = [c["id"] for c in resp.json()["items"]]
        assert c1["id"] in ids
        assert c2["id"] not in ids

    def test_filter_min_and_max_records_combined(
        self, api_client, create_activity, create_client
    ) -> None:
        """min_records + max_records narrows to a range."""
        # Client with 1 record
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "RangeV1", "phone": "+79997000060"},
        )
        # Client with 3 records
        c3, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "RangeV3", "phone": "+79997000061"},
        )
        for _ in range(2):
            act = create_activity()
            api_client.post("/api/v1/records", json={
                "activity_id": act["id"],
                "client_id": c3["id"],
                "comment": "Extra",
                "visits": [{"name": "G", "price": 3000, "status": "visited"}],
            })

        resp = api_client.get("/api/v1/clients", params={
            "min_records": "2", "max_records": "4", "per_page": 100,
        })
        ids = [c["id"] for c in resp.json()["items"]]
        assert c3["id"] in ids
        assert c1["id"] not in ids


# ─── Extended Sort Tests ──────────────────────────────────────────────────────

class TestClientListSortExtended:
    """Verify sorting by additional fields."""

    def test_sort_by_total_paid_desc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=total_paid orders by payment amount."""
        c_low, r_low = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "LowPay", "phone": "+79998000001"},
        )
        c_high, r_high = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "HighPay", "phone": "+79998000002"},
        )
        _add_payment(api_client, r_low["id"], amount=1000)
        _add_payment(api_client, r_high["id"], amount=10000)

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "total_paid", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("LowPay", "HighPay")]
        assert len(relevant) == 2
        assert relevant[0]["total_paid"] >= relevant[1]["total_paid"]

    def test_sort_by_missed_records_desc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=missed_records orders by missed record count."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "NoMissSort", "phone": "+79998000010"},
            visits=[{"name": "G", "price": 3500, "status": "visited"}],
        )
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MissSort", "phone": "+79998000011"},
            visits=[{"name": "G1", "price": 3500, "status": "missed"}],
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Second missed",
            "visits": [{"name": "G2", "price": 2500, "status": "missed"}],
        })

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "missed_records", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("NoMissSort", "MissSort")]
        assert len(relevant) == 2
        assert relevant[0]["missed_records"] >= relevant[1]["missed_records"]

    def test_sort_by_created_at_desc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=created_at desc returns newest first."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "OldCreated", "phone": "+79998000020"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "NewCreated", "phone": "+79998000021"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "created_at", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("OldCreated", "NewCreated")]
        assert len(relevant) == 2
        assert relevant[0]["created_at"] >= relevant[1]["created_at"]

    def test_sort_by_last_record_desc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=last_record desc orders by most recent Activity.start (no status filter)."""
        from datetime import UTC, datetime, timedelta

        early_start = datetime.now(UTC) - timedelta(days=30)
        late_start = datetime.now(UTC) - timedelta(days=5)

        # EarlyVisitor: activity 30 days ago
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "EarlyVisitor", "phone": "+79998000030"},
        )
        early_act = create_activity(start=early_start)
        api_client.post("/api/v1/records", json={
            "activity_id": early_act["id"],
            "client_id": c1["id"],
            "comment": "Early",
            "visits": [{"name": "G", "price": 3500, "status": "visited"}],
        })

        # LateVisitor: activity 5 days ago (more recent)
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "LateVisitor", "phone": "+79998000031"},
        )
        late_act = create_activity(start=late_start)
        api_client.post("/api/v1/records", json={
            "activity_id": late_act["id"],
            "client_id": c2["id"],
            "comment": "Late",
            "visits": [{"name": "G", "price": 3500, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "last_record", "sort_order": "desc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("EarlyVisitor", "LateVisitor")]
        assert len(relevant) == 2
        # LateVisitor should be first (later Activity.start = more recent last_record)
        assert relevant[0]["name"] == "LateVisitor"

    def test_sort_by_updated_at_asc(
        self, api_client, create_activity, create_client
    ) -> None:
        """sort_by=updated_at asc returns oldest first."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "FirstUpdated", "phone": "+79998000040"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "LastUpdated", "phone": "+79998000041"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "updated_at", "sort_order": "asc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("FirstUpdated", "LastUpdated")]
        assert len(relevant) == 2
        assert relevant[0]["updated_at"] <= relevant[1]["updated_at"]

    def test_invalid_sort_by_falls_back_to_name(
        self, api_client, create_activity, create_client
    ) -> None:
        """Invalid sort_by field falls back to name sorting."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Zebra", "phone": "+79998000050"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "Apple", "phone": "+79998000051"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "sort_by": "nonexistent_field", "sort_order": "asc", "per_page": 100,
        })
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("Zebra", "Apple")]
        assert len(relevant) == 2
        # Should fall back to name asc
        assert relevant[0]["name"] == "Apple"
        assert relevant[1]["name"] == "Zebra"

    def test_default_sort_is_name_asc(
        self, api_client, create_activity, create_client
    ) -> None:
        """Without sort params, default is name ascending."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "ZDefault", "phone": "+79998000060"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "ADefault", "phone": "+79998000061"},
        )

        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        items = resp.json()["items"]
        relevant = [c for c in items if c["name"] in ("ZDefault", "ADefault")]
        assert len(relevant) == 2
        assert relevant[0]["name"] == "ADefault"
        assert relevant[1]["name"] == "ZDefault"


# ─── Pagination Edge Cases ────────────────────────────────────────────────────

class TestClientListPaginationEdgeCases:
    """Edge cases for pagination parameters."""

    def test_page_zero_returns_422(self, api_client) -> None:
        """page=0 returns 422 validation error."""
        resp = api_client.get("/api/v1/clients", params={"page": 0})
        assert resp.status_code == 422

    def test_negative_page_returns_422(self, api_client) -> None:
        """Negative page returns 422 validation error."""
        resp = api_client.get("/api/v1/clients", params={"page": -1})
        assert resp.status_code == 422

    def test_per_page_zero_returns_422(self, api_client) -> None:
        """per_page=0 returns 422 validation error."""
        resp = api_client.get("/api/v1/clients", params={"per_page": 0})
        assert resp.status_code == 422

    def test_negative_per_page_returns_422(self, api_client) -> None:
        """Negative per_page returns 422 validation error."""
        resp = api_client.get("/api/v1/clients", params={"per_page": -5})
        assert resp.status_code == 422

    def test_page_beyond_total_returns_empty_items(
        self, api_client, create_client
    ) -> None:
        """Page number beyond total pages returns empty items."""
        create_client(name="OnlyOne")
        resp = api_client.get("/api/v1/clients", params={"page": 100, "per_page": 10})
        body = resp.json()
        assert body["items"] == []
        assert body["page"] == 100
        assert body["total"] >= 1  # total still counts

    def test_per_page_1_returns_single_item(self, api_client, create_client) -> None:
        """per_page=1 returns exactly one item."""
        create_client(name="OneItem")
        create_client(name="TwoItem")
        resp = api_client.get("/api/v1/clients", params={"per_page": 1})
        assert len(resp.json()["items"]) == 1

    def test_total_independent_of_per_page(
        self, api_client, create_client
    ) -> None:
        """Total count stays the same regardless of per_page."""
        for i in range(3):
            create_client(name=f"TotalIndep {i}")

        resp1 = api_client.get("/api/v1/clients", params={"per_page": 1})
        resp2 = api_client.get("/api/v1/clients", params={"per_page": 100})
        assert resp1.json()["total"] == resp2.json()["total"]

    def test_per_page_100_accepted(self, api_client) -> None:
        """per_page=100 is accepted (max allowed)."""
        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        assert resp.status_code == 200


# ─── Stats Accuracy Extended ──────────────────────────────────────────────────

class TestClientStatsAggregationExtended:
    """More thorough stats tests for edge cases."""

    def test_total_paid_across_multiple_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """Payments across multiple records sum correctly."""
        client, r1 = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MultiRec", "phone": "+79999000001"},
        )
        _add_payment(api_client, r1["id"], amount=2000)

        # Second record for same client
        activity2 = create_activity()
        r2_resp = api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": client["id"],
            "comment": "Record 2",
            "visits": [{"name": "G2", "price": 3500, "status": "visited"}],
        })
        assert r2_resp.status_code == 201
        _add_payment(api_client, r2_resp.json()["id"], amount=3000)

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["total_paid"] == 5000

    def test_total_paid_not_multiplied_by_visit_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """Guard against cartesian product: 1 record with multiple visits + payments.

        total_paid must equal the true payment sum, NOT sum * number_of_visits.
        This is the exact shape that triggered the historical inflated-total bug (#105).
        """
        # 1 record with 2 visits (this is what multiplies payments if joined naively)
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "CartesianGuard", "phone": "+79999123456"},
            visits=[
                {"name": "V1", "price": 3500, "status": "missed"},
                {"name": "V2", "price": 2500, "status": "visited"},
            ],
        )
        # 2 payments totaling 3000
        _add_payment(api_client, record["id"], amount=1000, method="card")
        _add_payment(api_client, record["id"], amount=2000, method="cash")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])

        # total_paid must be exactly 3000, NOT 6000 (= 3000 * 2 visits)
        assert item["total_paid"] == 3000, (
            f"total_paid inflated by cartesian product: got {item['total_paid']}, "
            f"expected 3000 (payments must not be multiplied by visit count)"
        )
        # sanity: other stats unaffected by the same query
        assert item["records_count"] == 1  # one record, not two visits
        # Record.status is 'visited' (1 visited visit wins priority), so
        # the record is NOT counted in missed_records.
        assert item["missed_records"] == 0  # record-level 'visited', not 'missed'

    def test_last_record_is_most_recent(
        self, api_client, create_activity, create_client
    ) -> None:
        """last_record field reflects the most recent record's Activity.start."""
        client, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "LastVisitAcc", "phone": "+79999000010"},
        )
        # Create a second record (newer visit)
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": client["id"],
            "comment": "Later",
            "visits": [{"name": "G", "price": 3500, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["last_record"] is not None

    def test_mixed_visit_statuses_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """Mixed visited/missed/cancelled within a single record.

        Record-level status is 'visited' (priority: any-visited > all-missed >
        all-cancelled > waiting), so missed_records==0 for this record
        (record status is 'visited', not 'missed'). This validates the
        semantic shift: counts are at the Record level, not the Visit level.
        """
        client, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MixedStatus", "phone": "+79999000020"},
            visits=[
                {"name": "V1", "price": 3500, "status": "visited"},
                {"name": "V2", "price": 2500, "status": "missed"},
                {"name": "V3", "price": 1500, "status": "cancelled"},
            ],
        )

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["records_count"] == 1  # counts 1 record, not 3 visits
        # Record.status = 'visited' (priority: visited > missed > cancelled)
        assert item["missed_records"] == 0  # record is 'visited', not 'missed'

    def test_payments_only_count_active_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """total_paid only aggregates from active records."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "ActiveRecPay", "phone": "+79999000030"},
        )
        _add_payment(api_client, record["id"], amount=5000)

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["total_paid"] == 5000

    def test_client_with_multiple_payment_methods(
        self, api_client, create_activity, create_client
    ) -> None:
        """Multiple payment methods (card + cash + transfer) all count."""
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "MultiPay", "phone": "+79999000040"},
        )
        _add_payment(api_client, record["id"], amount=1000, method="card")
        _add_payment(api_client, record["id"], amount=2000, method="cash")
        _add_payment(api_client, record["id"], amount=3000, method="transfer")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["total_paid"] == 6000

    def test_no_last_record_when_no_visits(
        self, api_client, create_client
    ) -> None:
        """Client without records has last_record=None."""
        client = create_client(name="NoVisitClient")
        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["last_record"] is None

    def test_last_record_uses_activity_start_of_record(
        self, api_client, create_activity, create_client
    ) -> None:
        """last_record = MAX(Activity.start) over all active records of the client.
        NO status filter: cancelled/missed/waiting are included.
        """
        from datetime import UTC, datetime, timedelta

        client = create_client(name="AttendVsBooked", phone="+79999111001")

        past = datetime.now(UTC) - timedelta(days=10)
        future = datetime.now(UTC) + timedelta(days=10)
        act_past = create_activity(start=past)
        act_future = create_activity(start=future)

        # Attended the past activity
        api_client.post("/api/v1/records", json={
            "activity_id": act_past["id"], "client_id": client["id"],
            "visits": [{"name": "V", "price": 1000, "status": "visited"}],
        })
        # Booked (waiting) for the future activity
        api_client.post("/api/v1/records", json={
            "activity_id": act_future["id"], "client_id": client["id"],
            "visits": [{"name": "V", "price": 1000, "status": "waiting"}],
        })

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["last_record"] is not None
        # Must be the FUTURE activity's start — the latest by Activity.start,
        # because last_record is the MAX over all records regardless of status.
        assert item["last_record"].startswith(future.date().isoformat())

    def test_last_record_is_none_when_no_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """A client with NO records has last_record=None."""
        client = create_client(name="NeverAttended", phone="+79999111002")
        # No record at all — last_record should be None.

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["last_record"] is None


# ─── Combined Filter Tests ────────────────────────────────────────────────────

class TestClientListCombinedFilters:
    """Verify multiple filters working together."""

    def test_search_with_is_active(self, api_client, create_client) -> None:
        """search + is_active filter together."""
        active = create_client(name="Combined Active", phone="+79999500001")
        inactive = create_client(name="Combined Inactive", phone="+79999500002")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients", params={
            "search": "Combined", "is_active": "true",
        })
        ids = [c["id"] for c in resp.json()["items"]]
        assert active["id"] in ids
        assert inactive["id"] not in ids

    def test_search_with_min_records(
        self, api_client, create_activity, create_client
    ) -> None:
        """search + min_records filter together."""
        c1, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "SearchVisit1", "phone": "+79999500010"},
        )
        c2, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "SearchVisit2", "phone": "+79999500011"},
        )
        activity2 = create_activity()
        api_client.post("/api/v1/records", json={
            "activity_id": activity2["id"],
            "client_id": c2["id"],
            "comment": "Extra",
            "visits": [{"name": "G", "price": 3000, "status": "visited"}],
        })

        resp = api_client.get("/api/v1/clients", params={
            "search": "SearchVisit", "min_records": "2", "per_page": 100,
        })
        ids = [c["id"] for c in resp.json()["items"]]
        assert c2["id"] in ids
        assert c1["id"] not in ids

    def test_date_range_with_sort(
        self, api_client, create_activity, create_client
    ) -> None:
        """created_from + sort_by together."""
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "DateSortA", "phone": "+79999500020"},
        )
        _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "DateSortB", "phone": "+79999500021"},
        )

        resp = api_client.get("/api/v1/clients", params={
            "created_from": "2020-01-01",
            "sort_by": "name",
            "sort_order": "asc",
            "per_page": 100,
        })
        items = resp.json()["items"]
        names = [c["name"] for c in items if c["name"].startswith("DateSort")]
        assert names == sorted(names)


# ─── TDD #131 — Records-based semantics ────────────────────────────────────────
#
# These tests pin down the public contract of the renamed stats fields:
#   visits_count   → records_count
#   last_visit     → last_record
#   missed_visits  → missed_records
#
# They were written BEFORE the production rename (RED phase) and were
# expected to fail because the old field names are still emitted.

class TestClientStatsRecordsRename:
    """Issue #131: client-stats now uses Record as the single semantic unit."""

    def test_records_count_renamed(
        self, api_client, create_activity, create_client
    ) -> None:
        """Response exposes `records_count` (not `visits_count`).
        Backed by existing Record rows (hard-delete entity — no is_active filter), not visits.
        """
        client, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "RenameCount", "phone": "+79990001301"},
            visits=[
                {"name": "A", "price": 1000, "status": "waiting"},
                {"name": "B", "price": 1000, "status": "waiting"},
            ],
        )
        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["records_count"] == 1  # one record, regardless of 2 visits
        assert "visits_count" not in item

    def test_missed_records_uses_record_status(
        self, api_client, create_activity, create_client
    ) -> None:
        """`missed_records` is derived from Record.status='missed', NOT Visit.status.

        Client A: 1 record, 2 visits all 'missed' → Record.status='missed'
                  → missed_records == 1 (record-level, not 2 visit-level).
        Client B: 1 record, 1 'visited' + 1 'missed' visit
                  → Record.status='visited' (priority: visited > missed)
                  → missed_records == 0 (record is 'visited', not 'missed').
        """
        # Client A: all-missed record
        client_a, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "AllMissed", "phone": "+79990001302"},
            visits=[
                {"name": "A1", "price": 1000, "status": "missed"},
                {"name": "A2", "price": 1000, "status": "missed"},
            ],
        )

        # Client B: visited + missed record (priority: visited wins)
        client_b, _ = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "VisitedWins", "phone": "+79990001303"},
            visits=[
                {"name": "B1", "price": 1000, "status": "visited"},
                {"name": "B2", "price": 1000, "status": "missed"},
            ],
        )

        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        items = {c["id"]: c for c in resp.json()["items"]}

        # Client A: the record IS 'missed' (both visits missed) → count 1
        assert items[client_a["id"]]["missed_records"] == 1
        # Client B: the record is 'visited' (priority rule) → count 0
        assert items[client_b["id"]]["missed_records"] == 0

    def test_last_record_uses_activity_start_no_status_filter(
        self, api_client, create_activity, create_client
    ) -> None:
        """`last_record` = MAX(Activity.start) over all active records of the client,
        with NO status filter (cancelled/missed/waiting are included).

        Record A: Activity.start=2026-01-10, visit status='visited'
        Record B: Activity.start=2026-01-20, visit status='cancelled'

        Expected: last_record == '2026-01-20' (Record B wins by Activity.start,
        even though its only visit is 'cancelled' — no status filter).
        """
        from datetime import UTC, datetime

        client = create_client(name="LastRecordMix", phone="+79990001304")

        early = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
        late = datetime(2026, 1, 20, 12, 0, tzinfo=UTC)

        act_early = create_activity(start=early)
        api_client.post("/api/v1/records", json={
            "activity_id": act_early["id"], "client_id": client["id"],
            "visits": [{"name": "V1", "price": 1000, "status": "visited"}],
        })
        act_late = create_activity(start=late)
        api_client.post("/api/v1/records", json={
            "activity_id": act_late["id"], "client_id": client["id"],
            "visits": [{"name": "V2", "price": 1000, "status": "cancelled"}],
        })

        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["last_record"] is not None
        # Record B (cancelled) has the later Activity.start — must win
        assert item["last_record"].startswith("2026-01-20")

    def test_all_cancelled_records_missed_zero(
        self, api_client, create_activity, create_client
    ) -> None:
        """US-7 edge case: client with all-cancelled records.

        Record A: Activity.start=2026-01-10, visit status='cancelled'
        Record B: Activity.start=2026-01-22, visit status='cancelled'

        Both records' status = 'cancelled' (NOT 'missed').
        Expected: missed_records == 0, last_record = '2026-01-22'.
        """
        from datetime import UTC, datetime

        client = create_client(name="AllCancelled", phone="+79990001305")

        first = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
        second = datetime(2026, 1, 22, 12, 0, tzinfo=UTC)

        act1 = create_activity(start=first)
        api_client.post("/api/v1/records", json={
            "activity_id": act1["id"], "client_id": client["id"],
            "visits": [{"name": "C1", "price": 1000, "status": "cancelled"}],
        })
        act2 = create_activity(start=second)
        api_client.post("/api/v1/records", json={
            "activity_id": act2["id"], "client_id": client["id"],
            "visits": [{"name": "C2", "price": 1000, "status": "cancelled"}],
        })

        resp = api_client.get("/api/v1/clients", params={"per_page": 100})
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])
        assert item["missed_records"] == 0
        assert item["last_record"] is not None
        assert item["last_record"].startswith("2026-01-22")
