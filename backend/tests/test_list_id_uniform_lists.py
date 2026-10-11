"""GH #371 Task 2 — the list matrix: ``?id=`` narrowing on model-as-query lists.

Spec ``docs/specs/2026-10-10-list-id-uniform-371-design.md`` §4.1: every
paginated list gets its ``XListParams(SortParams[...], PaginationParams)``
injected as ``Annotated[XListParams, Query()]`` — scalar query siblings
are banned (fastapi PR #12481), and the ``id`` field inherited from
``PaginationParams`` (#232) makes ``?id=X&id=Y`` narrowing work uniformly.

THE MATRIX IS DESIGNED FOR ALL SEVEN service-ready endpoints (§4.1): the
three dictionary sort lists here (services, materials, tags) — the first
conversions of the eleven (§4.6 checkpoint) — plus visitors, activities,
payments, positions, which Task 3 appends to the SAME ``ENDPOINTS`` list
(no test-body changes needed: everything is parametrized by descriptors
carrying the route URL + the conftest factory name).

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


# Task 3 appends visitors / activities / payments / positions here —
# the same classes below then cover them with zero test-body edits.
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
