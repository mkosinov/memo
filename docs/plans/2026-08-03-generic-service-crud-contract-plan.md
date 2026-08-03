# GH #184 — GenericService Full-CRUD Service Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One parametrized contract file (`backend/tests/services/test_generic_service_contract.py`) covering full CRUD for all GenericService subclasses — new service = one `EntityConfig` entry → full coverage — plus the G1b-directed production fix: `is_active` becomes a sticky field on update/patch for soft-delete entities (omitted/None = preserve stored value; explicit bool = apply).

**Architecture:** Extend the existing contract pattern (#175/PR #181): `__subclasses__()` auto-discovery + `CONTRACT_CONFIG` + `make_entity` fixture, parametrized over the 8 configured entities. The `is_active` fix lives in the service layer per the #195 rule "base GenericService has NO is_active knowledge": stored-value injection in `SoftDeleteService.update`, a `_patch_payload` hook for patch, one shared `_strip_is_active_none` helper also used by `ServiceService` (which re-implements update/patch without super()).

**Tech Stack:** pytest (asyncio_mode=auto), SQLAlchemy 2.0 async, Pydantic v2, FastAPI

**Spec:** `docs/specs/2026-08-03-generic-service-crud-contract-design.md` (rev 4, G1b-approved 2026-08-03)

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria:

- **Admin edits an archived master/location/material/service (or API consumer PUTs without `is_active`)** → the record **stays archived** (previously: silently reactivated). Explicitly sending `is_active: true` on an archived record = legal reactivation; sending `false` on an active record = archiving. PATCH behaves identically; `is_active: null` now means "don't touch" (previously: DB error).
- **API consumer GETs an archived record by id** → record is returned with `is_active: false` visible (unchanged behavior, now locked by tests).
- **Clients API** → Update/Patch schemas gain an optional `is_active` field, aligning clients with the other soft-delete entities (no UI change; restore-buttons UI remains a follow-up).
- **Developer adds a new GenericService subclass** → writes one `CONTRACT_CONFIG` entry → gets full CRUD + (if soft-delete) `is_active` semantics coverage automatically; without the entry, a guard test fails with MISSING-CONFIG.
- **Developer breaks generic semantics** (update nonexistent ≠ None, PUT partially applying fields, soft-deleted row in list, `is_active` resurrection) → the contract fails across all entities in one file, not scattered per-entity tests.
- **Test suite** → backend ≈ 854p/3s becomes ≈ 981p/5s; `test_generic_service_list.py` dissolved (generic parts parametrized into the contract file, 3 service-specific tests moved to per-entity files); production diff confined to 7 files under `backend/src/`.

---

## File Structure

### New test files

| File | Responsibility |
|------|----------------|
| `backend/tests/services/test_generic_service_contract.py` | **Renamed** from `test_generic_service_patch.py` (git mv). Full-CRUD parametrized contract + guards |
| `backend/tests/services/test_service_service.py` | Moved `test_service_service_list_paginated` (eager-load) + 5 per-entity Service `is_active` tests |
| `backend/tests/services/test_record_service.py` | Moved `test_record_service_list_paginated_with_client_filter` |

### Modified test files

| File | Action |
|------|--------|
| `backend/tests/services/test_visit_service.py` | Receives moved `test_visit_service_list_paginated` |

### Deleted test files

| File | Reason |
|------|--------|
| `backend/tests/services/test_generic_service_list.py` | Generic parts absorbed (parametrized) into contract file; non-generic moved per §3.4 spec mapping |

### Modified `src/` files (bounded — spec AC 7)

| File | What's modified |
|------|----------------|
| `backend/src/schemas/master.py` (:29) | `is_active: bool = True` → `bool \| None = None` (MasterUpdate) |
| `backend/src/schemas/location.py` (:33) | same (LocationUpdate) |
| `backend/src/schemas/material.py` (:20) | same (MaterialUpdate) |
| `backend/src/schemas/service.py` (:56) | same (ServiceUpdate) |
| `backend/src/schemas/client.py` | add `is_active: bool \| None = None` to `ClientUpdate` and `ClientPatch` |
| `backend/src/services/generic.py` | `_strip_is_active_none` helper; `GenericService._patch_payload` hook extraction; `SoftDeleteService.update` + `SoftDeleteService._patch_payload` overrides |
| `backend/src/services/service.py` | apply `_strip_is_active_none` in `ServiceService.update`/`patch` dict paths |

### Modified docs

| File | What's modified |
|------|----------------|
| `docs/domain-rules/_overview.md` | New "is_active semantics on get/update/patch" section; PATCH None-table third row; create-side line; reorder line; `:97` file-name reference fix |
| `docs/domain-rules/{masters,locations,materials,clients,services}.md` | "Archive semantics on write" section each; `clients.md:30-32` reframe (schema gap closed, UI restore still follow-up) |
| `docs/specs/2026-08-02-is-active-list-filters-design.md` | One-line addendum in §3: out-of-scope default flip now addressed by #184 |

---

## Task 1: Rename contract file + extend EntityConfig + make_entity overrides

### Classification: standard

### Required Docs
- `docs/specs/2026-08-03-generic-service-crud-contract-design.md` §3.1-§3.2 — the rename, D1, new config fields
- `backend/tests/services/test_generic_service_patch.py` — the file being renamed (read fully before editing)
- pytest-patterns skill — fixture conventions

### Task Description

Mechanical foundation for all later tasks. No behavior change — all existing tests must stay green.

**Steps:**

- [ ] 1. `git mv backend/tests/services/test_generic_service_patch.py backend/tests/services/test_generic_service_contract.py`
- [ ] 2. In the renamed file: rename constant `GENERIC_PATCH_EXCEPTIONS` → `GENERIC_CONTRACT_EXCEPTIONS` (same set `{ServiceService, PhotoService, RecordService, SoftDeleteService}`), update all references and its comment. Update the module docstring: the file is the single source of truth for GenericService **full-CRUD** generic semantics (create/get/list/update/patch/delete), discovered via `__subclasses__()`, exceptions have their own tests.
- [ ] 3. Extend the `EntityConfig` NamedTuple (currently `service_factory, model, create_schema, patch_schema, create_data, fk_map, not_null_field, not_null_sentinel, nullable_field, nullable_sentinel, delete_semantics`). Append three fields (after `delete_semantics`; `unique_row_field` needs a default so it must be last):
  ```python
  class EntityConfig(NamedTuple):
      service_factory: Callable
      model: type
      create_schema: type
      patch_schema: type
      create_data: dict
      fk_map: dict            # field name -> fixture name (existing; verify actual current type annotation)
      not_null_field: str | None
      not_null_sentinel: object
      nullable_field: str | None
      nullable_sentinel: object
      delete_semantics: Literal["soft", "hard"]
      update_schema: type     # PUT-style schema; Tag uses TagCreate (no TagUpdate exists)
      update_data: dict       # fields present in update_schema, values != create_data; never contains is_active
      unique_row_field: str | None = None  # DB-unique column varied per row in multi-row tests (Tag only)
  ```
  (Field order of the pre-existing fields must stay exactly as in the current file — the snippet shows intent; preserve the file's actual declarations/imports.)
- [ ] 4. Extend all 8 `CONTRACT_CONFIG` entries (keyword args) with these exact values:

  | Entity | update_schema | update_data | unique_row_field |
  |--------|---------------|-------------|------------------|
  | Activity | `ActivityUpdate` | `{"start": datetime(2030, 2, 2, 12, 0), "duration": 90, "capacity": 20}` | — |
  | Client | `ClientUpdate` | `{"name": "Petr", "phone": "+79111111111"}` | — |
  | Location | `LocationUpdate` | `{"name": "Loc2", "capacity": 10}` | — |
  | Master | `MasterUpdate` | `{"first_name": "A2", "last_name": "B2", "color": "#000000"}` | — |
  | Material | `MaterialUpdate` | `{"title": "T2", "description": "D2"}` | — |
  | Payment | `PaymentUpdate` | `{"amount": 200, "method": "cash"}` | — |
  | Tag | `TagCreate` | `{"tag": "t2-upd"}` | `"tag"` |
  | Visitor | `VisitorUpdate` | `{"name": "V2", "age": 11}` | — |

  Add imports: `ActivityUpdate`, `ClientUpdate`, `LocationUpdate`, `MasterUpdate`, `MaterialUpdate`, `PaymentUpdate`, `VisitorUpdate` from their schema modules (`TagCreate` already imported).
- [ ] 5. Extend the `make_entity` fixture: inner `_make` gains `**overrides` merged into the copied `create_data`, and an optional keyword `with_input: bool = False`. When `with_input=True`, return `(service, created_resp, input_schema)` — the constructed `create_schema` instance (carries parsed types + resolved FK ids); otherwise keep returning the 2-tuple (existing call sites unaffected):
  ```python
  async def _make(cfg, with_input: bool = False, **overrides):
      create_data = dict(cfg.create_data)
      for field, fixture_name in cfg.fk_map.items():
          factory = request.getfixturevalue(fixture_name)
          created = factory()
          create_data[field] = created["id"]
      create_data.update(overrides)
      service = cfg.service_factory()
      input_schema = cfg.create_schema(**create_data)
      created_resp = await service.create(db_session, input_schema)
      if with_input:
          return service, created_resp, input_schema
      return service, created_resp
  ```
- [ ] 6. Verify: `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` — all pre-existing tests (patch contract, delete semantics, guards) green, zero regressions from the rename/config extension.
- [ ] 7. Commit: `test: rename generic service patch contract to full-CRUD contract file (#184)`

---

## Task 2: Create + Get contract classes

### Classification: standard

### Required Docs
- Spec §3.3 (Create/Get rows)
- pytest-patterns skill — parametrization conventions

### Task Description

Add two parametrized classes to `test_generic_service_contract.py`, using the existing `_contract_params()` and `make_entity`.

**Steps:**

- [ ] 1. Add `TestGenericServiceCreateContract` (parametrized via `@pytest.mark.parametrize("service_cls,cfg", _contract_params())`, same decorator as the patch class — follow the file's existing pattern including the `assert cfg is not None` first line):
  ```python
  class TestGenericServiceCreateContract:
      async def test_create_response_contains_create_data_fields(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG  # reuse the file's existing message pattern
          service, created, sent = await make_entity(cfg, with_input=True)
          for field in cfg.create_data:
              if field in type(created).model_fields:
                  assert getattr(created, field) == getattr(sent, field), (
                      f"{service_cls.__name__}.create: response field {field} mismatch"
                  )

      async def test_create_persists_row(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG
          service, created = await make_entity(cfg)
          row = await db_session.get(cfg.model, created.id)  # ORM-level, distinct from service.get
          assert row is not None, f"{service_cls.__name__}.create: row not persisted"
  ```
- [ ] 2. Add `TestGenericServiceGetContract`:
  ```python
  class TestGenericServiceGetContract:
      async def test_get_returns_created_entity(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG
          service, created, sent = await make_entity(cfg, with_input=True)
          fetched = await service.get(db_session, created.id)
          assert fetched is not None
          for field in cfg.create_data:
              if field in type(fetched).model_fields and field not in cfg.fk_map:
                  assert getattr(fetched, field) == getattr(sent, field)

      async def test_get_nonexistent_returns_none(self, service_cls, cfg, db_session):
          assert cfg is not None, MISSING_MSG
          service = cfg.service_factory()
          assert await service.get(db_session, "nonexistent-id") is None
  ```
- [ ] 3. Verify: `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` — green (16 new cases).
- [ ] 4. Commit: `test: add create/get contract classes to generic service contract (#184)`

---

## Task 3: List contract + dissolve test_generic_service_list.py

### Classification: standard

### Required Docs
- Spec §3.3 (List row), §3.4 (absorption mapping)
- `backend/tests/services/test_generic_service_list.py` — the file being dissolved (read fully)
- pytest-patterns skill

### Task Description

Parametrize the generic list behaviors over all 8 entities; move the 3 non-generic tests to per-entity homes; delete the old file.

**Steps:**

- [ ] 1. Add a `seed_rows` fixture to the contract file (next to `make_entity`):
  ```python
  @pytest.fixture
  def seed_rows(request, db_session):
      """Create n rows via the entity's service. FK parents resolved ONCE and shared;
      unique_row_field (Tag.tag) suffixed per row to respect the DB unique constraint."""
      async def _seed(cfg, n: int):
          base_data = dict(cfg.create_data)
          fk_ids = {}
          for field, fixture_name in cfg.fk_map.items():
              factory = request.getfixturevalue(fixture_name)
              fk_ids[field] = factory()["id"]
          service = cfg.service_factory()
          created = []
          for i in range(n):
              data = {**base_data, **fk_ids}
              if cfg.unique_row_field:
                  data[cfg.unique_row_field] = f"{base_data[cfg.unique_row_field]}-{i}"
              created.append(await service.create(db_session, cfg.create_schema(**data)))
          return service, created
      return _seed
  ```
- [ ] 2. Add `TestGenericServiceListContract` (parametrized like Task 2 classes; `db_session`, `make_entity`, `seed_rows` fixtures as needed; every test starts with the `assert cfg is not None` line):
  ```python
  class TestGenericServiceListContract:
      async def test_list_envelope_shape(self, service_cls, cfg, db_session, make_entity):
          # create 1 row; resp = await service.list(db_session)
          # assert resp.page == 1 and resp.per_page == 20 and resp.total == 1
          # assert isinstance(resp.items, list); assert set of response fields == {"items", "total", "page", "per_page"}
          #   (use: assert set(type(resp).model_fields) == {"items", "total", "page", "per_page"})

      async def test_list_contains_created_entity(self, service_cls, cfg, db_session, make_entity):
          # create 1 via make_entity; resp = list()
          # assert created.id in [item.id for item in resp.items]; assert resp.total == 1

      async def test_list_empty(self, service_cls, cfg, db_session):
          # fresh DB (reset_db autouse); resp = await cfg.service_factory().list(db_session)
          # assert resp.total == 0 and resp.items == []

      async def test_list_pagination_slices_and_total(self, service_cls, cfg, db_session, seed_rows):
          # service, rows = await seed_rows(cfg, 3)
          # page1 = await service.list(db_session, page=1, per_page=2); page2 = ...(page=2, per_page=2)
          # assert len(page1.items) == 2 and len(page2.items) == 1
          # assert page1.total == page2.total == 3
          # ids disjoint: {i.id for i in page1.items}.isdisjoint({i.id for i in page2.items})

      async def test_list_out_of_range_page(self, service_cls, cfg, db_session, seed_rows):
          # seed 3; resp = await service.list(db_session, page=99, per_page=2)
          # assert resp.items == [] and resp.total == 3

      async def test_list_id_filter_narrows_items_and_total(self, service_cls, cfg, db_session, seed_rows):
          # seed 3; target = rows[0]; resp = await service.list(db_session, id=target.id)
          # assert resp.total == 1 and resp.items[0].id == target.id
  ```
  (Method bodies written out as above = full logic; implementer expands the comment lines into the exact asserts shown — no additional behavior.)
- [ ] 3. Create `backend/tests/services/test_service_service.py`: move `test_service_service_list_paginated` (eager-loaded tariffs/tags) verbatim from `test_generic_service_list.py:140-158`, preserving its imports/fixtures. File gets a module docstring: "Per-entity ServiceService tests (contract exception — own update/patch/list semantics)."
- [ ] 4. Create `backend/tests/services/test_record_service.py`: move `test_record_service_list_paginated_with_client_filter` verbatim from `:159-176`.
- [ ] 5. Move `test_visit_service_list_paginated` verbatim from `:177-186` into the existing `backend/tests/services/test_visit_service.py` (append; match its asyncio mark/style).
- [ ] 6. Delete `backend/tests/services/test_generic_service_list.py` (`git rm`).
- [ ] 7. Verify: `cd backend && python -m pytest tests/services/ -q` — green; then full `python -m pytest -q` — green.
- [ ] 8. **Mutation check (spec AC 4 setup happens in Task 4; here list-only):** none. Sanity: confirm the 3 moved tests run under their new paths (`pytest tests/services/test_service_service.py tests/services/test_record_service.py tests/services/test_visit_service.py -q`).
- [ ] 9. Commit: `test: parametrized list contract; dissolve test_generic_service_list.py (#184)`

---

## Task 4: Update contract (PUT full-replace)

### Classification: standard

### Required Docs
- Spec §3.2 (payload construction, D2/D3), §3.3 (Update row, D7)
- pytest-patterns skill

### Task Description

Add `TestGenericServiceUpdateContract` — the first-ever generic coverage of PUT-style `update()`. Depends on Task 1 (`update_schema`, `update_data`, `with_input`).

**Steps:**

- [ ] 1. Add a module-level payload helper to the contract file:
  ```python
  def _update_kwargs(cfg, sent) -> dict:
      """PUT payload = create fields (parsed, incl. resolved FK ids) + update_data,
      filtered to update_schema fields. FK values come from `sent` (the create_schema
      instance returned by make_entity(with_input=True)) — reused unchanged (D2/D3).
      VisitorUpdate has no client_id and is_active is never sent explicitly here —
      both dropped by the model_fields filter / never added."""
      allowed = set(cfg.update_schema.model_fields)
      data = {k: v for k, v in sent.model_dump().items() if k in allowed}
      data.update(cfg.update_data)
      return data
  ```
- [ ] 2. Add the class:
  ```python
  class TestGenericServiceUpdateContract:
      async def test_update_applies_update_data(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG
          service, created, sent = await make_entity(cfg, with_input=True)
          payload = _update_kwargs(cfg, sent)
          updated = await service.update(db_session, created.id, cfg.update_schema(**payload))
          assert updated is not None
          after = await service.get(db_session, created.id)
          for field, value in cfg.update_data.items():
              assert getattr(after, field) == value, f"{service_cls.__name__}: update_data field {field} not applied"
          sent_dump = sent.model_dump()
          for field in set(payload) - set(cfg.update_data):
              assert getattr(after, field) == sent_dump[field], f"{service_cls.__name__}: field {field} unexpectedly changed"

      async def test_update_nonexistent_returns_none(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG
          service, created, sent = await make_entity(cfg, with_input=True)  # entity only to build a valid payload
          payload = _update_kwargs(cfg, sent)
          assert await service.update(db_session, "nonexistent-id", cfg.update_schema(**payload)) is None

      async def test_update_omitted_optional_field_reverts_to_default(self, service_cls, cfg, db_session, make_entity):
          assert cfg is not None, MISSING_MSG
          if cfg.nullable_field is None:
              pytest.skip(f"{service_cls.__name__}: no nullable field (PUT default-reversion not exercisable)")
          service, created, sent = await make_entity(cfg, with_input=True)
          # created row already carries a non-default nullable_field value via create_data (verified: all 8 configs)
          payload = _update_kwargs(cfg, sent)
          payload.pop(cfg.nullable_field, None)  # explicit pop — it otherwise rides along from create_data (spec panel fix)
          updated = await service.update(db_session, created.id, cfg.update_schema(**payload))
          assert updated is not None
          after = await service.get(db_session, created.id)
          expected_default = cfg.update_schema.model_fields[cfg.nullable_field].default
          assert getattr(after, cfg.nullable_field) == expected_default, (
              f"{service_cls.__name__}: omitted {cfg.nullable_field} did not revert to schema default — "
              f"full-replace (PUT) semantics broken (patch semantics leakage?)"
          )
  ```
- [ ] 3. Verify: `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` — green (22 new cases; Tag/Material omission cases skip).
- [ ] 4. **Mutation check (spec AC 4):** temporarily change `backend/src/repositories/generic.py` `update()` to use `model_dump(exclude_unset=True)` → `test_update_omitted_optional_field_reverts_to_default` MUST fail → revert. Report the observed failure in the task report.
- [ ] 5. Commit: `test: add update (PUT full-replace) contract class (#184)`

---

## Task 5: DeleteSemantics edge-case additions

### Classification: small

### Required Docs
- Spec §3.3 (DeleteSemantics row), §2 (delete edge behaviors)
- pytest-patterns skill

### Task Description

Three additions to the existing `TestGenericServiceDeleteSemantics` class (parametrized the same way):

**Steps:**

- [ ] 1. `test_delete_nonexistent_returns_false`: `service = cfg.service_factory()`; `assert await service.delete(db_session, "nonexistent-id") is False`.
- [ ] 2. `test_delete_already_deleted_soft_returns_false`: `if cfg.delete_semantics != "soft": pytest.skip(...)`; create via `make_entity` → first `delete()` returns True → second `delete()` returns False (locks `SoftDeleteRepository.delete` already-inactive edge, `repositories/generic.py:147-156`).
- [ ] 3. `test_soft_deleted_absent_from_list`: `if cfg.delete_semantics != "soft": pytest.skip(...)`; create → `delete()` → `resp = await service.list(db_session)`; assert `created.id not in [i.id for i in resp.items]` and `resp.total == 0` ("list hides" half of the list/get pairing).
- [ ] 4. Verify: `cd backend && python -m pytest tests/services/test_generic_service_contract.py -q` — green (16 new cases).
- [ ] 5. Commit: `test: delete edge cases in generic service contract (#184)`

---

## Task 6: is_active stickiness — RED contract tests + GREEN production fix

### Classification: large

### Required Docs
- Spec §2 (amended contract table), §3.3 (IsActiveContract row), §3.5 (production fix + D13 mechanism), §8 (D11-D13)
- `docs/domain-rules/_overview.md` — Deletion Policy (current state)
- pytest-patterns skill
- **Required skill: test-driven-development** — strict RED-GREEN-REFACTOR for this task

### Task Description

User-directed semantics (G1b): get returns archived rows; update/patch preserve `is_active` when absent/None; explicit bool applies (`True` on archived = legal reactivation). TDD: write the RED tests first, watch them fail for the right reason, then implement the bounded production fix.

**Steps — RED:**

- [ ] 1. Add `TestGenericServiceIsActiveContract` to the contract file (parametrized like the other classes; every test starts with the `assert cfg is not None` line and `if cfg.delete_semantics != "soft": pytest.skip(f"{service_cls.__name__}: hard-delete entity")`):
  ```python
  class TestGenericServiceIsActiveContract:
      async def test_get_archived_returns_row_with_is_active_false(self, service_cls, cfg, db_session, make_entity):
          # create → await service.delete(db_session, created.id) → fetched = await service.get(...)
          # assert fetched is not None, "get must return archived rows (user decision 1)"
          # assert fetched.is_active is False

      async def test_update_preserves_is_active_when_omitted(self, service_cls, cfg, db_session, make_entity):
          # phase 1 (archived stays archived): create → delete → update with _update_kwargs(cfg, sent)
          #   → after = get → assert after.is_active is False, "PUT without is_active must not resurrect"
          # phase 2 (active stays active): create second entity (fresh make_entity call) → update, no is_active
          #   → assert (await service.get(...)).is_active is True

      async def test_update_explicit_is_active_applies(self, service_cls, cfg, db_session, make_entity):
          # create → payload = _update_kwargs(cfg, sent); payload["is_active"] = False
          #   → update → assert (await service.get(...)).is_active is False, "explicit False must archive"
          # payload["is_active"] = True → update again → assert is_active is True, "explicit True must reactivate"
          # resp = await service.list(db_session) → assert created.id in [i.id for i in resp.items], "reactivated row visible in list again"

      async def test_patch_preserves_is_active_when_omitted_or_none(self, service_cls, cfg, db_session, make_entity):
          # create → delete (archived)
          # omitted: await service.patch(db_session, id, cfg.patch_schema()) → assert get().is_active is False
          # explicit None: await service.patch(db_session, id, cfg.patch_schema(is_active=None))
          #   → assert get().is_active is False, "is_active=None must mean preserve, never NULL"

      async def test_patch_explicit_is_active_applies(self, service_cls, cfg, db_session, make_entity):
          # create → patch(cfg.patch_schema(is_active=False)) → assert get().is_active is False
          # patch(cfg.patch_schema(is_active=True)) → assert get().is_active is True
          # list() contains the row again
  ```
  Multi-phase tests use labeled asserts (messages above) for failure localization (spec D-log).
- [ ] 2. Add the 5 per-entity Service tests to `backend/tests/services/test_service_service.py` (Service is a contract exception with its own update/patch — spec D11). Mirror the 5 flows above against `ServiceService` directly: create the row via the existing `create_service` API factory (as the moved list test does), then operate via `ServiceService()` methods with `ServiceUpdate`/`ServicePatch`. For the `ServiceUpdate` payload, mirror the exact field set used by the existing green service PUT test in `backend/tests/test_put_is_active.py:95-115` (read it and copy its data shape, changing values). Assert the same 5 semantics (get archived → returned; update/patch preserve on omitted/None; explicit False archives; explicit True reactivates + visible in list).
- [ ] 3. Run RED: `cd backend && python -m pytest tests/services/test_generic_service_contract.py -k IsActive tests/services/test_service_service.py -q`. Expected: `test_update_preserves_is_active_when_omitted` FAILS (silent resurrection), `test_patch_preserves_is_active_when_omitted_or_none` FAILS on the explicit-None phase (NULL write / IntegrityError); the get-archived and explicit-bool tests pass already. If the RED failures differ, STOP and report — do not proceed to GREEN.

**Steps — GREEN (production fix, bounded to spec §3.5 files):**

- [ ] 4. Schemas — flip 4 Update defaults with a trailing comment `# None = preserve stored value; sticky field (#184)`:
  - `backend/src/schemas/master.py:29`, `location.py:33`, `material.py:20`, `service.py:56`: `is_active: bool = True` → `is_active: bool | None = None`
- [ ] 5. `backend/src/schemas/client.py`: add `is_active: bool | None = None  # None = preserve stored value; sticky field (#184)` to `ClientUpdate` (class body currently `pass` — give it the field) and to `ClientPatch`.
- [ ] 6. `backend/src/services/generic.py`:
  - Add module-level helper:
    ```python
    def _strip_is_active_none(payload: dict) -> dict:
        """Drop is_active when None — sticky field: absent/None preserves the stored value (#184).

        Shared by SoftDeleteService._patch_payload and ServiceService.update/patch
        (ServiceService re-implements update/patch without super() — single helper
        prevents the drift that hid the resurrection hazard there)."""
        if payload.get("is_active") is None:
            payload.pop("is_active", None)
        return payload
    ```
  - In `GenericService` (patch at :115-136): move the existing `model_dump(exclude_unset=True)` + NOT_NULL-strip lines verbatim into a new method `def _patch_payload(self, data: BaseModel) -> dict:`; `patch()` calls `payload = self._patch_payload(data)` in their place. **Logic must be byte-identical** — the existing patch contract guards it. Base stays free of `is_active` knowledge.
  - Add to `SoftDeleteService` (:155-179):
    ```python
    async def update(self, db_session, id, data):
        """PUT with sticky is_active: None/absent → stored value injected before full replace (#184).

        Injection (not stripping) is required: base update re-dumps the schema internally,
        so a stripped key would re-enter as the schema default. Explicit bool passes through
        (True on an archived row = legal reactivation)."""
        if "is_active" in type(data).model_fields and data.is_active is None:
            current = await self.get(db_session, id)
            if current is None:
                return None
            data = data.model_copy(update={"is_active": current.is_active})
        return await super().update(db_session, id, data)

    def _patch_payload(self, data):
        return _strip_is_active_none(super()._patch_payload(data))
    ```
    (Match the base class's exact parameter names/type annotations for `update` — read them at generic.py:105-113. If base `update` carries `@transactional`, the override intentionally does NOT repeat it: the `super().update()` call enters the decorated base method.)
- [ ] 7. `backend/src/services/service.py`: in `ServiceService.update` (:110-146) wrap the apply-dict: `update_data = _strip_is_active_none(data.model_dump(exclude={"tariffs", "tag_ids"}))`; in `ServiceService.patch` (:148-206) apply the same helper to its apply-dict at the equivalent spot (read both methods; the dict that is `setattr`-looped is the target). Import `_strip_is_active_none` from `src.services.generic`.
- [ ] 8. Run GREEN: `cd backend && python -m pytest tests/services/ tests/test_put_is_active.py tests/test_patch_is_active.py -q` — all green.
- [ ] 9. **Mutation checks (spec AC 5):** (a) comment out the `model_copy` injection in `SoftDeleteService.update` → `test_update_preserves_is_active_when_omitted` MUST fail → revert; (b) make `_strip_is_active_none` a no-op → `test_patch_preserves_is_active_when_omitted_or_none` MUST fail → revert. Report observed failures.
- [ ] 10. Full suite: `cd backend && python -m pytest -q` — green. Then `git diff --stat main -- src/` — shows exactly the 7 files from spec AC 7.
- [ ] 11. Commit (single commit at green — the RED state is never committed): `fix: sticky is_active on update/patch for soft-delete entities + contract tests (#184)`

---

## Task 7: Domain-rules documentation + addenda

### Classification: small

### Required Docs
- Spec §3.6 (exact doc changes)
- `docs/domain-rules/_overview.md` (current Deletion Policy + PATCH Contract sections)

### Task Description

**Steps:**

- [ ] 1. `docs/domain-rules/_overview.md`:
  - Add section **"is_active semantics on get/update/patch"** (under Deletion Policy): (1) `get` returns archived rows; `is_active` is exposed in all soft-delete Response schemas — *list hides, get returns* (deliberate pairing); (2) update (PUT) and patch preserve the stored `is_active` when the field is absent or `None`; an explicit boolean always applies — `true` on an archived record is the legal reactivation path, `false` archives; (3) `is_active` is a documented sticky-field exception to PUT full-replace (like `id`/`created_at`), implemented in `SoftDeleteService` (+ `ServiceService` overrides) — see spec GH #184.
  - PATCH Contract None-handling table (:89-95): add third row — `is_active: None` (soft-delete entities) → stripped, stored value preserved (sticky field; see section above).
  - Add one line: create always yields `is_active=True` — Create schemas do not expose the field; adding it there would bypass sticky semantics (trap, do not do).
  - Add one line: `reorder` silently skips archived rows (`repositories/generic.py:169`) — a reactivated row becomes reorder-eligible again.
  - Fix the stale reference at :97: `test_generic_service_patch.py` → `test_generic_service_contract.py`.
- [ ] 2. Per-entity files `masters.md`, `locations.md`, `materials.md`, `clients.md`, `services.md`: add a short **"Archive semantics on write"** section: pointer to the `_overview.md` general rule + entity note (Client: `is_active` now accepted by Update/Patch schemas — archive/restore via PATCH possible; Service: strip implemented in its own `update`/`patch` overrides; Master/Location/Material: inherited from `SoftDeleteService`).
- [ ] 3. `clients.md:30-32` reframe: the schema-level gap (`ClientPatch` lacked `is_active`) is closed by #184; only the frontend restore-buttons UI remains a follow-up.
- [ ] 4. `docs/specs/2026-08-02-is-active-list-filters-design.md` §3: add one-line addendum to the "Backend Update-schema `is_active: bool = True` default — out of scope" item: "*Addressed by GH #184 (rev 4 §3.5): defaults flipped to `bool | None = None`, sticky-field semantics.*"
- [ ] 5. Commit: `docs: is_active get/update/patch semantics in domain-rules (#184)`

---

## Verification (final, phase-level)

1. `cd backend && python -m pytest -q` — green; counts ≈ 981 passed / 5 skipped (baseline 854p/3s + net +127 tests, +2 skips; implementer reports actual `pytest -q` tail).
2. `git diff main --stat -- src/` — exactly: `schemas/{master,location,material,client,service}.py`, `services/{generic,service}.py`.
3. `git diff main --name-only -- tests/` — shows: renamed contract file, deleted list file, new `test_service_service.py` / `test_record_service.py`, modified `test_visit_service.py`; nothing else.
4. Mutation checks reported green-by-failure (Task 4 step 4, Task 6 step 9).
5. Guard sanity (spec scenario 2): temporarily add `class _DummyService(GenericService): pass` in a scratch test → `test_all_generic_subclasses_covered_or_excepted` fails → revert. Report result.
6. Frontend compatibility (schema change ripples): from repo root `npm run test:all` — api-client tests, admin vitest (incl. the 4 modal `is_active` tests), type-check all green. If api-client has generated OpenAPI types for the 5 changed schemas, regenerate per repo convention and include in the branch; if hand-written, confirm `is_active` optional-nullable is compatible (frontend already sends the field explicitly).
7. Acceptance criteria spec §6.1-6.9 — all checked.
