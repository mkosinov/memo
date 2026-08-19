# GH #212 — Server-side search (`?q=`) in the standard list-pagination pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a uniform server-side `?q=` search param to the 9 paginated list endpoints, migrate all table search boxes and PhotoModal typeaheads onto it, rename `searchClientByPhone`→`getClientByPhone` (`GET /clients/get?phone=`), delete the `/api/v1/search/*` router, and fix Cyrillic case-insensitivity on SQLite.

**Architecture:** One pure predicate builder (`backend/src/repositories/search.py`) + per-entity `search_fields` declared on service classes; generic repos gain `q`/`search_fields` params (predicate before COUNT); clients/records/activities apply the helper on their custom paths. Frontend (post-#139 world): factory gains a `serverSearch` flag wiring context `search` into the query key + fetcher `q`; dict `*Filters` bars unchanged visually; Records gains a search input in BookingFilters; PhotoModal typeaheads switch to list getters with `per_page=10`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async, aiosqlite) + pydantic · packages/api-client (zod) · Next.js admin + React Query.

**Spec:** `docs/specs/2026-08-19-list-search-q-design.md` (G1b approved, pushed). Read it before Task 1.

**Sequencing / grounding notes:**
- IMPL starts only after **#139 merges** (generic DataTable). Tasks touching frontend table wiring (T10–T13) are written against the #139 design contract (`docs/specs/2026-08-18-generic-datatable-design.md` §6.1/§6.4/§6.7); at IMPL start, re-verify exact file shapes against merged #139 and adjust line references — the contracts (withSearch, factory search/setSearch, PagedListState) are stable.
- Fresh worktree: run `uv sync --extra dev` in `backend/` before pytest (pytest is in the dev extra).
- Single PR; tasks land in order, each green. The `search`→`q` rename must never straddle commits (FastAPI silently ignores unknown params).

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Table search searches everything, not the current page** → On every admin table (Tags, Locations, Masters, Materials, Services, Clients, Records) typing ≥2 chars in the existing search box queries the server; the pager total shrinks to the real filtered count. (Spec §6 S1; Records' box is NEW — §6 S2.)
- **Paste a full UUID → exactly that row** → Pasting a full entity id (36-char UUID, any letter case) into any table's search box narrows the table to that single record; an id fragment never matches by id. (Spec §6 S3 — also the #216 deep-link prerequisite.)
- **1-char queries do nothing** → Table search boxes and PhotoModal typeaheads don't fire below 2 characters (no error toasts, no 422 noise); direct API calls with `q` shorter than 2 chars get a 422. (Spec §6 S4.)
- **Cyrillic search is case-insensitive** → "иван" finds "Иван" in every table and typeahead (previously broken on SQLite). (Spec §5.4, contract case 2.)
- **Photo modal typeaheads keep working, now on the standard API** → Visitors, services, activities, tags pickers behave as before (services still active-only; activity picker still narrows by selected service and auto-fills it); the old `/api/v1/search/*` endpoints disappear. (Spec §5.5 point 6, §6 S5/S7.)
- **Phone lookup in booking forms unchanged** → Typing a full phone still auto-fills the client name; partial/unknown phone still 404s silently into the create flow. Only the endpoint name changed (`/clients/search` → `/clients/get`). (Spec §6 S6.)
- **Search combines with every existing filter** → Status tabs, date ranges, record filters all AND with the search text. (Spec §5.1, contract case 7.)
- (Backend-only portion — no user-visible delta: per-entity `search_fields` declarations, repo/service plumbing, contract-test matrix, domain-rules sync. Full plan below.)

---

## Task 1: M5 — Cyrillic probe test + SQLite `lower()` override
### Classification: small
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.4 — the fix and its blast-radius reasoning
- Skill: pytest-patterns — fixtures, api_client usage

### Task Description
**Files:**
- Create: `backend/tests/test_cyrillic_search_probe.py`
- Modify: `backend/src/db/database.py` (the existing connect listener, lines 16-44)

**Steps:**
- [ ] Write the probe test FIRST (RED). Exact content:

```python
"""M5 probe (GH #212): Cyrillic case-insensitivity of list search on SQLite.

Stock SQLite lower() folds ASCII only — without the engine-level override in
src/db/database.py this test fails ("иван" does not match "Иван").
"""

import pytest

pytestmark = pytest.mark.api


def test_cyrillic_ilike_probe(api_client, create_client) -> None:
    client = create_client()
    api_client.post(
        "/api/v1/visitors",
        json={"client_id": client["id"], "name": "Иван Петров", "age": 30},
    )
    # Targets /api/v1/search/visitors (present until Task 14) — it exercises the
    # same ilike mechanism. Task 14 retargets this probe to GET /api/v1/visitors?q=.
    resp = api_client.get("/api/v1/search/visitors", params={"q": "иван"})
    assert resp.status_code == 200
    names = [v["name"] for v in resp.json()]
    assert "Иван Петров" in names
```

(The probe targets the still-present `/api/v1/search/visitors` — sync TestClient style per existing `test_api_search.py`.)
- [ ] Run it: `cd backend && uv run pytest tests/test_cyrillic_search_probe.py -x -q` → expect **FAIL** (name not found). If it unexpectedly PASSES pre-fix, continue anyway (the override is harmless and guarantees parity across SQLite builds) — note that in the commit message.
- [ ] GREEN — in `backend/src/db/database.py`, inside `_set_sqlite_pragmas`, immediately after the sqlite guard (`if "sqlite" not in type(dbapi_connection).__module__: return`), add:

```python
    # GH #212 M5: full-Unicode case folding for ilike — stock SQLite lower()
    # folds ASCII only. Python str.lower agrees with SQLite lower() on ASCII,
    # so pre-existing ASCII queries are unaffected.
    dbapi_connection.create_function(
        "lower", 1, lambda s: s.lower() if s is not None else None
    )
```

- [ ] Re-run probe → PASS. Run full backend suite: `uv run pytest -x -q` → same counts as baseline (1265p expected, 0f).
- [ ] Commit: `feat(backend): Unicode lower() override for SQLite connections (GH #212 M5)`

---

## Task 2: Search predicate helper + pure unit tests
### Classification: small
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.1-§5.3 — param contract + helper design
- Skill: pytest-patterns — pure_unit marker convention (mirror `tests/test_schemas_search.py`)

### Task Description
**Files:**
- Create: `backend/src/repositories/search.py`
- Create: `backend/tests/test_search_predicate.py`

**Steps:**
- [ ] Write RED pure unit tests in `backend/tests/test_search_predicate.py` (`pytestmark = pytest.mark.pure_unit` — verify marker name against `tests/test_schemas_search.py`):

```python
"""Pure unit tests for repositories/search.py (GH #212). No DB."""

import pytest
from sqlalchemy import ColumnElement

from src.models.client import Client
from src.repositories.search import SearchField, search_predicate

pytestmark = pytest.mark.pure_unit


def _sql(pred: ColumnElement[bool]) -> str:
    return str(pred.compile(compile_kwargs={"literal_binds": True})).lower()


def test_substring_field_builds_escaped_ilike() -> None:
    pred = search_predicate("иван", [SearchField(Client.name)])
    sql = _sql(pred)
    assert "lower(" in sql  # ilike compiles via lower() — the M5 override target
    assert "%иван%" in sql


def test_wildcards_escaped() -> None:
    pred = search_predicate("100%_x", [SearchField(Client.name)])
    sql = _sql(pred)
    assert "\\%" in sql and "\\_" in sql and "escape" in sql


def test_full_uuid_adds_id_equality_normalized() -> None:
    uid = "123E4567-E89B-12D3-A456-426614174000"  # uppercase on purpose
    pred = search_predicate(uid, [SearchField(Client.name), SearchField(Client.id, kind="uuid")])
    sql = _sql(pred)
    assert "123e4567-e89b-12d3-a456-426614174000" in sql  # normalized lowercase


def test_partial_uuid_never_matches_id() -> None:
    pred = search_predicate(
        "123e4567", [SearchField(Client.name), SearchField(Client.id, kind="uuid")]
    )
    sql = _sql(pred)
    assert "like" in sql  # only the substring clause survives
    assert "clients.id =" not in sql  # no id equality for a partial UUID


def test_exact_kind_matches_always() -> None:
    pred = search_predicate("https://ya.ru/maps/x", [SearchField(Client.email, kind="exact")])
    assert "=" in _sql(pred)


def test_empty_fields_raise() -> None:
    with pytest.raises(ValueError):
        search_predicate("ab", [])
```

(Adjust the loose SQL-string assertions if the compiled form differs — the semantic requirements are: ilike present, escaped, UUID equality only for full UUIDs, ValueError on empty fields.)
- [ ] GREEN — `backend/src/repositories/search.py`:

```python
"""Search predicate builder for list `?q=` params (GH #212).

One pure helper; per-entity fields are declared on service classes as
`search_fields`. Substring = case-insensitive ilike '%q%' with %/_ escaping;
exact = equality (e.g. location URLs); uuid = equality only when q is a full
UUID (normalized lowercase — stored ids are lowercase str(uuid4)).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import ColumnElement

_ESCAPE = "\\"


@dataclass(frozen=True)
class SearchField:
    column: ColumnElement  # InstrumentedAttribute at call sites
    kind: Literal["substring", "exact", "uuid"] = "substring"


def _escape_like(q: str) -> str:
    return q.replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")


def _full_uuid(q: str) -> str | None:
    if len(q) != 36:
        return None
    try:
        return str(UUID(q))  # normalizes case + validates
    except ValueError:
        return None


def search_predicate(q: str, fields: Sequence[SearchField]) -> ColumnElement[bool]:
    """OR'd predicate for q over declared fields. Raises ValueError if fields empty."""
    if not fields:
        raise ValueError("search_fields must be non-empty when q is provided")
    uuid_q = _full_uuid(q)
    clauses = []
    for f in fields:
        if f.kind == "substring":
            clauses.append(f.column.ilike(f"%{_escape_like(q)}%", escape=_ESCAPE))
        elif f.kind == "exact":
            clauses.append(f.column == q)
        else:  # uuid
            if uuid_q is not None:
                clauses.append(f.column == uuid_q)
    from sqlalchemy import or_

    return or_(*clauses)
```

- [ ] `uv run pytest tests/test_search_predicate.py -q` → all pass.
- [ ] Commit: `feat(backend): search_predicate helper for list ?q= (GH #212)`

---

## Task 3: Generic repositories accept `q` + `search_fields`
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.3 points 1-2
- Skill: pytest-patterns

### Task Description
**Files:**
- Modify: `backend/src/repositories/generic.py` — `BaseRepository.list` (lines 29-63) and `ArchiveRepository.list` (lines 183-216)
- Modify: `backend/tests/test_repository_list.py`

**Steps:**
- [ ] RED — add repo-level tests to `tests/test_repository_list.py`: (a) q substring narrows rows + `total` reflects the filtered count (predicate before COUNT); (b) q combines with `filters=` (AND); (c) q + `search_fields=None` raises ValueError; (d) full-UUID q matches by id; (e) q absent → unchanged behavior. Use the existing test file's fixtures/patterns (read it first).
- [ ] GREEN — in both `list` methods, add keyword params `q: str | None = None, search_fields=None` and apply right after the `options` block / status predicate, BEFORE the count:

```python
        if q is not None:
            stmt = stmt.where(search_predicate(q, search_fields or []))
```

(add `from src.repositories.search import search_predicate` at module top; annotate `search_fields: Sequence[SearchField] | None = None` — import `SearchField` too, `Sequence` from collections.abc).
- [ ] `uv run pytest tests/test_repository_list.py tests/test_archive_repository.py tests/test_soft_delete_repository.py -q` → green; then full backend suite → green.
- [ ] Commit: `feat(backend): q/search_fields params on generic repositories (GH #212)`

---

## Task 4: Generic service plumbing + Tags wired end-to-end + search contract matrix skeleton
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.2 (field matrix), §5.3 point 2, §7 (matrix)
- `docs/domain-rules/tags.md`
- Skill: pytest-patterns

### Task Description
**Files:**
- Modify: `backend/src/services/generic.py` — `GenericService` (add `search_fields` class attr + `q` param on `list`, lines 76-94) and `ArchiveService.list` (lines 222-249)
- Modify: `backend/src/services/tag.py` — declare fields
- Modify: `backend/src/api/v1/tags.py` — list endpoint gains `q`
- Modify: `backend/tests/generic_contract.py` — extend `EntityConfig` + add `SEARCH_ENTITIES` parametrization
- Modify: `backend/tests/test_generic_api_contract.py` — new `TestGenericApiSearchContract`

**Steps:**
- [ ] RED — contract matrix skeleton in `test_generic_api_contract.py`:

```python
class TestGenericApiSearchContract:
    """Server-side ?q= search contract (GH #212), parametrized over SEARCH_ENTITIES."""

    @pytest.mark.parametrize("service_cls,cfg", _search_params())
    def test_substring_match_case_insensitive(self, api_client, service_cls, cfg): ...
        # create row via api_client.post(cfg.router_prefix, json={**cfg.create_data, **resolved_fk, **cfg.search_override})
        # GET {prefix}?q={cfg.search_query} → 200, exactly the created row in items, total == 1
    # + cases: full-UUID q → exact row; partial id → no match; q len 1 and q="" → 422
    #   (assert detail.code == "VALIDATION_ERROR"); q absent → unfiltered;
    #   no-match q → 200 items [] total 0; wildcard literal "%" → no crash, literal match only;
    #   Cyrillic: cfg.search_query is lowercase Cyrillic vs uppercase stored value (M5 pin);
    #   archive entities: archived row + q under default status → not returned (spec case 14);
    #   total-after-q: 3 matching rows, per_page=2 → page 2 has 1 item and total == 3.
```

- [ ] In `generic_contract.py` extend `EntityConfig` with optional search fields (trailing, defaulted — unspecified entities keep working):

```python
    # GH #212 search matrix. None → entity excluded from TestGenericApiSearchContract.
    search_override: dict | None = None      # create_data overrides carrying the Cyrillic probe value
    search_query: str | None = None          # lowercase Cyrillic substring matching search_override
```

and add `_search_params()` — iterate `CONTRACT_CONFIG` **directly** (like `_all_params()`, NOT like `_contract_params()`): the search matrix must NOT skip `GENERIC_CONTRACT_EXCEPTIONS` — `ServiceService` is in that set yet its custom-list q path needs matrix coverage (Task 5 adds its config). Filter: `cfg.search_query is not None`. Start with only `TagService` configured: `search_override={"tag": "Живопись"}`, `search_query="жив"` (adjust to existing create_data to avoid unique-row clashes).
- [ ] GREEN — plumbing. In `GenericService`:

```python
class GenericService(...):
    search_fields: Sequence[SearchField] | None = None  # declared per entity (GH #212)

    async def list(self, db_session, page=1, per_page=20, order_by=None,
                   q: str | None = None, **filters):
        items_orm, total = await self._repository.list(
            db_session, self._model, filters=filters, q=q,
            search_fields=self.search_fields, order_by=order_by,
            limit=per_page, offset=(page - 1) * per_page,
        )
```

Same `q` forwarding in `ArchiveService.list` (keeps `status` param). Import `SearchField`/`Sequence` in generic.py.
- [ ] `TagService` declaration:

```python
class TagService(GenericService[...]):
    search_fields = [SearchField(Tag.tag), SearchField(Tag.id, kind="uuid")]
```

- [ ] `tags.py` list endpoint: add scalar param `q: str | None = Query(None, min_length=2, max_length=100)` (after the sort params) and pass `q=q` into `service.list(...)`.
- [ ] `uv run pytest tests/test_generic_api_contract.py -q -k Search` → green; full backend suite green.
- [ ] Commit: `feat(backend): q plumbing on generic services; tags list search (GH #212)`

---

## Task 5: Masters, Materials, Locations, Visitors, Services search + full matrix configs
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.2 field matrix
- `docs/domain-rules/{masters,materials,locations,visitors,services}.md`
- Skill: pytest-patterns

### Task Description
**Files:**
- Modify: `backend/src/services/master.py`, `material.py`, `location.py`, `visitor.py`, `service.py` — `search_fields` declarations
- Modify: `backend/src/api/v1/masters.py`, `materials.py`, `locations.py`, `visitors.py`, `services.py` — list endpoints gain `q: str | None = Query(None, min_length=2, max_length=100)` + forward
- Modify: `backend/tests/generic_contract.py` — add search configs for the 5 entities

**Field declarations (spec §5.2, locked):**
- `MasterService`: `[SearchField(Master.first_name), SearchField(Master.last_name), SearchField(Master.id, kind="uuid")]`
- `MaterialService`: `[SearchField(Material.title), SearchField(Material.description), SearchField(Material.id, kind="uuid")]`
- `LocationService`: `[SearchField(Location.name), SearchField(Location.short_title), SearchField(Location.address), SearchField(Location.description), SearchField(Location.id, kind="uuid"), SearchField(Location.yandex_map_url, kind="exact"), SearchField(Location.review_url, kind="exact"), SearchField(Location.image_url, kind="exact")]` — verify field names against `src/models/location.py` first; if a URL field doesn't exist on the model, STOP and report (spec locked the matrix — mismatch = spec bug).
- `VisitorService`: `[SearchField(Visitor.name), SearchField(Visitor.id, kind="uuid")]`
- `ServiceService`: `[SearchField(Service.title), SearchField(Service.description), SearchField(Service.id, kind="uuid")]` — its custom `list` (service.py:43-74) delegates to `ArchiveRepository.list`; add `q` param and forward alongside `options`.

**Steps:**
- [ ] RED — extend each entity's `EntityConfig` with `search_override`/`search_query` (Cyrillic values, one per declared substring field where practical — at minimum one field per entity; per-field coverage for multi-field entities via repeated rows: e.g. masters first_name AND last_name each match). Matrix auto-runs per config.
- [ ] GREEN — service declarations + router params (pattern from Task 4's tags).
- [ ] Locations-specific: add a non-parametrized test — full URL pasted into `q` finds the location (exact kind); partial URL does not.
- [ ] `uv run pytest tests/test_generic_api_contract.py -q` → green; full backend suite green.
- [ ] Commit: `feat(backend): list ?q= for masters/materials/locations/visitors/services (GH #212)`

---

## Task 6: Clients — atomic `search`→`q` rename + email + `GET /clients/get?phone=` (cross-layer)
### Classification: large
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.2, §5.3 point 3/5, §5.5 point 4 (audit), §7 endpoint cases
- `docs/domain-rules/clients.md`
- Skills: pytest-patterns, vitest-playwright-patterns

### Task Description
ATOMIC across backend + api-client + frontend + tests in ONE commit (unknown params are silently ignored — a staged rename fails silently).

**Files — backend:**
- Modify: `backend/src/schemas/client.py` — `ClientListParams`: rename field `search` → `q` with validation `Field(default=None, min_length=2, max_length=100)` (line 101)
- Modify: `backend/src/services/client.py` — `list_clients_with_stats`: replace the hand-rolled search block (lines 157-164) with the shared helper applied to BOTH `query` and `count_query`:

```python
    if params.q:
        pred = search_predicate(params.q, ClientService.search_fields)
        query = query.where(pred)
        count_query = count_query.where(pred)
```

- Modify: `backend/src/services/client.py` — add to `ClientService`:

```python
    search_fields = [
        SearchField(Client.name),
        SearchField(Client.phone),
        SearchField(Client.email),
        SearchField(Client.id, kind="uuid"),
    ]
```

- Modify: `backend/src/api/v1/clients.py` — rename the route at lines 45-61: `@router.get("/get", response_model=ClientResponse)`, function `get_client_by_phone`; docstring "Get an active client by exact phone (GH #212; was /clients/search)"; body unchanged (`phone: Query(..., min_length=3)`, 404 CLIENT_NOT_FOUND, status=active via `service.list(phone=…)`). Keep the route in the same position (before `/{client_id}`).
- Backend tests to update (rename URL `/clients/search` → `/clients/get`, enumerated at panel): `tests/test_api_clients.py` (:152,:159,:173,:175,:188,:388-410,:417-476), `tests/test_coverage_boost.py` (:528-541), `tests/test_edge_cases.py` (:210,:222), `tests/test_integration_flows.py` (:25,:334-360). Update `search=` param usages in client list tests to `q=` (`tests/test_client_stats.py` search section + any in `test_api_clients.py`).
- New backend contract tests (add to `test_client_stats.py` search section): q matches email; q len 1 / q="" → 422; full-UUID q → exact client; partial id → no match; q + status/stats filters combined; total-after-q correct; archived client + q under default status → not returned; `GET /clients/get` exact→200, partial phone→404, archived→404, `phone=""`/len<3→422; route-shadowing: `GET /clients/get` hits the phone route and `GET /clients/<uuid>` still hits the by-id route; **old `search` param now ignored** (200 unfiltered) — pins the rename.

**Files — api-client:**
- Modify: `packages/api-client/src/endpoints.ts` — rename `searchClientByPhone` → `getClientByPhone`, URL `/api/v1/clients/get?phone=` (lines 487-492). Delete the old name (no alias).
- Modify: `packages/api-client/src/endpoints.test.ts` — rename the describe block (:614-623), assert new URL (`/api/v1/clients/get?phone=`, encoding preserved) **and add a 404 → ApiError assertion** for `getClientByPhone` (spec §10's explicit ask; mirror the existing 404 pattern in `client.test.ts:23-35`).

**Files — frontend:**
- Modify: `frontend/admin/contexts/ClientsContext.tsx` (~lines 103-113) — replace the blind `...filters` spread in `queryFn` with explicit mapping (the `search` key must no longer reach the wire):

```ts
      queryFn: () =>
        getClientsWithStats({
          page,
          per_page: perPage,
          sort_by: sortBy,
          sort_order: sortOrder,
          ...filters,
          q: filters.search.length >= 2 ? filters.search : undefined,
          search: undefined, // renamed server-side to q (GH #212)
        }),
```

(Keep the `ClientFilters.search` state field name — UI-facing, minimal churn. `getClientsWithStats` drops undefined/'' values already.)
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx:4,40` and `frontend/admin/hooks/useRecordMutations.ts:9,90` — import/call `getClientByPhone`.
- Frontend tests: rename `searchClientByPhone` mocks → `getClientByPhone` in `__tests__/ActivityDetailsModal.test.tsx:35,48,450`, `__tests__/ClientTab.integration.test.tsx:27`; update ClientsContext tests asserting the fetch params (`search` → `q`, incl. the ≥2 clamp: 1-char search sends no `q`).

**Steps:**
- [ ] Grep-audit FIRST (mandatory, spec §5.5 point 4): `rg "searchClientByPhone" --type ts --type tsx` repo-wide and `rg "clients/search" backend/tests frontend packages` — enumerate every hit; all must be covered by this task. Also `rg "search:" frontend/admin/contexts frontend/admin/app` and check each `getClientsWithStats` caller.
- [ ] RED backend tests (rename + new contract cases) → run, watch `/clients/search` 404s / new cases fail.
- [ ] GREEN backend (schema rename, helper, route rename).
- [ ] api-client rename + test.
- [ ] Frontend mapping + consumer renames; run `cd frontend/admin && npm run test` and `cd packages/api-client && npm test`.
- [ ] Full backend suite green; admin vitest green; `tsc` clean in admin + api-client.
- [ ] Commit: `feat: clients list search→q rename + email field + /clients/get phone lookup (GH #212)`

---

## Task 7: Records backend search (client fields + service title via outer joins)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.2 (records row), §5.3 point 3, §7 cases 11
- `docs/domain-rules/records.md`
- Skill: pytest-patterns

### Task Description
**Files:**
- Modify: `backend/src/schemas/record.py` — `RecordListParams` gains `q: str | None = Field(default=None, min_length=2, max_length=100)` (after line 138)
- Modify: `backend/src/services/record.py` — `RecordService.list` (lines 41-83) + `search_fields` declaration
- Modify: `backend/tests/test_api_records.py` — new search contract block

**Steps:**
- [ ] Declare on `RecordService`:

```python
    search_fields = [
        SearchField(Client.name),
        SearchField(Client.phone),
        SearchField(Client.email),
        SearchField(Service.title),
        SearchField(Record.id, kind="uuid"),
    ]
```

- [ ] In `list`, when `params.q` present, add joins BEFORE the predicate (LEFT OUTER — `client_id` nullable; Service outer for uniformity; joins only when q present — default plan unchanged):

```python
        if params.q:
            stmt = (
                stmt.outerjoin(Client, Record.client_id == Client.id)
                    .outerjoin(Service, Activity.service_id == Service.id)
                    .where(search_predicate(params.q, self.search_fields))
            )
```

(imports: `Client` and `Service` are already imported in record.py (used by `_sort_columns`); add only `search_predicate` + `SearchField`.)
- [ ] RED→GREEN contract tests in `test_api_records.py`: substring match per field (client name / client phone / client email / service title); full-UUID q → the record; partial id → no match; q len 1 → 422; q + location_id/service_id/master_id/status/date filters combined; total-after-q; **record with NULL client_id**: found when searching its service title, absent when searching a client name, no error either way; Cyrillic client name found by lowercase query.
- [ ] `uv run pytest tests/test_api_records.py -q` green; full backend suite green (watch `test_record_list_params.py` — add a q schema-param case there too).
- [ ] Commit: `feat(backend): records list ?q= via outer joins (GH #212)`

---

## Task 8: Activities backend — `q` + `service_id` filter + `service_title` in list responses
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.2 (activities row), §5.3 point 7 (optional field reasoning), §7 case 12
- `docs/domain-rules/activities.md`
- Skill: pytest-patterns

### Task Description
**Files:**
- Modify: `backend/src/schemas/activity.py` — `ActivityResponse` gains `service_title: str | None = None` (OPTIONAL — schema is shared by all 5 activity endpoints; single-item endpoints leave it None)
- Modify: `backend/src/services/activity.py` — `ActivityService.list` (lines 40-52): new params `q: str | None = None, service_id: str | None = None`; both paths apply them; populate `service_title` on list items
- Modify: `backend/src/api/v1/activities.py` — list endpoint gains `q` + `service_id` scalar params
- Modify: `backend/tests/test_api_activities.py` + `backend/tests/test_list_activities_query_count.py`

**Steps:**
- [ ] Declare: `ActivityService.search_fields = [SearchField(Service.title), SearchField(Activity.id, kind="uuid")]`.
- [ ] Rework the list override (both paths funnel through one stmt builder). Imports: add `from src.models.service import Service` (not imported today) and `search_predicate`/`SearchField`:

```python
    async def list(self, db_session, page=1, per_page=20, date_from=None, date_to=None,
                   q: str | None = None, service_id: str | None = None, **filters):
        stmt = select(Activity)
        for key, value in filters.items():  # equality filters, same as the old super().list path
            if value is not None:
                stmt = stmt.where(getattr(Activity, key) == value)
        from_dt, to_dt = day_range(date_from, date_to)
        if from_dt is not None:
            stmt = stmt.where(Activity.start >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.start <= to_dt)
        if service_id is not None:
            stmt = stmt.where(Activity.service_id == service_id)
        if q is not None:
            stmt = stmt.join(Service, Activity.service_id == Service.id).where(
                search_predicate(q, self.search_fields)
            )
        items_orm, total = await self._repository.list_custom(
            db_session, stmt, limit=per_page, offset=(page - 1) * per_page
        )
        items = [ActivityResponse.model_validate(a) for a in items_orm]
        await self._populate_service_titles(db_session, items, items_orm)
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

(`_list_by_date` is absorbed — update/delete its callers accordingly. The router's occupied post-mapping is untouched.)

`_populate_service_titles` — ONE bounded bulk query (keeps query-count bounded):

```python
    async def _populate_service_titles(self, db_session, items, items_orm) -> None:
        if not items:
            return
        rows = await db_session.execute(
            select(Activity.id, Service.title)
            .join(Service, Activity.service_id == Service.id)
            .where(Activity.id.in_([a.id for a in items_orm]))
        )
        titles = {row[0]: row[1] for row in rows.all()}
        for item in items:
            item.service_title = titles.get(item.id)
```

- [ ] Router: add `q: str | None = Query(None, min_length=2, max_length=100)` and `service_id: str | None = Query(None)`, forward both.
- [ ] RED→GREEN tests (`test_api_activities.py`): q by service title (Cyrillic case pin); full-UUID q → the activity; q + service_id combined; q + date range combined; q len 1 → 422; **`service_title` present and non-null in every list item** (both with and without q); single-item `GET /activities/{id}` still 200 with `service_title: null`. Update `test_list_activities_query_count.py` expected count (+1 bounded titles query) and **add a q-path variant** of the query-count assertion (spec §5.3 point 7: both paths stay bounded) — assert bounded, not unbounded.
- [ ] Full backend suite green.
- [ ] Commit: `feat(backend): activities list ?q= + service_id filter + service_title (GH #212)`

---

## Task 9: api-client — `q` params + activities signature (additions only, no deletions)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.5 point 1
- `packages/api-client` test conventions (endpoints.test.ts)

### Task Description
**Files:**
- Modify: `packages/api-client/src/endpoints.ts` + `packages/api-client/src/schemas.ts` + `packages/api-client/src/endpoints.test.ts`

**Steps:**
- [ ] `ListParams` gains `q?: string` (doc: "Server-side search (GH #212); min 2 chars server-enforced"); `listQuery` serializes it:

```ts
  if (params?.q) search.set('q', params.q);
```

- [ ] `getRecords` params type gains `q?: string`; builder adds `if (params?.q) search.set('q', params.q);`
- [ ] `getActivities` — relax dates to optional and add new params:

```ts
export async function getActivities(params: {
  date_from?: string;
  date_to?: string;
  service_id?: string;
  q?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<ActivityResponse>> {
  const search = new URLSearchParams();
  if (params.date_from) search.set('date_from', params.date_from);
  if (params.date_to) search.set('date_to', params.date_to);
  if (params.service_id) search.set('service_id', params.service_id);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/activities${qs ? `?${qs}` : ''}`, ActivityListResponseSchema);
}
```

(Fix existing callers if any relied on positional/required dates — grep getActivities call sites; the schedule/records callers pass dates explicitly and keep working.)
- [ ] `ActivityResponseSchema` gains `service_title: z.string().nullable().optional()` (schemas.ts:164-178 region).
- [ ] Tests: `q` serialization for listQuery/getRecords/getActivities; optional-dates call; service_title parsing (present-null/absent-safe).
- [ ] `cd packages/api-client && npm test` green; `npm run typecheck` (or tsc script — follow package.json) clean.
- [ ] Commit: `feat(api-client): q params + relaxed getActivities signature (GH #212)`

---

## Task 10: Factory `serverSearch` flag + ≥2 clamp (post-#139)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.5 point 2
- `docs/specs/2026-08-18-generic-datatable-design.md` §6.4, §6.7 — the post-#139 factory contract this extends
- Skill: vitest-playwright-patterns

### Task Description
**VERIFY FIRST (post-#139 grounding):** read the merged `frontend/admin/contexts/createPagedListContext.tsx` — #139 adds optional `search`/`setSearch` + a predicate-only client filter + page-clamp. This task adds the server path; if #139's merged shape diverges from its spec, adapt and note it in the report.

**Files:**
- Modify: `frontend/admin/contexts/createPagedListContext.tsx`
- Modify: `frontend/admin/__tests__/createPagedListContext.test.tsx`

**Steps:**
- [ ] `PagedListConfig` gains `serverSearch?: boolean` (default false). `PagedListFetcherParams` gains `q?: string`.
- [ ] When `serverSearch` is on: `q` (the debounced context `search` value, clamped) joins the query key and the fetcher call; the client-side predicate is bypassed (`visibleItems === items`); `setSearch` resets page→1. Clamp: only fire when length ≥ 2:

```ts
const q = serverSearch && search.length >= 2 ? search : undefined;
// queryKey: [prefix, page, perPage, status?, sortBy, sortOrder, ...(serverSearch ? [q ?? ''] : [])]
// fetcher: fetcher({ page, per_page: perPage, ...(sortBy ? {...} : {}), ...(withStatus ? {status} : {}), ...(q ? { q } : {}) })
```

- [ ] RED→GREEN unit tests in `createPagedListContext.test.tsx`: q in query key + fetcher params when serverSearch on; 1-char search does NOT fire with q (treated as unset); empty search no q; page resets to 1 on search change; predicate NOT applied when serverSearch on (visibleItems === items); serverSearch off → #139 predicate behavior unchanged (existing tests pin this).
- [ ] `cd frontend/admin && npm run test` green.
- [ ] Commit: `feat(admin): serverSearch flag on paged-list factory (GH #212)`

---

## Task 11: Dictionary tables → server search (+ Tags) + suite rewrites + masters e2e upgrade
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.5 point 3, §6 S1, §10
- `docs/specs/2026-08-18-generic-datatable-design.md` §6.1/§6.7 — post-#139 search-state ownership
- Skill: vitest-playwright-patterns

### Task Description
**Files (post-#139 shapes — verify at IMPL):**
- Modify: the 5 dict contexts `frontend/admin/contexts/{TagsContext,LocationsContext,MastersContext,ServicesContext,MaterialsContext}.tsx` — add `serverSearch: true` to the factory config; DELETE the per-entity client-filter predicate config (#139's predicate-only mechanism becomes dead for these 5 — the #205 "temporary degradation" ends here)
- `*Filters` bars and Tags' DataTable `withSearch` input: NO visual changes (they read `search`/`setSearch` from context either way)
- Rewrite the client-side search tests (post-#139 suite structure applies; locate current tests by grepping for `client-side` / `.includes` assertions):
  - `__tests__/tags/TagsTable.test.tsx` (:164 area), `__tests__/LocationsTable.test.tsx` (:300,:312,:324), `__tests__/MastersTable.test.tsx` (:310,:322), `__tests__/MaterialsTable.test.tsx` (:245,:257), `__tests__/ServicesTable.test.tsx` (:340,:352)
- Modify: `frontend/admin/e2e/masters-crud.spec.ts` — upgrade the "search filter works" test

**Rewrite pattern per suite (old:** type text → client filter hides rows; **new):**

```tsx
it('searches server-side via ?q=', async () => {
  setupEnvelope();
  await renderLoaded();
  fireEvent.change(<search input locator>, { target: { value: 'масл' } });
  // advance past debounce (fake timers or waitFor, per suite convention)
  await waitFor(() =>
    expect(mockGet<Entity>).toHaveBeenCalledWith(expect.objectContaining({ q: 'масл' }))
  );
  // rows render exactly what the server returned (no client filtering):
  // setupEnvelope's items stay visible regardless of text match
});

it('resets search and refetches without q', async () => { /* click Сбросить / ✕ → last fetch has no q */ });

it('does not fire on 1 char', async () => { /* type 'м' → no fetch with q */ });
```

**Steps:**
- [ ] RED: rewrite the 5 suites' search tests (server-q semantics above) → watch them fail against predicate behavior.
- [ ] GREEN: flip the 5 context configs.
- [ ] E2E — `masters-crud.spec.ts` "search filter works": create 2 masters via API (one with a unique Cyrillic marker in last_name, e.g. "Поискуников"), set page size small / ensure the match is beyond the loaded page if the suite already paginates; type the marker → assert ONLY the matching row visible and the pager reflects total 1 (scenario 1: cross-page match + honest total).
- [ ] `npm run test` green; e2e masters spec green (`npm run test:e2e -- masters-crud` per dev-workflow).
- [ ] Commit: `feat(admin): dictionary tables search server-side via ?q= (GH #212)`

---

## Task 12: Records filter bar gains a search input (+ context wiring + e2e)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.5 point 5, §6 S2, §7 (records cases)
- `docs/specs/2026-08-18-generic-datatable-design.md` §6.4 — RecordsContext aligned shape
- `docs/domain-rules/records.md`
- Skill: vitest-playwright-patterns

### Task Description
The ONLY new visual element in this feature. Post-#139 grounding: `RecordsContext` was aligned to `PagedListState` — adapt names if the merged shape differs.

**Files:**
- Modify: `frontend/admin/contexts/RecordsContext.tsx` — `RecordFilters` gains `search: string` (default `''`); queryFn passes `q: filters.search.length >= 2 ? filters.search : undefined` to `getRecords`; `setFilters` already resets page→1 (verify; add if missing for search changes)
- Modify: `frontend/admin/app/(main)/records/components/BookingFilters.tsx` — new leading field (props gain `search: string` + `onSearchChange: (v: string) => void`; wire in the page exactly like the other filters):

```tsx
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Поиск</label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Клиент или услуга..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Поиск по клиенту или услуге"
        />
      </div>
```

Debounce 300ms — follow the post-#139 convention: if the merged codebase has a shared debounce hook (ClientsFilters has a local `useDebouncedCallback`), reuse that pattern; reset button clears search too.
- Modify: records page wiring (`app/(main)/records/page.tsx`) to pass the new props.
- Tests: `__tests__/RecordsTable.test.tsx` / context tests — add: typing ≥2 chars → `getRecords` called with `q`; 1 char → no `q`; combines with existing filters (objectContaining both); reset clears.
- E2E: `e2e/records.spec.ts` — new test (scenario 2): seed two records (different clients, same location), set location filter, type client-name fragment → only the matching record row visible; pager total reflects filter.

**Steps:**
- [ ] RED unit tests (context + filter bar) → fail.
- [ ] GREEN implementation.
- [ ] E2E RED→GREEN.
- [ ] `npm run test` green; records e2e green; `npm run test:all` before reporting (UI change).
- [ ] Commit: `feat(admin): records table search input (server ?q=) (GH #212)`

---

## Task 13: PhotoModal typeaheads → list `?q=` + SearchableSelect ≥2 clamp
### Classification: standard
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.5 point 6 (parity table), §6 S5/S7, §7 case 12
- Skill: vitest-playwright-patterns

### Task Description
**Files:**
- Modify: `frontend/admin/app/components/shared/SearchableSelect.tsx:95` — clamp `if (q.length < 1)` → `if (q.length < 2)`
- Modify: `frontend/admin/app/(main)/photos/components/PhotoModal.tsx` (lines 7, 79-91, 95-141) — replace the 4 `search*` imports/calls with list getters
- Modify: `frontend/admin/__tests__/SearchableSelect.test.tsx`, `__tests__/PhotoModal.test.tsx`

**Typeahead mapping (PhotoModal):**

```ts
import { getVisitors, getServices, getActivities, getTags } from '@memo/api-client';

// visitors (display name, subtitle age):
const searchVisitorsFn = async (q: string) =>
  (await getVisitors({ q, per_page: 10 })).items;

// services (active-only by default status — parity with the old is_active filter):
const searchServicesFn = async (q: string) =>
  (await getServices({ q, per_page: 10 })).items;

// tags:
const searchTagsFn = async (q: string) =>
  (await getTags({ q, per_page: 10 })).items;

// activities — formats ISO start for display BEFORE handing to SearchableSelect
// (it renders raw field values); preserves the service_title/start display switch
// and the service_id auto-fill on select:
const searchActivitiesFn = (selectedServiceId: string | null) => async (q: string) => {
  const res = await getActivities({ q, service_id: selectedServiceId || undefined, per_page: 10 });
  return res.items.map((a) => ({
    ...a,
    start: formatActivityStart(a.start), // ISO → "HH:mm dd.mm.yyyy"
  }));
};
```

`formatActivityStart`: check `frontend/admin/lib/utils.ts` for an existing datetime formatter (e.g. used for record/activity display) and reuse it; if none formats "HH:mm dd.mm.yyyy", add:

```ts
export function formatActivityStart(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
```

with a unit test. (Verify against an existing util first — do not duplicate.)

**Steps:**
- [ ] RED — test updates: `SearchableSelect.test.tsx:49-71` 1-char assertions → assert NO call below 2 chars, call at 2; `PhotoModal.test.tsx` mocks switch from `searchVisitors/searchServices/searchActivities/searchTags` to `getVisitors/getServices/getActivities/getTags` (return PaginatedResponse envelopes); update any exact item-shape assertions (list responses carry extra fields); assert the activities onSearch passes `service_id` from formData and formats `start`; assert visitors subtitle (`age`) still renders.
- [ ] GREEN — implementation above.
- [ ] `npm run test` green; `tsc` clean; `npm run test:all` (UI touched).
- [ ] Commit: `feat(admin): PhotoModal typeaheads on list ?q=; SearchableSelect ≥2 clamp (GH #212)`

---

## Task 14: Delete the `/api/v1/search/*` router + old api-client search fns; move the M5 probe
### Classification: small
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §5.3 point 6, §4.4

### Task Description
Precondition: Tasks 6 + 13 merged in this branch (no consumers remain).

**Files:**
- Delete: `backend/src/api/v1/search.py`, `backend/src/schemas/search.py`, `backend/tests/test_api_search.py`, `backend/tests/test_schemas_search.py`
- Modify: `backend/src/main.py` — remove the search router import + mount (line ~151)
- Modify: `backend/tests/test_cyrillic_search_probe.py` — retarget the probe from `/api/v1/search/visitors` to `GET /api/v1/visitors?q=иван` (assert `items[0]["name"]` / total 1)
- Modify: `packages/api-client/src/endpoints.ts` — delete `searchVisitors/searchServices/searchActivities/searchTags` (lines 731-747) + the section header; `packages/api-client/src/schemas.ts` — delete the 4 `*SearchResult` schemas (lines 487-514); remove any remaining exports from the package index/barrel
- Grep-verify zero references remain: `rg "search/visitors|search/services|search/activities|search/tags|searchVisitors|searchServices|searchActivities|searchTags|SearchResult" backend frontend packages`

**Steps:**
- [ ] Grep-verification first (output goes in the report).
- [ ] Delete + unmount + retarget probe.
- [ ] Full backend suite green (tags gap now covered by the Task 4/5 matrix — verify `pytest -k Search` count); api-client + admin suites green; `tsc` clean both packages.
- [ ] Commit: `chore: delete /api/v1/search/* router after list ?q= migration (GH #212)`

---

## Task 15: Clients UUID-paste e2e (scenario 3, #216 pre-flight)
### Classification: small
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §6 S3, §5.6
- Skill: vitest-playwright-patterns (Full Cycle e2e pattern)

### Task Description
**Files:**
- Modify: `frontend/admin/e2e/clients.spec.ts` — new test

**Steps:**
- [ ] New e2e test: create a client via API; on the clients page paste the client's FULL UUID into the search box; wait past debounce → exactly one row (that client), pager total 1. Add a second assertion: paste a 10-char fragment of the id → no rows via id-match (the client disappears unless its name/phone/email happens to contain the fragment — choose fixture data so it doesn't).
- [ ] RED→GREEN (green already if Tasks 6/10-12 landed correctly — write as verification).
- [ ] Commit: `test(e2e): clients full-UUID search (#216 pre-flight) (GH #212)`

---

## Task 16: Domain-rules sync
### Classification: small
### Required Docs
- `docs/specs/2026-08-19-list-search-q-design.md` §9 (exact edit list)
- `docs/domain-rules/_overview.md`

### Task Description
**Files:** `docs/domain-rules/{clients,records,masters,materials,services,tags,locations,visitors,activities}.md`, `docs/domain-rules/_overview.md`

**Steps:**
- [ ] Per entity add/refresh a "Search (server `?q=`, GH #212)" block: declared substring/exact fields, param contract (min 2 / max 100 / full-UUID id-exact / 422 / count consistency). Entity-specific:
  - clients.md — `search`→`q` rename (update lines ~25, ~30, ~45, ~70, ~84 area), email added to searchable fields, `/clients/search` → `/clients/get?phone=` (exact, 404, active-only).
  - records.md — add `q` row to the list-contract param table; fields client.name/phone/email + service.title + id; update phone-blur wording to `getClientByPhone`.
  - masters/materials/services/tags/locations.md — replace the "until #212" search-matrix bullets with the delivered contract + field lists.
  - visitors.md, activities.md — add search sections (visitors: name + id; activities: service.title + id, `service_id` filter param, `service_title` in list responses).
  - _overview.md — cross-entity `q` invariant entry; keep the phone-search exact-match invariant (updated route name).
- [ ] Commit: `docs: sync domain-rules with list ?q= search (GH #212)`

---

## Self-Review Notes (architect)
- **Spec coverage:** §5.1 contract → T2/T3/T4+matrix; §5.2 matrix → T4/T5/T6/T7/T8 declarations; §5.3 architecture → T2/T3/T4/T6/T7/T8/T14; §5.4 M5 → T1 (+T14 probe retarget); §5.5 frontend → T6/T9/T10/T11/T12/T13; §5.6 #216 → T15; §5.7 order → task order; §7 matrix → T3/T4/T5/T6/T7/T8 + T1; §9 docs → T16; §10 tests → per-task; §11 visual → T12 is the only new element (visual gate at phase level).
- **No schema/migration tasks** — no model fields added (service_title is computed, not stored).
- **Order rationale:** backend foundation (T1-T5) → atomic clients rename (T6) → records/activities backend (T7-T8) → api-client (T9) → frontend wiring (T10-T13) → deletions last (T14) → e2e pre-flight (T15) → docs (T16).
