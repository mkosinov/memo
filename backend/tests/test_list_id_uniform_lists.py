"""GH #371 Tasks 2+3 — the list matrix: ``?id=`` narrowing on model-as-query lists.

Spec ``docs/specs/2026-10-10-list-id-uniform-371-design.md`` §4.1: every
paginated list gets its ``XListParams(SortParams[...], PaginationParams)``
injected as ``Annotated[XListParams, Query()]`` — scalar query siblings
are banned (fastapi PR #12481), and the ``id`` field inherited from
``PaginationParams`` (#232) makes ``?id=X&id=Y`` narrowing work uniformly.

THE MATRIX COVERS ALL TEN converted endpoints (§4.1): the three
dictionary sort lists (services, materials, tags — Task 2), the four
simple lists (visitors, activities, payments, positions — Task 3),
locations (Task 4 — the hybrid: ``?id=`` narrowing ALREADY worked there
via the ``#232`` sibling param, so the matrix is a pure REGRESSION pin
that the model conversion keeps the wire intact), staff (Task 5 —
its own sort whitelist/status/q; the plain branch here, the masters-
join branch in TestStaffBothBranchesIdNarrowing) and visits (Task 6 —
the §4.3 gap-2 custom list; the ``record_id``+``id`` conjunction is
arbitrated by TestVisitRecordIdPlusIdNarrowing) — all in the SAME
``ENDPOINTS`` list (no test-body changes needed: everything is
parametrized by descriptors carrying the route URL + the conftest
factory name).

Scenarios (spec §2/§6):

* С1 — narrowing: rows AND total; ``?id=X&id=X`` dedup; valid-but-unknown
  UUID → 200 + empty; ``?id=X&page=<beyond>`` → 200 + empty page.
* С2 — narrowing is an INTERSECTION with the other filters, never a
  replacement (services: archived id under the default ``status=ACTIVE``
  → empty; active id under explicit ``status=archived`` → empty).
* С3 — 422 matrix: non-UUID garbage / empty value / comma-glued pair
  ``X,Y`` / 101 distinct ids.
* §4.6 checkpoint — the GENERATED OpenAPI schema (``app.openapi()``,
  fields of the query model already expanded) declares ``id`` plus every
  former param (page, per_page, q, ...) on each converted route.
"""

from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest

pytestmark = pytest.mark.api


@dataclass(frozen=True)
class ListEndpoint:
    """Descriptor of one paginated list endpoint in the matrix.

    ``factory`` is the NAME of a conftest fixture factory creating one
    entity via the API (resolved with ``request.getfixturevalue`` — the
    descriptor stays a plain parametrize value). ``query_params`` is the
    full expected wire set of the route's GET query params (OpenAPI pin,
    §4.6): the shared bricks' fields plus the endpoint's own filters.
    """

    route: str
    factory: str
    query_params: tuple[str, ...]


# GH #371 Task 3 — the four simple lists join the SAME matrix: visitors,
# activities, payments, positions (no sort brick; scope, where present,
# stays a Depends sibling — see TestScopeSmokeIdNarrowing below).
ENDPOINTS = [
    ListEndpoint(
        route="/api/v1/services",
        factory="create_service",
        query_params=(
            "id", "page", "per_page", "sort_by", "sort_order",
            "status", "q", "material_id",
        ),
    ),
    ListEndpoint(
        route="/api/v1/materials",
        factory="create_material",
        query_params=(
            "id", "page", "per_page", "sort_by", "sort_order",
            "status", "q",
        ),
    ),
    ListEndpoint(
        route="/api/v1/tags",
        factory="create_tag",
        query_params=("id", "page", "per_page", "sort_by", "sort_order", "q"),
    ),
    ListEndpoint(
        route="/api/v1/visitors",
        factory="create_visitor",
        query_params=("id", "page", "per_page", "q"),
    ),
    ListEndpoint(
        route="/api/v1/activities",
        factory="create_activity",
        query_params=(
            "id", "page", "per_page", "date_from", "date_to", "q", "service_id",
        ),
    ),
    ListEndpoint(
        route="/api/v1/payments",
        factory="create_payment",
        query_params=("id", "page", "per_page", "record_id"),
    ),
    ListEndpoint(
        route="/api/v1/positions",
        factory="create_position",
        query_params=("id", "page", "per_page"),
    ),
    # GH #371 Task 4 — locations, the last sort-carrying hybrid: the row
    # pins the REGRESSION (С4): narrowing/422/OpenAPI behaved correctly
    # BEFORE the conversion (the #232 sibling contract) and must stay
    # green AFTER it (``id`` inherited from ``PaginationParams``).
    ListEndpoint(
        route="/api/v1/locations",
        factory="create_location",
        query_params=(
            "id", "page", "per_page", "sort_by", "sort_order",
            "status", "q",
        ),
    ),
    # GH #371 Task 5 — staff: its own sort whitelist (name/specialty/
    # color/avatar/status), ``status`` and ``q`` (2..100). The row pins
    # the PLAIN branch (no ``sort_by`` → ``StaffService.list``); the
    # join branch (``sort_by=specialty|color`` → ``list_join_masters``,
    # the §4.3 gap-1) is arbitrated by TestStaffBothBranchesIdNarrowing
    # below — the matrix descriptor stays branch-agnostic on purpose.
    ListEndpoint(
        route="/api/v1/staff",
        factory="create_staff",
        query_params=(
            "id", "page", "per_page", "sort_by", "sort_order",
            "status", "q",
        ),
    ),
    # GH #371 Task 6 — visits: the §4.3 gap-2 list (custom hand-rolled
    # ``VisitService.list`` outside GenericService — the ``ids``
    # predicate lives IN the service, right after the ``record_id``
    # filter and before the count subquery). The matrix row pins the
    # generic contract (С1/С3/OpenAPI); the ``record_id``+``id``
    # CONJUNCTION (С6) is arbitrated by TestVisitRecordIdPlusIdNarrowing
    # below.
    ListEndpoint(
        route="/api/v1/visits",
        factory="create_visit",
        query_params=("id", "page", "per_page", "record_id"),
    ),
]

_EP_IDS = lambda ep: ep.route.rsplit("/", 1)[-1]  # noqa: E731


class TestNarrowingMatrix:
    """С1 — ``?id=`` narrows rows and total on every ready endpoint."""

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_id_pair_narrows_rows_and_total(self, api_client, request, ep) -> None:
        """``?id=X&id=Y`` → only X and Y, and ``total`` == 2 (not the full list)."""
        factory = request.getfixturevalue(ep.factory)
        created = [factory() for _ in range(3)]
        wanted = [created[0]["id"], created[2]["id"]]

        resp = api_client.get(ep.route, params=[("id", i) for i in wanted])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(item["id"] for item in body["items"]) == sorted(wanted)
        assert body["total"] == 2

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_repeated_id_dedups_to_one_row(self, api_client, request, ep) -> None:
        """``?id=X&id=X`` → one row, ``total`` == 1 (dedup before the cap)."""
        factory = request.getfixturevalue(ep.factory)
        entity = factory()

        resp = api_client.get(
            ep.route, params=[("id", entity["id"]), ("id", entity["id"])]
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [item["id"] for item in body["items"]] == [entity["id"]]
        assert body["total"] == 1

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_unknown_valid_uuid_returns_empty_page(self, api_client, ep) -> None:
        """Valid but nonexistent UUID → 200 + empty (narrowing, not 404)."""
        resp = api_client.get(ep.route, params=[("id", str(uuid4()))])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_page_beyond_narrowed_range_is_empty(self, api_client, request, ep) -> None:
        """``?id=X&page=2`` (one narrowed row) → 200 + empty page, total kept."""
        factory = request.getfixturevalue(ep.factory)
        entity = factory()

        resp = api_client.get(
            ep.route, params=[("id", entity["id"]), ("page", "2")]
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 1


class TestFilterIntersectionServices:
    """С2 — narrowing intersects the other filters, never replaces them.

    Pinned on services (the entity whose default ``status=ACTIVE`` the
    spec §9 names as the thin-default-drift risk); the conjunctive
    predicate itself is shared by all lists (``ids_in_predicate``).
    """

    def test_archived_id_hidden_under_default_active(
        self, api_client, create_service
    ) -> None:
        """``?id=<archived>`` + default status → empty, not the archived row."""
        active = create_service()
        archived = create_service()
        archive_resp = api_client.post(f"/api/v1/services/{archived['id']}/archive")
        assert archive_resp.status_code == 200, archive_resp.text

        resp = api_client.get("/api/v1/services", params=[("id", archived["id"])])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
        # The active sibling is NOT the answer either: the id set and the
        # default ACTIVE status both narrow — intersection, not either/or.
        assert active["id"] not in {item["id"] for item in body["items"]}

    def test_active_id_hidden_under_explicit_archived(
        self, api_client, create_service
    ) -> None:
        """``?status=archived&id=<active>`` → empty (id must not bypass status)."""
        active = create_service()

        resp = api_client.get(
            "/api/v1/services",
            params=[("id", active["id"]), ("status", "archived")],
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0


class TestInvalidIdMatrix:
    """С3 — garbage ``?id=`` → 422 VALIDATION_ERROR, never a silent full list."""

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_non_uuid_value_returns_422(self, api_client, ep) -> None:
        resp = api_client.get(ep.route, params=[("id", "not-a-uuid")])
        assert resp.status_code == 422, resp.text

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_empty_value_returns_422(self, api_client, ep) -> None:
        resp = api_client.get(ep.route, params=[("id", "")])
        assert resp.status_code == 422, resp.text

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_comma_glued_pair_returns_422(self, api_client, ep) -> None:
        """``?id=X,Y`` (one glued string) is not a UUID → 422 (no implicit split)."""
        glued = f"{uuid4()},{uuid4()}"
        resp = api_client.get(ep.route, params=[("id", glued)])
        assert resp.status_code == 422, resp.text

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_101_distinct_ids_return_422(self, api_client, ep) -> None:
        """101 distinct ids after dedup → 422 too_long (MAX_LIST_IDS)."""
        ids = [str(UUID(int=i)) for i in range(101)]
        resp = api_client.get(ep.route, params=[("id", v) for v in ids])
        assert resp.status_code == 422, resp.text


class TestOpenApiQueryContract:
    """§4.6 checkpoint — the generated schema publishes ``id`` + former params.

    ``app.openapi()`` returns the schema with the query model's fields
    already expanded into individual parameters — the pin that the
    conversion keeps the wire (С8) and adds the ``id`` contract.
    """

    @pytest.mark.parametrize("ep", ENDPOINTS, ids=_EP_IDS)
    def test_route_declares_expected_query_params(self, app, ep) -> None:
        schema = app.openapi()
        get_op = schema["paths"][ep.route]["get"]
        names = {p["name"] for p in get_op["parameters"] if p["in"] == "query"}
        missing = set(ep.query_params) - names
        assert not missing, f"{ep.route}: query params missing from OpenAPI: {missing}"


class TestScopeSmokeIdNarrowing:
    """§4.6 checkpoint — ``?id=`` narrowing COMBINED with the master scope.

    Task 3 converts the first scope-carrying lists (visitors/activities;
    payments rides along — same ``Depends(get_scope)`` shape): the smoke
    pins that the id set narrows INSIDE the scope and never expands
    visibility — a foreign id in the set is silently absent (narrowing
    semantics #232), an all-foreign set → 200 + empty.

    Scope travels exactly like the existing scope suites: the master's
    session cookie (``make_master()`` + ``master["client"]``), i.e. the
    ``Depends(get_scope)`` sibling — NOT a query field (spec §4.1).

    RED design: each world seeds TWO own rows + one foreign row; the
    narrowing request asks for own#1 + foreign. If ``id`` were ignored
    (pre-conversion), the master would see BOTH own rows → the
    ``total == 1`` / single-row assertions fail.
    """

    @pytest.fixture
    def scoped_world(self, api_client, make_master, create_master,
                      create_activity, create_client):
        """Two own + one foreign entity for visitors/activities/payments.

        ``own`` rows sit on the scoped master's activities (visitors via
        record visits, payments via record), ``foreign`` on a second
        real master's activity — invisible in the first master's scope.
        """
        master = make_master()
        foreign_master = create_master()
        own_act = create_activity(master_id=master["staff_id"])
        second_own_act = create_activity(master_id=master["staff_id"])
        foreign_act = create_activity(master_id=foreign_master["id"])

        own_rec = api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"],
            "client_id": create_client()["id"],
            "visits": [
                {"name": "Свой первый", "price": 100, "status": "waiting"},
                {"name": "Свой второй", "price": 100, "status": "waiting"},
            ],
        }).json()
        foreign_rec = api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": create_client()["id"],
            "visits": [{"name": "Чужой", "price": 100, "status": "waiting"}],
        }).json()

        def _payment(record_id: str, amount: int) -> dict:
            resp = api_client.post("/api/v1/payments", json={
                "record_id": record_id, "amount": amount, "method": "card",
            })
            assert resp.status_code == 201, resp.text
            return resp.json()

        return {
            "master": master,
            "activities": {
                "own": [own_act, second_own_act],
                "foreign": foreign_act,
            },
            "visitors": {
                "own": [v["visitor_id"] for v in own_rec["visits"]],
                "foreign": foreign_rec["visits"][0]["visitor_id"],
            },
            "payments": {
                "own": [_payment(own_rec["id"], 500), _payment(own_rec["id"], 600)],
                "foreign": _payment(foreign_rec["id"], 700),
            },
        }

    # ── visitors (scope: visits → records → activities) ────────────────

    def test_visitors_id_narrows_inside_scope(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]
        own_ids = scoped_world["visitors"]["own"]

        resp = mc.get("/api/v1/visitors", params=[
            ("id", own_ids[0]), ("id", scoped_world["visitors"]["foreign"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [item["id"] for item in body["items"]] == [own_ids[0]]
        assert body["total"] == 1

    def test_visitors_foreign_id_alone_stays_empty(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]

        resp = mc.get("/api/v1/visitors", params=[
            ("id", scoped_world["visitors"]["foreign"]),
        ])

        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    # ── activities (scope: master_id equality, optional) ───────────────

    def test_activities_id_narrows_inside_scope(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]
        own_acts = scoped_world["activities"]["own"]

        resp = mc.get("/api/v1/activities", params=[
            ("id", own_acts[0]["id"]),
            ("id", scoped_world["activities"]["foreign"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [item["id"] for item in body["items"]] == [own_acts[0]["id"]]
        assert body["total"] == 1

    def test_activities_foreign_id_alone_stays_empty(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]

        resp = mc.get("/api/v1/activities", params=[
            ("id", scoped_world["activities"]["foreign"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_payments_id_narrows_inside_scope(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]
        own_pays = scoped_world["payments"]["own"]

        resp = mc.get("/api/v1/payments", params=[
            ("id", own_pays[0]["id"]), ("id", scoped_world["payments"]["foreign"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [item["id"] for item in body["items"]] == [own_pays[0]["id"]]
        assert body["total"] == 1

    def test_payments_foreign_id_alone_stays_empty(self, scoped_world) -> None:
        mc = scoped_world["master"]["client"]

        resp = mc.get("/api/v1/payments", params=[
            ("id", scoped_world["payments"]["foreign"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0


class TestStaffBothBranchesIdNarrowing:
    """С5 — BOTH staff list branches narrow rows AND total under ``?id=``.

    The staff route branches on the sort value (``params.sort_by`` after
    the #371 conversion): plain sorts (None/name/avatar/status) →
    ``StaffService.list`` (the repository core applies
    ``ids_in_predicate``); extension sorts (specialty/color) →
    ``StaffService.list_join_masters`` — the spec §4.3 GAP-1 branch:
    ``ids`` must reach the join query with the predicate in the BASE
    staff selection, BEFORE the masters LEFT JOIN can multiply rows and
    BEFORE the count subquery, so items and total narrow consensually —
    a narrowed-out SECTIONED card disappears ENTIRELY (its section must
    not leak rows into the page nor inflate ``total``).

    RED design: pre-conversion the join branch has NO ``ids`` plumbing
    at all (full list under ``?id=``) and the plain branch's route never
    forwards ``ids`` — both fail on rows+total; the fan-out arbiter
    (sculptor, the sectioned victim) catches a predicate placed after
    the join or applied to rows only (``total`` would stay 3).
    """

    @pytest.fixture
    def staff_world(self, create_staff) -> dict:
        """Three cards: two WITH master sections (join fan-out), one bare.

        ``sculptor`` is the narrowing VICTIM — every request below asks
        for painter+bare, so the sectioned sculptor must vanish from
        rows AND ``total`` on BOTH branches.
        """
        painter = create_staff(
            first_name="А", master={"specialty": "живопись", "color": "#111111"}
        )
        sculptor = create_staff(
            first_name="Б", master={"specialty": "скульптура", "color": "#222222"}
        )
        bare = create_staff(first_name="В")
        return {"painter": painter, "sculptor": sculptor, "bare": bare}

    def test_plain_branch_narrows_rows_and_total(
        self, api_client, staff_world
    ) -> None:
        """Default order (``list`` branch): ?id=painter&id=bare → exactly those."""
        w = staff_world
        resp = api_client.get("/api/v1/staff", params=[
            ("id", w["painter"]["id"]), ("id", w["bare"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(i["id"] for i in body["items"]) == sorted(
            [w["painter"]["id"], w["bare"]["id"]]
        )
        assert body["total"] == 2

    @pytest.mark.parametrize("join_sort", ["specialty", "color"])
    def test_join_branch_narrows_rows_and_total(
        self, api_client, staff_world, join_sort
    ) -> None:
        """Extension sort (``list_join_masters``): rows AND total narrow;
        the sectioned victim disappears entirely, sections still assemble."""
        w = staff_world
        resp = api_client.get("/api/v1/staff", params=[
            ("sort_by", join_sort),
            ("id", w["painter"]["id"]), ("id", w["bare"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = [i["id"] for i in body["items"]]
        # Rows: exactly the asked pair — the sectioned sculptor is gone…
        assert sorted(ids) == sorted([w["painter"]["id"], w["bare"]["id"]])
        assert w["sculptor"]["id"] not in ids
        # …and total narrows WITH the rows (count subquery sees the
        # predicate: 2, not 3 — the fan-out divergence arbiter, §4.3).
        assert body["total"] == 2
        # Composite assembly on narrowed rows: the kept section is filled.
        sections = {i["id"]: i["master"] for i in body["items"]}
        assert sections[w["painter"]["id"]] is not None
        assert sections[w["painter"]["id"]]["specialty"] == "живопись"
        assert sections[w["bare"]["id"]] is None

    def test_join_branch_single_id_total_is_one(
        self, api_client, staff_world
    ) -> None:
        """?id=<sectioned> alone on the join branch: total == 1 — the
        narrowest form of the arbiter (one card, one section, one row)."""
        w = staff_world
        resp = api_client.get("/api/v1/staff", params=[
            ("sort_by", "specialty"), ("id", w["sculptor"]["id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [i["id"] for i in body["items"]] == [w["sculptor"]["id"]]
        assert body["total"] == 1


class TestVisitRecordIdPlusIdNarrowing:
    """С6 — visits narrow ``?id=`` ON TOP of the existing ``record_id`` filter.

    ``GET /api/v1/visits`` is the spec §4.3 GAP-2 list: a hand-rolled
    ``VisitService.list`` OUTSIDE ``GenericService`` — the ``ids`` set
    must reach the service and its ``ids_in_predicate`` must land in the
    SAME WHERE as ``record_id``, BEFORE the count subquery, so rows and
    ``total`` narrow consensually.

    RED design: pre-conversion the route injects pagination via the
    Depends shape (which silently drops the list-typed ``id`` field —
    schemas/pagination.py caveat) and the service has no ``ids``
    plumbing at all: ``?record_id=R&id=X`` returns ALL of R's visits —
    the rows/total assertions fail. The foreign-visit case catches an
    OR-style (visibility-expanding) predicate: a valid visit id from
    ANOTHER record must stay absent under ``record_id=R``.
    """

    @pytest.fixture
    def visit_world(self, api_client, create_record) -> dict:
        """One record R with three visits + one visit on a foreign record.

        ``first``/``third`` are the narrowing targets; ``second`` is the
        VICTIM (asked-for-never); ``foreign`` sits outside ``record_id=R``
        — the conjunctivity probe.
        """
        record = create_record(visits=[
            {"name": "Первый", "price": 100, "status": "waiting"},
            {"name": "Второй", "price": 100, "status": "waiting"},
            {"name": "Третий", "price": 100, "status": "waiting"},
        ])
        foreign_record = create_record()  # default single guest visit
        return {
            "record_id": record["id"],
            "visits": [v["id"] for v in record["visits"]],
            "foreign_visit_id": foreign_record["visits"][0]["id"],
        }

    def test_record_id_with_id_pair_narrows_rows_and_total(
        self, api_client, visit_world
    ) -> None:
        """``?record_id=R&id=<first>&id=<third>`` → exactly first+third, total 2."""
        w = visit_world
        resp = api_client.get("/api/v1/visits", params=[
            ("record_id", w["record_id"]),
            ("id", w["visits"][0]), ("id", w["visits"][2]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(i["id"] for i in body["items"]) == sorted(
            [w["visits"][0], w["visits"][2]]
        )
        # total narrows WITH the rows (the count subquery sees the
        # predicate: 2, not 3 — placement arbiter, §4.3 gap 2).
        assert body["total"] == 2

    def test_record_id_with_foreign_visit_id_stays_empty(
        self, api_client, visit_world
    ) -> None:
        """A valid visit id from ANOTHER record under ``record_id=R`` →
        200 + empty (intersection, never replacement/expansion)."""
        w = visit_world
        resp = api_client.get("/api/v1/visits", params=[
            ("record_id", w["record_id"]),
            ("id", w["foreign_visit_id"]),
        ])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
