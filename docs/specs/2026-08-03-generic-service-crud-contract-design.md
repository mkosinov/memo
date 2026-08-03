# Design: GH #184 — GenericService: service-level contract for full CRUD (create/get/list/update/delete)

- **Issue:** GH #184
- **Type:** Test refactor + coverage extension + **scoped production fix** (`is_active` stickiness in soft-delete update/patch)
- **Date:** 2026-08-03 (rev 3 — user directive on `is_active` semantics incorporated; scope expanded beyond pure tests per G1b feedback)
- **Concept:** approved at G1a 2026-08-03; **user directive at G1b 2026-08-03** (get returns archived rows; update/patch preserve `is_active` unless explicitly set; fix schemas + service layer; document in domain-rules)
- **Refs:** #175 / PR #181 (patch contract pattern), #182 (paginated list form), #194 (deletion policy), #195 (status filter + frontend is_active workaround), #178 (Update-schema is_active — related follow-up), #185 (HTTP contract — out of scope)
- **Domain references:** `docs/domain-rules/_overview.md` (Deletion Policy + new is_active semantics rule), per-entity docs (updated, §3.6)

---

## 1. Problem

PR #181 introduced the contract-test pattern for `GenericService.patch()` only (parametrization over `__subclasses__()` + `EntityConfig` + `make_entity` in `backend/tests/services/test_generic_service_patch.py`, 599 lines). The rest of the CRUD surface is unevenly covered:

- **`update()` (PUT full replace) has NO generic test at all.** The only `service.update()` call in the suite is `test_visit_service.py:63` (standalone service, non-generic signature). PUT semantics (full replace incl. default-reversion of omitted fields, nonexistent → `None`) are untested.
- **Generic list shape** is tested in `test_generic_service_list.py` (186 lines) on 2 representative entities (Master, Tag), hand-written — a new entity gets no list coverage automatically.
- **`create()` / `get()`** generic behavior is only incidentally covered.
- **Delete edge cases** are partial: `delete(nonexistent) → False`, `delete(already-inactive soft row) → False`, "soft-deleted row absent from `list()`" unasserted.
- **`is_active` semantics are broken/inconsistent on the write path (user directive, G1b):**
  - `MasterUpdate`/`LocationUpdate`/`MaterialUpdate`/`ServiceUpdate` declare `is_active: bool = True` (`master.py:29`, `location.py:33`, `material.py:20`, `service.py:56`) and `BaseRepository.update` applies full `model_dump()` (`repositories/generic.py:68`) → **a PUT omitting `is_active` on an archived row silently reactivates it.** #195 Task 10 worked around this only on the frontend (4 edit modals explicitly resend the row's current `is_active`); the backend hazard was never fixed.
  - `ClientUpdate`/`ClientPatch` have **no `is_active` field at all** — clients cannot archive/restore via PATCH like the other soft entities.
  - Patch schemas declare `is_active: bool | None = None`, but `GenericService.patch` strips `None` only for `NOT_NULL_FIELDS` (and `is_active` is in no service's `NOT_NULL_FIELDS`) → **PATCH `{"is_active": null}` writes NULL** → DB NOT NULL violation.
  - `ServiceService` (SoftDeleteService subclass, contract exception) overrides `update`/`patch` **without calling super()** (`service.py:110-206`, tag_ids/tariffs handling) and re-applies full `model_dump()` → same silent-resurrection hazard.
  - `get()` returning archived rows is **correct** behavior (user decision 1) but is not locked by any test.

## 2. Contract under test (behavior AFTER this change — user-directed semantics)

From `backend/src/services/generic.py` / `backend/src/repositories/generic.py`, amended by §3.5:

| Method | Signature → return | Edge behavior |
|---|---|---|
| `create` | `(db_session, data: CreateSchemaT) -> ResponseSchemaT` | `@transactional`; row persisted, response schema reflects create fields |
| `get` | `(db_session, id: str) -> ResponseSchemaT \| None` | nonexistent id → `None`. **Deliberately returns archived rows** (no `is_active` filter) — user decision 1; `is_active` is exposed in all 5 soft entities' Response schemas (verified: master.py:55, location.py:63, material.py:39, client.py:57, service.py:85) so callers can see archive state. This pairs deliberately with `list()` hiding archived rows: *list hides, get returns*. |
| `list` | `(db_session, page=1, per_page=20, order_by=None, **filters) -> PaginatedResponse[ResponseSchemaT]` | envelope exactly `{items, total, page, per_page}` (#182); equality `**filters` narrow `items` and `total` |
| `update` | `(db_session, id: str, data: UpdateSchemaT) -> ResponseSchemaT \| None` | **full replace (PUT, RFC 9110 §9.3.4):** omitted fields revert to schema defaults — **except sticky fields** (`id`, `created_at`, and **`is_active`** for soft-delete entities): `is_active` absent/None in payload → stored value preserved; explicit bool → applied (`True` on archived = legal reactivation, `False` on active = archiving). Nonexistent id → `None` |
| `patch` | `(db_session, id: str, data: BaseModel) -> ResponseSchemaT \| None` | `exclude_unset` partial update; **`is_active` semantics identical to update:** absent/None → preserved (None is stripped, never written as NULL); explicit bool → applied. Nonexistent id → `None` |
| `delete` | `(db_session, id: str) -> bool` | nonexistent → `False`; already-inactive soft row → `False`; soft → `is_active=False`; hard → row physically gone |

**Signature notes (uniformity limits — contract tests never rely on these):**
- `SoftDeleteService.list` adds `status: ArchiveStatus = ACTIVE` — soft entities exclude `is_active=False` rows from `items` and `total` by default; hard entities list all rows.
- `PaymentService.list` has its own filter loop (no `order_by`); `ActivityService.list` delegates to `super().list` where `order_by` would fall into `**filters` → `AttributeError`. **Contract tests never pass `order_by`.**

**Delete semantics per entity (unchanged, from #194):** soft = Client, Location, Master, Material (+Service as contract exception); hard = Activity, Payment, Tag, Visitor.

## 3. Design

### 3.1 One contract file (rename)

`git mv backend/tests/services/test_generic_service_patch.py → backend/tests/services/test_generic_service_contract.py`

- All existing machinery carries over: `EntityConfig`, `CONTRACT_CONFIG` (8 entries: Activity, Client, Location, Master, Material, Payment, Tag, Visitor), `KNOWN_MISMATCHES`, `make_entity`, `_all_subclasses()`, `_contract_params()`.
- **Exceptions set unchanged:** `{ServiceService, PhotoService, RecordService, SoftDeleteService}`.
- **D1 (constant rename):** `GENERIC_PATCH_EXCEPTIONS` → `GENERIC_CONTRACT_EXCEPTIONS` (file covers full CRUD now; same set).
- Module docstring updated.
- `make_entity` inner factory gains `**overrides` merged into the copied `create_data` (existing call sites unaffected).

### 3.2 EntityConfig additions

| Field | Type | Semantics |
|---|---|---|
| `update_schema` | `type` | PUT-style update schema class. For Tag: **`TagCreate`** (no `TagUpdate` exists; `TagService` is `GenericService[TagCreate, TagCreate, TagResponse]`). |
| `update_data` | `dict` | Fields **actually present** in `update_schema`, values **different** from `create_data`. Multiple fields per entity — a PUT applying only some fields must fail the contract. `is_active` is **never** an `update_data` key (D4) — its semantics are pinned by `TestGenericServiceIsActiveContract` (§3.3). |
| `unique_row_field` | `str \| None` (default `None`) | Column with a DB unique constraint that multi-row tests must vary per row. Only **`Tag.tag`** is `unique=True` among the 8 models (verified) — only Tag sets this. |

Update payload construction (shared helper):

```
payload = { **create_data, **resolved_fk_map, **update_data }  filtered to update_schema.model_fields
```

- Required PUT-schema fields (`ActivityUpdate` FKs+start/duration/capacity; `MasterUpdate`, `MaterialUpdate`, `LocationUpdate` required sets; `PaymentUpdate.record_id`) come from `create_data`/`fk_map`, FK values reused unchanged.
- The `model_fields` filter is deterministic regardless of Pydantic `extra` config: `VisitorUpdate` has no `client_id` → excluded (matches concept intent).
- **D2 (Payment.record_id — refinement of concept wording):** concept said "excluded"; `PaymentUpdate` **requires** `record_id` → supplied unchanged via `fk_map`. Exclusion applies to `Visitor.client_id` only.

### 3.3 Test classes (all parametrized via existing `_contract_params()`)

| Class | Tests | Contract asserted |
|---|---|---|
| `TestGenericServiceCreateContract` | `test_create_response_contains_create_data_fields`; `test_create_persists_row` | response fields matching `create_data` keys equal created values; row exists at **ORM level** (`db_session.get(model, id)`) — distinct from the service-level get path |
| `TestGenericServiceGetContract` | `test_get_returns_created_entity`; `test_get_nonexistent_returns_none` | create → `get(id)` fields match; get(nonexistent) → `None` |
| `TestGenericServiceListContract` | `test_list_envelope_shape`; `test_list_contains_created_entity`; `test_list_empty`; `test_list_pagination_slices_and_total`; `test_list_out_of_range_page`; `test_list_id_filter_narrows_items_and_total` | envelope `{items,total,page,per_page}`; created row in `items`, counted in `total`; fresh DB → `total==0`, `items==[]`; 3 rows + `per_page=2` → 2/1/disjoint/`total=3`; page=99 → `items=[]`, `total=3`; `id` filter → `total==1` |
| `TestGenericServiceUpdateContract` | `test_update_applies_update_data`; `test_update_nonexistent_returns_none`; `test_update_omitted_optional_field_reverts_to_default` | create → update → get: `update_data` fields changed **and** non-`update_data` create fields unchanged; nonexistent → `None`; **PUT discrimination:** set `nullable_field` to non-default, update with standard payload (omits it) → reverts to `update_schema` default (Tag, Material skip with reason — no `nullable_field`) |
| **`TestGenericServiceIsActiveContract`** (NEW — soft entities only, `delete_semantics == "soft"` → Master, Location, Material, Client) | `test_get_archived_returns_row_with_is_active_false`; `test_update_preserves_is_active_when_omitted`; `test_update_explicit_is_active_applies`; `test_patch_preserves_is_active_when_omitted_or_none`; `test_patch_explicit_is_active_applies` | **User decisions 1-3:** get(archived) → row (not None) with `is_active is False`; update archived without `is_active` → still False (and active row without `is_active` → still True); update active with explicit `is_active=False` → archived, archived with explicit `True` → reactivated; patch without `is_active` **or with `is_active=None`** → preserved; patch with explicit bool → applied |
| `TestGenericServicePatchContract` | unchanged | unchanged |
| `TestGenericServiceDeleteSemantics` | existing unchanged; **ADD** `test_delete_nonexistent_returns_false`; **ADD** `test_delete_already_deleted_soft_returns_false` (soft only); **ADD** soft: deleted row absent from `list()` (`items` and `total`) | delete edge cases; *list hides* half of the list/get pairing |
| Guards (module level) | `test_all_generic_subclasses_covered_or_excepted`; `test_not_null_fields_match_model` | unchanged |

**Service (contract exception) coverage:** `ServiceService` gets the same 5 `is_active` semantics tests as per-entity tests in the new `test_service_service.py` (§3.4) — it re-implements `update`/`patch` and cannot be pinned by the parametrized class.

**Multi-row seeding (pagination):** `seed_rows(cfg, db_session, n)` helper resolves `fk_map` factories **once** (shared parents), creates `n` rows via `service.create` with `{unique_row_field: f"{value}-{i}"}` override when configured (Tag). Service-level creation only; ORM seeding rejected (D8).

**Estimated delta:** +138 cases — CRUD classes 118 (16 create + 16 get + 48 list + 22 update + 16 delete) + 20 is_active (5 × 4 soft entities) — minus 10 from the deleted list file → **net ≈ +128 tests, +2 skips**; plus 5 per-entity Service is_active tests in `test_service_service.py`. Backend suite ≈ 854p/3s → ≈ 987p/5s.

### 3.4 Absorption of `test_generic_service_list.py` (no coverage silently dropped)

| Old test (line) | Disposition |
|---|---|
| `test_list_returns_paginated_envelope` (:39, Master) | → `test_list_envelope_shape` (all 8) |
| `test_list_total_independent_of_per_page` (:50) | → `test_list_pagination_slices_and_total` (all 8) |
| `test_list_out_of_range_page_returns_empty_items` (:65) | → `test_list_out_of_range_page` (all 8) |
| `test_list_excludes_inactive` (:74) | → DeleteSemantics soft-list-absence + `test_list_contains_created_entity` |
| `test_list_filters_apply_to_total` (:89) | → `test_list_id_filter_narrows_items_and_total` (all 8) |
| `test_list_returns_paginated_envelope_tag` (:100) | subsumed by parametrized envelope |
| `test_list_flag_driven_filter` (:111) | subsumed: hard — `total` counts all rows; soft — DeleteSemantics list-absence |
| `test_service_service_list_paginated` (:140, eager-loaded tariffs/tags) | → **new** `backend/tests/services/test_service_service.py` (also receives the 5 Service `is_active` tests, §3.3) |
| `test_record_service_list_paginated_with_client_filter` (:159) | → **new** `backend/tests/services/test_record_service.py` |
| `test_visit_service_list_paginated` (:177) | → **existing** `backend/tests/services/test_visit_service.py` |

Then **delete** `backend/tests/services/test_generic_service_list.py`.

### 3.5 Production fix — `is_active` stickiness (user directive 2-3)

**Schema changes (`backend/src/schemas/`):**

| File:line | Change |
|---|---|
| `master.py:29`, `location.py:33`, `material.py:20`, `service.py:56` (Update schemas) | `is_active: bool = True` → `is_active: bool \| None = None` |
| `client.py` | **add** `is_active: bool \| None = None` to `ClientUpdate` **and** `ClientPatch` (currently absent in both — clients gain archive/restore via PATCH, aligning with the other soft entities) |
| Patch schemas of Master/Location/Material/Service | already `bool \| None = None` — **no change** |

**Service-layer changes (`backend/src/services/`):** the "strip `is_active` when None" hook lives in the **service layer**, honoring the #195 design rule "base `GenericService` has NO `is_active` knowledge" (`generic.py:51-52`):

- `SoftDeleteService` (generic.py:155-179) gains `update()` and `patch()` overrides: drop `is_active` from the applied dump when it is `None` (absent or explicitly null), then delegate to the base implementation; explicit bool passes through. All 4 contract soft entities (Master/Location/Material/Client) inherit this.
- `ServiceService.update`/`patch` (service.py:110-206) re-apply base fields **without super()** → the same strip is duplicated in both methods (documented in code comment as deliberate duplication, mirroring the existing `list` duplication rationale at service.py:26-29).

**`is_active` is a documented sticky-field exception to PUT full-replace** (like `id`/`created_at`): stated in §2, in the SoftDeleteService docstring, and in `docs/domain-rules/_overview.md` (§3.6). The PUT-discrimination test (D7) uses `nullable_field`, not `is_active`, so full-replace verification is unaffected.

**D11 — Service is fixed in #184, not deferred:** same hazard, same fix shape, and leaving one soft entity with resurrection semantics while four are fixed would create a worse inconsistency than either uniform state. Frontend `ServicesTable` already resends `is_active` explicitly → compatible.

**Untouched:** routers (pass schema straight through, no `is_active` logic — verified masters.py:100, locations.py:106, materials.py:83, clients.py:106, services.py:82), Response schemas (all 5 already expose `is_active`), User/Tariff (no GenericService path — verified; `_overview.md:72` already marks them out of scope), PhotoService/RecordService (hard-delete, no `is_active` semantics), frontend code.

### 3.6 Domain-rules updates (user directive 4)

- **`docs/domain-rules/_overview.md`:** new section **"is_active semantics on get/update/patch"** under the Deletion Policy: (1) `get` returns archived rows, `is_active` exposed in Response schemas (*list hides, get returns*); (2) update/patch preserve `is_active` when absent/None; explicit bool applies; `True` on archived = legal reactivation; (3) `is_active` is a sticky-field exception to PUT full-replace. Also update the stale file reference at `_overview.md:97` (rename) and the PATCH Contract section (:85-113) with the `is_active`-None strip.
- **Per-entity files** (`masters.md`, `locations.md`, `materials.md`, `clients.md`, `services.md`): short "Archive semantics on write" section each, referencing the general rule (+ entity notes: Client gains `is_active` in Update/Patch; Service implements the strip in its own overrides).

### 3.7 Expected collateral (verified — suite stays green)

- **No backend test relies on the old behavior** (verified by exploration): no test asserts the `is_active: bool = True` Update default, no test PUTs an archived row without `is_active`, no schema unit test asserts the default. `test_put_is_active.py` / `test_patch_is_active.py` assert **explicit**-bool behavior → unchanged. PUT API tests on active rows omitting `is_active` observe the same `True` (preserved = old default) → unchanged.
- **Frontend:** 4 modal tests (`MastersTable.test.tsx:534`, `LocationsTable.test.tsx:583`, `MaterialsTable.test.tsx:179`, `ServicesTable.test.tsx:368`) assert explicit `is_active` in payload → compatible with "explicit applies". Admin source comments citing "backend Update schema defaults is_active=True (#195)" (MastersTable.tsx:161, LocationsTable.tsx:160, MaterialsTable.tsx:222, ServicesTable.tsx:300) become **stale** → follow-up polish (with #178 TODO casts), not this issue.
- **api-client types:** Update schemas' `is_active` becomes nullable-optional → regenerate/verify OpenAPI-derived types; `npm run test` + type-check in frontend must stay green (frontend already always sends the field).

## 4. User scenarios (acceptance drivers)

1. Developer adds a new `GenericService` subclass → one `CONTRACT_CONFIG` entry → full CRUD coverage (create/get/list/update/patch/delete; + is_active semantics if soft-delete).
2. Developer adds a subclass without config → guard test fails with MISSING-CONFIG.
3. Developer breaks generic semantics (update returns non-`None` for nonexistent; update partially applies fields or skips default-reversion; soft-deleted row visible in list; **PUT/patch silently reactivating an archived row; `is_active=None` writing NULL**) → contract fails across all affected entities.
4. Developer changes the paginated list shape → contract fails.
5. Developer looking for "how is entity X tested" → one file, one config table.
6. API consumer archives a row, then edits it (PUT without `is_active`) → row stays archived; consumer explicitly sends `is_active: true` → row reactivates — documented in domain-rules.

## 5. Scope boundaries (non-goals)

- Production changes are **bounded to §3.5**: 5 schema files (4 default flips + 2 Client additions), `SoftDeleteService` (2 method overrides), `ServiceService` (strip in 2 methods). **No router changes, no Response-schema changes, no model changes, no frontend changes.** Any further bug the contract exposes → follow-up issue, tests NOT bent to fit.
- **No HTTP-level contract, no `test_api_*.py` dedup** — GH #185.
- **No changes to excepted services beyond §3.5** (ServiceService gets only the `is_active` strip; PhotoService/RecordService untouched).
- **VisitService / UserSettings** standalone — out of scope.
- **User/Tariff** — out of scope (no GenericService path; verified).
- **Stale frontend comments + #178 TODO casts** — follow-up, not this issue.

## 6. Acceptance criteria

1. `test_generic_service_contract.py` exists (renamed), all classes green; `test_generic_service_patch.py` / `test_generic_service_list.py` gone.
2. `EntityConfig` has `update_schema`, `update_data`, `unique_row_field` (Tag only); all 8 entries extended; guards unchanged and green.
3. Full CRUD contract runs parametrized over all 8 entities; unconfigured subclass fails the guard (IMPL-verified with temporary stub, reverted).
4. PUT-discrimination test fails if `repositories/generic.py` switches to `exclude_unset` (IMPL-verified with temporary mutation, reverted).
5. **`TestGenericServiceIsActiveContract` green (5 tests × 4 soft entities); fails if the `is_active` strip is removed from `SoftDeleteService` (IMPL-verified mutation, reverted). Same 5 semantics green for Service via `test_service_service.py`.**
6. The 3 non-generic list tests live in `test_service_service.py` (new), `test_record_service.py` (new), `test_visit_service.py` (extended); `test_generic_service_list.py` deleted; §3.4 mapping holds.
7. Production changes confined to §3.5 files (`git diff --name-only backend/src/` shows exactly: schemas/{master,location,material,client,service}.py, services/{generic,service}.py).
8. `docs/domain-rules/_overview.md` (new is_active-semantics section + `:97` reference fix) and 5 per-entity files updated.
9. Full backend suite green (≈ 987p/5s); admin vitest + type-check green (incl. the 4 modal is_active tests); api-client types verified against the changed schemas.

## 7. Visual Compliance Checks

N/A — backend-only (tests + service/schema internals); no user-visible UI change (frontend behavior unchanged — modals already send `is_active`).

## 8. Decisions log

- **D1:** `GENERIC_PATCH_EXCEPTIONS` → `GENERIC_CONTRACT_EXCEPTIONS` rename.
- **D2:** `Payment.record_id` NOT excluded from update payload (concept said excluded) — `PaymentUpdate` requires it; supplied unchanged via `fk_map`. `Visitor.client_id` genuinely excluded via `model_fields` filter.
- **D3:** Update payload = `create_data` + `fk_map` + `update_data`, filtered to `update_schema.model_fields`.
- **D4 (rev 3):** `is_active` never an explicit `update_data` key — its semantics are pinned by the dedicated `TestGenericServiceIsActiveContract`; schema default flips to `None` + service-layer strip make it a sticky field.
- **D5:** Soft list-absence in DeleteSemantics; ListContract asserts shape/pagination/filter/total only.
- **D6:** `unique_row_field` (Tag only) — only `Tag.tag` has a DB unique constraint among the 8.
- **D7:** PUT discrimination — unchanged-fields assertion + omission test (`nullable_field` reverts to schema default); `is_active` is the documented sticky-field exception and is exercised separately.
- **D8:** Service-level multi-row seeding with shared FK parents; ORM seeding rejected (shape drift).
- **D9:** `test_delete_already_deleted_soft_returns_false` (soft only).
- **D10:** `test_list_empty` — net-new empty-state envelope lock.
- **D11 (user-directive implementation):** Service fixed in #184 alongside the 4 contract soft entities — same hazard, same fix shape; uniform semantics beat partial consistency. Contract-exception status unchanged: its `is_active` tests live in `test_service_service.py`.
- **D12 (user directive 1):** `get` returning archived rows is **correct and locked** (paired deliberately with list hiding them); all 5 soft Response schemas already expose `is_active` — no Response-schema production change needed.
- **Panel suggestions dismissed:** single-sentinel update instead of `update_data` (concept-mandated, weaker); 2-representative pagination (defeats the pattern; real `list` overrides exist); merging create-persists into get test (resolved via ORM-level path instead).
