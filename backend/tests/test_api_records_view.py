"""API tests for GET /api/v1/records/view — composite records-table read (GH #213 Task 4).

Covers the router wiring of ``RecordService.list_view`` (Task 3):
  - route order: ``/view`` is NOT captured by the ``/{record_id}`` path
    param (declared BEFORE it — spec §4; otherwise a 404 id-lookup)
  - pagination envelope ``{items, total, page, per_page}`` + cross-endpoint
    page-content parity with ``GET /api/v1/records``
  - 422 parity matrix — same invalid params as ``/records`` → 422
    VALIDATION_ERROR (single ``RecordListParams`` class, no drift possible)
  - filters + ``?q=`` parity on the view (US-5)
  - sort parity: for EVERY ``sort_by`` key x both orders the id sequence
    from ``/records/view`` == the id sequence from ``/records`` on the same
    fixture (US-6 — shared ``_sort_columns`` whitelist)
  - display fields present in items incl. archived-entity names (US-3,
    API-level), anonymous/dangling nulls, ``paid`` sums,
    ``activity_start`` byte-parity with the activities endpoint
"""

from datetime import datetime

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

VIEW_URL = "/api/v1/records/view"
LIST_URL = "/api/v1/records"

SORT_KEYS = (
    "date",
    "client",
    "service",
    "master",
    "location",
    "guests",
    "status",
    "total",
    "payment",
)

# 422 matrix — mirrors TestRecordsList422 on /records + pagination + q-length
INVALID_PARAMS = [
    {"sort_by": "bogus"},
    {"sort_order": "sideways"},
    {"status": "bogus"},
    {"date_from": "not-a-date"},
    {"date_from": "2026-08-09", "date_to": "2026-08-03"},
    {"page": 0},
    {"per_page": 0},
    {"per_page": 101},
    {"q": "a"},
    {"q": ""},
]


# ─── helpers ──────────────────────────────────────────────────────────────────


def _ids(resp) -> list[str]:
    """Extract item ids from a 200 list response (asserts the status)."""
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
    return [r["id"] for r in resp.json()["items"]]


def _item_for(api_client, url: str, record_id: str) -> dict:
    """Return the view item for ``record_id`` from a full first page."""
    resp = api_client.get(url, params={"per_page": 100, "sort_by": "date", "sort_order": "asc"})
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
    items = [r for r in resp.json()["items"] if r["id"] == record_id]
    assert items, f"record {record_id} not found in {url} items"
    return items[0]


def _activity_on(
    api_client,
    *,
    master_id: str,
    service_id: str,
    location_id: str,
    start: datetime,
    is_private: bool = False,
) -> dict:
    """Create an activity on EXPLICIT master/service/location (name control)."""
    resp = api_client.post(
        "/api/v1/activities",
        json={
            "master_id": master_id,
            "service_id": service_id,
            "location_id": location_id,
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": is_private,
        },
    )
    assert resp.status_code == 201, f"{resp.status_code}: {resp.text}"
    return resp.json()


def _seed_view_world(
    api_client,
    create_master,
    create_service,
    create_location,
    create_client,
    create_record,
) -> dict:
    """Varied fixture: distinct values in EVERY sort dimension (US-5/US-6).

    4 records over 4 masters/services/locations/dates + payments:
      r1 | Анна     | 08-04 10:00 | Аквагрим | Арбузов Иван | Арбат | waiting   | 1 guest  | total 1000 | paid 1000 (full)
      r2 | Борис    | 08-05 11:00 | Батик    | Яблонев Пётр | Берег | visited   | 2 guests | total 3000 | paid 1500 (partial)
      r3 | anonymous| 08-06 12:00 | Витраж   | Волков Юрий  | Волна | waiting   | 0 guests | no visits  | unpaid
      r4 | Вера     | 08-07 13:00 | Глина    | Гусев Павел  | Гать  | cancelled | 2 guests | total 2000 | unpaid (private)
    """
    masters = [
        create_master(first_name="Иван", last_name="Арбузов", color="#010203"),
        create_master(first_name="Пётр", last_name="Яблонев", color="#040506"),
        create_master(first_name="Юрий", last_name="Волков", color="#070809"),
        create_master(first_name="Павел", last_name="Гусев", color="#0A0B0C"),
    ]
    services = [
        create_service(title="Аквагрим"),
        create_service(title="Батик"),
        create_service(title="Витраж"),
        create_service(title="Глина"),
    ]
    locations = [
        create_location(name="Арбат"),
        create_location(name="Берег"),
        create_location(name="Волна"),
        create_location(name="Гать"),
    ]
    clients = [
        create_client(name="Анна"),
        create_client(name="Борис"),
        create_client(name="Вера"),
    ]
    starts = [
        datetime(2026, 8, 4, 10, 0),
        datetime(2026, 8, 5, 11, 0),
        datetime(2026, 8, 6, 12, 0),
        datetime(2026, 8, 7, 13, 0),
    ]
    activities = [
        _activity_on(
            api_client,
            master_id=masters[i]["id"],
            service_id=services[i]["id"],
            location_id=locations[i]["id"],
            start=starts[i],
            is_private=(i == 3),
        )
        for i in range(4)
    ]
    r1 = create_record(
        activity_id=activities[0]["id"],
        client_id=clients[0]["id"],
        visits=[{"name": "А1", "price": 1000, "status": "waiting"}],
    )
    r2 = create_record(
        activity_id=activities[1]["id"],
        client_id=clients[1]["id"],
        visits=[
            {"name": "Б1", "price": 1500, "status": "visited"},
            {"name": "Б2", "price": 1500, "status": "visited"},
        ],
    )
    r3 = create_record(
        activity_id=activities[2]["id"],
        client_id=None,
        visits=[],
        anonym_visits=3,
    )
    r4 = create_record(
        activity_id=activities[3]["id"],
        client_id=clients[2]["id"],
        visits=[
            {"name": "В1", "price": 1000, "status": "cancelled"},
            {"name": "В2", "price": 1000, "status": "cancelled"},
        ],
    )
    for rid, amount in ((r1["id"], 1000), (r2["id"], 1500)):
        resp = api_client.post(
            "/api/v1/payments",
            json={"record_id": rid, "amount": amount, "method": "card"},
        )
        assert resp.status_code == 201, f"{resp.status_code}: {resp.text}"
    return {
        "masters": masters,
        "services": services,
        "locations": locations,
        "clients": clients,
        "activities": activities,
        "records": [r1, r2, r3, r4],
    }


# ─── route order + envelope ───────────────────────────────────────────────────


class TestViewRouteAndEnvelope:
    """/view must be matched as the list route, never as /{record_id}."""

    def test_view_returns_200_page_not_id_path(
        self,
        api_client,
        create_record,
    ) -> None:
        """GET /api/v1/records/view → 200 paginated page (route order §4).

        If declared AFTER ``GET /{record_id}``, "view" is captured as the id
        path param → 404 RECORD_NOT_FOUND instead of a page.
        """
        create_record()

        resp = api_client.get(VIEW_URL)

        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        body = resp.json()
        assert set(body.keys()) == {"items", "total", "page", "per_page"}
        assert body["total"] == 1
        assert body["page"] == 1
        assert body["per_page"] == 20
        assert isinstance(body["items"], list) and len(body["items"]) == 1

    def test_view_pagination_pages_parity_with_records(
        self,
        api_client,
        create_record,
    ) -> None:
        """Envelope slicing matches /records on every page (same fixture)."""
        for _ in range(3):
            create_record()

        for page in (1, 2):
            view = api_client.get(VIEW_URL, params={"page": page, "per_page": 2})
            list_ = api_client.get(LIST_URL, params={"page": page, "per_page": 2})
            assert view.status_code == 200, f"{view.status_code}: {view.text}"
            assert list_.status_code == 200
            vbody, lbody = view.json(), list_.json()
            assert vbody["total"] == lbody["total"] == 3
            assert vbody["page"] == lbody["page"] == page
            assert vbody["per_page"] == lbody["per_page"] == 2
            assert len(vbody["items"]) == len(lbody["items"])
            assert _ids(view) == _ids(list_)

        p1 = _ids(api_client.get(VIEW_URL, params={"page": 1, "per_page": 2}))
        p2 = _ids(api_client.get(VIEW_URL, params={"page": 2, "per_page": 2}))
        assert len(p1) == 2 and len(p2) == 1
        assert not set(p1) & set(p2)


# ─── 422 parity matrix ────────────────────────────────────────────────────────


class TestView422Parity:
    """Same invalid params as /records → 422 VALIDATION_ERROR (shared params class)."""

    @pytest.mark.parametrize("params", INVALID_PARAMS)
    def test_invalid_params_return_422(self, api_client, params) -> None:
        resp = api_client.get(VIEW_URL, params=params)
        assert resp.status_code == 422, (
            f"params={params}: expected 422, got {resp.status_code}: {resp.text}"
        )
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


# ─── filters + q parity (US-5) ────────────────────────────────────────────────


class TestViewFilterAndSearchParity:
    """Identical filter/search results on /records/view and /records (US-5)."""

    def test_filter_parity_all_filters(
        self,
        api_client,
        create_master,
        create_service,
        create_location,
        create_client,
        create_record,
    ) -> None:
        w = _seed_view_world(
            api_client,
            create_master,
            create_service,
            create_location,
            create_client,
            create_record,
        )
        cases: list[tuple[str, dict]] = [
            ("location", {"location_id": w["locations"][0]["id"]}),
            ("service", {"service_id": w["services"][0]["id"]}),
            ("master", {"master_id": w["masters"][0]["id"]}),
            ("status", {"status": "visited"}),
            ("activity", {"activity_id": w["activities"][0]["id"]}),
            ("client", {"client_id": w["clients"][0]["id"]}),
            ("date_range", {"date_from": "2026-08-04", "date_to": "2026-08-05"}),
            ("date_from_only", {"date_from": "2026-08-06"}),
            ("date_to_only", {"date_to": "2026-08-05"}),
            (
                "combined_loc_status_date",
                {
                    "location_id": w["locations"][1]["id"],
                    "status": "visited",
                    "date_from": "2026-08-05",
                    "date_to": "2026-08-05",
                },
            ),
        ]
        for name, params in cases:
            view = api_client.get(VIEW_URL, params=params)
            list_ = api_client.get(LIST_URL, params=params)
            assert _ids(view) == _ids(list_), f"filter {name}: sequences diverge"
            assert view.json()["total"] == list_.json()["total"], f"filter {name}: totals diverge"

    def test_q_parity(
        self,
        api_client,
        create_master,
        create_service,
        create_location,
        create_client,
        create_record,
    ) -> None:
        w = _seed_view_world(
            api_client,
            create_master,
            create_service,
            create_location,
            create_client,
            create_record,
        )
        # "нн" → Анна (client name), "итраж" → Витраж (service title → r3),
        # full-uuid → exact record; combined q+location+status → r2 only.
        cases: list[tuple[str, dict, list[str]]] = [
            ("client_name", {"q": "нн"}, [w["records"][0]["id"]]),
            ("service_title", {"q": "итраж"}, [w["records"][2]["id"]]),
            ("full_uuid", {"q": w["records"][1]["id"]}, [w["records"][1]["id"]]),
            (
                "combined",
                {"q": "ори", "location_id": w["locations"][1]["id"], "status": "visited"},
                [w["records"][1]["id"]],
            ),
        ]
        for name, params, expected in cases:
            view = api_client.get(VIEW_URL, params=params)
            list_ = api_client.get(LIST_URL, params=params)
            assert _ids(view) == expected, f"q case {name}: view ids {_ids(view)}"
            assert _ids(view) == _ids(list_), f"q case {name}: sequences diverge"
            assert view.json()["total"] == list_.json()["total"]


# ─── sort parity (US-6) ───────────────────────────────────────────────────────


class TestViewSortParity:
    """Every sort_by x both orders: view id sequence == records id sequence (US-6)."""

    @pytest.mark.parametrize("sort_order", ["asc", "desc"])
    @pytest.mark.parametrize("sort_by", SORT_KEYS)
    def test_sort_sequence_parity(
        self,
        api_client,
        create_master,
        create_service,
        create_location,
        create_client,
        create_record,
        sort_by,
        sort_order,
    ) -> None:
        _seed_view_world(
            api_client,
            create_master,
            create_service,
            create_location,
            create_client,
            create_record,
        )
        params = {"sort_by": sort_by, "sort_order": sort_order, "per_page": 100}
        view_ids = _ids(api_client.get(VIEW_URL, params=params))
        list_ids = _ids(api_client.get(LIST_URL, params=params))
        assert view_ids == list_ids, (
            f"sort_by={sort_by} sort_order={sort_order}: view={view_ids} != records={list_ids}"
        )


# ─── display fields (US-3 API-level) ─────────────────────────────────────────


class TestViewDisplayFields:
    """Display fields present and correct in /records/view items."""

    def test_display_fields_present_and_correct(
        self,
        api_client,
        create_master,
        create_service,
        create_location,
        create_client,
        create_record,
    ) -> None:
        master = create_master(first_name="Иван", last_name="Арбузов", color="#AB12CD")
        service = create_service(title="Гончарная мастерская")
        location = create_location(name="Студия на Арбате")
        client = create_client(name="Анна")
        activity = _activity_on(
            api_client,
            master_id=master["id"],
            service_id=service["id"],
            location_id=location["id"],
            start=datetime(2026, 8, 5, 15, 30),
            is_private=True,
        )
        record = create_record(
            activity_id=activity["id"],
            client_id=client["id"],
            visits=[{"name": "А", "price": 3500, "status": "waiting"}],
        )
        pay = api_client.post(
            "/api/v1/payments",
            json={
                "record_id": record["id"],
                "amount": 2000,
                "method": "card",
            },
        )
        assert pay.status_code == 201, f"{pay.status_code}: {pay.text}"

        item = _item_for(api_client, VIEW_URL, record["id"])

        # All display fields present on every item
        for field in (
            "client_name",
            "activity_start",
            "service_title",
            "master_name",
            "location_name",
            "master_color",
            "is_private",
            "paid",
        ):
            assert field in item, f"display field {field} missing from view item"
        # Values
        assert item["client_name"] == "Анна"
        assert item["service_title"] == "Гончарная мастерская"
        assert item["location_name"] == "Студия на Арбате"
        assert item["master_name"] == "Арбузов Иван"  # «Фамилия Имя»
        assert item["master_color"] == "#AB12CD"
        assert item["is_private"] is True
        assert item["paid"] == 2000  # partial sum
        # activity_start byte-parity with the activities endpoint serialization
        act_resp = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert act_resp.status_code == 200
        assert item["activity_start"] == act_resp.json()["start"]
        # base RecordResponse fields still present
        assert item["id"] == record["id"]
        assert item["activity_id"] == activity["id"]
        assert item["client_id"] == client["id"]
        assert len(item["visits"]) == 1

    def test_paid_none_partial_full_sums(
        self,
        api_client,
        create_record,
    ) -> None:
        """paid = SUM(payments): no payments → 0, partial → sum."""
        none_r = create_record()
        partial_r = create_record()
        full_r = create_record()
        for rid, amount in (
            (partial_r["id"], 1500),
            (full_r["id"], 3500),
        ):
            resp = api_client.post(
                "/api/v1/payments",
                json={
                    "record_id": rid,
                    "amount": amount,
                    "method": "cash",
                },
            )
            assert resp.status_code == 201, f"{resp.status_code}: {resp.text}"

        by_id = {
            item["id"]: item
            for item in api_client.get(VIEW_URL, params={"per_page": 100}).json()["items"]
        }
        assert by_id[none_r["id"]]["paid"] == 0
        assert by_id[partial_r["id"]]["paid"] == 1500
        assert by_id[full_r["id"]]["paid"] == 3500

    def test_archived_entities_resolve_names_us3(
        self,
        api_client,
        create_record,
    ) -> None:
        """Archived client + master still resolve names/color on the view (US-3)."""
        record = create_record()  # factory spawns client + master chain
        client_resp = api_client.get(f"/api/v1/clients/{record['client_id']}")
        assert client_resp.status_code == 200
        client_name = client_resp.json()["name"]
        activity = api_client.get(f"/api/v1/activities/{record['activity_id']}").json()
        master = api_client.get(f"/api/v1/masters/{activity['master_id']}").json()

        arch_c = api_client.post(f"/api/v1/clients/{record['client_id']}/archive")
        arch_m = api_client.post(f"/api/v1/masters/{activity['master_id']}/archive")
        assert arch_c.status_code == 200, f"{arch_c.status_code}: {arch_c.text}"
        assert arch_m.status_code == 200, f"{arch_m.status_code}: {arch_m.text}"

        item = _item_for(api_client, VIEW_URL, record["id"])
        assert item["client_name"] == client_name  # real name, not '—'
        assert item["master_name"] == f"{master['last_name']} {master['first_name']}"
        assert item["master_color"] == master["color"]

    def test_anonymous_record_null_display_fields(
        self,
        api_client,
        create_activity,
        create_record,
    ) -> None:
        """Anonymous record (client_id None) → client_name None."""
        activity = create_activity()
        record = create_record(
            activity_id=activity["id"],
            client_id=None,
            visits=[],
            anonym_visits=2,
        )

        item = _item_for(api_client, VIEW_URL, record["id"])

        assert item["client_name"] is None
        assert item["client_id"] is None
        assert item["activity_start"] is not None  # INNER-joined activity

    def test_dangling_master_nulls(
        self,
        api_client,
        create_activity,
        create_record,
    ) -> None:
        """FK-dangling master (deleted row) → master_name/master_color None.

        Seeded via raw SQL on a separate connection (SQLite FK enforcement
        is per-connection) — reads on the API connection just resolve no
        match → NULL → the UI gray-dot '#999' path.
        """
        activity = create_activity()
        record = create_record(activity_id=activity["id"])
        query_db(
            f"UPDATE activities SET master_id = '00000000-0000-0000-0000-000000000000' "
            f"WHERE id = '{activity['id']}'"
        )

        item = _item_for(api_client, VIEW_URL, record["id"])

        assert item["master_name"] is None
        assert item["master_color"] is None
