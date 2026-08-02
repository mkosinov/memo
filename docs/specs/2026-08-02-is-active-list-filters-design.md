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
- FastAPI/Pydantic v2 parses `bool | Literal["all"] | None` query unions: `"true"/"false"` → bool, `"all"` → literal, absent → None. (To be confirmed by tests in implementation; fallback if union parsing misbehaves: accept `str` and validate manually in a small helper — same contract, internal detail only.)
- Alternatives rejected: (a) separate `include_inactive` bool — two params, violates the approved concept; (b) rename to tri-state enum `status=active|all|archived` — renames the param, diverges from the clients reference pattern; (c) `null` meaning "all" — inexpressible in a URL query string distinct from "absent".

**Type alias (backend):** `IsActiveFilter = bool | Literal["all"] | None` (defined once, e.g. in `repositories/generic.py` or a shared types module, reused by services and routers).

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
- **Double-where hazard (must handle):** the current code has an unconditional `where(table.is_active)` (~line 66) plus a `**filters` loop (~67–69). The unconditional `where` must be replaced by the param-driven clause, and `is_active` must never leak into the `**filters` loop (otherwise `WHERE is_active AND is_active == False` → always empty).
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

- Dropdown options (exactly three): **«Активные» (`'active'`)**, **«Все» (`'all'`)**, **«Архив» (`'archived'`)**. The empty-string `''` value is eliminated.
- Default state: **`'active'`** in all 4 tables (masters/locations change from `''` to `'active'` — dropdown now shows «Активные» selected; data identical since `''` previously also yielded active-only).
- Local state values are exactly `'active' | 'all' | 'archived'`.

### 7.2 queryKey + queryFn

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same pattern for locations/services/materials).
2. **queryFn mapping:** `'active' → is_active: true`, `'all' → is_active: "all"`, `'archived' → is_active: false`; pass into the getter (`getMasters({ ..., is_active })` etc.).

### 7.3 Remove dead client-side status filtering

- MastersTable lines ~86–100
- LocationsTable lines ~89–103
- ServicesTable lines ~219–227
- MaterialsTable lines ~143–151

### 7.4 Unchanged

- **Archive/restore buttons** — already exist and invalidate queries — no changes.
- **Status column visibility** — unchanged (e.g. `defaultVisible: false` in MastersTable stays). In «Все»/«Архив» views archived rows are identified by the «Восстановить» button (and the status column if the user enables it); the column is not forced visible.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request with `is_active=true` → only active masters, data identical to today.
2. Filter «Все» → request with `is_active=all` → active + archived masters visible together; archived rows identifiable (status badge column if enabled / «Восстановить» button).
3. Filter «Архив» → request with `is_active=false` → only archived masters → «Восстановить» button on a row returns the master to active; after query invalidation the row disappears from the archive view.
4. Same behavior on `/locations`, `/services`, `/materials` (filter options «Активные»/«Все»/«Архив», default «Активные»).
5. `/clients` — unchanged.
6. API backward compatibility: `GET /api/v1/masters` without `is_active` returns active only, exactly as before.

## 9. Testing Approach

### Backend (pytest)

- Extend the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities, parametrized: **absent / `is_active=false` / `is_active=all`** (behaviorally distinct: active-only, archived-only, both). One entity's test also covers explicit `is_active=true` (identical WHERE to absent — contract documentation only, not repeated for all four).
- Unit tests for `GenericService.list` and `ServiceService.list` with `is_active` ∈ {None, "all", False} — covering both inline-SQL implementations, including the double-where hazard fix.
- Router-level test that `?is_active=all` parses to the `"all"` literal (validates the FastAPI union-parsing assumption in §4).

### API client (vitest)

- `listQuery()` serializes `is_active` correctly: `true`/`false`/`"all"` appended, `null`/`undefined` omitted.

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables): three-option dropdown, default «Активные», queryFn receives correct `is_active` mapping for all three states, queryKey includes filter.
- MaterialsTable: add a **minimal** test of the filter → queryFn/queryKey mapping only (no full component-coverage push — the file currently has zero coverage; covering just the new mapping is in scope, broader coverage is not).

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

### Rev 3 panel (three-state encoding) — pending, see G1b report

## 13. Open Questions

None. Encoding choice (§4) documented with rationale; fallback parsing strategy noted if FastAPI union parsing misbehaves (implementation detail, same contract).
