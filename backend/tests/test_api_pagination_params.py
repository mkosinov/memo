"""Query-param validation for paginated list endpoints (#182)."""

import pytest

pytestmark = pytest.mark.api

ENDPOINTS = [
    "/api/v1/masters",
    "/api/v1/locations",
    "/api/v1/tags",
    "/api/v1/materials",
    "/api/v1/services",
    "/api/v1/activities",
    "/api/v1/payments",
    "/api/v1/visits",
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
