"""HTTP-level CRUD contract for all GenericService-backed routers (GH #185).

Pins the TRANSPORT surface per entity: status codes (201/200/204/404/422),
exact response/envelope key sets, <ENTITY>_NOT_FOUND codes, pagination query
binding (ge=1 / le=100 / defaults echo), soft/hard delete visibility
(list hides, get returns). Business semantics (soft-delete rules, is_active
stickiness, pagination slicing) are pinned at service level —
tests/services/test_generic_service_contract.py. Do NOT re-assert them here.

Decision record: docs/decisions/006-http-contract-tests-end-to-end.md
(end-to-end TestClient + test SQLite, not mocked service).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from tests.generic_contract import EntityConfig, _contract_params, _hard_params, _soft_params


# ─── helpers ────────────────────────────────────────────────────────────────


def _resolve_fk_ids(request: pytest.FixtureRequest, cfg: EntityConfig) -> dict[str, Any]:
    """Resolve fk_map fixture names to created parent ids.

    conftest factories (create_master etc.) return a factory-callable; calling
    it POSTs the parent via the API and returns the response dict with "id".
    Mirrors make_entity in tests/services/test_generic_service_contract.py.
    """
    fk_ids: dict[str, Any] = {}
    for field, fixture_name in cfg.fk_map.items():
        factory = request.getfixturevalue(fixture_name)
        fk_ids[field] = factory()["id"]
    return fk_ids


def _jsonable(payload: dict[str, Any]) -> dict[str, Any]:
    """Make a payload JSON-serializable (datetime → ISO 8601 string, spec D11)."""
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in payload.items()}


def _create_payload(cfg: EntityConfig, fk_ids: dict[str, Any]) -> dict[str, Any]:
    return _jsonable({**cfg.create_data, **fk_ids})


def _update_payload(cfg: EntityConfig, fk_ids: dict[str, Any]) -> dict[str, Any]:
    """PUT body: create_data + FKs + update_data, filtered to update_schema fields (#184 D3)."""
    merged = {**cfg.create_data, **fk_ids, **cfg.update_data}
    payload = _jsonable({k: v for k, v in merged.items() if k in cfg.update_schema.model_fields})
    # GH #178: is_active is a required PUT field for soft entities (Client
    # included — omitting it now 500s until #201).
    if "is_active" in cfg.update_schema.model_fields:
        payload.setdefault("is_active", True)
    return payload


def _create_entity(api_client, cfg: EntityConfig, fk_ids: dict[str, Any]) -> dict[str, Any]:
    resp = api_client.post(cfg.router_prefix, json=_create_payload(cfg, fk_ids))
    assert resp.status_code == 201, f"POST {cfg.router_prefix} → {resp.status_code}: {resp.text}"
    return resp.json()


def _assert_exact_response_keys(body: dict[str, Any], cfg: EntityConfig) -> None:
    expected = set(cfg.response_schema.model_fields.keys())
    actual = set(body.keys())
    assert actual == expected, (
        f"response keys must equal {cfg.response_schema.__name__} fields exactly; "
        f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
    )


def _assert_sent_fields_echoed(body: dict[str, Any], cfg: EntityConfig, sent: dict[str, Any]) -> None:
    """Typed comparison through the validated response model (datetimes round-trip, spec D11)."""
    parsed = cfg.response_schema.model_validate(body)
    for key, value in sent.items():
        if key in cfg.response_schema.model_fields:
            assert getattr(parsed, key) == value, f"field {key!r} must echo the sent value"


def _assert_not_found(resp, cfg: EntityConfig) -> None:
    assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.text}"
    assert resp.json()["detail"]["code"] == cfg.not_found_code


# ─── contract classes ───────────────────────────────────────────────────────


class TestGenericApiCreateContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_create_returns_201_with_fields_matching_payload(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        resp = api_client.post(cfg.router_prefix, json=_create_payload(cfg, fk_ids))
        assert resp.status_code == 201, f"POST must return 201, got {resp.status_code}: {resp.text}"
        body = resp.json()
        _assert_exact_response_keys(body, cfg)
        _assert_sent_fields_echoed(body, cfg, {**cfg.create_data, **fk_ids})


class TestGenericApiGetContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_get_returns_created_entity(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        resp = api_client.get(f"{cfg.router_prefix}/{created['id']}")
        assert resp.status_code == 200, f"GET by id must return 200, got {resp.status_code}"
        body = resp.json()
        _assert_exact_response_keys(body, cfg)
        _assert_sent_fields_echoed(body, cfg, {**cfg.create_data, **fk_ids})

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_get_nonexistent_returns_404_with_entity_code(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        _assert_not_found(api_client.get(f"{cfg.router_prefix}/nonexistent-id"), cfg)


class TestGenericApiListContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_list_envelope_exact_keys_and_defaults(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        resp = api_client.get(cfg.router_prefix)
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"items", "total", "page", "per_page"}, (
            "list envelope must have exactly these keys"
        )
        assert body["page"] == 1, "default page must be 1 (default-drift lock)"
        assert body["per_page"] == 20, "default per_page must be 20 (default-drift lock)"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_list_contains_created_and_counts_total(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        body = api_client.get(cfg.router_prefix).json()
        assert body["total"] == 1, "exactly the created row must be counted (reset_db guarantees empty start)"
        matches = [item for item in body["items"] if item["id"] == created["id"]]
        assert len(matches) == 1, "created entity must appear in items"
        cfg.response_schema.model_validate(matches[0])  # item shape; extras ignored (ClientWithStats)

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_list_explicit_pagination_echoed(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        resp = api_client.get(cfg.router_prefix, params={"page": 1, "per_page": 5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["page"] == 1
        assert body["per_page"] == 5, "per_page query param must be bound and echoed"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_list_invalid_params_returns_422(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        for params in ({"page": 0}, {"per_page": 0}, {"per_page": 101}):
            resp = api_client.get(cfg.router_prefix, params=params)
            assert resp.status_code == 422, f"{params} must be rejected (ge=1, le=100), got {resp.status_code}"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_list_empty_state(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        body = api_client.get(cfg.router_prefix).json()
        assert body["items"] == []
        assert body["total"] == 0


class TestGenericApiUpdateContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_update_returns_200_and_changed_fields(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        resp = api_client.put(f"{cfg.router_prefix}/{created['id']}", json=_update_payload(cfg, fk_ids))
        assert resp.status_code == 200, f"PUT must return 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        _assert_exact_response_keys(body, cfg)
        parsed = cfg.response_schema.model_validate(body)
        for key, value in cfg.update_data.items():
            assert getattr(parsed, key) == value, f"update_data field {key!r} must be applied"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_update_nonexistent_returns_404_with_entity_code(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)  # valid FKs so the body passes validation → 404, not 422
        resp = api_client.put(f"{cfg.router_prefix}/nonexistent-id", json=_update_payload(cfg, fk_ids))
        _assert_not_found(resp, cfg)


class TestGenericApiDeleteContract:
    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_delete_returns_204(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        resp = api_client.delete(f"{cfg.router_prefix}/{created['id']}")
        assert resp.status_code == 204, f"DELETE must return 204, got {resp.status_code}"
        assert resp.content == b"", "204 must carry no body"

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_delete_nonexistent_returns_404_with_entity_code(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        _assert_not_found(api_client.delete(f"{cfg.router_prefix}/nonexistent-id"), cfg)

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    def test_delete_soft_visibility(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        assert api_client.delete(f"{cfg.router_prefix}/{created['id']}").status_code == 204
        get_resp = api_client.get(f"{cfg.router_prefix}/{created['id']}")
        assert get_resp.status_code == 200, "soft-deleted row stays GETtable (list hides, get returns)"
        assert get_resp.json()["is_active"] is False, "archived row must report is_active=false"
        body = api_client.get(cfg.router_prefix).json()
        assert created["id"] not in [item["id"] for item in body["items"]], (
            "list (default status=active) must hide the archived row"
        )
        assert body["total"] == 0

    @pytest.mark.parametrize("service_cls,cfg", _hard_params())
    def test_delete_hard_visibility(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        assert api_client.delete(f"{cfg.router_prefix}/{created['id']}").status_code == 204
        get_resp = api_client.get(f"{cfg.router_prefix}/{created['id']}")
        assert get_resp.status_code == 404, "hard-deleted row is gone"
        assert get_resp.json()["detail"]["code"] == cfg.not_found_code
        body = api_client.get(cfg.router_prefix).json()
        assert created["id"] not in [item["id"] for item in body["items"]]
        assert body["total"] == 0

    @pytest.mark.parametrize("service_cls,cfg", _soft_params())
    def test_delete_soft_second_delete_returns_404(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        assert api_client.delete(f"{cfg.router_prefix}/{created['id']}").status_code == 204
        resp = api_client.delete(f"{cfg.router_prefix}/{created['id']}")
        assert resp.status_code == 404, "deleting an already-archived row returns False → 404"
        assert resp.json()["detail"]["code"] == cfg.not_found_code


class TestGenericApiPatchWiring:
    """Absorbs the 8 per-entity #175 PATCH-wiring remnants (spec §3.3, D6 — G1b-approved)."""

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_patch_nonexistent_returns_404_with_entity_code(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        _assert_not_found(api_client.patch(f"{cfg.router_prefix}/nonexistent-id", json={}), cfg)
