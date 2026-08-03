# Design: GH #185 — GenericService: HTTP-level contract for full CRUD + test_api_*.py dedup

- **Issue:** GH #185
- **Type:** Test refactor + coverage extension (tests + docs only, **no production code changes**)
- **Date:** 2026-08-03 (rev 2 — spec-panel round 1 fixes: response_model blind-spot correction D12, Activity 404 fallback D13, list-contract restoration D14, pagination-params disposition, datetime serialization D11, ADR template format)
- **Concept:** approved at G1a 2026-08-03; **user decision:** HTTP contract = end-to-end test through TestClient + test SQLite, NOT a mocked service layer → recorded as **ADR 006** (§3.6)
- **Refs:** #175 / PR #181 (patch contract pattern), #182 (paginated list form), #183 (GET /tags/{id}, GET /api/v1/visitors — both confirmed present), #184 / PR #199 (service-level CRUD contract — parametrization model + EntityConfig), #194 (deletion policy)
- **Prior spec:** `docs/specs/2026-08-03-generic-service-crud-contract-design.md` (#184 — sibling contract at service level)

---

## 1. Problem

After #182–#184, the **service layer** has a full parametrized CRUD contract (`backend/tests/services/test_generic_service_contract.py`, 8 entities). The **HTTP layer** does not: statuses, response schemas, router wiring (prefix mount, DI binding, `response_model` per route) and per-entity 404 error codes are verified by ~1,010 lines of **hand-duplicated** per-entity tests across 8 `backend/tests/test_api_*.py` files (measured, §3.4). Consequences:

- Adding a new generic entity = copy-pasting ~110 lines of identical HTTP CRUD tests.
- A wiring break (router not mounted in `main.py`, `response_model` narrowed or leaking extra fields, POST returning 200 instead of 201, DELETE returning 200 instead of 204, wrong `<ENTITY>_NOT_FOUND` code) is caught only per-entity, by accident of duplication — and a **new** entity gets no wiring coverage until someone copies the tests. (One honest blind spot: a `response_model=` kwarg dropped without changing the route's return value is undetectable at the body level — services return already-validated schema instances; see §3.2 self-guard.)
- The #175 patch dedup left one PATCH wiring test per entity (404 + error code) — the same class of generic HTTP assertion, still scattered per-entity.

**What the HTTP layer adds over the service contract** (why a second contract file is not redundant): the service contract pins *business semantics* (return values, soft/hard delete, is_active stickiness). It cannot see: URL prefixes, HTTP status codes, `response_model` filtering/validation, pagination query-param binding, error-body shape `{"detail": {"code", "message"}}` (ADR-005). That transport surface is exactly what this issue pins.

## 2. Contract under test (verified current behavior — this change locks it, does not alter it)

All 8 entities verified uniform at HTTP level (`backend/src/api/v1/*.py`, mounted in `src/main.py:139–153`):

| Endpoint | Status | Body |
|---|---|---|
| `POST {prefix}` | **201** | `<Entity>Response` JSON (schema-valid, `id` present, sent fields echoed) |
| `GET {prefix}/{id}` | **200** / **404** | `<Entity>Response` JSON / `{"detail": {"code": "<ENTITY>_NOT_FOUND", "message": ...}}` |
| `GET {prefix}` | **200** | envelope with **exactly** `{items, total, page, per_page}` — all 8, incl. Clients (`ClientListResponse` is field-for-field identical to `PaginatedResponse`, verified `schemas/client.py:91–97` vs `schemas/common.py:10–16`) and Visitors (#183) |
| `PUT {prefix}/{id}` | **200** / **404** | `<Entity>Response` JSON with changed fields / 404 error body |
| `DELETE {prefix}/{id}` | **204** / **404** | empty body / 404 error body |
| `PATCH {prefix}/{id}` nonexistent | **404** | 404 error body (wiring remnant from #175 — absorbed, D6) |
| `GET {prefix}?page=0` (or `per_page=0`) | **422** | validation error (uniform `Query(ge=1)`, verified incl. Clients `ClientListParams`) |

Entity matrix (verified):

| Entity | Prefix | 404 code | Delete semantics | Soft-delete HTTP visibility |
|---|---|---|---|---|
| Activity | `/api/v1/activities` | `ACTIVITY_NOT_FOUND` | hard | row gone: GET → 404, absent from list |
| Client | `/api/v1/clients` | `CLIENT_NOT_FOUND` | soft | GET → 200 `is_active: false`; list (default `status=active`) excludes; 2nd DELETE → 404 |
| Location | `/api/v1/locations` | `LOCATION_NOT_FOUND` | soft | same |
| Master | `/api/v1/masters` | `MASTER_NOT_FOUND` | soft | same |
| Material | `/api/v1/materials` | `MATERIAL_NOT_FOUND` | soft | same |
| Payment | `/api/v1/payments` | `PAYMENT_NOT_FOUND` | hard | row gone |
| Tag | `/api/v1/tags` | `TAG_NOT_FOUND` | hard | row gone (GET /tags/{id} from #183 confirmed, `tags.py:37`) |
| Visitor | `/api/v1/visitors` | `VISITOR_NOT_FOUND` | hard | row gone |

Notes:
- **Tag PUT body is `TagCreate`** (no `TagUpdate` exists) — already reflected in `CONTRACT_CONFIG` (`update_schema = TagCreate`).
- Soft-delete HTTP visibility mirrors the #184 user-directed semantics: *list hides, get returns* — here pinned at transport level.
- Contract tests **never** pass entity-specific query params (`date_from/date_to`, `status`, `record_id`, client search filters) — those stay per-entity (§3.4).

## 3. Design

### 3.1 Shared contract config extraction

Today `EntityConfig` + `CONTRACT_CONFIG` + discovery helpers live inside `backend/tests/services/test_generic_service_contract.py`. The HTTP contract must parametrize over the **same** 8 entries (one config entry per entity → both service-level and HTTP-level coverage; guard tests already fail on unconfigured subclasses).

- Extract to a shared module `backend/tests/generic_contract.py` (exact name/path finalized in plan, matching suite import conventions — `tests/` is a package, `tests.*` absolute imports already used in the suite): `EntityConfig`, `CONTRACT_CONFIG`, `GENERIC_CONTRACT_EXCEPTIONS` (the shared `_contract_params` filters on it), `_all_subclasses()`, `_contract_params()`, `_soft_params()`, **and the explicit per-service import block** (`test_generic_service_contract.py:18–29` — `__subclasses__()` discovery only sees imported modules; if the imports don't move, both contracts silently parametrize over zero entities). **`KNOWN_MISMATCHES` stays** in the service test file (used only by the service-level not-null guard).
- `test_generic_service_contract.py` imports from it; its test classes, fixtures (`make_entity`, `seed_rows`) and guard tests stay put and stay green — pure move, no behavior change.
- **EntityConfig gains 3 fields** (HTTP-only; service contract ignores them). **Required, no defaults, inserted before `unique_row_field`** (NamedTuple ordering rule — a defaulted field must be last; D16): a future 9th entity configured without HTTP data must fail loudly at import, not silently skip HTTP coverage.

| Field | Type | Semantics |
|---|---|---|
| `router_prefix` | `str` | e.g. `"/api/v1/masters"` |
| `not_found_code` | `str` | e.g. `"MASTER_NOT_FOUND"` — explicit, NOT derived: the obvious derivation rule (`segment.rstrip('s').upper() + "_NOT_FOUND"`) breaks on `activities` → `"ACTIVITIE"` (D15) |
| `response_schema` | `type` | `<Entity>Response` class — `model_validate()` pins response shape/values on POST/GET/PUT bodies and list items (Pydantic v2 ignores extra keys, so `ClientWithStats` extras are tolerated). **Limit:** it cannot detect a dropped `response_model=` kwarg (services return validated instances → byte-identical body); shape drift IS caught by the exact key-set assertions (D12) |

### 3.2 New file: `backend/tests/test_generic_api_contract.py`

- **Sync-only**: `api_client` (session-scoped TestClient, `conftest.py:100`) + `reset_db` autouse truncation; **no `db_session`, no `query_db`** — every assertion goes through HTTP (D3). FK parents resolved via `fk_map` fixture names, which match the conftest API factories exactly (`create_master`, `create_service`, `create_location`, `create_client`, `create_record`) — parents are created **through the API too**, keeping the test end-to-end.
- **No multi-row seeding** (D4): list tests create at most one row; deep pagination slicing is a service-level concern already pinned by #184. `unique_row_field` unused here.
- **Payload construction** adapts the #184 rule to the HTTP boundary (D11): `{**create_data, **resolved_fks, **update_data}` filtered to `update_schema.model_fields`, then **JSON-serialized** (`datetime` → `.isoformat()` — Activity `start` is a raw `datetime` in `create_data`; `json=payload` raises `TypeError` otherwise). Field-match assertions compare **typed values through the validated response model** (`response_schema.model_validate(body)`), never raw JSON strings against Python objects. Create/update field-match includes the **`fk_map` keys** (response FK == parent id — the removed per-entity tests asserted this; `model_validate` catches a missing FK but not a wrong value).
- Every test class opens with `assert cfg is not None` (MISSING-CONFIG guard, same as the service contract — an unconfigured subclass fails with the guard message, not `AttributeError`).

| Class | Tests (each parametrized ×8 unless noted) | Contract asserted |
|---|---|---|
| `TestGenericApiCreateContract` | `test_create_returns_201_with_fields_matching_payload` | one POST, labeled asserts: **201**; **exact body key set** == `response_schema.model_fields` keys (D12); typed field-match for `create_data` + `fk_map` values |
| `TestGenericApiGetContract` | `test_get_returns_created_entity`; `test_get_nonexistent_returns_404_with_entity_code` | create → GET → 200, exact keys, typed field-match (incl. FKs); GET `/nonexistent` → 404 + `detail.code == not_found_code` |
| `TestGenericApiListContract` | `test_list_envelope_exact_keys_and_defaults`; `test_list_contains_created_and_counts_total`; `test_list_explicit_pagination_echoed`; `test_list_invalid_params_returns_422`; `test_list_empty_state` | bare GET → 200, **exact** envelope keys `{items,total,page,per_page}`, `page==1`, `per_page==20` (default-drift lock); create → id in `items`, **`total == 1`** (not `≥ 1` — `reset_db` guarantees empty start), found item `model_validate`d (extras ignored); `?page=1&per_page=5` → `page==1`, `per_page==5` (Query binding); `?page=0` / `?per_page=0` / **`?per_page=101`** → 422 (`ge=1` + **`le=100` cap** — restores the pagination-params coverage, D14); fresh DB → `items==[]`, `total==0` |
| `TestGenericApiUpdateContract` | `test_update_returns_200_and_changed_fields`; `test_update_nonexistent_returns_404_with_entity_code` | create → PUT (serialized payload) → 200, exact keys, `update_data` typed field-match; nonexistent → 404 + code |
| `TestGenericApiDeleteContract` | `test_delete_returns_204`; `test_delete_nonexistent_returns_404_with_entity_code`; `test_delete_soft_visibility` (soft ×4); `test_delete_hard_visibility` (hard ×4); `test_delete_soft_second_delete_returns_404` (soft ×4) | 204 empty body; 404 + code; soft: GET → 200 `is_active is False` **and** absent from list `items` (labeled asserts); hard: GET → 404 **and** absent from list; soft 2nd DELETE → 404 |
| `TestGenericApiPatchWiring` (D6) | `test_patch_nonexistent_returns_404_with_entity_code` | PATCH `/nonexistent` → 404 + code (absorbs the 8 per-entity #175 wiring remnants) |

**Estimated counts (panel-corrected):** **116 new parametrized cases** (create 8 + get 16 + list 40 + update 16 + delete 28 + patch-wiring 8) replacing ≈ **124** removed cases (≈100 per-entity + 24 pagination-params for the 6 generic endpoints) → net collected ≈ **−8**; backend suite ≈ 990p/5s → ≈ **985p/5s** (TestClient + SQLite truncation; ADR 006 records the cost decision).

**Wiring self-guard (no separate guard test needed) — panel-corrected, honest version:**
- **Unmounted prefix:** POST/GET-list on it return 404 → the create (expects 201) and list (expects 200) tests fail on status. The 404-code assertions catch it for **7 of 8** entities (default 404 body lacks their `code`); **Activity is the exception** — `main.py`'s `StarletteHTTPException` handler maps default 404s to `code=ACTIVITY_NOT_FOUND` via the legacy fallback (locked by `test_error_handlers.py:89–100`), so an unmounted activities router passes the code assertion and is caught by the status assertions instead (D13).
- **`response_model` narrowed** (a field dropped) → exact key-set / `model_validate` fails. **Extra fields leaked** → exact key-set fails. **Blind spot (documented):** a `response_model=` kwarg dropped while the route keeps returning the service's validated schema instance yields a byte-identical body — **no body-level test can catch it** (D12); the mutation in §5 uses the *narrowed* variant, which IS caught.
- **Status-code regression** (200-for-201, 200-for-204) → status assertions fail.

### 3.3 Patch-wiring absorption (D6 — flagged scope completion, G1b-vetoable)

#175 left one `test_patch_*_not_found*` wiring test in each of the 8 files (~5 lines each). They assert the same generic HTTP wiring this contract pins (404 + entity code). One parametrized test in `TestGenericApiPatchWiring` absorbs all 8. Without this, `test_api_tags.py` would survive holding a single 5-line test. **This adds PATCH to an otherwise CRUD-scoped issue — 8 test cases, ~15 lines; the user may veto at G1b** (veto = wiring tests stay per-entity, tags file keeps its 5 lines).

### 3.4 Per-entity dedup — disposition

Rule: categories (a) create-201, (b) get-200/404, (c) list-envelope, (d) put-200/404, (e) delete-204/404 + (P) patch-wiring are **removed** (now contract-covered). Entity-specific extras **remain**. Measured from the current suite (line ranges approximate, plan gets the exact per-test keep/remove table):

| File (lines) | Removed (categories a–e + P) | Kept extras |
|---|---|---|
| `test_api_activities.py` (334) | ≈116 | date filters `date_from/date_to`; `occupied=1` via DB insert; batch occupied N+1 (US-1/US-3) |
| `test_api_clients.py` (505) | ≈91 | `/search?phone` (+422s, case-insensitive, #195 archived regression); `GET /{id}/visitors` scoped route; create edge cases (empty body, name-only, phone-only, channels); invalid/null channel 422; PUT null-all/422; `ClientResponse`/`ClientWithStats` schema tests; #60 unknown-channel tolerance |
| `test_api_locations.py` (205) | ≈104 | `?status=` filter matrix (#195) |
| `test_api_masters.py` (194) | ≈96 | `?status=` filter matrix (#195) |
| `test_api_materials.py` (208) | ≈112 | `?status=` filter matrix (#195) |
| `test_api_payments.py` (320) | ≈102 | client-supplied `created_at` persistence/default-now; `GET /payments/totals` (multi-record, 422, deleted-excluded, #186 regression) |
| `test_api_tags.py` (120) | **all 120** | none — **file deleted** (the DB-level `query_db` row-gone assertion in `test_delete_tag` is intentionally not replicated at HTTP level — D3; ORM-level hard-delete is pinned by the service contract) |
| `test_api_visitors.py` (257) | ≈165 | create with null age; PATCH `client_id` immutability; scoped-route regression (`/clients/{id}/visitors` stays a bare array) — the kept test asserts the **2-visitor** scoped listing (absorbs the multi-row assertion of removed `:44`); the `GET /visitors` envelope/param tests (181–257) are generic now and removed |
| `test_api_pagination_params.py` (39) | ≈24 (6 generic endpoints × 4 cases drop out) | **services, records, visits** params stay — services/records are contract exceptions ("Untouched" below) and this file holds their ONLY pagination/422 coverage; clients/visitors were never in this file (panel correction: 6 generics, not 8) |

**Sizing validation vs concept:** concept estimated "per-entity files slim by ~500 lines (create/get/list ~300 + update/delete ~200)". Measured: gross removal ≈ **930** lines (generic CRUD ≈ 1,010 across the 8 files was measured), new contract file ≈ 550 + shared-config delta ≈ 30 → **net ≈ −350 lines** (orphaned local fixtures/imports cleanup may extend it modestly). The concept undercounted gross duplication (it is ~2× the estimate) but the net lands near the promised range.

**Untouched:** `test_api_services.py`, `test_api_photos.py`, `test_api_records.py` (contract exceptions — override semantics), `test_api_visits.py`, `test_api_user_settings.py` (standalone), `test_api_search.py`, `test_api_records_status_rejected.py`, all service-level and domain test files.

### 3.5 Non-goals

- **No production code changes** — tests + docs only. If the contract exposes an HTTP bug (wrong status, missing code, broken envelope), it is filed as a follow-up issue; tests are NOT bent to fit (precedent: #184 is_active directive).
- No PATCH semantics at HTTP level beyond the D6 wiring test (PATCH contract lives at service level, #175).
- No changes to excepted entities' API tests, no frontend changes, no api-client changes.
- No auth coverage (the API is unauthenticated in tests today — pinning that is out of scope).

### 3.6 ADR 006 — user-decided testing architecture decision

**User decision (G1a):** the HTTP contract is an **end-to-end test through TestClient + test SQLite**, NOT an endpoint-boundary test with a mocked `GenericService`. The user asked to record this as an architectural decision.

**Placement decision:** write **`docs/decisions/006-http-contract-tests-end-to-end.md`** following the existing `docs/decisions/TEMPLATE.md`. Correction to the G1a briefing: the repo **already has** an ADR home — `docs/decisions/` with ADRs 001–005, README, and TEMPLATE (the briefing's "ADR-папки нет" was wrong). Alternatives rejected: (a) new `docs/adr/` folder — duplicates an existing convention; (b) section in `testing-strategy-v2.md` — that doc is a strategy/plan, while `docs/decisions/README.md` explicitly covers this class ("choosing between multiple approaches with trade-offs", "non-obvious trade-off"). Also update `docs/decisions/README.md` index: add the **missing 005 row** (doc drift — 005 exists on disk but not in the index) and the new 006 row.

**ADR 006 content (deliverable, drafted in full so G1b approves the text; `##`-heading structure per `TEMPLATE.md`):**

```markdown
# ADR 006: HTTP Contract Tests Are End-to-End (TestClient + Test SQLite), Not Mocked-Service

## Status

Accepted

**Date:** 2026-08-03

## Context

The HTTP layer of the 8 generic CRUD entities needed contract coverage (GH #185), complementing the service-level contract (#184). Candidate architectures:

1. **Endpoint-boundary tests with a mocked `GenericService`** — fast, no DB; asserts the router calls the service correctly.
2. **End-to-end tests through `TestClient` against the real test SQLite** — the full request path: routing, DI binding, schema validation, `response_model` serialization, service, repository, DB.
3. **Mainstream e2e variants** (considered within option 2): the official FastAPI/SQLModel guidance of a *function-scoped* fresh DB with `app.dependency_overrides`, and `httpx.ASGITransport` + `AsyncClient` for async tests. The repo instead standardizes on a *session-scoped* sync `TestClient` + per-test table truncation (`reset_db`) — a recognized minority pattern, speed-justified (no per-test engine/app rebuild).

## Decision

Adopt (2) end-to-end TestClient + test SQLite, keeping the repo's existing session-scoped client + truncation pattern.

Rationale: the dominant HTTP-layer risk in this codebase is **wiring across 8 entities** — per-entity router prefix mounting in `main.py`, per-router DI bindings, `response_model` on each route, status codes (201/200/204), per-entity `<ENTITY>_NOT_FOUND` error codes (ADR-005 body shape). A mocked service verifies none of that. The marginal cost of SQLite is low (~1–2 s on the whole set). Semantic depth (soft-delete rules, is_active stickiness, pagination slicing) is deliberately **not** re-asserted here — the service-level contract (#184) owns semantics; this contract owns transport only. Option (1) rejected: it tests the mock, not the wiring. Option (3)'s per-test fresh DB rejected: heavier and slower with no isolation gain over truncation for this suite; async client rejected: the suite is sync throughout.

## Consequences

### Positive
- Router miswiring fails loudly per entity (a new generic entity gets full HTTP+service coverage from one config entry)
- ~930 lines of duplicated HTTP tests collapse into one parametrized file (net ≈ −350)
- The two contract levels are complementary, not overlapping

### Negative
- Contract cases run through the DB (net collected ≈ −8 cases, suite stays ≈5 s)
- Triage rule needed: if the HTTP contract fails and the service contract is green, the bug is in routing/schemas
- One blind spot: a `response_model=` kwarg dropped without changing the route's return value is undetectable at body level (services return validated schema instances)

### Risks
- Future non-uniform endpoint (a third response shape) breaks the exact-envelope assertion — that is the contract working as intended; add to exceptions only with a documented reason
- Isolation correctness rides on `reset_db` delete-order (`reversed(Base.metadata.sorted_tables)`; the `PRAGMA foreign_keys=OFF` inside the transaction is a no-op) and IDs are not reset (`sqlite_sequence` high-water marks persist) — a table-ordering regression there breaks all contract tests

## References

- Issue: GH #185; spec `docs/specs/2026-08-03-generic-api-crud-contract-design.md`
- Service-level contract: GH #184, `docs/specs/2026-08-03-generic-service-crud-contract-design.md`
- ADR-005 (error contract codes); GH #175 (patch contract)
```

## 4. User scenarios (acceptance drivers)

1. Developer adds a new `GenericService` subclass → one `CONTRACT_CONFIG` entry (incl. the 3 HTTP fields) → full HTTP CRUD + patch-wiring coverage, alongside existing service-level coverage.
2. Developer mounts a router under a wrong/absent prefix or breaks DI binding → `test_*_404_with_entity_code` fails for that entity (default FastAPI 404 body has no `code`).
3. Developer narrows a route's `response_model` (drops a field) or leaks extra fields → exact key-set / `response_schema.model_validate` fails. (Dropping the `response_model=` kwarg alone is the documented blind spot, §3.2.)
4. Developer regresses a status code (POST → 200, DELETE → 200-with-body) → create/delete contract tests fail.
5. Developer breaks soft-delete HTTP visibility (archived row in list, or GET 404s archived rows) → soft delete-visibility tests fail; hard-delete regression (row still GETtable) → hard visibility tests fail.
6. Developer breaks pagination Query binding (`per_page` ignored) → echo test fails; removes `ge=1` validation → 422 test fails.
7. Developer looking for "how is entity X tested at HTTP level" → one contract file + a per-entity file containing only extras.

## 5. Acceptance criteria

1. `backend/tests/test_generic_api_contract.py` exists; all 6 classes green; parametrized over the 8 `CONTRACT_CONFIG` entries; sync-only (`api_client` + API factories, no `db_session`).
2. Shared config extracted to `backend/tests/generic_contract.py` (incl. the explicit service-module import block and `GENERIC_CONTRACT_EXCEPTIONS`; `KNOWN_MISMATCHES` stays in the service file); `EntityConfig` gains `router_prefix`, `not_found_code`, `response_schema` as **required** fields before `unique_row_field`; all 8 entries extended; `test_generic_service_contract.py` imports from it and its suite stays green (pure move).
3. Per-entity disposition per §3.4 executed; `test_api_tags.py` deleted; `test_api_pagination_params.py` slimmed to services/records/visits; 8 PATCH-wiring remnants absorbed (unless G1b vetoes D6).
4. Net line delta ≈ −350 (`git diff --stat` on `backend/tests/`).
5. IMPL-verified mutations (all reverted): (a) unmount one router prefix → that entity's create (201) and list (200) status assertions fail (+ its 404-code test for 7 entities — Activity excepted, D13); (b) narrow one route's `response_model` (drop a field) → exact key-set / `model_validate` fails; (c) flip one status code (201→200 or 204→200) → status assertion fails.
6. Full backend suite green (≈ 985p/5s); no production files changed (`git diff --name-only backend/src/` empty).
7. `docs/decisions/006-http-contract-tests-end-to-end.md` committed per TEMPLATE.md heading structure (content ≈ §3.6 draft); `docs/decisions/README.md` index gains the missing 005 row + 006 row.

## 6. Visual Compliance Checks

N/A — backend-only test refactor; no user-visible UI.

## 7. Decisions log

- **D1:** Shared config extracted (`backend/tests/generic_contract.py`) — one entry per entity drives both contract levels; importing the service test module cross-directory rejected (fragile under pytest import modes).
- **D2:** EntityConfig +`router_prefix`, +`not_found_code`, +`response_schema` (concept asked only for `router_prefix`; the other two are the same class of per-entity HTTP wiring data and keep assertions config-driven, not hard-coded).
- **D3:** Sync-only HTTP contract — all verification through HTTP; no `db_session`/`query_db` in this file (soft-delete visibility is observable via GET/list — the end-to-end decision's spirit).
- **D4:** No multi-row seeding at HTTP level; single-row list tests only (pagination depth is #184's domain).
- **D5:** Exact envelope key-set assertion — verified all 8 entities emit exactly `{items,total,page,per_page}` (Clients via `ClientListResponse`, field-identical).
- **D6:** PATCH-wiring absorption (8 remnants → 1 parametrized test) — small scope completion of #175's HTTP side; **G1b-vetoable**.
- **D7:** `test_api_pagination_params.py` slimmed to visits (generic entities' 422/envelope params subsumed by ListContract).
- **D8:** `test_api_tags.py` fully deleted (120 lines, zero extras).
- **D9:** ADR → existing `docs/decisions/` as 006 (+README index fix for missing 005). New `docs/adr/` and testing-strategy-v2 section rejected (§3.6).
- **D10:** Visitor `/clients/{id}/visitors` scoped-route regression stays per-entity (bare-array shape is a deliberate deviation from the envelope contract).
- **D11 (panel):** HTTP payload construction JSON-serializes `create_data`/`update_data` (datetime → isoformat); field-match asserts typed values via the validated response model, never raw JSON strings; FK echo included (`fk_map` keys).
- **D12 (panel blocker):** exact body key-set assertions on create/get/update responses (same tool as D5's envelope check) — pins shape drift. **Documented blind spot:** a `response_model=` kwarg dropped without changing the route's return value is undetectable at body level (services return validated schema instances → byte-identical body); the §5 mutation uses the *narrowed* variant, which IS caught. The pre-panel claim "dropped `response_model` fails `model_validate`" was false and is corrected everywhere (§1, §3.1, §3.2, §4, §5).
- **D13 (panel):** Activity 404-code blind spot — `main.py`'s `StarletteHTTPException` legacy fallback maps default 404s to `code=ACTIVITY_NOT_FOUND` (locked by `test_error_handlers.py`), so an unmounted activities router is caught by create/list *status* assertions, not the code assertion. Self-guard wording corrected.
- **D14 (panel):** ListContract extended to restore exactly what the dedup removes: bare-GET default echo (`page==1`, `per_page==20`), empty state (`items==[]`, `total==0`), and the 422 matrix incl. the `le=100` cap (`per_page=101`). Pagination-params file keeps services/records/visits (their only pagination coverage).
- **D15 (panel, simplicity dismissed):** `not_found_code` stays an explicit config field — the derivation rule (`rstrip('s')`) breaks on `activities` → `ACTIVITIE`. Explicit config matches the suite's philosophy.
- **D16 (panel):** the 3 new EntityConfig fields are required (no defaults), placed before `unique_row_field` — a 9th entity configured without HTTP data fails loudly at import; silent-skip (defaulted None) rejected.
- **D17 (panel):** `GENERIC_CONTRACT_EXCEPTIONS` moves to the shared module (the shared `_contract_params` filters on it); `KNOWN_MISMATCHES` stays in the service file (service-only guard); the explicit service-module import block moves (powers `__subclasses__()` discovery for both contracts).
- **D18 (panel, partial):** create-pair merged into one test with labeled asserts (same POST; #184 precedent), envelope+default echo merged (same bare GET); the other tests stay separate for failure-name localization. `total == 1` (not `≥ 1`) in list-contains — `reset_db` guarantees an empty start.
