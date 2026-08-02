# GH #195 — `is_active` Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval, rev 5 — 3-state encoding + SoftDeleteService polymorphism per user decision)
**Reference implementation:** Clients entity (aligned to the same convention in this feature)

---

## 1. Problem Statement

Soft-delete entities (masters, locations, services, materials) support archive/restore (`is_active` flag, `PATCH .../restore`), but their **list endpoints always return only active records**. The admin tables therefore cannot show archived records, and the existing status filter dropdowns in 4 tables are **dead client-side filters** — they filter only within the already-active-only page of data, so "Все" and "Архив" never show archived rows.

Additionally, the **clients endpoint has a latent bug**: `services/client.py` (~103–106) computes `is_active_filter = params.is_active if params.is_active is not None else True` — absent param is coerced to active-only, so the ClientsTable «Все» filter can never show archived records server-side. Clients is aligned to the new convention in this feature.

## 2. Goals

1. Single `is_active: bool | None` query param across API → services → repository for masters, locations, services, materials list endpoints, with **3 states**: `true` = active only, `false` = archived only, **absent/`None` = all (no filter)**.
2. Introduce `SoftDeleteService(GenericService)` — polymorphism replaces soft_delete branching: base `GenericService` has NO is_active knowledge; the subclass applies the filter.
3. Rename repository param `include_inactive: bool = False` → `is_active: bool | None = None` (internal method, safe to rename).
4. Admin tables for masters/locations/services/materials: server-side three-option archive filtering («Активные» default / «Все» / «Архив»), dead client-side status filtering removed.
5. Align **clients** backend to the same convention (None = no filter) — fixes the latent «Все» bug.

**Default UX is a frontend concern:** backend default is `None` = all records; the tables' default filter «Активные» sends `is_active=true` explicitly. **Backward compatibility of the API default is explicitly waived (user decision, 2026-08-02).**

## 3. Explicitly Out of Scope (YAGNI)

- **API default backward compatibility** — waived by user. Callers needing active-only must pass `is_active=true` (caller audit, §4a).
- **No new archive/restore button work** — existing buttons already invalidate queries.
- **No E2E tests** — project practice is unit/integration only.
- **ClientsTable frontend** — no changes (already sends `is_active` per filter; the fix is backend-only).
- **Pagination/`per_page` behavior** — unchanged (tables fetch `per_page: 100` and slice client-side; archive/all views inherit the same cap — accepted limitation).
- **Empty-state UX copy** — filtered-empty views use the existing generic "not found" row.
- No changes to non-soft-delete entities (tags, visitors stay on base `GenericService`).

## 4. Param Encoding (user decision, rev 5)

**`is_active: bool | None`, default `None`.**

| Param value | SQL | Result |
|-------------|-----|--------|
| absent / `None` | *(no is_active filter)* | **all records (active + archived)** |
| `?is_active=true` | `where(table.is_active == True)` | active only |
| `?is_active=false` | `where(table.is_active == False)` | archived only |

**Rationale:**
- Cleanest 3-state encoding of the approved single-param concept: a plain bool plus "absent", no string sentinels, no union parsing edge cases (rev-4's `bool | "all"` was rejected by the user).
- The default-flip risk (absent was active-only before) is contained by the caller audit (§4a) and by the fact that all 4 admin tables send explicit values in every state except «Все».
- Frontend mapping: «Активные» → `is_active=true`, «Все» → param omitted (`null`), «Архив» → `is_active=false`.
- Type alias: `IsActiveFilter = bool | None` is trivial — inline it in signatures; no shared alias module needed.

### 4a. Caller audit (blast radius of the default flip) — REQUIRED

Because absent param now returns **all** records (was active-only), the implementation MUST audit and update every existing caller that relies on active-only behavior:

- **Frontend:** all callers of `getMasters` / `getLocations` / `getServices` / `getMaterials` outside the 4 tables (schedule page, booking/record forms, selects, legends, etc.) must pass `is_active: true` where archived records must not appear. Deliverable: a list of audited call sites in the PR description; each either passes `is_active: true` or is confirmed all-records-tolerant.
- **Backend:** all internal callers of `SoftDeleteRepository.list` / `GenericService.list` / `ServiceService.list` (other services, stats queries) must pass `is_active=True` explicitly where they need active-only. Callers previously passing `include_inactive=True` map to `is_active=None`.
- **Clients:** `ClientService.list` callers audited the same way (default flips from active-only to all).

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `is_active: bool | None = None`.
- Logic:
  - `is_active is None` → **no is_active filter** (all records)
  - `isinstance(is_active, bool)` → `where(table.is_active == is_active)`
- All repository callers updated in the same PR (§4a); `include_inactive=True` → `is_active=None`.

### 5.2 `backend/src/services/generic.py` — GenericService + NEW SoftDeleteService (user decision: polymorphism)

- **Base `GenericService`:** NO is_active knowledge at all — no param, no `soft_delete` branching in `list()` (the current `if self._model.soft_delete:` guard + unconditional `where(table.is_active)` at ~65–66 is removed from base). `TagService` and `VisitorService` stay on base `GenericService` — structurally unaffected (eliminates the rev-4 BLOCKER by construction).
- **NEW `SoftDeleteService(GenericService)`:** overrides `list()` accepting `is_active: bool | None = None`; applies `where(is_active == value)` only when not `None`; otherwise delegates to the base query unchanged. `get()` unchanged (no is_active filter today).
- **Migration:** Master, Location, Material services move from `GenericService` → `SoftDeleteService`.
- The `is_active` param is an **explicit named parameter**, never routed through `**filters` (double-where hazard from rev-3 panel).

### 5.3 `backend/src/services/service.py` — ServiceService (lines 31–54)

- Inherits `SoftDeleteService` (moves off base `GenericService`), keeps its eager-load override (tariffs/tags).
- Its overridden `list()` replaces the unconditional `.where(Service.is_active)` (~line 41) with the param-driven clause (`is_active is not None` → `where(Service.is_active == is_active)`), keeping `is_active` out of the `**filters` loop (~44–46).

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`:

- Add query param `is_active: bool | None = None`.
- Pass through to the corresponding service `.list()`.
- Absent = all records (§4, §4a).

### 5.5 Clients alignment (in scope, minimal)

- `backend/src/services/client.py` (~103–106): remove the `else True` coercion — `is_active=None` → no filter (all). Net change: the `is_active_filter` fallback disappears.
- `ClientListParams` (`schemas/client.py:75`): `is_active: bool | None = None` unchanged (default already None).
- Caller audit per §4a.

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `is_active?: boolean | null` (no `"all"` sentinel).
- `listQuery()` appends `is_active` **only when it is `true` or `false`**; `null`/`undefined` → param omitted (server: all records).
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.
- **Known type-level leak (accepted, documented):** `getVisitors` / `getTags` also take `ListParams` (endpoints.ts:402, 471), so their TS surface gains an `is_active` their backends don't declare — a call passing it compiles and is silently ignored by FastAPI. Accepted to avoid per-entity param subtypes; add a code comment on `ListParams.is_active` noting it applies to soft-delete entities only.

## 7. Frontend Changes (admin) — 4 tables, server-side filtering

User decision: **minimal changes, like ClientsTable but WITHOUT contexts — tables keep local state.**

Files:

- `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
- `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (note: lives under `services/components/`)

### 7.1 Filter dropdown — three explicit options

- Dropdown options (exactly three): **«Активные» (`'active'`)**, **«Все» (`'all'`)**, **«Архив» (`'archived'`)**. The empty-string `''` value is eliminated — filter components currently emit `<option value="">Все</option>` (MasterFilters.tsx:62, LocationFilters, ServiceFilters, MaterialsTable.tsx:326); these become `value="all"`.
- Default state: **`'active'`** in all 4 tables (masters/locations change from `''` to `'active'` — data identical since `''` previously also yielded active-only).
- **«Сбросить» (reset) handlers:** MastersTable.tsx:251 and LocationsTable.tsx:250 currently call `setStatus('')` — change to `setStatus('active')` (ServicesTable:378 / MaterialsTable:333 already reset to `'active'`).
- Local state values are exactly `'active' | 'all' | 'archived'`.

### 7.2 queryKey + queryFn

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same for locations/services/materials).
2. **queryFn mapping:** `'active' → is_active: true`, `'all' → is_active: null` (param omitted → server returns all), `'archived' → is_active: false`.
3. **`placeholderData: keepPreviousData`** (react-query v5) on all 4 list queries: a queryKey change creates a new pending query, and the tables' `if (isLoading)` gate (e.g. MastersTable.tsx:236) would flash the full-table "Загрузка..." on every dropdown switch — today's client-side filter is instant. `keepPreviousData` is the documented v5 remedy.

### 7.3 Remove dead client-side status filtering

Remove **only the dead status predicate** from the client-side filter memos (the surrounding memo also contains the *search* filter, which must be preserved — e.g. MastersTable.tsx:86–100 is the whole `filteredMasters` memo; only the status lines ~96–97 are dead):

- MastersTable: status predicate lines (~96–97) inside the memo at ~86–100
- LocationsTable: status predicate lines inside the memo at ~89–103
- ServicesTable: status predicate lines at ~219–227
- MaterialsTable: status predicate lines at ~143–151

### 7.4 Unchanged

- **Archive/restore buttons** — already exist and invalidate queries — no changes. **Stated dependency:** mutation hooks invalidate the base key `['masters']` (useMastersMutations.ts:11–36, etc.); react-query v5 `invalidateQueries` prefix-matches by default (`exact: false`), catching the new `['masters', statusFilter]` keys. A test assertion locks this in (§9).
- **Status column visibility** — unchanged (e.g. `defaultVisible: false` in MastersTable stays). Archived rows are identified by the «Восстановить» button (and the status column if enabled); the column is not forced visible.

### 7.5 Editing archived rows — preserve `is_active`

Scenarios 2–3 make archived rows clickable into the edit modal for the first time. Hazard: the edit modals don't send `is_active`, the 4 `Update` schemas default `is_active: bool = True` (schemas/master.py:29, material.py:20, location.py:33, service.py:56), and `GenericService.update` does `model_dump()` — a PUT edit of an archived entity would **silently flip it back to active**.

**Fix (frontend, minimal):** the edit modals for the 4 entities include the record's current `is_active` value in the update payload. No UI change, no backend update-path change, no schema change.

### 7.6 Caller audit (frontend side of §4a)

Audit all non-table callers of the 4 getters (schedule page, booking/record forms, selects, legends); pass `is_active: true` where archived records must not appear. Deliverable: audited call-site list in the PR description.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request with `is_active=true` → only active masters, data identical to today.
2. Filter «Все» → request **without** `is_active` → active + archived masters visible together; archived rows identifiable («Восстановить» button / status badge if column enabled).
3. Filter «Архив» → request with `is_active=false` → only archived masters → «Восстановить» button returns a master to active; after invalidation the row disappears from the archive view.
3a. Inverse flow: in «Активные» view, archiving a row → after invalidation the row disappears from the active view (and appears under «Архив»).
4. Same behavior on `/locations`, `/services`, `/materials` (options «Активные»/«Все»/«Архив», default «Активные»).
5. `/clients` — filter «Все» now correctly shows active + archived clients (latent backend bug fixed); «Активные»/«Архив» unchanged.
6. API contract: `GET /api/v1/masters` without `is_active` returns **all** records (breaking change, explicitly waived; all in-repo callers updated per §4a).

## 9. Testing Approach

### Backend (pytest)

- Extend the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities, parametrized: **absent (=all) / `is_active=true` / `is_active=false`** — all three behaviorally distinct under the rev-5 encoding.
- **Update the existing clients tests** for the new semantics: absent `is_active` → all records (the current test suite encodes the old `else True` coercion and will fail until updated).
- Unit tests for `SoftDeleteService.list` (new class: None / True / False) and `ServiceService.list` (eager-load override with the same 3 states), including keeping `is_active` out of `**filters`.
- **Regression (simplified by polymorphism):** `GET /api/v1/tags` and `GET /api/v1/visitors` return 200 — structurally guaranteed (tags/visitors stay on base `GenericService`), smoke-level assertion suffices.
- Router-level test: `?is_active=true/false` parse as bools; absent → None; `?is_active=foo` → 422 (documented behavior: previously the undeclared param was silently ignored).
- Caller-audit verification: existing backend tests passing after §4a updates serves as the check; no new dedicated test file.

### API client (vitest)

- `listQuery()` serializes `is_active` correctly: `true`/`false` appended, `null`/`undefined` omitted.

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables): three-option dropdown, default «Активные», queryFn mapping for all three states (`true` / omitted / `false`), queryKey includes filter.
- MaterialsTable: **minimal** test of the filter → queryFn/queryKey mapping only (file has zero coverage today; broader coverage not in scope).
- One assertion in the existing mutation-hook tests (e.g. useMastersMutations) locking in **prefix invalidation**: `invalidateQueries({ queryKey: ['masters'] })` must match `['masters', statusFilter]` keys (§7.4).
- Caller-audit: where an audited call site gains `is_active: true`, update its existing test mock expectations if they assert getter args.

## 10. Key Code Facts (verified by exploration + panels)

- Backend code is at `backend/src/` (NOT `backend/app`).
- `GenericService.list` duplicates repository logic inline and is shared by hard-delete entities (tags, visitors) via the `soft_delete` guard (~line 65) — rev 5 replaces the guard with `SoftDeleteService` polymorphism.
- `ServiceService.list` (~line 41) has an unconditional `.where(Service.is_active)` plus a `**filters` loop (~44–46).
- Clients latent bug: `services/client.py` ~103–106 `params.is_active if ... is not None else True`.
- Current filter dropdowns: «Все» is the empty string `''` in all 4 tables; defaults differ (`''` masters/locations, `'active'` services/materials).
- `MaterialsTable.tsx` lives under `services/components/` and has zero unit-test coverage.
- Status column in MastersTable is `defaultVisible: false` — left as-is.
- Reference (clients):
  - `backend/src/schemas/client.py:75` (`is_active` param)
  - `backend/src/api/v1/clients.py:60–66`
  - `backend/tests/test_client_stats.py:420–450` (`TestClientListFilterIsActive` — test pattern to copy, then update for rev-5 semantics)
  - `frontend/admin/app/(main)/clients/` wiring chain
  - `packages/api-client/src/endpoints.ts:270–283` (`getClientsWithStats` generic params)

## 11. Visual Compliance Checks

- [ ] `/masters`: status filter shows exactly three options («Активные»/«Все»/«Архив»), «Активные» selected by default, switching changes table content without a full-table loading flash
- [ ] `/masters`: «Все» shows active + archived masters together
- [ ] `/masters`: «Архив» shows only archived masters; «Восстановить» button present and removes rows from the view after restore
- [ ] `/locations`: same three-option filter behavior
- [ ] `/services`: same three-option filter behavior
- [ ] `/materials` (tab/section under services): same three-option filter behavior
- [ ] `/clients`: «Все» shows active + archived clients
- [ ] Schedule page and booking forms show no archived entities in their selects/lists (caller audit)

## 12. Spec Panel Findings — Resolution History

### Rev 2 panel (2026-08-02, 2/5 perspectives available)

| Finding | Severity | Resolution |
|---------|----------|------------|
| «Все»/«all» unrepresentable under absent=active-only semantics (completeness + simplicity, agreement) | BLOCKER | Rev 2 removed «Все»; **user rejected at G1b** → three-state encodings in rev 3+ |
| Default filter is «Все» (`''`) in masters/locations | BLOCKER | Default `'active'` everywhere (§7.1) |
| Filter mapping didn't match reality (`''` used for «Все») | MAJOR | Explicit `'all'` state value (§7.1–7.2) |
| `per_page=100` cap truncates archive views | MAJOR | Accepted limitation — out of scope (§3) |
| ServiceService.list / GenericService.list double-where hazard | MAJOR/MINOR | §5.2/§5.3: explicit named param, never via `**filters` |
| Empty states unspecified | MINOR | Out of scope (§3) |
| Status badge column `defaultVisible: false` vs visual check | MINOR | Visibility unchanged, check reworded (§7.4/§11) |
| MaterialsTable new test file beyond minimal mandate | MINOR | Scoped to mapping-only test (§9) |
| `is_active=true` case adds zero behavioral coverage | MINOR | Superseded: all 3 states distinct under rev-5 encoding (§9) |

### Rev 3/4 panel (2026-08-02, three-state `bool | "all"` encoding; 3/5 perspectives available: completeness, simplicity, best-practices ✅; feasibility, consistency ❌ unavailable)

| Finding | Perspective | Severity | Resolution |
|---------|-------------|----------|------------|
| `soft_delete` guard in GenericService.list load-bearing — tags/visitors share the method; dropping guard → 500 | completeness | BLOCKER | **Rev 5: eliminated structurally** — `SoftDeleteService` polymorphism, tags/visitors stay on base (§5.2, user decision) |
| «Сбросить» handlers call `setStatus('')`; filter options emit `value=""` | completeness | MAJOR | §7.1: reset → `'active'`, options → `value="all"` |
| Editing archived rows silently resurrects them (Update schemas default `is_active=True`) | completeness | MAJOR | §7.5: modals include record's current `is_active` in payload |
| Filter-switch UX regression: new queryKey + `isLoading` gate → "Загрузка..." flash | best-practices | MAJOR | §7.2: `placeholderData: keepPreviousData` |
| §7.3 line refs covered the *search* filter memo, not just dead status lines | completeness | MINOR | §7.3 corrected: status predicate only |
| Invalid `is_active` values → 422 (today silently ignored) | completeness + best-practices | MINOR | §9 router test; rev-5 note: 422 contract kept |
| Invalidation depends on default prefix matching — unstated, untested | completeness + best-practices | MINOR | §7.4 stated; §9 assertion added |
| `ListParams` widening leaks `is_active` to getVisitors/getTags | completeness + best-practices | MINOR | §6 accepted + documented |
| Inverse archive-in-«Активные» flow missing | completeness | MINOR | §8 scenario 3a |
| Fallback parsing strategy = speculative complexity | simplicity | MINOR | Rev 5: moot — plain bool parsing, no union |
| `IsActiveFilter` alias placement → layering inversion | simplicity | MINOR | Rev 5: moot — alias dropped, inline `bool \| None` |
| Mixed bool/"all" sentinel acceptable but enum more canonical | best-practices | MINOR | Rev 5: moot — sentinel encoding replaced per user decision |

### Rev 5 panel (3-state `bool | None` encoding + SoftDeleteService + clients alignment) — pending, see G1b report

## 13. Open Questions

None blocking. Noted consequence of the waived backward compatibility: any out-of-repo API consumer calling the 4 endpoints without `is_active` now receives archived records too — in-repo callers are covered by the §4a audit; out-of-repo consumers are the user's accepted risk.
