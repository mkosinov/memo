"""Query-param validation for paginated list endpoints (#182)."""

from uuid import UUID

import pytest

pytestmark = pytest.mark.api

ENDPOINTS = [
    "/api/v1/services",
    "/api/v1/visits",
    "/api/v1/records",
]

# #232 Task 1: endpoints that ENFORCE the shared ``id`` filter contract.
# Both use the Annotated[Params, Query()] injection shape — under the
# Depends-with-model shape FastAPI 0.141 classifies list-typed model
# fields as body params and silently drops them (see clients.py
# list_clients comment). clients = the #232 target (ClientListParams),
# records = sibling schema (RecordListParams) proving inheritance.
ID_FILTER_ENDPOINTS = [
    "/api/v1/clients",
    "/api/v1/records",
]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("params", [
    {"per_page": 101},
    {"per_page": 0},
    {"page": 0},
])
def test_invalid_pagination_params_return_422(api_client, endpoint, params):
    resp = api_client.get(endpoint, params=params)
    assert resp.status_code == 422


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_default_pagination_envelope(api_client, endpoint):
    resp = api_client.get(endpoint)
    assert resp.status_code == 200
    body = resp.json()
    assert body["page"] == 1
    assert body["per_page"] == 20
    assert isinstance(body["items"], list)
    assert isinstance(body["total"], int)


# --- GH #232 Task 1: ?id= list filter contract (spec §3.1) ---


@pytest.mark.parametrize("endpoint", ID_FILTER_ENDPOINTS)
def test_id_filter_invalid_uuid_returns_422(api_client, endpoint):
    resp = api_client.get(endpoint, params=[("id", "garbage")])
    assert resp.status_code == 422


@pytest.mark.parametrize("endpoint", ID_FILTER_ENDPOINTS)
def test_id_filter_over_100_values_returns_422(api_client, endpoint):
    ids = [str(UUID(int=i)) for i in range(101)]
    resp = api_client.get(endpoint, params=[("id", v) for v in ids])
    assert resp.status_code == 422


@pytest.mark.parametrize("endpoint", ID_FILTER_ENDPOINTS)
def test_id_filter_valid_repeated_keys_ok(api_client, endpoint):
    # ?id=X&id=Y repeated query keys must parse into the list (FastAPI
    # default behavior for list[UUID] query params) without blowing up.
    resp = api_client.get(
        endpoint, params=[("id", str(UUID(int=1))), ("id", str(UUID(int=2)))]
    )
    assert resp.status_code == 200
