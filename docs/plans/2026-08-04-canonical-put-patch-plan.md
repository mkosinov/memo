# GH #178 — Canonical PUT/PATCH types (api-client + backend, 4 entities) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PUT canonical for Master, Service, Location, Material — `is_active` required end-to-end (zod `XUpdateSchema = XCreateSchema.extend({is_active})`, backend `XUpdate.is_active: bool`), remove the sticky-injection leniency and all type workarounds, flip the test suite to the new semantics.

**Architecture:** Three stacked layers, one task each: backend (schemas + services + tests, single TDD cycle), api-client (zod schemas + endpoint signatures + tests), frontend admin (hooks + 4 typed PUT payloads + hook tests). Domain-rules sync closes the feature. Client stays optional-`is_active` until GH #201 — with the user-accepted regression window (Client PUT omitting `is_active` → 500).

**Tech Stack:** Pydantic v2 (`FieldInfo.is_required()`, `ValidationError`), FastAPI (422 on schema validation), zod 3.23 (`.extend()`, `.default()`), TypeScript, React Query mutations, pytest, vitest.

**Spec:** `docs/specs/2026-08-04-canonical-put-patch-design.md` (rev 3, G1b-approved 2026-08-04).

**Hard constraints (user decisions):**
- The `SoftDeleteService.update` injection branch is **REMOVED** (user overrode the spec-panel BLOCKER at G1b). Accepted consequence: Client PUT omitting `is_active` regresses to 500 until #201 (Next Up 2, starts immediately after; no production). Every Client skip introduced MUST contain `#201` in its reason.
- PATCH sticky semantics (`absent`/`None` → preserve) stay everywhere, incl. Client. `_strip_is_active_none` is kept for the PATCH path.
- Create schemas (backend + zod) are NOT touched. `updateVisitor`/Visitor/UserSettings untouched.
- Admin Client edit (`ClientCardModal.tsx:195` → `contexts/ClientsContext.tsx:115-118,138-143`, payload from `ClientInfoTab.tsx:59` = name/phone/email/channel only, no `is_active`) will 500 in the window — **accepted**, documented in Task 4 domain rules; fixing it ad-hoc would re-introduce the cast workaround this feature removes.

**Call-site inventory (verified 2026-08-04 via explore — no other consumers exist):**
- Backend PUT tests on the 4 routes lacking `is_active`: `test_generic_api_contract.py:171/:183`, `test_sort_order.py:90`, `test_coverage_boost.py:287/:324`, `test_api_services.py:146/:185/:229`, `test_location_short_title.py:129/:152`. (`test_api_masters/locations/materials.py` have zero PUTs; no scripts/e2e helpers PUT the 4 routes.)
- Frontend `updateX(` callers: only the 4 hooks (`useXMutations.ts:18`), consumed only by the 4 tables. E2E: one locations PUT mock (`e2e/error-messages.spec.ts:166-181`, short-circuits 422, payload-agnostic — no change needed).

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria (cross-layer type/contract feature — delta is developer-facing; the only end-user-visible change is a guard):

- **AC1 — zod Update schemas via `.extend({is_active})`** → A developer writing an update payload in TS now gets a compile error unless every field (including `is_active`) is present; the "send half the fields on PUT" pattern is impossible to type.
- **AC2 — workarounds removed** → The `& { is_active?: boolean }` patches and `TODO(#178)` comments are gone from the 4 PATCH endpoints and 4 hooks; PATCH is plain `Partial<XUpdate>` and still accepts a lone `{ is_active: false }`.
- **AC3 — backend required `is_active` + leniency removed** → `curl -X PUT` on a master/service/location/material without `is_active` now returns **422** (previously 200 with silent state injection). Client PUT without `is_active` temporarily 500s (accepted window until #201); Client tests carry `#201`-referenced skips so the suite stays green by design.
- **AC4 — PATCH sticky unchanged** → Archiving/restoring via single-field PATCH (`{"is_active": false}`/`true`) works exactly as before for all soft entities.
- **AC5 — typed frontend payloads** → The 4 admin edit flows (masters/services/locations/materials tables) build fully typed payload objects — no blanket casts; a null optional field (e.g. avatar) is sent as `''` (the Create default) instead of being dropped.
- **AC6 — suites green** → Backend ≈ 999p/6s (baseline 999p/5s: +1 new 422 test, +1 `#201` Client skip replacing a pass), api-client passing with 4 pre-existing #188 failures unchanged, admin vitest green.
- **AC7 — domain rules synced** → `docs/domain-rules/_overview.md` + entity notes describe the new PUT canon and the #178→#201 Client window.

---

## Task 1: Backend — canonical `is_active` for PUT (schemas + services + tests)

### Classification: large

### Required Docs
- `docs/specs/2026-08-04-canonical-put-patch-design.md` §2, §3.2, §3.4, §5 — the contract and the accepted Client window
- `docs/domain-rules/_overview.md` — "is_active semantics on get/update/patch" (current rule being changed; markdown updated in Task 4, not here)
- `.opencode/skills/pytest-patterns/SKILL.md` — suite conventions

### Task Description

Single TDD cycle: RED (test changes asserting the NEW semantics fail against old code) → GREEN (schema + service edits) → suite green → commit.

**Step 1 — RED: flip/extend the backend tests first.**

- [ ] **1a. `backend/tests/services/test_generic_service_contract.py`** — 3 edits:
  1. Add import if absent: `from pydantic import ValidationError`.
  2. `_update_kwargs` helper (:72-88) — after `data.update(cfg.update_data)` append (entity-conditional guarded injection — spec §3.4, plan-review-aligned):
     ```python
         # GH #178: is_active is a required PUT field for soft entities — the
         # create schema never carries it, so inject it explicitly. Hard
         # entities (no is_active in update_schema) are unaffected by the filter.
         if "is_active" in allowed:
             data.setdefault("is_active", True)
     ```
     Also fix the now-outdated docstring line "``is_active`` is never sent explicitly here" → "``is_active`` is injected as ``True`` for soft entities (required PUT field, GH #178)".
  3. `TestGenericServiceUpdateContract.test_update_applies_update_data` (:738-759): change the unchanged-fields loop to `for field in set(payload) - set(cfg.update_data) - {"is_active"}:` and append after the loop:
     ```python
             if "is_active" in cfg.update_schema.model_fields:
                 assert after.is_active is True, (
                     f"{service_cls.__name__}: explicit is_active=True not applied"
                 )
     ```
  4. Replace `TestGenericServiceIsActiveContract.test_update_preserves_is_active_when_omitted` (:849-895) entirely with:
     ```python
         @pytest.mark.parametrize("service_cls,cfg", _soft_params())
         async def test_update_without_is_active_raises_validation_error(
             self, service_cls, cfg, db_session, make_entity
         ):
             """PUT without ``is_active`` → the Update schema refuses construction
             (canonical full-replace, GH #178): ``is_active`` is required, so
             Pydantic raises ``ValidationError`` before any DB write.

             Entities whose Update schema still treats ``is_active`` as optional
             (Client — until GH #201 redefines Client PUT semantics) skip: the
             check is data-driven via ``FieldInfo.is_required()`` and lifts
             itself automatically when #201 flips ClientUpdate to required.
             """
             assert cfg is not None, MISSING_MSG
             field = cfg.update_schema.model_fields.get("is_active")
             assert field is not None, (
                 f"{service_cls.__name__}: soft entity must expose is_active"
             )
             if not field.is_required():
                 pytest.skip(
                     "GH #201: is_active not yet required for this entity "
                     "(Client PUT semantics redefined there)"
                 )
             service, created, sent = await make_entity(cfg, with_input=True)
             payload = _update_kwargs(cfg, sent)
             payload.pop("is_active")
             with pytest.raises(ValidationError):
                 cfg.update_schema(**payload)
     ```
     (The other 4 IsActive tests — get-archived, explicit-applies, both patch tests — stay unchanged.)
- [ ] **1b. `backend/tests/services/test_service_service.py`**:
  1. Add `from pydantic import ValidationError` import if absent.
  2. Replace `TestServiceIsActiveContract.test_update_preserves_is_active_when_omitted` (:102-138) entirely with:
     ```python
         async def test_update_without_is_active_raises_validation_error(self):
             """PUT without is_active → ServiceUpdate refuses construction (GH #178)."""
             payload = dict(_SERVICE_UPDATE_FIELDS)
             payload.pop("is_active", None)
             with pytest.raises(ValidationError):
                 ServiceUpdate(**payload)
     ```
  3. Sweep the file: `rg -n "ServiceUpdate\(|_SERVICE_UPDATE_FIELDS" backend/tests/services/test_service_service.py` — every OTHER construction site (e.g. tariff/tag update tests, `test_update_explicit_is_active_applies` already sets it explicitly) must pass `is_active` explicitly; add `payload["is_active"] = True` where missing. Adjust the class docstring (:85-90): "stickiness contract" → "is_active contract — canonical PUT (#178) + sticky PATCH".
- [ ] **1c. `backend/tests/test_generic_api_contract.py`** — the `_update_payload` helper (used at :171/:183) currently builds via a `merged` dict returned in one expression. First bind the return value to a local (e.g. `payload = merged ... ; ` restructure minimally), then append before the return:
     ```python
         # GH #178: is_active is a required PUT field for soft entities (Client
         # included — omitting it now 500s until #201).
         if "is_active" in cfg.update_schema.model_fields:
             payload.setdefault("is_active", True)
     ```
     No new 422 test in this file (charter :1-12: business semantics pinned at service level).
- [ ] **1d. `backend/tests/test_api_services.py`**:
  1. `test_update_service` (:132-145): add `"is_active": True,` as first key of `update_data`.
  2. `test_update_nonexistent_service_returns_404` (:185): `json=SERVICE_PAYLOAD` → `json={**SERVICE_PAYLOAD, "is_active": True}` (body must validate → 404, not 422).
  3. `test_update_service_set_max_age_to_null` (:228): `update_data = {**SERVICE_PAYLOAD, "max_age": None}` → `{**SERVICE_PAYLOAD, "max_age": None, "is_active": True}`.
  4. ADD immediately after `test_update_nonexistent_service_returns_404`:
     ```python
         def test_update_service_without_is_active_returns_422(self, api_client) -> None:
             """PUT /api/v1/services/{id} without is_active → 422 (canonical PUT, GH #178)."""
             create_resp = api_client.post("/api/v1/services", json=SERVICE_PAYLOAD)
             service_id = create_resp.json()["id"]

             response = api_client.put(f"/api/v1/services/{service_id}", json=SERVICE_PAYLOAD)
             assert response.status_code == 422
     ```
- [ ] **1e. Payload additions** (`"is_active": True,` in the PUT body):
  - `backend/tests/test_sort_order.py` :90-97 (`test_master_update_sort_order`)
  - `backend/tests/test_location_short_title.py` :129-136 and :152-159 (both PUT bodies)
  - `backend/tests/test_coverage_boost.py` :272-286 and :313-323 (both `update_data` dicts)
- [ ] **1f. `backend/tests/test_api_clients.py`**:
  1. `test_put_sets_all_nullable_to_null` (:195-200): add `"is_active": True,` to the PUT json (None assertions unchanged).
  2. Rename `test_put_empty_body` (:219) → `test_put_minimal_body_sets_others_to_null`; body `json={}` → `json={"is_active": True}`; new docstring: `"""PUT with only is_active sets all nullable fields to null. A truly empty body 500s in the #178→#201 window (Client PUT de-facto requires explicit is_active); #201 redefines Client PUT semantics."""`
  3. `test_put_invalid_channel_returns_422` (:208-217): unchanged (422 at validation, before the service layer).
- [ ] **1g. Straggler sweep + RED run:**
  - `rg -n "\.put\(" backend/tests | grep -E "masters|services|locations|materials|clients"` — every hit accounted for above or already sending `is_active` (`test_put_is_active.py` ×5 stay untouched).
  - `rg -n "(MasterUpdate|LocationUpdate|MaterialUpdate|ServiceUpdate)\(" backend/tests` — every construction includes `is_active` except the two renamed ValidationError tests.
  - `cd backend && python -m pytest tests/services/test_generic_service_contract.py tests/services/test_service_service.py tests/test_api_services.py -q` → the new/flipped tests FAIL (ValidationError not raised; 422 test gets 200) — this is the RED state. Payload-only edits pass already (explicit `is_active` works today).
- [ ] **1h. Extra-field config check:** `rg -n "model_config|extra" backend/src/schemas/master.py backend/src/schemas/location.py backend/src/schemas/material.py backend/src/schemas/service.py` → confirm no `extra="forbid"` on the 4 Update schemas/bases (frontend will send zod-Create-shaped bodies; Pydantic default ignores extras). If `forbid` found → report DONE_WITH_CONCERNS with the finding, do not improvise.

**Step 2 — GREEN: production changes.**

- [ ] **2a. Update schemas** — in each, replace the `is_active` line (drop `| None = None` and the sticky comment):
  - `backend/src/schemas/master.py:29` → `is_active: bool  # required on PUT — canonical full-replace (#178); PATCH sticky via MasterPatch`
  - `backend/src/schemas/location.py:33` → same pattern (`LocationPatch`)
  - `backend/src/schemas/material.py:20` → same pattern (`MaterialPatch`)
  - `backend/src/schemas/service.py:56` → same pattern (`ServicePatch`)
  - `backend/src/schemas/client.py` — **untouched**.
- [ ] **2b. `backend/src/services/generic.py`:** delete the entire `SoftDeleteService.update` override (:202-217 — after branch removal it is a pure passthrough to `GenericService.update`). Verify the base `GenericService.update` carries `@transactional` (read it); if it does NOT, report DONE_WITH_CONCERNS instead of guessing. Update `_strip_is_active_none` docstring (:25-33): "Shared by SoftDeleteService._patch_payload and ServiceService.update/patch" → "Shared by SoftDeleteService._patch_payload and ServiceService.patch".
- [ ] **2c. `backend/src/services/service.py:121`:** `update_data = _strip_is_active_none(data.model_dump(exclude={"tariffs", "tag_ids"}))` → `update_data = data.model_dump(exclude={"tariffs", "tag_ids"})` (`is_active` is now always a real bool; the `setattr` loop applies it). The `patch` override (:178-179) keeps `_strip_is_active_none`. If `_strip_is_active_none` becomes an unused import in this file → remove from imports; it is still used at :179, so it will not.

**Step 3 — verify + commit:**
- [ ] `cd backend && python -m pytest -q` → full suite green. Expected ≈ **999 passed / 6 skipped** (baseline 999p/5s: +1 new 422 test, Client param of the flipped IsActive test moves pass→skip — the two cancel on the pass count). Report exact numbers.
- [ ] `cd backend && python -m ruff check src/schemas src/services tests` → clean.
- [ ] `git add backend/ && git commit -m "feat(backend): canonical PUT — required is_active, drop sticky injection (#178)"`

---

## Task 2: api-client — Update schemas via `.extend()`, drop PATCH workaround

### Classification: standard

### Required Docs
- `docs/specs/2026-08-04-canonical-put-patch-design.md` §2, §3.1, §3.4 — zod contract + test flips
- `packages/api-client/src/schemas.ts` — read the 4 Create schema definitions (:23-30 Master, :383-395 Service, :404-416 Location, :437-440 Material) and current Update definitions (:33, :399, :420, :443) before editing

### Task Description

RED (flipped/new schema tests fail against `.partial()` schemas) → GREEN (`.extend()` + signature cleanup) → green → commit. Note: vitest does not type-check — RED is demonstrated by the runtime "rejects" tests; type-level completeness is verified by `tsc`/`pnpm build` (dts).

**Step 1 — RED: `packages/api-client/src/schemas.test.ts`.**
- [ ] Extend the import block to include `MasterUpdateSchema`, `MaterialUpdateSchema`, `MasterUpdate`, `MaterialUpdate` (as needed by the tests below).
- [ ] Rewrite `it('ServiceUpdate is a valid type')` (:535-538) — full literal:
  ```ts
    it('ServiceUpdate is a valid type', () => {
      const s: ServiceUpdate = {
        title: 'Обновлённое название',
        description: '',
        image_url: '',
        specialty: '',
        min_age: 0,
        max_age: 18,
        duration: 60,
        record_info: '',
        material_hint: '',
        tariffs: [],
        tag_ids: [],
        is_active: true,
      };
      expect(s.title).toBe('Обновлённое название');
    });
  ```
- [ ] Rewrite `it('LocationUpdate is a valid type')` (:550-553) — full literal: `{ name: 'Обновлённая студия', short_title: '', address: '', description: '', capacity: 10, yandex_map_url: '', review_url: '', record_info: '', image_url: '', location_hint: '', tag_ids: [], is_active: true }` (assertion unchanged).
- [ ] Replace the `ServiceUpdateSchema` describe (:660-671) with:
  ```ts
  describe('ServiceUpdateSchema', () => {
    it('accepts a full canonical update payload', () => {
      const result = ServiceUpdateSchema.parse({
        title: 'Новое название',
        duration: 90,
        is_active: true,
      });
      expect(result.title).toBe('Новое название');
      expect(result.is_active).toBe(true);
    });

    it('rejects update missing is_active', () => {
      expect(() =>
        ServiceUpdateSchema.parse({ title: 'Новое название', duration: 90 }),
      ).toThrow();
    });

    it('rejects update missing required create fields', () => {
      expect(() => ServiceUpdateSchema.parse({ is_active: true })).toThrow();
    });
  });
  ```
- [ ] Replace the `LocationUpdateSchema` describe (:732-743) with the same pattern (`parse({ name: 'Обновлённое', capacity: 20, is_active: true })` accepts; missing `is_active` rejects; `parse({ is_active: true })` rejects).
- [ ] ADD new describes (Master/Material Update tests are a coverage gap — none exist):
  ```ts
  describe('MasterUpdateSchema', () => {
    it('accepts a full canonical update payload', () => {
      const result = MasterUpdateSchema.parse({
        first_name: 'Пётр',
        last_name: 'Иванов',
        color: '#AABBCC',
        position: 'мастер',
        specialty: 'живопись',
        is_active: true,
      });
      expect(result.is_active).toBe(true);
    });

    it('rejects update missing is_active', () => {
      expect(() =>
        MasterUpdateSchema.parse({
          first_name: 'Пётр',
          last_name: 'Иванов',
          color: '#AABBCC',
          position: 'мастер',
          specialty: 'живопись',
        }),
      ).toThrow();
    });
  });

  describe('MaterialUpdateSchema', () => {
    it('accepts a full canonical update payload', () => {
      const result = MaterialUpdateSchema.parse({ title: 'Глина', is_active: true });
      expect(result.is_active).toBe(true);
    });

    it('rejects update missing is_active', () => {
      expect(() => MaterialUpdateSchema.parse({ title: 'Глина' })).toThrow();
    });
  });
  ```
- [ ] **RED run:** `cd packages/api-client && pnpm test` → the 6 "rejects update missing is_active" / "rejects … required create fields" tests FAIL — Service ×2, Location ×2, Master ×1, Material ×1 (old `.partial()` schemas accept everything). Pre-existing: 4 known #188 failures in this suite — they must remain exactly 4, do not touch them.

**Step 2 — GREEN: `packages/api-client/src/schemas.ts` + `endpoints.ts`.**
- [ ] Replace 4 lines:
  - :33 → `export const MasterUpdateSchema = MasterCreateSchema.extend({ is_active: z.boolean() });`
  - :399 → `export const ServiceUpdateSchema = ServiceCreateSchema.extend({ is_active: z.boolean() });`
  - :420 → `export const LocationUpdateSchema = LocationCreateSchema.extend({ is_active: z.boolean() });`
  - :443 → `export const MaterialUpdateSchema = MaterialCreateSchema.extend({ is_active: z.boolean() });`
  (Type export lines `export type XUpdate = z.infer<...>` unchanged.)
- [ ] `endpoints.ts` — 4 PATCH signatures, drop the intersection + TODO comment:
  - :128 `data: Partial<MasterUpdate> & { is_active?: boolean }, // TODO(#178): …` → `data: Partial<MasterUpdate>,`
  - :520 same for `ServiceUpdate`; :551 `LocationUpdate`; :593 `MaterialUpdate`.

**Step 3 — `packages/api-client/src/endpoints.test.ts` (type-driven, not RED):**
- [ ] `describe('updateService')` (:631-644): introduce `const payload: ServiceUpdate = { title: 'Обновлённое', description: '', image_url: '', specialty: '', min_age: 0, max_age: 18, duration: 60, record_info: '', material_hint: '', tariffs: [], tag_ids: [], is_active: true };` — call `await updateService('s-1', payload)` and assert `body: JSON.stringify(payload)`.
- [ ] `describe('updateLocation')` (:676-689): same pattern — `const payload: LocationUpdate = { name: 'Обновлённая', short_title: '', address: '', description: '', capacity: 10, yandex_map_url: '', review_url: '', record_info: '', image_url: '', location_hint: '', tag_ids: [], is_active: true };`.
- [ ] PATCH tests (:703-761, `{ is_active: false }` bodies) stay valid via `Partial<XUpdate>` — unchanged.

**Step 4 — verify + commit:**
- [ ] `cd packages/api-client && pnpm test` → green except exactly the 4 known #188 failures. Report exact counts.
- [ ] `cd packages/api-client && pnpm build` → tsup dts generation succeeds (type-level check).
- [ ] `git add packages/api-client && git commit -m "feat(api-client): canonical Update schemas via extend + drop is_active workaround (#178)"`

---

## Task 3: frontend admin — hooks de-intersection + 4 typed PUT payloads + hook tests

### Classification: standard

### Required Docs
- `docs/specs/2026-08-04-canonical-put-patch-design.md` §3.3 — the null-coercion rule and the checked-boundary decision
- `packages/api-client/src/schemas.ts` — the new `XUpdate` types (Task 2 output) for the exact field sets

### Task Description

Type-driven refactor (no runtime RED — the pre-change code compiles only because the old types were all-optional). Verification = vitest green + `tsc` clean. The pattern per table: replace `Object.entries` iteration / spread + `as Record<string, unknown>` bypass with an explicitly typed `XUpdate` object literal — every field listed, form values extracted per-field with `as`, null optionals coerced to Create defaults (`?? ''` / `?? 0` / `?? 18` / `?? []`), `is_active` from the typed row object. Wire delta (spec §3.3, accepted): null optional fields are sent as defaults instead of being dropped; Service/Material payloads no longer forward raw form nulls.

**Step 1 — hooks ×4** (`frontend/admin/hooks/useMastersMutations.ts:26`, `useLocationsMutations.ts:26`, `useMaterialsMutations.ts:26`, `useServicesMutations.ts:26`):
- [ ] `data: Partial<MasterUpdate> & { is_active?: boolean }` → `data: Partial<MasterUpdate>` (and the Location/Material/Service equivalents).

**Step 2 — table handlers ×4:**
- [ ] `frontend/admin/app/(main)/masters/components/MastersTable.tsx` :153-173 — replace the `handleEdit` body between `if (!editMaster) return;` and `try {` with:
  ```ts
      // Canonical PUT (GH #178): every MasterUpdate field listed — tsc fails on
      // missing/extra fields. Form values are untyped → per-field extraction;
      // null optionals coerce to the Create default (backend does the same).
      const payload: MasterUpdate = {
        first_name: data.first_name as string,
        last_name: data.last_name as string,
        color: data.color as string,
        position: data.position as MasterUpdate['position'],
        specialty: data.specialty as MasterUpdate['specialty'],
        avatar_url: (data.avatar_url as string | null | undefined) ?? '',
        is_active: editMaster.is_active,
      };
  ```
  Keep the `try/catch` + `mutateAsync({ id: editMaster.id, data: payload })` + toasts as-is. (`MasterUpdate` is already imported — it typed the old `const payload: MasterUpdate = {}`.)
- [ ] `frontend/admin/app/(main)/locations/components/LocationsTable.tsx` :151-172 — same replacement with:
  ```ts
      const payload: LocationUpdate = {
        name: data.name as string,
        short_title: (data.short_title as string | null | undefined) ?? '',
        address: (data.address as string | null | undefined) ?? '',
        description: (data.description as string | null | undefined) ?? '',
        capacity: data.capacity as number,
        yandex_map_url: (data.yandex_map_url as string | null | undefined) ?? '',
        review_url: (data.review_url as string | null | undefined) ?? '',
        record_info: (data.record_info as string | null | undefined) ?? '',
        image_url: (data.image_url as string | null | undefined) ?? '',
        location_hint: (data.location_hint as string | null | undefined) ?? '',
        tag_ids: (data.tag_ids as string[] | undefined) ?? [],
        is_active: editLocation.is_active,
      };
  ```
- [ ] `frontend/admin/app/(main)/services/components/ServicesTable.tsx` :295-309 — replace `handleEditSubmit` body with:
  ```ts
      if (!editingService) return;
      // Canonical PUT (GH #178): full typed ServiceUpdate — every field listed.
      const payload: ServiceUpdate = {
        title: data.title as string,
        description: (data.description as string | null | undefined) ?? '',
        image_url: (data.image_url as string | null | undefined) ?? '',
        specialty: (data.specialty as string | null | undefined) ?? '',
        min_age: (data.min_age as number | null | undefined) ?? 0,
        max_age: (data.max_age as number | null | undefined) ?? 18,
        duration: data.duration as number,
        record_info: (data.record_info as string | null | undefined) ?? '',
        material_hint: (data.material_hint as string | null | undefined) ?? '',
        tariffs: (data.tariffs as ServiceUpdate['tariffs'] | undefined) ?? [],
        tag_ids: (data.tag_ids as string[] | undefined) ?? [],
        is_active: editingService.is_active,
      };
      try {
        await updateService.mutateAsync({ id: editingService.id, data: payload });
        showToast('Услуга обновлена', undefined);
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
  ```
  Add `ServiceUpdate` to the type imports from `@memo/api-client` if not already imported.
- [ ] `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` :217-231 — replace `handleEditSubmit` body with:
  ```ts
      if (!editingMaterial) return;
      const payload: MaterialUpdate = {
        title: data.title as string,
        description: (data.description as string | null | undefined) ?? '',
        is_active: editingMaterial.is_active,
      };
      try {
        await updateMaterial.mutateAsync({ id: editingMaterial.id, data: payload });
        showToast('Материал обновлён', undefined);
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
  ```
  Add `MaterialUpdate` to the type imports if missing.
- [ ] Sweep: `rg -n "Record<string, unknown>" frontend/admin/app/\(main\)/masters/components/MastersTable.tsx frontend/admin/app/\(main\)/locations/components/LocationsTable.tsx frontend/admin/app/\(main\)/services/components/ServicesTable.tsx frontend/admin/app/\(main\)/services/components/MaterialsTable.tsx` → the only remaining occurrence per file may be the `handleEdit(data: Record<string, unknown>)` modal-boundary signature itself (that one stays — spec §3.3). No `as Record<string, unknown>` casts remain.

**Step 3 — hook mutation tests ×4** (full typed payloads; define the literal once per test and reuse it in the call AND the expectation):
- [ ] `frontend/admin/__tests__/useMastersMutations.test.ts` :90-103 — `data` becomes `{ first_name: 'Пётр', last_name: 'Иванов', color: '#AABBCC', position: 'мастер', specialty: 'живопись', avatar_url: '', is_active: true }` (typed `MasterUpdate`).
- [ ] `frontend/admin/__tests__/useServicesMutations.test.ts` :92-123 — both `useUpdateService` tests: full `ServiceUpdate` literal (same field set as Task 2 Step 1, values may be minimal-valid).
- [ ] `frontend/admin/__tests__/useLocationsMutations.test.ts` :90-121 — both `useUpdateLocation` tests: full `LocationUpdate` literal.
- [ ] `frontend/admin/__tests__/useMaterialsMutations.test.ts` :83-96 — `data` becomes `{ title: 'Глина 2', description: '', is_active: true }`.

**Step 4 — verify + commit:**
- [ ] `cd frontend/admin && npx tsc --noEmit` → clean (this is the primary gate for the refactor — it proves no field is missing anywhere).
- [ ] `cd frontend/admin && pnpm test` → all green (1239+ baseline). Report exact counts.
- [ ] `git add frontend/admin && git commit -m "feat(admin): typed canonical PUT payloads for masters/services/locations/materials (#178)"`

---

## Task 4: Domain rules sync (docs)

### Classification: small

### Required Docs
- `docs/specs/2026-08-04-canonical-put-patch-design.md` §3.5 — exact rule changes
- `docs/domain-rules/_overview.md`, `masters.md`, `locations.md`, `materials.md`, `services.md`, `clients.md`

### Task Description

Markdown-only edits, committed into the feature branch (docs land with the code that makes them true).

- [ ] `docs/domain-rules/_overview.md` — replace bullet 2 (:79) with:
  ```markdown
  2. **`update` (PUT) requires an explicit `is_active` boolean** for Master, Location, Material, Service (GH #178 — canonical full-replace; omission → 422). Explicit `true` on an archived record is the legal reactivation path, `false` archives. **Client exception until GH #201:** `ClientUpdate.is_active` stays optional (`bool | None = None`) and the #184 sticky-preserve injection was removed with #178 — a Client PUT omitting `is_active` currently errors (accepted window; #201 redefines Client PUT with explicit-null wipe semantics).
  ```
  Replace bullet 3 (:80) with:
  ```markdown
  3. **`patch` preserves the stored `is_active`** when the field is absent or `None` (sticky — all soft entities incl. Client); an explicit boolean always applies. `None` is stripped via the shared `_strip_is_active_none` helper (`services/generic.py:25`).
  ```
  Bullet :82 (Create rule) unchanged.
- [ ] `docs/domain-rules/masters.md` :46 → entity note becomes: `**Entity note:** PUT requires explicit \`is_active\` (GH #178); PATCH sticky inherited from \`SoftDeleteService\` (no override).`
- [ ] `docs/domain-rules/locations.md` :63 → same rewording.
- [ ] `docs/domain-rules/materials.md` :41 → same rewording.
- [ ] `docs/domain-rules/services.md` :81 → entity note becomes: `**Entity note:** PUT requires explicit \`is_active\` (GH #178). \`ServiceService\` overrides \`update\`/\`patch\` (tag_ids/tariffs handling); the PATCH path strips \`is_active: None\` via the shared \`_strip_is_active_none\` helper (\`services/generic.py:25\`) — the update-path strip was removed in #178.`
- [ ] `docs/domain-rules/clients.md` — append to the soft-delete entity note (:78 area): `**#178→#201 window:** \`ClientUpdate.is_active\` stays optional, but the sticky-preserve injection was removed in #178 — a Client PUT omitting \`is_active\` errors (500) until #201 redefines Client PUT (explicit-null wipe). The admin Client edit flow (\`ClientCardModal\` → \`ClientsContext\`, payload name/phone/email/channel only) sends no \`is_active\` and is affected in the window.`
- [ ] `git add docs/domain-rules && git commit -m "docs: sync domain rules with canonical PUT is_active (#178)"`

---

## Self-Review Notes (architect)

- **Spec coverage:** AC1→Task 2, AC2→Tasks 2+3, AC3→Task 1, AC4→Task 1 (patch tests untouched, stay green), AC5→Task 3, AC6→all, AC7→Task 4. User scenarios 1-4 pinned by Tasks 2/1/3/1 respectively; scenario 5 = #201 (out of scope).
- **Green-between-tasks:** Task 1 commits backend green standalone (backend tests don't depend on api-client). Task 2's gates (api-client vitest + `pnpm build` dts) do NOT type-check `frontend/admin`, and admin vitest runs without type-checking — so the 4 old admin PUT sites (`const payload: XUpdate = {}` ×2, `as Record<string, unknown>` spreads ×2) are **temporarily tsc-broken after Task 2** until Task 3 rewrites them (accepted: tsc for admin is Task 3's gate; the two tasks land back-to-back in the same branch). Task 2's own package compiles clean independently. Verified ordering safe.
- **Type consistency:** zod output types make `.default()` fields required — all literals in Tasks 2-3 include them; backend Update schemas keep Base defaults (documented leniency, spec §2).
- **Known unresolved-in-plan detail:** `LocationUpdate` (zod) carries `tag_ids` which backend `LocationUpdate` (LocationBase) does not declare — Task 1 Step 1h verifies no `extra="forbid"` so the extra key is ignored on the wire; Task 3 sources it `?? []` (mirrors today's behavior: form doesn't edit location tags).
