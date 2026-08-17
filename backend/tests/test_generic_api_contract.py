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

from tests.generic_contract import (
    EntityConfig,
    TagService,
    _all_params,
    _contract_params,
    _hard_params,
    _serialized_keys,
)


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


def _create_payload(cfg: EntityConfig, fk_ids: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST body: ``data`` (defaults to ``cfg.create_data``) + FK ids, JSON-serialized.

    The optional ``data`` override lets a test POST a row whose sort key
    differs from ``cfg.create_data`` (used by the ``/all`` default-order
    contract to seed a sentinel that sorts BEFORE the default row per
    spec §4.4).
    """
    base = data if data is not None else cfg.create_data
    return _jsonable({**base, **fk_ids})


def _update_payload(cfg: EntityConfig, fk_ids: dict[str, Any]) -> dict[str, Any]:
    """PUT body: create_data + FKs + update_data, filtered to update_schema fields.

    #207 §3.2 (#178 auto-close): ``is_active`` was removed from all Update
    schemas for the 5 archive-capable entities (MasterUpdate/LocationUpdate/
    ServiceUpdate/MaterialUpdate/ClientUpdate), so the ``model_fields`` filter
    below drops it for them and the ``setdefault`` injection below is a no-op.
    Hard-delete entities never had ``is_active`` in their Update schema, so the
    injection is also a no-op there. The 422-on-stray-``is_active`` contract is
    pinned by ``test_update_rejects_is_active.py`` (Task 5) +
    ``test_put_is_active.py`` (Task 13 acceptance).
    """
    merged = {**cfg.create_data, **fk_ids, **cfg.update_data}
    payload = _jsonable({k: v for k, v in merged.items() if k in cfg.update_schema.model_fields})
    if "is_active" in cfg.update_schema.model_fields:
        payload.setdefault("is_active", True)
    return payload


def _create_entity(
    api_client,
    cfg: EntityConfig,
    fk_ids: dict[str, Any],
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """POST a row and return the created body. Optional ``data`` overrides
    ``cfg.create_data`` (see ``_create_payload``)."""
    resp = api_client.post(cfg.router_prefix, json=_create_payload(cfg, fk_ids, data=data))
    assert resp.status_code == 201, f"POST {cfg.router_prefix} → {resp.status_code}: {resp.text}"
    return resp.json()


def _assert_exact_response_keys(body: dict[str, Any], cfg: EntityConfig) -> None:
    # #207 §3.1: Response schemas for the 5 archive-capable entities keep
    # ``is_active: bool = Field(..., exclude=True)`` (parsed, NOT serialized)
    # and expose ``archived`` via a ``@computed_field`` (serialized, absent from
    # ``model_fields``). Comparing against ``model_fields.keys()`` would assert
    # ``is_active`` is in the body (False — excluded) and miss ``archived``
    # (False — computed). Compute the SERIALIZED field set instead so the
    # contract pins what the API actually emits. Hard-delete entities have no
    # excluded or computed fields → the helper reduces to ``set(model_fields)``.
    expected = _serialized_keys(cfg.response_schema)
    actual = set(body.keys())
    assert actual == expected, (
        f"response keys must equal {cfg.response_schema.__name__} serialized "
        f"fields exactly; missing={sorted(expected - actual)}, "
        f"extra={sorted(actual - expected)}"
    )


def _assert_sent_fields_echoed(body: dict[str, Any], cfg: EntityConfig, sent: dict[str, Any]) -> None:
    """Typed comparison through the validated response model (datetimes round-trip, spec D11).

    Delegates the ``model_validate`` round-trip to ``_validate_response_body``
    (which handles the #207 §3.1 ``is_active: Field(exclude=True)`` injection for
    archive-capable entities — see that helper for details).
    """
    parsed = _validate_response_body(body, cfg)
    for key, value in sent.items():
        if key in cfg.response_schema.model_fields:
            assert getattr(parsed, key) == value, f"field {key!r} must echo the sent value"


def _validate_response_body(body: dict[str, Any], cfg: EntityConfig):
    """Run ``cfg.response_schema.model_validate`` on an API body with the #207
    §3.1 ``is_active`` injection for archive-capable entities.

    Archive-capable Response schemas (Master/Location/Service/Material/Client)
    keep ``is_active: bool = Field(..., exclude=True)`` — REQUIRED on input but
    NEVER serialized. ``model_validate(body)`` raises because the body lacks
    ``is_active``. Inject it from the inverted ``archived`` computed field
    (``is_active = not archived``) before validation so the type-coercion
    round-trip still works (datetimes, enums — spec D11). Hard-delete entities
    (Activity/Payment/Visitor/Tag) have no ``is_active`` field → the guard is a
    no-op, the original ``model_validate(body)`` path is preserved.
    """
    validate_dict = dict(body)
    is_active_field = cfg.response_schema.model_fields.get("is_active")
    if is_active_field is not None and is_active_field.exclude is True:
        validate_dict["is_active"] = not body.get("archived", False)
    return cfg.response_schema.model_validate(validate_dict)


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
        # #207 §3.1: archive-capable Response schemas need is_active injected
        # from inverted `archived` before model_validate (see
        # _validate_response_body). Hard-delete entities → no-op.
        _validate_response_body(matches[0], cfg)  # item shape; extras ignored (ClientWithStats)

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
        # #207 §3.1: archive-capable Response schemas need is_active injected
        # from inverted `archived` before model_validate (see
        # _validate_response_body). Hard-delete entities → no-op.
        parsed = _validate_response_body(body, cfg)
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

    @pytest.mark.parametrize("service_cls,cfg", _hard_params())
    def test_delete_hard_second_delete_returns_404(self, service_cls, cfg, api_client, request):
        """Deleting an already-hard-deleted id → 404 (row gone, ``service.delete``
        returns False on missing instance).

        Replaces the deleted ``test_delete_soft_second_delete_returns_404``
        (#207 Task 13 Part B3): the soft-delete world's "second delete on an
        archived row returns False" guard is now redundant because there is no
        archived state — a hard-delete already 204s the first call, and the
        second call hits a missing row the same way
        ``test_delete_nonexistent_returns_404_with_entity_code`` does. Kept as a
        dedicated parity test for the second-call semantics.
        """
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        assert api_client.delete(f"{cfg.router_prefix}/{created['id']}").status_code == 204
        resp = api_client.delete(f"{cfg.router_prefix}/{created['id']}")
        assert resp.status_code == 404, "second DELETE on a hard-deleted row → 404"
        assert resp.json()["detail"]["code"] == cfg.not_found_code


class TestGenericApiPatchWiring:
    """Absorbs the 8 per-entity #175 PATCH-wiring remnants (spec §3.3, D6 — G1b-approved)."""

    @pytest.mark.parametrize("service_cls,cfg", _contract_params())
    def test_patch_nonexistent_returns_404_with_entity_code(self, service_cls, cfg, api_client):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        _assert_not_found(api_client.patch(f"{cfg.router_prefix}/nonexistent-id", json={}), cfg)


# ─── /all contract (GH #205 Task 4) ─────────────────────────────────────────
# Spec §4.6: opt-in parametrizer (``_all_params`` in generic_contract.py)
# filtered to the 5 dictionary service classes. Covers: bare-array shape +
# item schema, deterministic default order (§4.4), status parity for archive
# entities (tags skipped), limit 422 + boundary (tags only — cheapest bulk
# insert; enforcement is the single shared ``list_all`` choke point), and a
# negative route-presence guard for non-dictionaries.


class TestGenericApiAllContract:
    """``GET {prefix}/all`` contract for the 5 dictionaries (spec §4.6, #205).

    Mirrors ``TestGenericApiListContract``'s style but asserts the bare-array
    second response shape approved at G1a: a top-level JSON array (NOT the
    ``PaginatedResponse`` envelope), items validating against
    ``cfg.response_schema``, §4.4 deterministic default order, and archive-
    status parity for the 4 archive-capable dictionaries (tags skipped —
    non-archive, hard-delete only).
    """

    @pytest.mark.parametrize("service_cls,cfg", _all_params())
    def test_all_returns_bare_array_with_valid_items(self, service_cls, cfg, api_client, request):
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        resp = api_client.get(cfg.router_prefix + "/all")
        assert resp.status_code == 200, f"GET {cfg.router_prefix}/all → {resp.status_code}: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must be a bare array, not an envelope"
        # Negative assertion on envelope keys: a list has no ``items``/``total``
        # keys — ``isinstance(body, list)`` above IS that assertion.
        matches = [item for item in body if item["id"] == created["id"]]
        assert len(matches) == 1, "created entity must appear in /all exactly once"
        _validate_response_body(matches[0], cfg)

    @pytest.mark.parametrize("service_cls,cfg", _all_params())
    def test_all_deterministic_default_order(self, service_cls, cfg, api_client, request):
        """§4.4 default order: the ``earlier_create_data`` sentinel sorts
        BEFORE the default ``create_data`` row, so it must appear earlier in
        the ``/all`` array regardless of insertion order."""
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        assert cfg.earlier_create_data is not None, (
            f"{service_cls.__name__}: earlier_create_data must be set on the config "
            f"to exercise the §4.4 default-order contract"
        )
        fk_ids = _resolve_fk_ids(request, cfg)
        # Insert "later" FIRST, then "earlier" — order must come from §4.4
        # columns, not insertion/id order.
        later = _create_entity(api_client, cfg, fk_ids)
        earlier_data = {**cfg.create_data, **cfg.earlier_create_data}
        earlier = _create_entity(api_client, cfg, fk_ids, data=earlier_data)
        body = api_client.get(cfg.router_prefix + "/all").json()
        ids = [item["id"] for item in body]
        assert ids.index(earlier["id"]) < ids.index(later["id"]), (
            f"{service_cls.__name__} /all default order per spec §4.4: the "
            f"sentinel row must sort before the default-create_data row"
        )

    @pytest.mark.parametrize("service_cls,cfg", _all_params())
    def test_all_status_filter_parity(self, service_cls, cfg, api_client, request):
        """Archive entities: ``/all`` honors ``status`` the same way as the
        paginated list — active default hides archived, ``status=all`` and
        ``status=archived`` include them. Tags have no archive surface → skip."""
        assert cfg is not None, f"{service_cls.__name__}: missing CONTRACT_CONFIG entry"
        if service_cls is TagService:
            pytest.skip("tags have no archive status (non-archive, hard-delete only)")
        fk_ids = _resolve_fk_ids(request, cfg)
        created = _create_entity(api_client, cfg, fk_ids)
        archive = api_client.post(f"{cfg.router_prefix}/{created['id']}/archive")
        assert archive.status_code == 200, f"archive → {archive.status_code}: {archive.text}"
        # Default (active) hides the archived row.
        assert all(item["id"] != created["id"] for item in api_client.get(cfg.router_prefix + "/all").json()), (
            "archived row must NOT appear in /all with default (active) status"
        )
        # status=all includes it.
        assert any(
            item["id"] == created["id"]
            for item in api_client.get(cfg.router_prefix + "/all", params={"status": "all"}).json()
        ), "archived row MUST appear in /all?status=all"
        # status=archived includes it.
        assert any(
            item["id"] == created["id"]
            for item in api_client.get(cfg.router_prefix + "/all", params={"status": "archived"}).json()
        ), "archived row MUST appear in /all?status=archived"


# ─── /all limit + boundary (tags only — cheapest bulk insert) ───────────────
# Enforcement lives in the single shared ``GenericService.list_all`` choke
# point (LIMIT BARE_LIST_MAX_ROWS + 1 probe → BareListLimitExceededError).
# One entity suffices to cover all 5 (spec §4.6). Tags are the cheapest
# (single String column, no FKs, no nested relationships).


def _bulk_seed_tags(db_engine, n: int) -> None:
    """Bulk-insert ``n`` tag rows directly via SQLAlchemy (sync test → asyncio.run).

    Mirrors conftest's ``reset_db`` ``asyncio.run`` idiom (:145-156). Explicit
    uuid4 ids + created_at/updated_at are supplied because bulk ``insert()``
    with a list of dicts does not reliably invoke Python-side column defaults
    across SQLAlchemy versions — supplying them keeps the test deterministic.
    """
    import asyncio
    import uuid as _uuid
    from datetime import datetime

    async def _seed() -> None:
        from sqlalchemy import insert
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from src.models.tag import Tag

        factory = async_sessionmaker(db_engine, expire_on_commit=False)
        now = datetime.utcnow()
        rows = [
            {
                "id": str(_uuid.uuid4()),
                "tag": f"bulk-{i:05d}",
                "created_at": now,
                "updated_at": now,
            }
            for i in range(n)
        ]
        async with factory() as session:
            await session.execute(insert(Tag), rows)
            await session.commit()

    asyncio.run(_seed())


def test_all_limit_exceeded_422(api_client, db_engine):
    """``BARE_LIST_MAX_ROWS + 1`` rows → 422 with the standard envelope
    (``code=VALIDATION_ERROR``, English message naming the entity + limit)."""
    from src.services.generic import BARE_LIST_MAX_ROWS

    _bulk_seed_tags(db_engine, BARE_LIST_MAX_ROWS + 1)
    resp = api_client.get("/api/v1/tags/all")
    assert resp.status_code == 422, f"limit exceeded → 422, got {resp.status_code}: {resp.text}"
    detail = resp.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"
    assert "tags" in detail["message"], "message must name the entity ('tags')"
    assert str(BARE_LIST_MAX_ROWS) in detail["message"], "message must cite the limit value"


def test_all_limit_boundary_ok(api_client, db_engine):
    """Exactly ``BARE_LIST_MAX_ROWS`` rows → 200 with the full array (boundary)."""
    from src.services.generic import BARE_LIST_MAX_ROWS

    _bulk_seed_tags(db_engine, BARE_LIST_MAX_ROWS)
    resp = api_client.get("/api/v1/tags/all")
    assert resp.status_code == 200, f"boundary → 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert isinstance(body, list)
    assert len(body) == BARE_LIST_MAX_ROWS, "exactly BARE_LIST_MAX_ROWS rows must be returned"


# ─── /all route-presence negative guard (non-dictionaries → 404) ────────────
# Spec §4.6 + G1b: ``/all`` is dictionaries-only. The 6 non-dictionary
# prefixes must NOT have a ``/all`` route — a 404 keeps the opt-in semantics
# pinned (#205).


@pytest.mark.parametrize(
    "prefix",
    [
        "/api/v1/clients",
        "/api/v1/records",
        "/api/v1/activities",
        "/api/v1/visits",
        "/api/v1/payments",
        "/api/v1/visitors",
    ],
)
def test_all_absent_on_non_dictionaries(api_client, prefix):
    resp = api_client.get(prefix + "/all")
    assert resp.status_code == 404, (
        f"{prefix}/all must NOT exist — /all is dictionaries-only (#205)"
    )
