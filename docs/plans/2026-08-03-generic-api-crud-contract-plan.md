# GH #185 — GenericService HTTP CRUD Contract + test_api Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~930 lines of hand-duplicated per-entity HTTP CRUD tests with one parametrized contract file (`backend/tests/test_generic_api_contract.py`, 116 cases over 8 entities) sharing one config module with the service-level contract.

**Architecture:** Extract `EntityConfig`/`CONTRACT_CONFIG`/discovery helpers from `tests/services/test_generic_service_contract.py` into `backend/tests/generic_contract.py` (+3 HTTP fields per entity), then add a sync-only HTTP contract file (TestClient + test SQLite, end-to-end per ADR 006 — no `db_session`, no mocks). Finally delete the duplicated per-entity tests, keeping entity-specific extras.

**Tech Stack:** pytest, FastAPI TestClient (session-scoped `api_client` + autouse `reset_db` truncation), Pydantic v2 (`model_validate`, `model_fields`).

**Spec:** `docs/specs/2026-08-03-generic-api-crud-contract-design.md` (rev 2, G1b-approved 2026-08-03 — incl. D6 PATCH-wiring absorption and ADR 006 text).

**Hard constraints (user decisions):**
- Tests + docs only. **No production code changes.** If a contract test exposes an HTTP bug → STOP, report BLOCKED (do NOT bend the test to fit).
- The documented `response_model=`-kwarg blind spot (spec D12) stays **documentation-only — NO structure-level/signature guard test** (explicit user decision at G1b).
- Contract tests are characterization tests: they pin EXISTING verified behavior and are green by construction. RED-proof happens via Task 5 mutations (reverted), not via TDD RED.

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria (backend feature — delta is developer-facing, not end-user UI):

- **AC1 — contract file exists, 116 cases, sync-only** → Running the backend suite now hits every generic entity's HTTP endpoints exactly as a client would: POST returns 201 with precisely the response schema's fields, GET/PUT return 200 with the sent values echoed, list returns exactly `{items,total,page,per_page}` with working `page`/`per_page` params (and 422 on `page=0`/`per_page=0`/`per_page=101`), DELETE returns 204, and every unknown id returns the entity's own `<ENTITY>_NOT_FOUND` code. Soft-deleted rows stay GETtable with `is_active: false` but disappear from list; hard-deleted rows 404.
- **AC2 — shared config module** → One config table (`backend/tests/generic_contract.py`) now drives both the service-level and the HTTP-level contract; a future entity configured without its HTTP wiring data fails loudly at import.
- **AC3 — per-entity dedup** → Each `test_api_*.py` file shrinks to only what makes that entity special (date/status filters, search, payment totals, channel edge cases); `test_api_tags.py` disappears entirely; the pagination-params file keeps only services/records/visits.
- **AC4 — net ≈ −350 lines** → ~930 lines of duplicated tests replaced by ~580 lines of shared contract + config.
- **AC5 — mutations verified** → Proven during implementation (then reverted): unmounting a router, narrowing a route's `response_model`, or flipping a status code makes the contract fail.
- **AC6 — suite green, no prod changes** → `backend/src/` untouched; backend suite ≈ 990–1000 passed, ~5s.
- **AC7 — ADR 006** → `docs/decisions/` gains ADR 006 (why HTTP contract tests are end-to-end, not mocked-service), and the README index gains its missing 005 row plus 006.

---

## Task 1: Extract shared contract config module + extend EntityConfig

### Classification: standard

### Required Docs
- `docs/specs/2026-08-03-generic-api-crud-contract-design.md` §3.1, D15–D17 — field semantics, ordering rule
- `backend/tests/services/test_generic_service_contract.py` — the file being split (read it fully before editing)
- `.opencode/skills/pytest-patterns/SKILL.md` — suite conventions

### Task Description

Pure move + extension. No test behavior changes; the service contract suite must be green before and after.

**Step 1 — baseline:**
- [ ] `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` → note pass count (baseline).

**Step 2 — create `backend/tests/generic_contract.py`** with this structure:
- Module docstring: `"""Shared config for GenericService contract tests (service level + HTTP level, GH #184/#185). One entry per entity drives both contracts. The explicit service imports below power __subclasses__() discovery — do not trim."""`
- The FULL import block currently at `test_generic_service_contract.py` L10–83 (all explicit service imports, service classes/factories, models, Create/Patch/Update schema imports), **PLUS** these 8 new imports (append after the Update schema imports):

```python
# Schemas — Response (HTTP-level contract: exact-keys + model_validate on bodies)
from src.schemas.activity import ActivityResponse
from src.schemas.client import ClientResponse
from src.schemas.location import LocationResponse
from src.schemas.master import MasterResponse
from src.schemas.material import MaterialResponse
from src.schemas.payment import PaymentResponse
from src.schemas.tag import TagResponse
from src.schemas.visitor import VisitorResponse
```

- Move **verbatim** from the service file: `GENERIC_CONTRACT_EXCEPTIONS`, `EntityConfig`, `CONTRACT_CONFIG`, `_all_subclasses()`, `_contract_params()`, `_soft_params()`. **`KNOWN_MISMATCHES` does NOT move** (service-only guard data, D17).

**Step 3 — extend `EntityConfig`** (in the new module): insert these 3 fields immediately BEFORE `unique_row_field` (which must stay last — it has a default):

```python
    # HTTP-level wiring (used by tests/test_generic_api_contract.py; the
    # service-level contract ignores them). Required, no defaults — a new
    # entity configured without them must fail loudly at import, not silently
    # lose HTTP coverage (spec D16).
    router_prefix: str  # e.g. "/api/v1/masters"
    not_found_code: str  # e.g. "MASTER_NOT_FOUND" — explicit, NOT derived (activities → ACTIVITY, spec D15)
    response_schema: type  # <Entity>Response — model_validate + exact-keys on HTTP bodies
```

**Step 4 — extend all 8 `CONTRACT_CONFIG` entries** with exactly these values (insert before each entry's `unique_row_field`/closing paren):

| Service | router_prefix | not_found_code | response_schema |
|---|---|---|---|
| ActivityService | `"/api/v1/activities"` | `"ACTIVITY_NOT_FOUND"` | `ActivityResponse` |
| ClientService | `"/api/v1/clients"` | `"CLIENT_NOT_FOUND"` | `ClientResponse` |
| LocationService | `"/api/v1/locations"` | `"LOCATION_NOT_FOUND"` | `LocationResponse` |
| MasterService | `"/api/v1/masters"` | `"MASTER_NOT_FOUND"` | `MasterResponse` |
| MaterialService | `"/api/v1/materials"` | `"MATERIAL_NOT_FOUND"` | `MaterialResponse` |
| PaymentService | `"/api/v1/payments"` | `"PAYMENT_NOT_FOUND"` | `PaymentResponse` |
| TagService | `"/api/v1/tags"` | `"TAG_NOT_FOUND"` | `TagResponse` |
| VisitorService | `"/api/v1/visitors"` | `"VISITOR_NOT_FOUND"` | `VisitorResponse` |

**Step 5 — add `_hard_params()`** to the new module, immediately after `_soft_params()`:

```python
def _hard_params() -> list:
    """Parametrization over hard-delete entities only (delete_semantics == "hard").

    Mirror of _soft_params(); used by the HTTP-level delete-visibility tests
    (tests/test_generic_api_contract.py, GH #185).
    """
    return [
        p
        for p in _contract_params()
        if p.values[1] is not None and p.values[1].delete_semantics == "hard"
    ]
```

**Step 6 — rewrite `backend/tests/services/test_generic_service_contract.py` imports:** delete the moved definitions (`GENERIC_CONTRACT_EXCEPTIONS`, `EntityConfig`, `CONTRACT_CONFIG`, `_all_subclasses`, `_contract_params`, `_soft_params`) and replace with:

```python
from tests.generic_contract import (
    CONTRACT_CONFIG,
    GENERIC_CONTRACT_EXCEPTIONS,
    EntityConfig,
    _all_subclasses,
    _contract_params,
    _soft_params,
)
```

- Keep `KNOWN_MISMATCHES`, `make_entity`, `seed_rows`, all test classes and guard tests in place, untouched.
- Trim the service file's own import block: keep only imports still directly referenced by the remaining code (e.g. service classes used by `KNOWN_MISMATCHES`/guard tests, `GenericService` for the guard, schema/model imports used in test bodies). Remove the rest (the explicit `import src.services.*` block now lives in `generic_contract.py` and executes on import — discovery still works).
- The `from tests.generic_contract import ...` absolute import follows the suite's existing precedent (`from tests.conftest import query_db` in `test_api_tags.py`). If collection raises `ModuleNotFoundError: tests`, STOP and report BLOCKED — do not improvise sys.path hacks.

**Step 7 — verify + commit:**
- [ ] `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` → same pass count as Step 1 baseline.
- [ ] `cd backend && python -m pytest tests/services/ -q` → all green.
- [ ] `git add backend/tests/generic_contract.py backend/tests/services/test_generic_service_contract.py && git commit -m "test: extract shared generic-contract config module (#185)"`

---

## Task 2: HTTP contract file `backend/tests/test_generic_api_contract.py`

### Classification: large

### Required Docs
- `docs/specs/2026-08-03-generic-api-crud-contract-design.md` §2, §3.2, D3–D5, D11–D14 — the contract being pinned
- `backend/tests/generic_contract.py` — config module from Task 1
- `backend/tests/conftest.py` L100–160 (`api_client`, `reset_db`), L165–344 (factory fixtures return callables)
- `.opencode/skills/pytest-patterns/SKILL.md` — suite conventions

### Task Description

Create `backend/tests/test_generic_api_contract.py` with EXACTLY this content (116 parametrized cases: create 8 + get 16 + list 40 + update 16 + delete 28 + patch-wiring 8):

```python
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
    return _jsonable({k: v for k, v in merged.items() if k in cfg.update_schema.model_fields})


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
```

**Steps:**
- [ ] Write the file exactly as above.
- [ ] `cd backend && python -m pytest tests/test_generic_api_contract.py -q` → **116 passed**. If any case fails, this pinpoints a real HTTP deviation: STOP, report BLOCKED with the failing entity/assertion (do NOT weaken assertions; do NOT touch production code).
- [ ] `cd backend && python -m pytest tests/ -q` → full suite green.
- [ ] `git add backend/tests/test_generic_api_contract.py && git commit -m "test: HTTP-level CRUD contract for 8 generic entities (#185)"`

---

## Task 3: Per-entity dedup (9 files)

### Classification: standard

### Required Docs
- `docs/specs/2026-08-03-generic-api-crud-contract-design.md` §3.4 — disposition rules
- The 9 target files themselves

### Task Description

Delete the contract-covered tests; keep entity-specific extras. **Rule:** if a KEEP test fails after removals (e.g. it secretly depended on a removed helper), restore the minimal helper — do not delete the KEEP test. Exact per-file tables (test names verified against source):

**`backend/tests/test_api_activities.py`** — REMOVE 9 tests: `TestActivitiesCrud.test_create_activity`, `.test_list_activities_includes_created`, `.test_get_activity_by_id`, `.test_update_activity`, `.test_delete_activity_hard_deletes`, `.test_get_nonexistent_activity_returns_404`, `.test_update_nonexistent_activity_returns_404`, `.test_delete_nonexistent_activity_returns_404`, `.test_patch_nonexistent_activity_returns_404`. KEEP: all of `TestActivitiesDateFiltering` (2), `TestActivitiesOccupied` (1), `TestActivitiesOccupiedBatch` (2). Helpers `_create_prerequisites`, `_activity_payload`, payload constants, `_insert_record_direct`, late `import asyncio` all stay (used by kept tests). If removing `TestActivitiesCrud` empties the class, delete the class shell too.

**`backend/tests/test_api_clients.py`** — REMOVE 9 tests: `TestClientsCrud.test_create_client`, `.test_list_clients_includes_created`, `.test_get_client_by_id`, `.test_update_client`, `.test_delete_client_soft_deletes`, `.test_get_nonexistent_client_returns_404`, `.test_update_nonexistent_client_returns_404`, `.test_delete_nonexistent_client_returns_404`, `.test_patch_client_not_found`. KEEP everything else (27 tests incl. search, `/clients/{id}/visitors`, create edge cases, channel tolerance, #195 regression, schema contract). `CLIENT_PAYLOAD` stays.

**`backend/tests/test_api_locations.py`** — REMOVE 9 tests: `TestLocationsCrud.test_create_location`, `.test_list_locations_includes_created`, `.test_get_location_by_id`, `.test_update_location`, `.test_delete_location_soft_deletes`, `.test_get_nonexistent_location_returns_404`, `.test_update_nonexistent_location_returns_404`, `.test_delete_nonexistent_location_returns_404`; and `TestLocationPatch.test_patch_location_not_found_404` (delete the now-empty `TestLocationPatch` class). **KEEP `TestLocationsCrud.test_create_location_without_location_hint`** (create edge case — omitted optional field → null; mirrors the kept clients create edge cases; keeps `LOCATION_PAYLOAD` in use) and all 4 `TestLocationListStatusFilter` tests.

**`backend/tests/test_api_masters.py`** — REMOVE 9 tests: `TestMastersCrud.test_create_master`, `.test_list_masters_includes_created`, `.test_get_master_by_id`, `.test_update_master`, `.test_delete_master_soft_deletes`, `.test_get_nonexistent_master_returns_404`, `.test_update_nonexistent_master_returns_404`, `.test_delete_nonexistent_master_returns_404`; and `TestMasterPatch.test_patch_master_not_found_404` (delete the empty class). KEEP all 4 `TestMasterListStatusFilter` tests. **Also delete the orphaned `MASTER_PAYLOAD` constant** (L7–14, used only by removed tests).

**`backend/tests/test_api_materials.py`** — REMOVE 11 tests: `TestMaterialsCrud.test_list_materials_empty`, `.test_create_material`, `.test_get_material`, `.test_update_material`, `.test_delete_material`, `.test_delete_material_soft_deletes`, `.test_list_materials_includes_created`, `.test_get_nonexistent_material_returns_404`, `.test_update_nonexistent_material_returns_404`, `.test_delete_nonexistent_material_returns_404`; and `TestMaterialPatch.test_patch_material_not_found_404` (delete the empty class). KEEP all 4 `TestMaterialListStatusFilter` tests; `_create_material` helper stays (used by kept tests).

**`backend/tests/test_api_payments.py`** — REMOVE 9 tests: `TestPaymentsCrud.test_create_payment`, `.test_list_payments_includes_created`, `.test_get_payment_by_id`, `.test_update_payment`, `.test_delete_payment_hard_deletes`, `.test_get_nonexistent_payment_returns_404`, `.test_update_nonexistent_payment_returns_404`, `.test_delete_nonexistent_payment_returns_404`, `.test_patch_payment_not_found_404`. KEEP: `test_create_payment_with_created_at_persists_it`, `test_create_payment_without_created_at_defaults_now` (both stay in `TestPaymentsCrud` — do not delete the class), all 6 `TestPaymentTotals` tests. Helpers `_create_record`, `PAYMENT_PAYLOAD`, prereq constants stay (used by kept tests).

**`backend/tests/test_api_tags.py`** — **DELETE THE FILE** (all 12 tests contract-covered). This also drops the local `from tests.conftest import query_db` usage — intended (spec §3.4: DB-level row-gone is pinned at ORM level by the service contract).

**`backend/tests/test_api_visitors.py`** — REMOVE 15 tests: `TestVisitorsCrud.test_create_visitor`, `.test_list_visitors_for_client` (superseded by the strengthened scoped-route test below), `.test_get_visitor_by_id`, `.test_update_visitor`, `.test_delete_visitor_hard_deletes`, `.test_get_nonexistent_visitor_returns_404`, `.test_update_nonexistent_visitor_returns_404`, `.test_delete_nonexistent_visitor_returns_404`; `TestVisitorPatch.test_patch_visitor_not_found_404`; and all 6 envelope/param tests in `TestVisitorList`: `.test_list_visitors_envelope_shape`, `.test_list_visitors_total`, `.test_list_visitors_page2_disjoint_from_page1`, `.test_list_visitors_per_page_respected`, `.test_list_visitors_out_of_range_page_empty`, `.test_list_visitors_invalid_params_422` (per spec D4/D14: envelope/422 are contract-covered; slicing is service-contract-covered). KEEP: `TestVisitorsCrud.test_create_visitor_with_null_age`, `TestVisitorPatch.test_patch_visitor_client_id_immutable`, and `TestVisitorList.test_scoped_client_visitors_route_unchanged`. **Strengthen the kept scoped-route test** to absorb the removed multi-row assertion: create a client, create **2 visitors** for it (via the existing `_create_visitors` helper or two POSTs), then GET `/api/v1/clients/{client_id}/visitors` and assert: status 200; body is a **bare array** (`"items" not in body` — deliberate deviation from the envelope contract, spec D10); `len(body) == 2`; both visitor names present.

**`backend/tests/test_api_pagination_params.py`** — in the `ENDPOINTS` constant (L7–17), REMOVE the 6 generic endpoints (`/api/v1/masters`, `/api/v1/locations`, `/api/v1/tags`, `/api/v1/materials`, `/api/v1/activities`, `/api/v1/payments`). KEEP `/api/v1/services`, `/api/v1/visits`, `/api/v1/records` (contract exceptions/standalone — their only pagination coverage, spec D14). Both test functions stay, now parametrized over 3 endpoints.

**Steps:**
- [ ] Apply the 9 file edits above.
- [ ] `cd backend && python -m pytest tests/test_api_activities.py tests/test_api_clients.py tests/test_api_locations.py tests/test_api_masters.py tests/test_api_materials.py tests/test_api_payments.py tests/test_api_visitors.py tests/test_api_pagination_params.py tests/test_generic_api_contract.py -q` → all green.
- [ ] `cd backend && python -m pytest tests/ -q` → full suite green (≈ 990–1000 passed; removed 107 cases [83 per-entity + 24 pagination params], added 116 → net ≈ +9 vs the pre-#185 suite).
- [ ] Verify no orphaned names: `cd backend && python -m ruff check tests/ 2>/dev/null || true` — if ruff is not configured, manually confirm no unused imports/constants remain in the 8 edited files (unused imports fail CI lint).
- [ ] `git add -A backend/tests && git commit -m "test: dedup per-entity API CRUD tests into generic contract (#185)"`

---

## Task 4: ADR 006 + decisions index

### Classification: small

### Required Docs
- `docs/specs/2026-08-03-generic-api-crud-contract-design.md` §3.6 — the G1b-approved ADR text
- `docs/decisions/TEMPLATE.md`, `docs/decisions/README.md`

### Task Description

- [ ] Create `docs/decisions/006-http-contract-tests-end-to-end.md` with EXACTLY the markdown content of spec §3.6's fenced block (title `# ADR 006: HTTP Contract Tests Are End-to-End (TestClient + Test SQLite), Not Mocked-Service` through the References list — copy verbatim, including the `## Status`/`## Context`/`## Decision`/`## Consequences`/`### Positive`/`### Negative`/`### Risks`/`## References` heading structure).
- [ ] Edit `docs/decisions/README.md` ADR Index table: add the missing 005 row AND the new 006 row (005 exists on disk but was never indexed — doc drift fix per spec D9):

```markdown
| 005 | End-to-End Error Contract with Machine-Readable Codes | Accepted | 2026-06-20 |
| 006 | HTTP Contract Tests Are End-to-End (TestClient + Test SQLite), Not Mocked-Service | Accepted | 2026-08-03 |
```

- [ ] `git add docs/decisions/006-http-contract-tests-end-to-end.md docs/decisions/README.md && git commit -m "docs: ADR 006 — end-to-end HTTP contract tests (#185)"`

---

## Task 5: Mutation verification (RED-proof) + final suite

### Classification: small

### Required Docs
- `docs/specs/2026-08-03-generic-api-crud-contract-design.md` §5 (AC5), §3.2 self-guard

### Task Description

Prove the contract catches the three wiring-break classes. Each mutation is applied, tested, then **fully reverted** before the next. Do NOT commit mutations.

- [ ] **Mutation A — unmounted router:** in `backend/src/main.py`, comment out ONE `app.include_router(...)` line (pick `masters`). Run `cd backend && python -m pytest tests/test_generic_api_contract.py -q -k "Master"` → EXPECT failures: `test_create_returns_201...` (404≠201), list tests (404≠200), `test_get_nonexistent...` (code mismatch — default 404 body lacks `MASTER_NOT_FOUND`... note: Activity is the documented exception, D13; masters is not). `git checkout -- backend/src/main.py`. Verify the file is pristine.
- [ ] **Mutation B — narrowed/wrong response_model:** in `backend/src/api/v1/masters.py`, on the GET `/{master_id}` route temporarily change `response_model=MasterResponse` to `response_model=TagResponse` (FastAPI then filters the body down to Tag's fields). Run `cd backend && python -m pytest tests/test_generic_api_contract.py -q -k "Master and get"` → EXPECT `test_get_returns_created_entity[MasterService]` to fail (exact-keys assertion). NOTE: do NOT mutate by merely dropping the `response_model=` kwarg — that is the documented blind spot (spec D12; services return validated schema instances → byte-identical body). `git checkout -- backend/src/api/v1/masters.py`. Verify pristine.
- [ ] **Mutation C — status flip:** in `backend/src/api/v1/masters.py`, change POST's `status_code=201` to `status_code=200`. Run `pytest tests/test_generic_api_contract.py -q -k "Master and create"` → EXPECT failure on the 201 assertion. `git checkout -- backend/src/api/v1/masters.py`.
- [ ] `git status` → `backend/src/` must show ZERO modifications.
- [ ] `cd backend && python -m pytest tests/ -q` → full suite green.
- [ ] Record results (expected/actual per mutation) in the task report.

---

## Self-Review Checklist (architect, completed at plan write time)

- Spec coverage: AC1→Task 2; AC2→Task 1; AC3→Task 3; AC4→Tasks 2+3 (verified at Task 3 via git diff --stat); AC5→Task 5; AC6→Task 5; AC7→Task 4. ✓
- No placeholders: all code blocks complete; all keep/remove tables use exact test names verified against source. ✓
- Measured arithmetic: 107 removed cases (83 per-entity + 24 pagination cases) vs 116 new → net ≈ +9 collected; suite ≈ 990–1000p (spec's "≈985p / −8" estimate superseded by this measured inventory — same order, noted here for AC6 tolerance ±15). ✓
- No `backend/src/` changes anywhere in the plan (mutations are reverted in-task). ✓
