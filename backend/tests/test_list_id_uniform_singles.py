"""GH #371 Task 1 — eight single-scalar GET routes become one model-as-query.

Spec ``docs/specs/2026-10-10-list-id-uniform-371-design.md`` §4.2: the five
dictionary ``/all`` routes (services, materials, locations, staff, masters)
share ``ArchiveStatusParams``; the public photo gallery ``GET /photos/web``
gets ``PhotoWebListParams``; payment totals get ``PaymentTotalsParams``; the
client phone lookup gets ``ClientPhoneLookupParams``. Every handler injects
the model as ``Annotated[<Model>, Query()]`` — scalar query siblings are
banned (fastapi PR #12481).

The wire must NOT change (scenario С8): same keys, same defaults, same 422
codes. This file pins the singles part of С8:

* garbage ``status`` → 422 on every dictionary ``/all``;
* the ``ACTIVE`` default on ``/all`` (spec §4.2 default table);
* non-UUID ``activity_id`` → 422 on ``/photos/web`` (spec §4.2 types the
  field as UUID — newly enforced by the params model) and the valid-UUID
  contract around it (unknown UUID → 200 empty, same as before).

The short-phone (``/clients/get``) and record_ids-cap (``/payments/totals``)
422 pins already live in ``test_api_clients.py`` / ``test_api_payments.py``
and must stay green without expectation edits (regression, not duplicated
here). The masters ``/all`` default + garbage pins live in
``test_api_staff.py``.
"""

from uuid import uuid4

import pytest

_DICTIONARY_ALL_ROUTES = [
    "/api/v1/services/all",
    "/api/v1/materials/all",
    "/api/v1/locations/all",
    "/api/v1/staff/all",
    "/api/v1/masters/all",
]


class TestArchiveStatusParamsContract:
    """5 × dictionary ``/all`` — one shared ``ArchiveStatusParams`` (§4.2)."""

    @pytest.mark.parametrize("route", _DICTIONARY_ALL_ROUTES)
    def test_all_garbage_status_returns_422(self, api_client, route: str) -> None:
        """``?status=<garbage>`` → 422 on every dictionary /all (С8 pin)."""
        resp = api_client.get(route, params={"status": "garbage"})
        assert resp.status_code == 422, resp.text

    def test_services_all_default_status_is_active(self, api_client, create_service) -> None:
        """No ``status`` → ACTIVE default: archived rows hidden (§4.2)."""
        active = create_service()
        archived = create_service()
        archive_resp = api_client.post(f"/api/v1/services/{archived['id']}/archive")
        assert archive_resp.status_code == 200, archive_resp.text

        body = api_client.get("/api/v1/services/all").json()

        assert [s["id"] for s in body] == [active["id"]]

    def test_locations_all_default_status_is_active(self, api_client, create_location) -> None:
        """No ``status`` → ACTIVE default: archived rows hidden (§4.2)."""
        active = create_location()
        archived = create_location()
        archive_resp = api_client.post(f"/api/v1/locations/{archived['id']}/archive")
        assert archive_resp.status_code == 200, archive_resp.text

        body = api_client.get("/api/v1/locations/all").json()

        assert [loc["id"] for loc in body] == [active["id"]]


class TestPhotoWebListParamsContract:
    """Public gallery ``GET /photos/web`` — ``PhotoWebListParams`` (§4.2)."""

    def test_web_non_uuid_activity_id_returns_422(self, api_client) -> None:
        """``?activity_id=<garbage>`` → 422: the field is UUID-typed (§4.2)."""
        resp = api_client.get("/api/v1/photos/web", params={"activity_id": "not-a-uuid"})
        assert resp.status_code == 422, resp.text

    def test_web_unknown_uuid_activity_id_returns_empty_list(self, api_client) -> None:
        """Valid but unknown UUID → 200 + [] (wire unchanged for UUIDs)."""
        resp = api_client.get("/api/v1/photos/web", params={"activity_id": str(uuid4())})
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
