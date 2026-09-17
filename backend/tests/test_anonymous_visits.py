"""Anonymous-visit unification #257 — backend behavioral guarantees.

The legacy ``records.anonym_visits`` counter is gone: an anonymous guest is
a visit row with ``visitor_id = NULL``. This file pins the behavior that
must survive the unification:

* US6  — anonymous visits participate in record status derivation
         (visit_status canon counts ALL visits, named or anonymous);
* D4   — cancel-cascade treats anonymous visits like any other: PUT with
         all-cancelled visits cancels the record and frees its seats;
* D3   — the seats invariant ``record.seats == len(record.visits)`` holds
         across every mutation point (create/PUT/PATCH/POST visit/DELETE visit);
* D7   — conversion of an anonymous visit to a named one (PATCH visitor_id)
         on a FULL activity succeeds (conversion must not re-check capacity
         against its own seat) and the guests-sort sees it as named.
"""
import pytest

pytestmark = pytest.mark.api


def _anonymous_visit(price: int = 0, status: str = "waiting") -> dict:
    """Payload element for an anonymous guest (no name, no visitor_id)."""
    return {"visitor_id": None, "price": price, "status": status}


class TestAnonymousVisitStatusParticipation:
    """US6: anonymous visits participate in record status derivation."""

    def test_record_waiting_with_anonymous_visit_then_visited(
        self, api_client, create_record,
    ) -> None:
        """Record [named missed, anonymous waiting] → waiting; PATCH the
        anonymous visit to 'visited' → record becomes VISITED."""
        record = create_record(visits=[
            {"name": "Мэри", "price": 1000, "status": "missed"},
            _anonymous_visit(status="waiting"),
        ])
        assert record["status"] == "waiting"  # missed + waiting → waiting

        anon_visit = next(v for v in record["visits"] if v["visitor_id"] is None)
        resp = api_client.patch(
            f"/api/v1/visits/{anon_visit['id']}",
            json={"status": "visited"},
        )
        assert resp.status_code == 200, f"PATCH failed: {resp.text}"

        record_resp = api_client.get(f"/api/v1/records/{record['id']}")
        assert record_resp.status_code == 200
        assert record_resp.json()["status"] == "visited"


class TestAnonymousVisitCancelCascade:
    """D4: cancel-cascade covers anonymous visits and frees the seat."""

    def test_put_all_cancelled_frees_seat_for_new_booking(
        self, api_client, create_record,
    ) -> None:
        """PUT with all-cancelled visits (incl. the anonymous element):
        every visit cancelled, record CANCELLED, the seat is reusable —
        a new booking on the same activity succeeds without 409."""
        record = create_record(visits=[
            {"name": "Аня", "price": 1000, "status": "waiting"},
            _anonymous_visit(status="waiting"),
        ])
        cancelled_visits = [
            {**v, "status": "cancelled"} for v in record["visits"]
        ]
        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "visits": cancelled_visits,
        })
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        body = resp.json()
        assert body["status"] == "cancelled"
        assert all(v["status"] == "cancelled" for v in body["visits"])
        anonymous = [v for v in body["visits"] if v["visitor_id"] is None]
        assert len(anonymous) == 1, "anonymous visit must be cancelled too"

        # Seat freed: a new booking on the same activity is admitted (no 409)
        rebooking = api_client.post("/api/v1/records", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "visits": [{"name": "Новая", "price": 1000, "status": "waiting"}],
        })
        assert rebooking.status_code == 201, (
            f"seat should be free after cancel: {rebooking.text}"
        )

    def test_capacity_1_activity_block_and_free(
        self, api_client, create_activity, create_client,
    ) -> None:
        """Strict D4 probe on a capacity-1 activity: anonymous booking fills
        the seat, cancel frees it, a new booking succeeds."""
        activity = create_activity(capacity=1)
        client = create_client()

        first = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [_anonymous_visit(status="waiting")],
        })
        assert first.status_code == 201, first.text

        # Full → second booking 409s
        blocked = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [_anonymous_visit(status="waiting")],
        })
        assert blocked.status_code == 409, f"expected full: {blocked.text}"

        # Cancel the anonymous visit via PUT (all-cancelled array)
        record = first.json()
        cancelled = [{**v, "status": "cancelled"} for v in record["visits"]]
        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "visits": cancelled,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "cancelled"

        # Seat freed → booking succeeds again
        after = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [_anonymous_visit(status="waiting")],
        })
        assert after.status_code == 201, (
            f"seat should be free after cancel: {after.text}"
        )


class TestSeatsInvariant:
    """D3: record.seats == len(record.visits) across all mutation points."""

    def test_seats_invariant_across_mutation_points(
        self, api_client, create_record,
    ) -> None:
        """create → PUT → PATCH → POST /visits → DELETE /visits:
        after every point the invariant holds."""
        record = create_record(visits=[
            {"name": "Аня", "price": 1000, "status": "waiting"},
            _anonymous_visit(status="waiting"),
        ])

        def _assert_invariant() -> dict:
            current = api_client.get(f"/api/v1/records/{record['id']}").json()
            assert current["seats"] == len(current["visits"]), (
                f"invariant broken: seats={current['seats']}, "
                f"visits={len(current['visits'])}"
            )
            return current

        _assert_invariant()  # create

        # PUT: replace visits (3 elements)
        current = _assert_invariant()
        put_resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": current["activity_id"],
            "client_id": current["client_id"],
            "visits": [
                {"name": "Аня", "price": 1000, "status": "waiting"},
                {"name": "Боря", "price": 1000, "status": "waiting"},
                _anonymous_visit(status="waiting"),
            ],
        })
        assert put_resp.status_code == 200, put_resp.text
        _assert_invariant()  # PUT

        # PATCH: shrink to 1 element
        patch_resp = api_client.patch(
            f"/api/v1/records/{record['id']}",
            json={"visits": [_anonymous_visit(status="waiting")]},
        )
        assert patch_resp.status_code == 200, patch_resp.text
        current = _assert_invariant()  # PATCH

        # POST /visits: add one → seats grows
        visit_add = api_client.post("/api/v1/visits", json={
            "record_id": record["id"],
            "price": 500,
            "status": "waiting",
        })
        assert visit_add.status_code == 201, visit_add.text
        current = _assert_invariant()  # POST visit

        # DELETE /visits: remove one → seats shrinks
        del_resp = api_client.delete(f"/api/v1/visits/{visit_add.json()['id']}")
        assert del_resp.status_code == 204, del_resp.text
        _assert_invariant()  # DELETE visit


class TestAnonymousToNamedConversion:
    """D7: converting an anonymous visit to a named one (PATCH visitor_id)."""

    def test_conversion_on_full_activity_succeeds_and_sorts_as_named(
        self, api_client, create_activity, create_client, create_record,
    ) -> None:
        """PATCH /visits/{id} {visitor_id} on a FULL activity → 200, seats
        unchanged, guests-sort sees the visit as named (conversion must not
        be blocked by the capacity guard)."""
        activity = create_activity(capacity=1)
        client = create_client()

        record = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [_anonymous_visit(status="waiting")],
        }).json()

        # Named visitor linked to the same client
        visitor = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Конверт", "age": None,
        }).json()

        anon_visit = next(
            v for v in record["visits"] if v["visitor_id"] is None
        )
        resp = api_client.patch(
            f"/api/v1/visits/{anon_visit['id']}",
            json={"visitor_id": visitor["id"]},
        )
        assert resp.status_code == 200, f"conversion failed: {resp.text}"
        assert resp.json()["visitor_id"] == visitor["id"]

        # Seats unchanged (activity is full — conversion must not 409)
        current = api_client.get(f"/api/v1/records/{record['id']}").json()
        assert current["seats"] == 1
        assert current["visits"][0]["visitor_id"] == visitor["id"]

        # Guests-sort counts it as named — asserted via ORDER (the list
        # response exposes no guests field; the expression lives in the
        # ORDER BY). guests = named-visit count: zero_named (anonymous
        # only) = 0, converted record = 1, two_named = 2 → the strict
        # desc chain holds deterministically ONLY once the converted
        # visit counts as named (pre-conversion record ties zero_named
        # at 0 → order would fall to the id tiebreak).
        zero_named = create_record(visits=[_anonymous_visit(status="waiting")])
        two_named = create_record(visits=[
            {"name": "Комп1", "price": 1000, "status": "waiting"},
            {"name": "Комп2", "price": 1000, "status": "waiting"},
        ])
        ids = [r["id"] for r in api_client.get("/api/v1/records", params={
            "sort_by": "guests", "sort_order": "desc",
        }).json()["items"]]
        assert (
            ids.index(two_named["id"])
            < ids.index(record["id"])
            < ids.index(zero_named["id"])
        ), "converted visit must count as named for guests-sort"
