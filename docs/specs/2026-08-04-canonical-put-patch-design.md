# Design: GH #178 — Canonical PUT/PATCH types in api-client + backend (Master, Service, Location, Material)

- **Issue:** GH #178
- **Type:** Cross-layer type/contract fix (api-client zod schemas, backend Pydantic schemas + service dead-code removal, frontend admin call-site typing, test semantics flip)
- **Date:** 2026-08-04 (rev 3 — **user decision at G1b**: injection branch REMOVED per original concept; temporary Client PUT regression explicitly accepted until #201. rev 2 had spec-panel fixes, all retained except the keep-branch one)
- **Concept:** approved at G1a 2026-08-04 (do not re-brainstorm)
- **Refs:** #184 / PR #199 (sticky `is_active` semantics this feature partially supersedes — PUT half), #185 / PR #200 (generic HTTP CRUD contract), #195 (frontend `is_active` resend workaround — now made type-safe), **#201 (Client data-wipe semantics — Next Up 2, starts immediately after this ships; fixes the accepted Client regression)**
- **Domain references:** `docs/domain-rules/_overview.md` ("is_active semantics on get/update/patch", "PATCH Contract") + per-entity notes (`masters.md`, `locations.md`, `materials.md`, `services.md`) — **these rules change with this feature; markdown updates land in the feature branch** (§3.5)

---

## 1. Problem

PUT is replacement semantics (RFC 9110 §9.3.4): the resulting resource state must reflect the enclosed representation — the server must not silently inject values absent from it. The current stack violates this for the 4 soft-delete entities:

1. **api-client** (`packages/api-client/src/schemas.ts`): `XUpdateSchema = XCreateSchema.partial()` — all fields optional. Since Create schemas have no `is_active`, the Update types lack it entirely, forcing the workaround `& { is_active?: boolean }` + `TODO(#178)` in `patchMaster` / `patchService` / `patchLocation` / `patchMaterial` (`endpoints.ts` ~:128, :520, :551, :593). The same stale intersection lives in the 4 mutation hooks (`useMastersMutations.ts` :26 and siblings).
2. **Backend** (`backend/src/schemas/{master,service,location,material}.py`): `XUpdate.is_active: bool | None = None` (post-#184). `SoftDeleteService.update` carries a stored-value injection branch (`backend/src/services/generic.py` ~:202-217): when `data.is_active is None`, the current DB value is re-injected so PUT "preserves" it — the resulting state diverges from the sent representation, and an incomplete PUT passes silently.
3. **Frontend admin** (4 PUT call sites): `MastersTable.tsx` ~:155, `LocationsTable.tsx` ~:154, `ServicesTable.tsx` ~:298, `MaterialsTable.tsx` ~:220 bypass the broken types with `as Record<string, unknown>` casts and post-init `is_active` assignment hacks. All 4 already send `is_active` at runtime (workaround from #195) — but untyped.

**Consequence:** incomplete PUT payloads compile in TS and pass validation in Python; archive state is silently carried instead of explicitly stated; the type system gives no guarantee of PUT completeness.

## 2. Target contract (behavior AFTER this change)

| Layer | Before | After |
|---|---|---|
| api-client `XUpdateSchema` | `XCreateSchema.partial()` (all optional, no `is_active`) | `XCreateSchema.extend({ is_active: z.boolean() })` — **no `.partial()`**. Create-shaped: fields with `.default()` stay runtime-optional (zod keeps defaults under `.extend()`), but the **inferred TS type requires all fields** + `is_active` is runtime-required. Guarantee = type-level full payload + runtime-required `is_active` |
| api-client PATCH type | `Partial<XUpdate> & { is_active?: boolean }` workaround (endpoints.ts + 4 hooks) | `Partial<XUpdate>` everywhere — optional `is_active` comes free via `Partial` |
| api-client Create schemas | no `is_active` | **unchanged** (backend Create does not accept `is_active`) |
| Backend `XUpdate.is_active` ×4 | `bool \| None = None` (sticky) | `bool` — **required**; PUT without `is_active` → **422** |
| Backend `ClientUpdate/Patch.is_active` | `bool \| None = None` | **unchanged** until #201 |
| Backend `XPatch.is_active` ×4 | `bool \| None = None`, None stripped (sticky) | **unchanged** — PATCH sticky stays (all soft entities incl. Client) |
| `SoftDeleteService.update` injection branch (`generic.py` ~:202-217) | injects stored `is_active` when `data.is_active is None` | **REMOVED** (user decision, G1b 2026-08-04) — dead for the 4 required-bool entities; **accepted consequence: Client PUT omitting `is_active` regresses to a NULL write → IntegrityError → 500 until #201** (§5, §8). PATCH paths unaffected |
| `ServiceService.update` override (`service.py` ~:121) | re-applies `_strip_is_active_none` | strip call **removed** — genuinely dead (Service-only override, schema now requires bool); tag_ids/tariffs handling unchanged; `patch` override keeps the strip |
| `_strip_is_active_none` (`generic.py` :25) | used by update + patch paths | **kept** — PATCH path |
| Frontend 4 PUT call sites | `as Record<string, unknown>` casts + post-init hacks | payload built as an **explicitly typed `XUpdate` object** via per-field mapping (§3.3); no `Record<string, unknown>` bypass |

**Semantics flip vs #184:** #184 introduced sticky `is_active` on PUT ("omitted → preserved") as a protective interim. This feature supersedes the **PUT half**: for the 4 entities omission becomes a client error (422) — the client must state archive intent explicitly; for Client the sticky preserve is simply dropped (regression window until #201, accepted). **PATCH sticky is unchanged everywhere** ("absent/None → preserved; explicit bool → applied"; `true` on archived = legal reactivation, `false` = archiving). Domain-rules `_overview.md` is updated accordingly (§3.5).

**Remaining leniency (pre-existing, out of scope):** backend Update schemas inherit Base defaults, so a PUT omitting a defaulted field (e.g. `sort_order`) still writes the server default; zod `.extend()` likewise keeps `.default()` fields runtime-optional. This is layer-consistent and unchanged by this feature.

**Scope vs GH #178 body:** the issue body's minimal variant (touch api-client only, maybe Create schemas) was expanded at G1a based on verified research: Create schemas stay untouched, and the backend leniency + frontend casts are addressed in the same pass. Create call sites are unaffected (Create schemas unchanged).

**Entities in scope:** Master, Service, Location, Material.
**Explicitly out:** Client (→ GH #201 — with the accepted temporary regression, §5), UserSettings, `updateVisitor` (PUT /visitors stays — CRUD parity, user's explicit call; Visitor is a hard-delete entity, no `is_active`).

## 3. Design

### 3.1 api-client (`packages/api-client/src/schemas.ts`, `endpoints.ts`)

1. For each of Master, Service, Location, Material:
   ```ts
   export const XUpdateSchema = XCreateSchema.extend({ is_active: z.boolean() });
   ```
   replaces `XCreateSchema.partial()`. All 4 Create schemas are plain `z.object()` (verified — no `.refine`/effects; `.extend()` is valid). `XUpdate` type = `z.infer<...>` — all Create fields required at type level (defaulted fields keep runtime defaults) + required `is_active`.
2. PATCH method signatures keep `Partial<XUpdate>`; drop the `& { is_active?: boolean }` intersection and the `TODO(#178)` comments in `patchMaster` (:~128), `patchService` (:~520), `patchLocation` (:~551), `patchMaterial` (:~593).
3. Drop the same stale intersection in the 4 hooks: `useMastersMutations.ts` :26, `useLocationsMutations.ts` :26, `useMaterialsMutations.ts` :26, `useServicesMutations.ts` :26.
4. Create schemas/types: **no change**. `updateVisitor` / `VisitorUpdateSchema` / Client schemas: **no change**.

### 3.2 Backend (`backend/src/schemas/`, `backend/src/services/`)

1. `master.py`, `location.py`, `material.py`, `service.py` — Update schemas: `is_active: bool | None = None` → `is_active: bool` (required, no default). Patch schemas (`MasterPatch` etc.): **no change** (`bool | None = None` stays). `client.py`: **no change**.
2. `backend/src/services/generic.py` — **remove the stored-value injection branch in `SoftDeleteService.update`** (~:202-217): dead for the 4 required-bool entities (Pydantic guarantees non-None); the Client fallout is the accepted regression (§5). Keep `_strip_is_active_none` (:25) — PATCH path.
3. `backend/src/services/service.py` — `ServiceService.update` override (~:121): remove the now-dead `_strip_is_active_none` call on the update path (Service schema guarantees bool); `patch` override keeps the strip. tag_ids/tariffs logic untouched.
4. Net HTTP behavior: `PUT /api/v1/{masters,services,locations,materials}/{id}` without `is_active` → **422** (Pydantic validation). With explicit bool → applied exactly (incl. reactivation `true` on archived). `PUT /clients/{id}` without `is_active` → **500 (accepted regression until #201)**; with explicit `is_active` → works.

### 3.3 Frontend admin (4 PUT call sites)

`MastersTable.tsx` ~:155, `LocationsTable.tsx` ~:154, `ServicesTable.tsx` ~:298, `MaterialsTable.tsx` ~:220:

- Remove `as Record<string, unknown>` casts, `const payload: XUpdate = {}` initializers, and post-init `is_active` hacks.
- Build the PUT body as an **explicitly typed `XUpdate` object**: every `XUpdate` field listed, values mapped per-field from the edited row + modal form values. The compile-time guarantee: missing/extra fields in the literal fail `tsc`.
- **Null-coercion rule (explicit):** Response types are null-wider than Update types (e.g. `MasterResponse.avatar_url: string | null` vs `MasterUpdate.avatar_url: string` with zod default `''`). Rule: `field: row.field ?? <Create default>` (e.g. `avatar_url: row.avatar_url ?? ''`). Honest wire delta: a null optional field becomes `''`/default on save — consistent with backend Update defaults; noted, accepted.
- The modals' `onSubmit(data: Record<string, unknown>)` boundary stays untyped (typing 4 modals' form state is out of scope); per-field extraction into the typed `XUpdate` object is the checked boundary. One `as` inside the mapping for genuinely-untypeable form values is acceptable; the blanket `Record<string, unknown>` payload bypass is not.

No visual delta; behavioral delta limited to the null-coercion note above.

### 3.4 Tests

**Backend** (suite at 999p/5s post-#185; all files flat in `backend/tests/` — no `api/` subdir):

| File:lines | Change |
|---|---|
| `test_generic_service_contract.py` `TestGenericServiceIsActiveContract` (:825-895) | `test_update_preserves_is_active_when_omitted` **splits per entity**: Master/Location/Material flip → constructing Update schema without `is_active` raises `ValidationError` ("rejects update missing is_active"); **Client param → `pytest.skip` with `#201` reference** (the sticky-preserve behavior it pins is intentionally removed; #201 redefines Client semantics). `test_update_explicit_is_active_applies` stays (all soft entities incl. Client — explicit bool still works); both patch tests unchanged for all params (PATCH sticky intact) |
| same file, `TestGenericServiceUpdateContract` (~:738-790) | update payloads gain explicit `is_active` for **all soft entities including Client** (uniform — Client needs it now: omitting → 500). Injection must be **per-entity in payload construction, not in the shared `_update_kwargs`** (:72) — the flipped tests construct the is_active-less variant explicitly (e.g. pop) to assert `ValidationError` |
| `test_service_service.py` `TestServiceServiceIsActiveContract` (:84-170) | same flip for the Service-specific tests (ServiceService re-implements update/patch; Service is in `GENERIC_CONTRACT_EXCEPTIONS` so it is not covered by the parametrized classes) |
| `test_generic_api_contract.py` `TestGenericApiUpdateContract` (:167/:180) | PUT payloads gain explicit `is_active` for **all soft entities including Client**. **No new 422 test here** — the file charter pins business semantics at service level |
| `test_api_services.py` (:146, :183, :219) | PUT payloads gain `is_active`; **ADD one explicit test**: PUT /services/{id} without `is_active` → **422** (HTTP-level canary for scenario 2; the other 3 entities are pinned by the service-level ValidationError flips + FastAPI's standard mapping) |
| `test_sort_order.py` :90 (`test_master_update_sort_order`) | payload gains `is_active` |
| `test_location_short_title.py` :129/:152 | payloads gain `is_active` |
| `test_coverage_boost.py` :287/:324 (service updates) | payloads gain `is_active` |
| `test_api_clients.py` (:190-206, :219-228) | **Client PUT cases split by purpose** (classification confirmed at plan): cases pinning sticky-preserve of `is_active` → `pytest.skip` with `#201` reference; cases whose purpose is general PUT behavior → payload gains explicit `is_active` (stays 200). Suite green **by design**, each skip traceable to #201 |
| `test_put_is_active.py` (5 tests, explicit `is_active`) | **stays green, unchanged** — canary that explicit-`is_active` PUT did not regress |

Skip mechanics (plan-level): per-param mark (`pytest.param(..., marks=pytest.mark.skip(reason="GH #201"))`) or in-test guard — one mechanism, applied uniformly; every skip reason contains `#201` so #201 can grep-restore.

**api-client** (suite at 144p/4f — 4 known #188 failures):

| File:lines | Change |
|---|---|
| `schemas.test.ts` :536, :551, :662-670, :734-742 | "accepts empty update" semantics flips → **"rejects update missing is_active"** (Service/Location cases) |
| `schemas.test.ts` | **ADD missing Master/Material Update schema tests** (gap — none exist): full-payload acceptance + rejection of missing `is_active` |
| `endpoints.test.ts` :634/:679 | full PUT payloads |

**Frontend admin** (vitest suite 1239p — changes ARE expected here):

| File:lines | Change |
|---|---|
| `useMastersMutations.test.ts` :98; `useServicesMutations.test.ts` :99-102/:119; `useLocationsMutations.test.ts` :97-100/:117; `useMaterialsMutations.test.ts` :91 | PUT mutation payloads → full typed payloads incl. `is_active` (~6 spots) |

`npm run test:all` + `tsc` type-check must pass.

**Estimated delta:** net additions are small — +1 HTTP 422 test, +2 api-client schema test groups; a few Client skips (restored by #201); the rest are in-place semantics flips/payload edits. Exact counts verified at baseline/plan.

### 3.5 Domain rules (lands in the feature branch)

`docs/domain-rules/_overview.md`:
- "is_active semantics on get/update/patch" — PUT bullet rewritten: for Master/Service/Location/Material `is_active` is a **required** PUT field (omitted → 422); Client PUT has **no sticky guarantee until #201** (omitting `is_active` currently errors — accepted window). PATCH bullet unchanged (sticky, all soft entities). Note supersession of the #184 interim rule.
- "PATCH Contract" table — unchanged (sticky stays; explicit `null` → preserve is a deliberate, documented deviation from RFC 7386 null-means-remove — meaningless for a NOT NULL boolean).

Entity notes in `masters.md` :46, `locations.md` :63, `materials.md` :41, `services.md` :81 — reword: PUT requires explicit `is_active`; PATCH sticky inherited/kept. `clients.md` — note the #178→#201 window: Client PUT must send explicit `is_active`; sticky returns in #201-redefined form.

## 4. User Scenarios

1. **Type-safety:** developer passes an incomplete PUT payload in TS → compile fails before runtime (Update type requires all fields incl. `is_active`).
2. **Backend guard:** PUT without `is_active` bypassing the frontend (curl/external client) → **422**; archive state is never silently carried or reset.
3. **Admin edits master** in the table → PUT body built as a typed `XUpdate` literal, no blanket casts; null optional fields coerce to defaults (e.g. `avatar_url` null → `''`).
4. **Admin archives a service** → `PATCH {is_active: false}` single field → works (PATCH sticky unchanged).
5. **Data wipe requires explicit values** — for Client: explicit `null` semantics, documented in #201 (out of scope here; #201 lands immediately after).

## 5. Recorded decisions (G1a + G1b user decisions)

- `updateVisitor` (PUT /visitors) **stays** — CRUD parity, user's explicit call.
- Backend Create schemas **without** `is_active` (creating an archived row is nonsense).
- Data-wipe semantics = explicit `null` (documented in #201 for Client).
- Backend leniency removed for the 4 entities' PUT; PATCH sticky stays everywhere (incl. Client PATCH).
- **G1b user decision (2026-08-04, overriding spec-panel BLOCKER fix):** the `SoftDeleteService.update` injection branch is **REMOVED** in this feature, per the original G1a concept. **Accepted consequence:** Client PUT omitting `is_active` regresses (NULL write → IntegrityError → 500) until #201 lands. Justification (user, verbatim intent): no production exists; #201 is already Next Up 2 and starts immediately after #178 ships; nobody is harmed in the window. Test fallout is handled by design, not accident (§3.4: explicit-`is_active` Client payloads + `#201`-referenced skips).
- Client `Update`/`Patch` schemas untouched (stay `bool | None = None`) until #201.
- **Rejected alternative (AIP-134/129):** keep `is_active` server-owned / PATCH-only — rejected because admin PUT flows already send it and the flag is the entity's archive state; requiring it in PUT makes intent explicit.
- PATCH explicit-`null` → preserve is a deliberate deviation from RFC 7386 (null-means-remove is meaningless for a NOT NULL boolean); documented in domain rules.
- 422 for missing required field is the FastAPI default for Pydantic validation failures — no custom error shape introduced.

## 6. Acceptance Criteria

- [ ] AC1: `XUpdateSchema = XCreateSchema.extend({ is_active: z.boolean() })` for Master/Service/Location/Material; no `.partial()`; Create schemas untouched. (Create-shaped: defaulted fields stay runtime-optional; inferred type requires all fields; `is_active` runtime-required.)
- [ ] AC2: `& { is_active?: boolean }` + `TODO(#178)` removed from all 4 patch methods in `endpoints.ts` **and** the stale intersection removed from the 4 `useXMutations.ts` hooks; PATCH signatures are plain `Partial<XUpdate>`.
- [ ] AC3: Backend `XUpdate.is_active: bool` required ×4; PUT without `is_active` → 422 for the 4 entities (pinned by service-level ValidationError flips + one explicit HTTP 422 test in `test_api_services.py`); `SoftDeleteService.update` injection branch **removed**; `ServiceService.update` dead strip removed; Client test fallout handled per §3.4 (explicit payloads + `#201`-referenced skips — suite green, zero unexpected failures).
- [ ] AC4: PATCH sticky unchanged — `{"is_active": null}`/omitted → preserved; explicit bool applies (existing patch contract tests stay green, all soft entities incl. Client).
- [ ] AC5: 4 frontend PUT call sites build explicitly typed `XUpdate` payloads (every field listed; null→default coercion rule applied); no `as Record<string, unknown>` payload bypass at those sites; `tsc` clean.
- [ ] AC6: Backend suite green with flipped sticky-PUT tests, uniform explicit-`is_active` payloads, and only `#201`-referenced Client skips; api-client suite green (± known #188 failures) with new Master/Material Update schema tests; admin vitest green with updated hook mutation payloads.
- [ ] AC7: Domain rules (`_overview.md` + 4 entity notes + `clients.md` window note) updated to the new PUT canon, noting #184 supersession and the #178→#201 Client window.

## 7. Visual Compliance Checks

Frontend files change, but the delta is type-level + null-coercion only — no visual change intended. Gate runs autonomously as the repo's standing smoke process (not new acceptance scope) to catch payload-construction regressions in the edit flow:

- [ ] Admin "Мастера" table renders with rows
- [ ] Edit modal on a master row opens and "Сохранить" succeeds (PUT 200)
- [ ] Admin "Услуги" table renders; edit-save succeeds
- [ ] Admin "Локации" table renders; edit-save succeeds
- [ ] Admin "Материалы" table renders; edit-save succeeds

## 8. Risks & notes

- **ACCEPTED RISK (user decision, G1b):** Client PUT omitting `is_active` → 500 during the #178→#201 window. Mitigations: no production; #201 is Next Up 2 starting immediately; backend test fallout neutralized by design (§3.4); plan step greps frontend Client PUT call sites (e.g. ClientsTable edit) to document which admin flows are affected in the window — fixing them properly requires the #201 Client schema treatment (adding `is_active` ad-hoc would re-introduce the very cast workaround this feature removes), so window breakage is accepted there too if found.
- **External consumers of PUT** (scripts, e2e helpers) sending `is_active`-less payloads would start getting 422 — panel + research found the full set of in-repo call sites (§3.4); plan step re-verifies via grep for PUT call sites before implementation.
- **Suite-count arithmetic:** changes are mostly in-place flips/payload edits; net additions ≈ +1 backend test + 2 api-client schema test groups, minus a few `#201`-referenced Client skips. Baseline counts taken at worktree step.
- **`test_put_is_active.py`** is the canary that explicit-`is_active` PUT behavior did not regress.
- **Remaining defaulted-field leniency** (§2) is pre-existing and layer-consistent; tightening it (e.g. `.required()` everywhere or hand-written Update schemas) is a possible follow-up, explicitly out of scope.
- **#201 handoff:** every skip introduced here references `#201`; #201 must unskip/rewrite Client tests and re-deliver Client PUT semantics (explicit-null wipe).
- **Visitor/UserSettings** surfaces untouched.
