# GH #195 — `is_active` Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval, rev 3 — three-state filter per user decision)
**Reference implementation:** Clients entity (already works end-to-end)

---

## 1. Problem Statement

Soft-delete entities (masters, locations, services, materials) support archive/restore (`is_active` flag, `PATCH .../restore`), but their **list endpoints always return only active records**. The admin tables therefore cannot show archived records, and the existing status filter dropdowns in 4 tables are **dead client-side filters** — they filter only within the already-active-only page of data, so "Все" and "Архив" never show archived rows.

Clients already solved part of this: `GET /clients?is_active=...` + server-side filtering in ClientsTable (two-state: active/archived). This feature extends the pattern to the remaining 4 soft-delete entities **with an additional "all" state** (user decision at G1b: keep the «Все» filter option).

## 2. Goals

1. Single `is_active` query param across API → services → repository for masters, locations, services, materials list endpoints, supporting **three states**: active-only (default), archived-only, all (active + archived).
2. Rename repository param `include_inactive: bool = False` → `is_active` (internal method, safe to rename).
3. Admin tables for masters/locations/services/materials: server-side archive filtering (queryKey + queryFn), dead client-side status filtering removed, three-option dropdown «Активные» / «Все» / «Архив».
4. Backward compatible: absent `is_active` param = active only (current behavior).

## 3. Explicitly OUT of Scope (YAGNI)

- **ClientsTable / clients endpoint** — untouched (already works end-to-end with two-state is_active; extending clients to "all" is not requested).
- **No new archive/restore button work** — existing buttons already invalidate queries.
- **No E2E tests** — project practice is unit/integration only.
- **Pagination/`per_page` behavior** — unchanged (all 4 tables currently fetch `per_page: 100` and slice client-side; archive/all views inherit the same cap — accepted limitation, not addressed here).
- **Empty-state UX copy** — filtered-empty views use the existing generic "not found" row; no new CTA.
- No changes to non-soft-delete entities.

## 4. Param Encoding (user decision: three states; architect's encoding choice)

**Chosen encoding: `is_active: bool | Literal["all"] | None = None`** — a single optional query param.

| Param value | Service/repository value | SQL | Result |
|-------------|--------------------------|-----|--------|
| absent | `None` | `where(table.is_active)` | active only — **default, backward compatible** |
| `?is_active=true` | `True` | `where(table.is_active == True)` | active only (explicit) |
| `?is_active=false` | `False` | `where(table.is_active == False)` | archived only |
| `?is_active=all` | `"all"` | *(no is_active filter)* | active + archived |

**Rationale:**
- Keeps the approved single-param naming concept (`is_active` across the whole chain) — one param, one name, no parallel `include_inactive` flag.
- Absent = active only preserves backward compatibility for all existing callers (schedule page, booking flow, etc.).
- The `"all"` sentinel avoids overloading `None` (which must keep its current default meaning) and is self-describing in URLs, logs, and tests.
- FastAPI/Pydantic v2 parses `bool | Literal["all"] | None` query unions correctly — **verified by panel research**: smart union resolves `"true"/"false"` → bool, `"all"` → Literal, absent → None; `"all"` is outside the lax-bool string set so it cannot be mis-coerced. This is the committed encoding; a router-level test (§9) locks it.
- **Invalid values → 422:** `?is_active=foo`, `?is_active=` (empty), `?is_active=ALL` → 422 (Pydantic v2 strict union rejection). Documented behavior change: today the undeclared param is silently ignored. Backward compatibility claim covers only a truly absent param.
- Alternatives rejected: (a) separate `include_inactive` bool — two params, violates the approved concept; (b) rename to tri-state enum `status=active|all|archived` — renames the param, diverges from the clients reference pattern (note: AIP-126 considers an enum the more canonical form once a bool gains a third state; rejected here for concept fidelity, but a future 4th state would be a breaking union change — documented caveat); (c) `null` meaning "all" — inexpressible in a URL query string distinct from "absent".

**Type alias (backend):** `IsActiveFilter = bool | Literal["all"] | None`. Placement: an existing neutral module in the schemas layer (or inlined in each signature). Must NOT be defined in `repositories/generic.py` — routers importing a type from the repository layer is a layering inversion. No new module is created solely for this alias.

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `is_active: IsActiveFilter = None`.
- Logic:
  - `is_active is None` → `where(table.is_active)` (active only, current default)
  - `is_active == "all"` → no is_active filter
  - `isinstance(is_active, bool)` → `where(table.is_active == is_active)`
- Internal method — safe to rename, but all callers must be updated in the same PR.

### 5.2 `backend/src/services/generic.py` — GenericService.list (lines 54–79)

- Accepts `is_active: IsActiveFilter = None` as an **explicit named parameter** (NOT via `**filters`).
- Same three-branch logic as 5.1.
- **`soft_delete` guard is load-bearing (BLOCKER from panel):** the current `where(table.is_active)` (~line 65) is wrapped in `if self._model.soft_delete:` because `GenericService.list` is shared by hard-delete entities — `TagService` (tag.py) and `VisitorService` (visitor.py) use the inherited method via their routers (`GET /tags`, `GET /visitors`). The new three-branch clause MUST stay inside that guard (soft-delete models only); dropping it → `AttributeError`/500 on tags and visitors list endpoints.
- **Double-where hazard (must handle):** the current code has an unconditional `where(table.is_active)` (~line 66, inside the guard) plus a `**filters` loop (~67–69). The unconditional `where` must be replaced by the param-driven clause, and `is_active` must never leak into the `**filters` loop (otherwise `WHERE is_active AND is_active == False` → always empty).
- **NOTE:** GenericService.list builds its own inline SQL (does NOT delegate to the repository) — both implementations must be kept in sync.

### 5.3 `backend/src/services/service.py` — ServiceService.list (lines 31–54)

- Eager-loads tariffs/tags; add the same `is_active` support with the same three-branch logic.
- **Double-where hazard (must handle):** the current code has an unconditional `.where(Service.is_active)` (~line 41) plus a `**filters` loop (~44–46). The unconditional where must be replaced by the param-driven clause and `is_active` excluded from the filters loop.

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`:

- Add query param `is_active: IsActiveFilter = None` (FastAPI parses `true`/`false`/`all`; absent = `None`).
- Pass through to the corresponding service `.list()`.
- Absent = active only (backward compatible).

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `is_active?: boolean | "all" | null`.
- `listQuery()` appends `is_active` to the query string **whenever it is not `null`/`undefined`**: `true` → `is_active=true`, `false` → `is_active=false`, `"all"` → `is_active=all`.
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.
- **Known type-level leak (accepted, documented):** `getVisitors` / `getTags` also take `ListParams` (endpoints.ts:402, 471), so their TS surface gains an `is_active` their backends don't declare — a call passing it compiles and is silently ignored by FastAPI. Accepted to avoid per-entity param subtypes (complexity for no runtime effect); add a code comment on the `ListParams.is_active` field noting it applies to soft-delete entities only.

## 7. Frontend Changes (admin) — 4 tables, server-side filtering

User decision: **minimal changes, like ClientsTable but WITHOUT contexts — tables keep local state.**

Files:

- `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
- `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (note: lives under `services/components/`)

### 7.1 Filter dropdown — three explicit options

Panel finding: current dropdowns use the empty string `''` for «Все», and defaults are inconsistent (masters/locations default to `''`; services/materials default to `'active'`).

Change per table:

- Dropdown options (exactly three): **«Активные» (`'active'`)**, **«Все» (`'all'`)**, **«Архив» (`'archived'`)**. The empty-string `''` value is eliminated — the filter components currently emit `<option value="">Все</option>` (MasterFilters.tsx:62, LocationFilters, ServiceFilters, MaterialsTable.tsx:326); these become `value="all"`.
- Default state: **`'active'`** in all 4 tables (masters/locations change from `''` to `'active'` — dropdown now shows «Активные» selected; data identical since `''` previously also yielded active-only).
- **«Сбросить» (reset) handlers:** MastersTable.tsx:251 and LocationsTable.tsx:250 currently call `setStatus('')` — must change to `setStatus('active')` (ServicesTable:378 / MaterialsTable:333 already reset to `'active'`). After this change `''` no longer exists in the state union.
- Local state values are exactly `'active' | 'all' | 'archived'`.

### 7.2 queryKey + queryFn

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same pattern for locations/services/materials).
2. **queryFn mapping:** `'active' → is_active: true`, `'all' → is_active: "all"`, `'archived' → is_active: false`; pass into the getter (`getMasters({ ..., is_active })` etc.).
3. **`placeholderData: keepPreviousData`** (react-query v5) on all 4 list queries: a queryKey change creates a new pending query, and the tables' `if (isLoading)` gate (e.g. MastersTable.tsx:236) would flash the full-table "Загрузка..." on every dropdown switch — today's client-side filter is instant. `keepPreviousData` is the documented v5 remedy for filter switches.

### 7.3 Remove dead client-side status filtering

Remove **only the dead status predicate** from the client-side filter memos (panel correction: the surrounding memo also contains the *search* filter, which must be preserved — e.g. MastersTable.tsx:86–100 is the whole `filteredMasters` memo; only the status lines ~96–97 are dead):

- MastersTable: status predicate lines (~96–97) inside the memo at ~86–100
- LocationsTable: status predicate lines inside the memo at ~89–103
- ServicesTable: status predicate lines at ~219–227
- MaterialsTable: status predicate lines at ~143–151

### 7.4 Unchanged

- **Archive/restore buttons** — already exist and invalidate queries — no changes. **Stated dependency:** mutation hooks invalidate the base key `['masters']` (useMastersMutations.ts:11–36, etc.); react-query v5 `invalidateQueries` prefix-matches by default (`exact: false`), so this catches the new `['masters', statusFilter]` keys. A test assertion locks this in (§9).
- **Status column visibility** — unchanged (e.g. `defaultVisible: false` in MastersTable stays). In «Все»/«Архив» views archived rows are identified by the «Восстановить» button (and the status column if the user enables it); the column is not forced visible.

### 7.5 Editing archived rows — preserve `is_active` (MAJOR from panel)

Scenarios 2–3 make archived rows clickable into the edit modal for the first time. Hazard: the edit modals don't send `is_active`, the 4 `Update` schemas default `is_active: bool = True` (schemas/master.py:29, material.py:20, location.py:33, service.py:56), and `GenericService.update` does `model_dump()` — so a PUT edit of an archived entity would **silently flip it back to active** with no UI indication.

**Fix (frontend, minimal):** the edit modals for the 4 entities include the record's current `is_active` value in the update payload. No UI change, no backend update-path change, no schema change.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request with `is_active=true` → only active masters, data identical to today.
2. Filter «Все» → request with `is_active=all` → active + archived masters visible together; archived rows identifiable (status badge column if enabled / «Восстановить» button).
3. Filter «Архив» → request with `is_active=false` → only archived masters → «Восстановить» button on a row returns the master to active; after query invalidation the row disappears from the archive view.
3a. Inverse flow: in «Активные» view, archiving a row via its «Архивировать» button → after invalidation the row disappears from the active view (and appears under «Архив»).
4. Same behavior on `/locations`, `/services`, `/materials` (filter options «Активные»/«Все»/«Архив», default «Активные»).
5. `/clients` — unchanged.
6. API backward compatibility: `GET /api/v1/masters` without `is_active` returns active only, exactly as before.

## 9. Testing Approach

### Backend (pytest)

- Extend the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities, parametrized: **absent / `is_active=false` / `is_active=all`** (behaviorally distinct: active-only, archived-only, both). One entity's test also covers explicit `is_active=true` (identical WHERE to absent — contract documentation only, not repeated for all four).
- Unit tests for `GenericService.list` and `ServiceService.list` with `is_active` ∈ {None, "all", False} — covering both inline-SQL implementations, including the double-where hazard fix.
- Router-level tests: `?is_active=all` parses to the `"all"` literal (locks the FastAPI union-parsing contract in §4); `?is_active=foo` and `?is_active=` (empty) → 422 (locks the documented invalid-value behavior).
- **Regression test for the `soft_delete` guard (§5.2):** hard-delete entities still list after the `GenericService.list` rewrite — `GET /api/v1/tags` and `GET /api/v1/visitors` return 200 with data.

### API client (vitest)

- `listQuery()` serializes `is_active` correctly: `true`/`false`/`"all"` appended, `null`/`undefined` omitted.

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables): three-option dropdown, default «Активные», queryFn receives correct `is_active` mapping for all three states, queryKey includes filter.
- MaterialsTable: add a **minimal** test of the filter → queryFn/queryKey mapping only (no full component-coverage push — the file currently has zero coverage; covering just the new mapping is in scope, broader coverage is not).
- One assertion in the existing mutation-hook tests (e.g. useMastersMutations) locking in **prefix invalidation**: `invalidateQueries({ queryKey: ['masters'] })` must match `['masters', statusFilter]` keys (default fuzzy matching) — this is what makes archive/restore buttons work with the new keyed queries (§7.4).

## 10. Key Code Facts (verified by exploration + panel)

- Backend code is at `backend/src/` (NOT `backend/app`).
- `GenericService.list` duplicates repository logic inline — both must be updated in sync.
- `GenericService.list` (~line 66) and `ServiceService.list` (~line 41) each have an unconditional `where(is_active)` plus a `**filters` loop — double-where hazard if `is_active` leaks into filters.
- Current filter dropdowns: «Все» is the empty string `''` in all 4 tables; defaults differ (`''` masters/locations, `'active'` services/materials).
- `MaterialsTable.tsx` lives under `services/components/` and has zero unit-test coverage.
- Status column in MastersTable is `defaultVisible: false` — left as-is.
- Reference (clients, already working, two-state only):
  - `backend/src/schemas/client.py:75` (`is_active` param)
  - `backend/src/api/v1/clients.py:60–66`
  - `backend/tests/test_client_stats.py:420–450` (`TestClientListFilterIsActive` — test pattern to copy)
  - `frontend/admin/app/(main)/clients/` wiring chain
  - `packages/api-client/src/endpoints.ts:270–283` (`getClientsWithStats` generic params)

## 11. Visual Compliance Checks

- [ ] `/masters`: status filter shows exactly three options («Активные»/«Все»/«Архив»), «Активные» selected by default, switching changes table content
- [ ] `/masters`: «Все» shows active + archived masters together
- [ ] `/masters`: «Архив» shows only archived masters; «Восстановить» button present on archived rows and removes them from the view after restore
- [ ] `/locations`: same three-option filter behavior
- [ ] `/services`: same three-option filter behavior
- [ ] `/materials` (tab/section under services): same three-option filter behavior
- [ ] `/clients` page renders unchanged

## 12. Spec Panel Findings — Resolution History

### Rev 2 panel (2026-08-02, 2/5 perspectives available)

| Finding | Severity | Resolution |
|---------|----------|------------|
| «Все»/«all» unrepresentable under absent=active-only semantics (completeness + simplicity, agreement) | BLOCKER | Rev 2 removed «Все»; **user rejected at G1b** → rev 3 adds `"all"` state (§4) |
| Default filter is «Все» (`''`) in masters/locations | BLOCKER | Default `'active'` everywhere (§7.1) |
| Filter mapping didn't match reality (`''` used for «Все») | MAJOR | Explicit `'all'` state value (§7.1–7.2) |
| `per_page=100` cap truncates archive views | MAJOR | Accepted limitation — out of scope (§3) |
| ServiceService.list / GenericService.list double-where hazard | MAJOR/MINOR | §5.2/§5.3: replace unconditional where + exclude from `**filters` |
| Empty states unspecified | MINOR | Out of scope (§3) |
| Status badge column `defaultVisible: false` vs visual check | MINOR | Visibility unchanged, check reworded (§7.4/§11) |
| MaterialsTable new test file beyond minimal mandate | MINOR | Scoped to mapping-only test (§9) |
| `is_active=true` case adds zero behavioral coverage | MINOR | One parametrized instance only (§9) |

### Rev 3 panel (2026-08-02, three-state encoding; 3/5 perspectives available)

**Availability:** completeness ✅, simplicity ✅, best-practices ✅ (after 1 retry); feasibility ❌ unavailable (empty ×2), consistency ❌ unavailable (empty + cancelled) — both per availability policy.

| Finding | Perspective | Severity | Resolution |
|---------|-------------|----------|------------|
| `soft_delete` guard in GenericService.list is load-bearing — tags/visitors (hard-delete) share the method; dropping the guard → 500 on GET /tags, /visitors | completeness | BLOCKER | §5.2: three-branch clause stays inside `if self._model.soft_delete:`; §9: regression test for tags/visitors list |
| «Сбросить» handlers call `setStatus('')` (MastersTable:251, LocationsTable:250); filter options emit `value=""` | completeness | MAJOR | §7.1: reset → `'active'`, options → `value="all"`, `''` eliminated from state union |
| Editing archived rows silently resurrects them (Update schemas default `is_active=True` + `model_dump()`) | completeness | MAJOR | §7.5: edit modals include record's current `is_active` in update payload |
| Filter-switch UX regression: new queryKey + `isLoading` gate → full-table "Загрузка..." flash | best-practices | MAJOR | §7.2: `placeholderData: keepPreviousData` on all 4 list queries |
| §7.3 line refs covered the *search* filter memo, not just dead status lines | completeness | MINOR | §7.3 corrected: remove only status predicate, preserve search |
| Invalid `is_active` values → 422 (today silently ignored); contract undocumented | completeness + best-practices | MINOR | §4 documented; §9 router test for 422 |
| Invalidation of keyed queries depends on default prefix matching — unstated, untested | completeness + best-practices | MINOR | §7.4 dependency stated; §9 mutation-hook assertion added |
| `ListParams` widening leaks `is_active` to getVisitors/getTags (typed-but-no-op) | completeness + best-practices | MINOR | §6 accepted + documented with code comment |
| Inverse archive-in-«Активные» flow missing from scenarios | completeness | MINOR | §8 scenario 3a added |
| Fallback parsing strategy = speculative complexity | simplicity | MINOR | §4: committed to union encoding, fallback dropped |
| `IsActiveFilter` alias in repositories/generic.py → layering inversion | simplicity | MINOR | §4: alias in neutral schemas-layer module or inlined |
| Mixed bool/"all" sentinel acceptable; enum more canonical per AIP-126 | best-practices | MINOR | §4 rationale: caveat documented, encoding kept per concept |

## 13. Open Questions

None. Encoding choice (§4) documented with rationale; fallback parsing strategy noted if FastAPI union parsing misbehaves (implementation detail, same contract).
