# Design: GH #178 — Canonical PUT/PATCH types in api-client + backend (Master, Service, Location, Material)

- **Issue:** GH #178
- **Type:** Cross-layer type/contract fix (api-client zod schemas, backend Pydantic schemas + service dead-code removal, frontend admin call-site typing, test semantics flip)
- **Date:** 2026-08-04
- **Concept:** approved at G1a 2026-08-04 (do not re-brainstorm)
- **Refs:** #184 / PR #199 (sticky `is_active` semantics this feature partially supersedes — PUT half), #185 / PR #200 (generic HTTP CRUD contract), #195 (frontend `is_active` resend workaround — now made type-safe), #201 (Client data-wipe semantics — follow-up, out of scope)
- **Domain references:** `docs/domain-rules/_overview.md` ("is_active semantics on get/update/patch", "PATCH Contract") + per-entity notes (`masters.md`, `locations.md`, `materials.md`, `services.md`) — **these rules change with this feature; markdown updates land in the feature branch** (§6)

---

## 1. Problem

PUT (full replace, RFC 9110 §9.3.4) requires the client to send the complete representation. The current stack violates this canon for the 4 soft-delete entities:

1. **api-client** (`packages/api-client/src/schemas.ts`): `XUpdateSchema = XCreateSchema.partial()` — all fields optional. Since Create schemas have no `is_active`, the Update types lack it entirely, forcing the workaround `& { is_active?: boolean }` + `TODO(#178)` in `patchMaster` / `patchService` / `patchLocation` / `patchMaterial` (`endpoints.ts` ~:128, :520, :551, :593).
2. **Backend** (`backend/src/schemas/{master,service,location,material}.py`): `XUpdate.is_active: bool | None = None` (post-#184). `SoftDeleteService.update` carries a stored-value injection branch (`backend/src/services/generic.py` ~:202-217): when `data.is_active is None`, the current DB value is re-injected so PUT "preserves" it. This leniency means an incomplete PUT silently keeps the row archived/active instead of failing — the client's intent is never stated.
3. **Frontend admin** (4 PUT call sites): `MastersTable.tsx` ~:155, `LocationsTable.tsx` ~:154, `ServicesTable.tsx` ~:298, `MaterialsTable.tsx` ~:220 bypass the broken types with `as Record<string, unknown>` casts and post-init `is_active` assignment hacks. All 4 already send `is_active` at runtime (workaround from #195) — but untyped.

**Consequence:** incomplete PUT payloads compile in TS and pass validation in Python; archive state can be silently carried instead of explicitly set; type system gives no guarantee of PUT completeness.

## 2. Target contract (behavior AFTER this change)

| Layer | Before | After |
|---|---|---|
| api-client `XUpdateSchema` | `XCreateSchema.partial()` (all optional, no `is_active`) | `XCreateSchema.extend({ is_active: z.boolean() })` — **full required PUT schema, no `.partial()`** |
| api-client PATCH type | `Partial<XUpdate> & { is_active?: boolean }` workaround | `Partial<XUpdate>` — optional `is_active` comes free via `Partial` |
| api-client Create schemas | no `is_active` | **unchanged** (backend Create does not accept `is_active`) |
| Backend `XUpdate.is_active` | `bool \| None = None` (sticky) | `bool` — **required**; PUT without `is_active` → **422** |
| Backend `XPatch.is_active` | `bool \| None = None`, None stripped (sticky) | **unchanged** — PATCH sticky stays |
| `SoftDeleteService.update` | injects stored `is_active` when None (`generic.py` ~:202-217) | branch **removed** (dead — Pydantic guarantees non-None); explicit bool applied via normal `model_dump()` |
| `_strip_is_active_none` (`generic.py` :25) | used by update + patch paths | **kept** — still used by PATCH path; becomes a no-op on the update path |
| `ServiceService.update` override (`service.py` ~:121) | re-implements sticky strip | adjusted — strip is no-op for required bool; tag_ids/tariffs handling unchanged |
| Frontend 4 PUT call sites | `as Record<string, unknown>` casts + post-init hacks | full **typed** payload literals, no casts (all 4 already send `is_active` — now type-checked) |

**Semantics flip vs #184:** #184 introduced sticky `is_active` on PUT ("omitted → preserved") as a protective interim. This feature supersedes the **PUT half only**: omission becomes a client error (422), because canon requires the full representation. **PATCH sticky is unchanged** ("absent/None → preserved; explicit bool → applied"; `true` on archived = legal reactivation, `false` = archiving). Domain-rules `_overview.md` is updated accordingly (§6).

**Scope vs GH #178 body:** the issue body's minimal variant (touch api-client only, maybe Create schemas) was expanded at G1a based on verified research: Create schemas stay untouched, and the backend leniency + frontend casts are removed in the same pass. Create call sites are unaffected (Create schemas unchanged).

**Entities in scope:** Master, Service, Location, Material.
**Explicitly out:** Client (→ GH #201, data-wipe-via-explicit-null semantics), UserSettings, `updateVisitor` (PUT /visitors stays — CRUD parity, user's explicit call; Visitor is a hard-delete entity, no `is_active`).

## 3. Design

### 3.1 api-client (`packages/api-client/src/schemas.ts`, `endpoints.ts`)

1. For each of Master, Service, Location, Material:
   ```ts
   export const XUpdateSchema = XCreateSchema.extend({ is_active: z.boolean() });
   ```
   replaces `XCreateSchema.partial()`. `XUpdate` type = `z.infer<typeof XUpdateSchema>` (all Create fields required + required `is_active`).
2. PATCH method signatures keep `Partial<XUpdate>`; drop the `& { is_active?: boolean }` intersection and the `TODO(#178)` comments in `patchMaster` (:~128), `patchService` (:~520), `patchLocation` (:~551), `patchMaterial` (:~593).
3. Create schemas and Create types: **no change**. `updateVisitor` / `VisitorUpdateSchema`: **no change**.

### 3.2 Backend (`backend/src/schemas/`, `backend/src/services/`)

1. `master.py`, `location.py`, `material.py`, `service.py` — Update schemas: `is_active: bool | None = None` → `is_active: bool` (required, no default). Patch schemas (`MasterPatch` etc.): **no change** (`bool | None = None` stays).
2. `backend/src/services/generic.py`:
   - Remove the stored-value injection branch in `SoftDeleteService.update` (~:202-217) — unreachable once `is_active` is a required bool.
   - Keep `_strip_is_active_none` (:25) — used by the PATCH path.
3. `backend/src/services/service.py` — `ServiceService.update` override (~:121): drop the now-no-op strip for the update path (explicit bool flows through); `patch` override keeps the strip. tag_ids/tariffs logic untouched.
4. Net HTTP behavior: `PUT /api/v1/{masters,services,locations,materials}/{id}` without `is_active` → **422** (Pydantic validation). With explicit bool → applied exactly (incl. reactivation `true` on archived).

### 3.3 Frontend admin (4 PUT call sites)

`MastersTable.tsx` ~:155, `LocationsTable.tsx` ~:154, `ServicesTable.tsx` ~:298, `MaterialsTable.tsx` ~:220:

- Remove `as Record<string, unknown>` casts and post-init `is_active` assignment hacks.
- Build full typed payload literals matching `XUpdate` (all Create fields + `is_active` from the row's current state — same values sent today, now statically checked).

No visual/behavioral delta — type-level change only.

### 3.4 Tests

**Backend** (suite at 999p/5s post-#185):

| File:lines | Change |
|---|---|
| `backend/tests/services/test_generic_service_contract.py` `TestGenericServiceIsActiveContract` (:825-895) | `test_update_preserves_is_active_when_omitted` flips semantics → **constructing Update schema without `is_active` raises `ValidationError`**; `test_update_explicit_is_active_applies` stays; both patch tests unchanged (sticky stays) |
| same file, `TestGenericServiceUpdateContract` (~:738-790) | update payloads gain explicit `is_active` for Master/Location/Material (required now); **Client payload unchanged** (optional until #201); hard entities unaffected |
| `backend/tests/services/test_service_service.py` `TestServiceIsActiveContract` (:84-170) | same flip for the Service-specific tests (ServiceService re-implements update/patch) |
| `backend/tests/api/test_generic_api_contract.py` `TestGenericApiUpdateContract` (:167/:180) | PUT payloads gain explicit `is_active`; **ADD** parametrized test: PUT without `is_active` → 422 for Master/Location/Material (+Service; Client excluded — optional until #201) — pins scenario 2 at HTTP level |
| `backend/tests/api/test_api_services.py` (:183/:219) | payloads gain `is_active` |
| `backend/tests/api/test_put_is_active.py` (5 tests, explicit `is_active`) | **stays green, unchanged** |

Contract-helper note for the plan: the parametrized update-payload construction (`{**create_data, **update_data}` filtered to `update_schema.model_fields`) must inject `is_active` for the entities whose Update schema now requires it — `create_data` never contains it (Create schemas unchanged). `update_data` itself stays `is_active`-free (#184 D4): `is_active` semantics remain pinned by the dedicated IsActive contract classes.

**api-client** (suite at 144p/4f — 4 known #188 failures):

| File:lines | Change |
|---|---|
| `useMastersMutations.test.ts` :98; `useServicesMutations.test.ts` :99-102/:119; `useLocationsMutations.test.ts` :97-100/:117; `useMaterialsMutations.test.ts` :91 | PUT mutation payloads → full typed payloads incl. `is_active` (~6 spots) |
| `schemas.test.ts` :536, :551, :662-670, :734-742 | "accepts empty update" semantics flips → **"rejects incomplete update"** (Service/Location cases) |
| `schemas.test.ts` | **ADD missing Master/Material Update schema tests** (gap — none exist): required-field acceptance + rejection of missing `is_active` |
| `endpoints.test.ts` :634/:679 | full PUT payloads |

**Frontend admin:** vitest suite (1239p) — no test changes expected (type-level only); `npm run test:all` + `tsc` type-check must pass.

### 3.5 Domain rules (lands in the feature branch)

`docs/domain-rules/_overview.md`:
- "is_active semantics on get/update/patch" — PUT bullet: sticky exception **removed**; `is_active` is a **required** PUT field for Master/Service/Location/Material (omitted → 422). PATCH bullet unchanged (sticky). Note supersession of the #184 interim rule and Client's exception until #201.
- "PATCH Contract" table — unchanged (sticky stays).

Entity notes in `masters.md` :46, `locations.md` :63, `materials.md` :41, `services.md` :81 — reword: PUT requires explicit `is_active`; PATCH sticky inherited/kept.

## 4. User Scenarios

1. **Type-safety:** developer passes an incomplete PUT payload in TS → compile fails before runtime (Update type requires all fields incl. `is_active`).
2. **Backend guard:** PUT without `is_active` bypassing the frontend (curl/external client) → **422**; archive state is never silently carried or reset.
3. **Admin edits master** in the table → PUT with all fields, fully typed, no casts (same wire payload as today).
4. **Admin archives a service** → `PATCH {is_active: false}` single field → works (PATCH sticky unchanged).
5. **Data wipe requires explicit values** — for Client: explicit `null` semantics, documented in #201 (out of scope here).

## 5. Recorded decisions (G1a)

- `updateVisitor` (PUT /visitors) **stays** — CRUD parity, user's explicit call.
- Backend Create schemas **without** `is_active` (creating an archived row is nonsense).
- Data-wipe semantics = explicit `null` (documented in #201 for Client).
- Backend leniency removed **only** for the 4 entities' PUT; PATCH sticky stays everywhere.
- Client `Update`/`Patch` schemas untouched (stay `bool | None = None`) until #201 — the parametrized contract must not require `is_active` for Client.

## 6. Acceptance Criteria

- [ ] AC1: `XUpdateSchema = XCreateSchema.extend({ is_active: z.boolean() })` for Master/Service/Location/Material; no `.partial()`; Create schemas untouched.
- [ ] AC2: `& { is_active?: boolean }` + `TODO(#178)` removed from all 4 patch methods; PATCH signatures are plain `Partial<XUpdate>`.
- [ ] AC3: Backend `XUpdate.is_active: bool` required ×4; PUT without `is_active` → 422 (pinned by new parametrized API test); injection branch in `SoftDeleteService.update` removed; `_strip_is_active_none` kept for PATCH.
- [ ] AC4: PATCH sticky unchanged — `{"is_active": null}`/omitted → preserved; explicit bool applies (existing patch contract tests stay green).
- [ ] AC5: 4 frontend PUT call sites build full typed payloads; zero `as Record<string, unknown>` at those sites; `tsc` clean.
- [ ] AC6: Backend suite green with flipped sticky-PUT tests (→ ValidationError/422) and explicit-`is_active` payloads; api-client suite green (± known #188 failures) with new Master/Material Update schema tests; admin vitest green.
- [ ] AC7: Domain rules (`_overview.md` + 4 entity notes) updated to the new PUT canon, noting #184 supersession and Client/#201 exception.

## 7. Visual Compliance Checks

Frontend files change, but the delta is **type-level only** — no visual or behavioral change intended. Gate runs autonomously as a smoke check that payload-construction edits did not break the edit flow:

- [ ] Admin "Мастера" table renders with rows
- [ ] Edit modal on a master row opens and "Сохранить" succeeds (PUT 200)
- [ ] Admin "Услуги" table renders; edit-save succeeds
- [ ] Admin "Локации" table renders; edit-save succeeds
- [ ] Admin "Материалы" table renders; edit-save succeeds

## 8. Risks & notes

- **External consumers of PUT** (scripts, e2e helpers) sending `is_active`-less payloads would start getting 422 — research found none beyond the 4 admin tables; plan step re-verifies via grep for `update(`/`put(` call sites.
- **#184 contract arithmetic**: the flipped tests keep the suite's collected-count roughly neutral; new +4/5 422 cases and +2 api-client schema tests are the only net additions.
- **Visitor/UserSettings** surfaces untouched; `test_put_is_active.py` (5 tests) is the canary that explicit-`is_active` PUT behavior did not regress.
