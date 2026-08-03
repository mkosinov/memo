# Design: GH #184 — GenericService: service-level contract for full CRUD (create/get/list/update/delete)

- **Issue:** GH #184
- **Type:** Test-only task (no production code changes; pure test refactor + coverage extension)
- **Date:** 2026-08-03 (rev 2 — spec-panel fixes applied)
- **Concept:** approved at G1a 2026-08-03 (single parametrized contract file; EntityConfig +update_schema/+update_data)
- **Refs:** #175 / PR #181 (patch contract pattern), #182 (paginated list form), #194 (deletion policy, `delete_semantics`), #185 (HTTP contract — follow-up, out of scope)
- **Domain references:** `docs/domain-rules/_overview.md` (Deletion Policy), per-entity docs. No domain-rule changes — this spec only encodes already-documented behavior into tests. Exception: `_overview.md:97` references the old test file name and is updated as part of the rename (§6.7).

---

## 1. Problem

PR #181 introduced the contract-test pattern for `GenericService.patch()` only: parametrization over `__subclasses__()` + `EntityConfig` + `make_entity` fixture in `backend/tests/services/test_generic_service_patch.py` (599 lines). The rest of the CRUD surface is unevenly covered:

- **`update()` (PUT-style full replace) has NO generic test at all.** The only `service.update()` call in the entire test suite is `test_visit_service.py:63`, and `VisitService` is a standalone service with a non-generic signature (`visit_id` kwarg). Generic PUT semantics (full replace incl. omitted fields reverting to schema defaults, nonexistent → `None`) are untested.
- **Generic list shape** is tested in a separate file (`test_generic_service_list.py`, 186 lines) on only 2 representative entities (Master, Tag) with hand-written, non-parametrized tests — a new entity gets no list coverage automatically.
- **`create()` / `get()`** generic behavior (response contains created fields, row persisted, nonexistent → `None`) is only incidentally covered inside per-entity tests.
- **Delete edge cases** are partial: `TestGenericServiceDeleteSemantics` (#194) verifies soft vs hard semantics of an existing row, but `delete(nonexistent) → False`, `delete(already-inactive soft row) → False`, and "soft-deleted row absent from `list()`" are not asserted.

Adding a new `GenericService` subclass today = writing one `CONTRACT_CONFIG` entry covers **patch+delete only**; the developer must still hand-write create/get/list/update tests.

## 2. Contract under test (actual behavior, not desired)

From `backend/src/services/generic.py` and `backend/src/repositories/generic.py`:

| Method | Signature → return | Edge behavior |
|---|---|---|
| `create` | `(db_session, data: CreateSchemaT) -> ResponseSchemaT` | `@transactional`; row persisted, response schema reflects create fields |
| `get` | `(db_session, id: str) -> ResponseSchemaT \| None` | nonexistent id → `None`. **Does NOT filter `is_active`** (soft-deleted rows are returned) — see §5 deferral |
| `list` | `(db_session, page=1, per_page=20, order_by=None, **filters) -> PaginatedResponse[ResponseSchemaT]` | envelope exactly `{items, total, page, per_page}` (locked form from #182); equality `**filters` narrow both `items` and `total` |
| `update` | `(db_session, id: str, data: UpdateSchemaT) -> ResponseSchemaT \| None` | **full replace (PUT semantics, RFC 9110 §9.3.4):** repo applies full `model_dump()` — omitted fields revert to schema defaults; nonexistent id → `None` (`generic.py:111-112`, `repositories/generic.py:61-67`) |
| `delete` | `(db_session, id: str) -> bool` | nonexistent id → `False`; already-inactive soft row → `False` (`repositories/generic.py:147-156`); soft → row kept with `is_active=False`; hard → row physically gone (Deletion Policy in `docs/domain-rules/_overview.md`) |

**Signature notes (uniformity limits — contract tests never rely on these):**
- `SoftDeleteService.list` adds `status: ArchiveStatus = ACTIVE` — by default soft entities exclude `is_active=False` rows from **both** `items` and `total`; hard-delete entities list all rows (no implicit filtering).
- `PaymentService.list` has its own filter loop (no `order_by` param); `ActivityService.list` delegates to `super().list` where an `order_by` kwarg would fall into `**filters` and raise `AttributeError`. **Contract tests never pass `order_by`.**

Type vars: `GenericService[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]` (no `PatchSchemaT` — `patch()` takes plain `BaseModel`).

**Delete semantics per entity (unchanged, from #194):** soft = Client, Location, Master, Material; hard = Activity, Payment, Tag, Visitor.

## 3. Design

### 3.1 One contract file (rename)

`git mv backend/tests/services/test_generic_service_patch.py → backend/tests/services/test_generic_service_contract.py`

- All existing machinery carries over: `EntityConfig`, `CONTRACT_CONFIG` (8 entries: Activity, Client, Location, Master, Material, Payment, Tag, Visitor), `KNOWN_MISMATCHES`, `make_entity` fixture, `_all_subclasses()`, `_contract_params()`.
- **Exceptions set unchanged:** `{ServiceService, PhotoService, RecordService, SoftDeleteService}`.
- **Decision D1 (constant rename):** `GENERIC_PATCH_EXCEPTIONS` → `GENERIC_CONTRACT_EXCEPTIONS`. The file no longer covers only patch; keeping a patch-scoped name for a whole-CRUD exclusion list is misleading. Purely test-internal rename, same set.
- Module docstring updated to describe the full-CRUD contract.
- `make_entity` inner factory gains `**overrides` merged into the copied `create_data` (one-line change; existing single-call sites unaffected).

### 3.2 EntityConfig additions

Three new fields (others unchanged):

| Field | Type | Semantics |
|---|---|---|
| `update_schema` | `type` | The PUT-style update schema class for the entity (e.g. `ClientUpdate`). For Tag: **`TagCreate`** — no `TagUpdate` exists; `TagService` is declared `GenericService[TagCreate, TagCreate, TagResponse]`. |
| `update_data` | `dict` | Fields **actually present** in `update_schema`, with values **different** from `create_data` so the change is observable. Multiple fields per entity — a PUT that applies only some fields must fail the contract. `is_active` is never an explicit `update_data` key (see D4). |
| `unique_row_field` | `str \| None` (default `None`) | Column with a DB unique constraint that multi-row tests must vary per row. Among the 8 models only **`Tag.tag`** is `unique=True` (verified across all 8 models) — only Tag sets this. A future entity with a unique column sets it here, or its 2nd row create raises `IntegrityError`. |

Update payload construction (shared helper in the contract file):

```
payload = { **create_data, **resolved_fk_map, **update_data }  filtered to update_schema.model_fields
```

- Required fields of PUT schemas (`ActivityUpdate`: master_id/service_id/location_id/start/duration/capacity; `MasterUpdate`, `MaterialUpdate`, `LocationUpdate` required sets; `PaymentUpdate.record_id`) are satisfied from `create_data`/`fk_map` — FK values are reused **unchanged** (no dangling FKs, no extra fixtures).
- The `model_fields` filter makes behavior deterministic regardless of Pydantic `extra` config: `VisitorUpdate` has no `client_id` → automatically excluded; this matches the concept's intent ("only fields actually present in the Update schema").
- **Decision D2 (Payment.record_id — refinement of concept wording):** the concept said "Payment.record_id excluded". Verification shows `PaymentUpdate` **requires** `record_id` (unlike `PaymentPatch`, which lacks it — that patch-side gap is the existing `KNOWN_MISMATCHES` entry). Exclusion is therefore impossible; `record_id` is supplied via `fk_map` with the same value created. The exclusion intent applies to `Visitor.client_id` only.

### 3.3 Test classes (all parametrized via existing `_contract_params()`)

| Class | Tests | Contract asserted |
|---|---|---|
| `TestGenericServiceCreateContract` | `test_create_response_contains_create_data_fields`; `test_create_persists_row` | response schema fields matching `create_data` keys equal the created values; row exists at **ORM level** (`db_session.get(model, id)`) — distinct path from the service-level `get` contract |
| `TestGenericServiceGetContract` | `test_get_returns_created_entity`; `test_get_nonexistent_returns_none` | create → `get(id)` fields match; get(nonexistent) → `None` |
| `TestGenericServiceListContract` | `test_list_envelope_shape`; `test_list_contains_created_entity`; `test_list_empty`; `test_list_pagination_slices_and_total`; `test_list_out_of_range_page`; `test_list_id_filter_narrows_items_and_total` | envelope exactly `{items,total,page,per_page}`; created row present in `items` and counted in `total`; fresh DB → `total==0`, `items==[]`; 3 rows + `per_page=2` → page1=2 items, page2=1 item, disjoint, `total=3`; page=99 → `items=[]`, `total=3`; filter by `id` (portable across all 8) → `total==1`, single item is the created row |
| `TestGenericServiceUpdateContract` | `test_update_applies_update_data`; `test_update_nonexistent_returns_none`; `test_update_omitted_optional_field_reverts_to_default` | create → `update(id, update_schema(**payload))` → `get(id)`: every `update_data` field has the new value **and** every `create_data` field not in `update_data` is unchanged; update(nonexistent) → `None`; **PUT discrimination:** set `nullable_field` to a non-default value, update with the standard payload (which omits it) → field reverts to the `update_schema` default (entities without `nullable_field` — Tag, Material — skip with reason, mirroring the patch contract) |
| `TestGenericServicePatchContract` | unchanged | unchanged |
| `TestGenericServiceDeleteSemantics` | existing `test_delete_semantics_per_entity` unchanged; **ADD** `test_delete_nonexistent_returns_false`; **ADD** `test_delete_already_deleted_soft_returns_false` (soft entities only); **ADD** soft entities: deleted row absent from `list()` (`items` and `total`) | delete(nonexistent) → `False`; delete(already-inactive soft row) → `False`; soft-deleted rows invisible to list |
| Guards (module level) | `test_all_generic_subclasses_covered_or_excepted`; `test_not_null_fields_match_model` | unchanged |

**Multi-row seeding (pagination tests):** a `seed_rows(cfg, db_session, n)` helper resolves `fk_map` factories **once** (parents shared across rows), then creates `n` rows via `service.create` with `make_entity`-style overrides applying `{unique_row_field: f"{value}-{i}"}` when configured (Tag). Creation stays service-level (single creation path, no model/schema-shape drift); ORM seeding was considered and rejected (D8).

**Estimated delta:** +118 parametrized cases (16 create + 16 get + 48 list + 22 update + 16 delete), −10 tests from the deleted list file (7 generic absorbed, 3 moved) → **net ≈ +108 tests, +2 skips** (omission test on Tag/Material). Backend suite ≈ 854p/3s → ≈ 962p/5s.

### 3.4 Absorption of `test_generic_service_list.py` (no coverage silently dropped)

| Old test (line) | Disposition |
|---|---|
| `test_list_returns_paginated_envelope` (:39, Master) | → `TestGenericServiceListContract.test_list_envelope_shape` (all 8) |
| `test_list_total_independent_of_per_page` (:50) | → `test_list_pagination_slices_and_total` (all 8) |
| `test_list_out_of_range_page_returns_empty_items` (:65) | → `test_list_out_of_range_page` (all 8) |
| `test_list_excludes_inactive` (:74) | → `TestGenericServiceDeleteSemantics` soft-list-absence addition (soft entities) + `test_list_contains_created_entity`/`total` behavior |
| `test_list_filters_apply_to_total` (:89) | → `test_list_id_filter_narrows_items_and_total` (all 8) |
| `test_list_returns_paginated_envelope_tag` (:100) | subsumed by parametrized envelope (Tag included) |
| `test_list_flag_driven_filter` (:111) | subsumed: hard entities — `total` counts all created rows (no implicit filtering); soft entities — DeleteSemantics list-absence |
| `test_service_service_list_paginated` (:140, eager-loaded tariffs/tags) | → **new** `backend/tests/services/test_service_service.py` |
| `test_record_service_list_paginated_with_client_filter` (:159) | → **new** `backend/tests/services/test_record_service.py` |
| `test_visit_service_list_paginated` (:177) | → **existing** `backend/tests/services/test_visit_service.py` (moved as-is) |

Net-new tests with no old-file counterpart: `test_list_empty`, `test_update_*` (all), `test_create_*`, `test_get_*`, `test_delete_nonexistent_returns_false`, `test_delete_already_deleted_soft_returns_false`.

Then **delete** `backend/tests/services/test_generic_service_list.py`.

## 4. User scenarios (acceptance drivers)

1. Developer adds a new `GenericService` subclass → writes one `CONTRACT_CONFIG` entry → gets full CRUD coverage (create/get/list/update/patch/delete).
2. Developer adds a subclass without config → guard test fails with MISSING-CONFIG.
3. Developer breaks generic semantics (update returns non-`None` for nonexistent id; update applies only some fields or omits default-reversion; soft-deleted row visible in list) → contract fails across all entities.
4. Developer changes the paginated list shape → contract fails.
5. Developer looking for "how is entity X tested" → one file, one config table.

## 5. Scope boundaries (non-goals)

- **No production code changes.** Pure test task. If the contract exposes a real bug, the bug is flagged as a follow-up issue — tests are NOT bent to fit. (Pre-verification found the implementation compliant: `update` → `None`, `delete` → `False` for nonexistent.)
- **`get()`/`update()` vs `is_active` asymmetry — DEFERRED (recommended, gate decision):** `GenericService.get()` does NOT filter `is_active` (soft-deleted rows are returned; predecessor specs 2026-07-29 §5 and tags spec queued this to #184 as a candidate), and a PUT on an archived soft entity silently reactivates it for Master/Location/Material because their Update schemas carry `is_active: bool = True` and `repo.update` applies full `model_dump()` (ClientUpdate has no `is_active`). This spec neither locks nor fixes that behavior — it is a domain-semantics decision deserving its own issue (recommended follow-up: "get/update soft-delete asymmetry"). Presented at G1b for confirmation; the alternative (lock current behavior with contract tests) adds 2 tests × soft entities.
- **No HTTP-level contract, no `test_api_*.py` dedup** — that is GH #185.
- **No changes to excepted services** (ServiceService, PhotoService, RecordService, SoftDeleteService) — they keep their own per-entity tests.
- **VisitService / UserSettings** are standalone services (not `GenericService` subclasses) — out of scope; `test_visit_service.py` only receives the moved list test.
- **No domain-rule changes** — behavior documented in `docs/domain-rules/` is only being encoded into tests (the `_overview.md:97` file-name reference update in §6.7 is reference maintenance, not a rule change).

## 6. Acceptance criteria

1. `backend/tests/services/test_generic_service_contract.py` exists (renamed), all classes green; `test_generic_service_patch.py` and `test_generic_service_list.py` no longer exist.
2. `EntityConfig` has `update_schema`, `update_data`, `unique_row_field`; all 8 `CONTRACT_CONFIG` entries extended (`unique_row_field` set only for Tag); guard tests unchanged and green.
3. Full CRUD contract (create/get/list/update/patch/delete incl. edge cases in §3.3) runs parametrized over all 8 entities; adding an unconfigured subclass fails the guard (scenario 2 verified during IMPL by temporary stub, then reverted).
4. The PUT-discrimination test fails if `repositories/generic.py` switches from `model_dump()` to `model_dump(exclude_unset=True)` (verified during IMPL by temporary mutation, then reverted).
5. The 3 non-generic list tests live in `test_service_service.py` (new), `test_record_service.py` (new), `test_visit_service.py` (extended); `test_generic_service_list.py` deleted; list-shape coverage mapping in §3.4 holds (no dropped assertions).
6. No changes under `backend/src/` (any violation = the contract exposed a bug → follow-up issue, not a fix in this branch).
7. `docs/domain-rules/_overview.md:97` reference to `test_generic_service_patch.py` updated to the new file name.
8. Full backend suite green; net ≈ +108 tests, +2 skips.

## 7. Visual Compliance Checks

N/A — backend-only test task, no user-visible UI.

## 8. Decisions log (deviations/refinements vs G1a concept + panel fixes)

- **D1:** `GENERIC_PATCH_EXCEPTIONS` → `GENERIC_CONTRACT_EXCEPTIONS` rename (file now covers full CRUD; same set). Rationale: naming honesty; zero behavior impact.
- **D2:** `Payment.record_id` is NOT excluded from update payload (concept said excluded) — `PaymentUpdate` **requires** it; supplied unchanged via `fk_map`. `Visitor.client_id` genuinely excluded (absent from `VisitorUpdate`) via the `model_fields` filter.
- **D3:** Update payload = `create_data` + resolved `fk_map` + `update_data`, filtered to `update_schema.model_fields` — satisfies PUT-schema required fields without special-casing any entity.
- **D4 (revised):** `is_active` is never an explicit `update_data` key. Unlike patch (`exclude_unset`), update applies full `model_dump()`, so for Master/Location/Material the schema default `is_active=True` rides along on every update — the exclusion prevents explicit toggling only, not default flow-through. Consequence (PUT-resurrects-archived-row) is deferred, not locked (§5).
- **D5:** Soft-deleted-row list-absence lives in `TestGenericServiceDeleteSemantics`; `TestGenericServiceListContract` asserts shape/pagination/filter/total only — no duplicated assertions between the two classes.
- **D6 (panel fix):** `unique_row_field` config field (Tag only) — only `Tag.tag` has a DB unique constraint among the 8 models; without a per-row suffix the pagination test's 2nd create raises `IntegrityError`.
- **D7 (panel fix):** PUT discrimination — `test_update_applies_update_data` also asserts non-`update_data` create fields unchanged, and `test_update_omitted_optional_field_reverts_to_default` proves full-replace (vs patch semantics) via default-reversion of an omitted optional field. Without this, a full↔partial regression in `repositories/generic.py` is undetectable.
- **D8 (panel fix):** Multi-row seeding stays service-level via `seed_rows` helper (shared FK parents, per-row unique suffix). Direct-ORM seeding rejected: introduces a second creation path with model-vs-schema shape drift risk; runtime cost of service-level creation is negligible at this scale.
- **D9 (panel fix):** `test_delete_already_deleted_soft_returns_false` locks the `SoftDeleteRepository.delete` already-inactive → `False` edge (soft entities only).
- **D10 (panel fix):** `test_list_empty` locks the empty-state envelope (`total==0`, `items==[]`) — net-new, no old-file counterpart.
- **Panel suggestions dismissed:** (a) drop `update_data` for a single-sentinel update — concept-mandated, and multi-field data catches partial-application bugs a single sentinel can miss; (b) run pagination mechanics on 2 representative entities only — contradicts the contract pattern's core value (new subclass → full coverage; Activity/Payment have real `list` overrides); runtime addressed by D8 instead. (c) merge create-persists into get test — resolved by giving create-persists the ORM-level path (§3.3) instead of merging.
