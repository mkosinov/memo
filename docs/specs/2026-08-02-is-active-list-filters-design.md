# GH #195 — `is_active` Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval, rev 2 after spec panel)
**Reference implementation:** Clients entity (already works end-to-end)

---

## 1. Problem Statement

Soft-delete entities (masters, locations, services, materials) support archive/restore (`is_active` flag, `PATCH .../restore`), but their **list endpoints always return only active records**. The admin tables therefore cannot show archived records, and the existing status filter dropdowns in 4 tables are **dead client-side filters** — they filter only within the already-active-only page of data, so "Все" and "Архив" never show archived rows.

Clients already solved this: `GET /clients?is_active=...` + server-side filtering in ClientsTable. This feature replicates that pattern across the remaining 4 soft-delete entities.

## 2. Goals

1. Single `is_active: bool | None` query param across API → services → repository for masters, locations, services, materials list endpoints.
2. Rename repository param `include_inactive: bool = False` → `is_active: bool | None = None` (internal method, safe to rename).
3. Admin tables for masters/locations/services/materials: server-side archive filtering (queryKey + queryFn), dead client-side status filtering removed.
4. Backward compatible: absent `is_active` param = active only (current behavior).

## 3. Explicitly OUT of Scope (YAGNI)

- **ClientsTable** — untouched (already works end-to-end; restore buttons there are a separate follow-up issue).
- **No new archive/restore button work** — existing buttons already invalidate queries.
- **No E2E tests** — project practice is unit/integration only.
- **Pagination/`per_page` behavior** — unchanged (all 4 tables currently fetch `per_page: 100` and slice client-side; archive views inherit the same cap — accepted limitation, not addressed here).
- **Empty-state UX copy** — filtered-empty views use the existing generic "not found" row; no new CTA.
- No changes to non-soft-delete entities.

## 4. Naming Convention and Param Semantics (user decision + panel clarification)

Single `is_active: bool | None` across the whole chain — API → services → repository.

**Param semantics (backend):**

| Param value | SQL | Result |
|-------------|-----|--------|
| absent / `None` | `where(table.is_active)` | active only — **current default, backward compatible** |
| `true` | `where(table.is_active == True)` | active only (explicit) |
| `false` | `where(table.is_active == False)` | archived only |

**IMPORTANT — "all" (active + archived) is intentionally NOT expressible.** The UI dropdowns are reduced to two options (see §7), so no API value for "all" is needed. This resolves the otherwise contradictory semantics where "param omitted" would have to mean both "default active-only" and "all".

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `is_active: bool | None = None`.
- Logic:
  - `is_active is None` → `where(table.is_active)` (active only, current default)
  - explicit value → `where(table.is_active == is_active)`
- Internal method — safe to rename, but all callers must be updated in the same PR.

### 5.2 `backend/src/services/generic.py` — GenericService.list (lines 54–79)

- Accepts `is_active: bool | None = None` as an **explicit named parameter** (NOT via `**filters`).
- Same semantics as 5.1.
- **Double-where hazard (must handle):** the current code has an unconditional `where(table.is_active)` (~line 66) plus a `**filters` loop (~67–69). The unconditional `where` must be replaced by the param-driven clause, and `is_active` must never leak into the `**filters` loop (otherwise `WHERE is_active AND is_active == False` → always empty).
- **NOTE:** GenericService.list builds its own inline SQL (does NOT delegate to the repository) — both implementations must be kept in sync.

### 5.3 `backend/src/services/service.py` — ServiceService.list (lines 31–54)

- Eager-loads tariffs/tags; add the same `is_active` support.
- **Double-where hazard (must handle):** the current code has an unconditional `.where(Service.is_active)` (~line 41) plus a `**filters` loop (~44–46). The unconditional where must be replaced by the param-driven clause and `is_active` excluded from the filters loop (same always-empty hazard as 5.2).

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`:

- Add query param `is_active: bool | None = None`.
- Pass through to the corresponding service `.list()`.
- Absent = active only (backward compatible).

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `is_active?: boolean | null`.
- `listQuery()` appends `is_active` to the query string **only when it is `true` or `false`**; `null`/`undefined` → param omitted (server default = active only).
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.

## 7. Frontend Changes (admin) — 4 tables, server-side filtering

User decision: **minimal changes, like ClientsTable but WITHOUT contexts — tables keep local state.**

Files:

- `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
- `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (note: lives under `services/components/`)

### 7.1 Filter dropdown reduced to two options

Panel finding: current dropdowns have three options — «Все» (`''`), «Активные», «Архив» — and defaults are inconsistent (masters/locations default to `''` = «Все»; services/materials default to `'active'`). Under the two-state param semantics (§4), «Все» is unrepresentable and duplicates «Активные».

Change per table:

- Dropdown options: **«Активные» (`'active'`)** and **«Архив» (`'archived'`)** only. Remove the «Все»/`''` option.
- Default state: **`'active'`** in all 4 tables (masters/locations change from `''` to `'active'` — visible behavior change: dropdown now shows «Активные» selected; data is identical since `''` previously also yielded active-only).
- Local state values are exactly `'active' | 'archived'` — no empty string, no `'all'`.

### 7.2 queryKey + queryFn

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same pattern for locations/services/materials).
2. **queryFn mapping:** `'active' → is_active: true`, `'archived' → is_active: false`; pass into the getter (`getMasters({ ..., is_active })` etc.).

### 7.3 Remove dead client-side status filtering

- MastersTable lines ~86–100
- LocationsTable lines ~89–103
- ServicesTable lines ~219–227
- MaterialsTable lines ~143–151

### 7.4 Unchanged

- **Archive/restore buttons** — already exist and invalidate queries — no changes.
- **Status column visibility** — unchanged (e.g. `defaultVisible: false` in MastersTable stays). Archived rows are identified by the filter itself and the «Восстановить» button, not by forcing the badge column visible.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request with `is_active=true` → only active masters, data identical to today.
2. Filter «Архив» → request with `is_active=false` → only archived masters → «Восстановить» button on a row returns the master to active; after query invalidation the row disappears from the archive view.
3. Same behavior on `/locations`, `/services`, `/materials` (filter options «Активные»/«Архив», default «Активные»).
4. `/clients` — unchanged.

## 9. Testing Approach

### Backend (pytest)

- Copy the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities: **absent / `is_active=false`** cases (behaviorally distinct). The explicit `is_active=true` case produces the identical WHERE clause as absent — include it only in one entity's parametrized test for contract documentation, not all four.
- Unit tests for `GenericService.list` and `ServiceService.list` with `is_active` (None/false) — covering both inline-SQL implementations, including the double-where hazard fix.

### API client (vitest)

- `listQuery()` serializes `is_active` correctly: `true`/`false` appended, `null`/`undefined` omitted.

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables): two-option dropdown, default «Активные», queryFn receives correct `is_active` mapping, queryKey includes filter.
- MaterialsTable: add a **minimal** test of the filter → queryFn/queryKey mapping only (no full component-coverage push — the file currently has zero coverage; covering just the new mapping is in scope, broader coverage is not).

## 10. Key Code Facts (verified by exploration + panel)

- Backend code is at `backend/src/` (NOT `backend/app`).
- `GenericService.list` duplicates repository logic inline — both must be updated in sync.
- `GenericService.list` (~line 66) and `ServiceService.list` (~line 41) each have an unconditional `where(is_active)` plus a `**filters` loop — double-where hazard if `is_active` leaks into filters.
- Current filter dropdowns: «Все» is the empty string `''` in all 4 tables; defaults differ (`''` masters/locations, `'active'` services/materials).
- `MaterialsTable.tsx` lives under `services/components/` and has zero unit-test coverage.
- Status column in MastersTable is `defaultVisible: false` — left as-is.
- Reference (clients, already working):
  - `backend/src/schemas/client.py:75` (`is_active` param)
  - `backend/src/api/v1/clients.py:60–66`
  - `backend/tests/test_client_stats.py:420–450` (`TestClientListFilterIsActive` — test pattern to copy)
  - `frontend/admin/app/(main)/clients/` wiring chain
  - `packages/api-client/src/endpoints.ts:270–283` (`getClientsWithStats` generic params)

## 11. Visual Compliance Checks

- [ ] `/masters`: status filter shows exactly two options («Активные»/«Архив»), «Активные» selected by default, switching changes table content
- [ ] `/masters`: «Архив» shows only archived masters; «Восстановить» button present on archived rows and removes them from the view after restore
- [ ] `/locations`: same two-option filter behavior
- [ ] `/services`: same two-option filter behavior
- [ ] `/materials` (tab/section under services): same two-option filter behavior
- [ ] `/clients` page renders unchanged

## 12. Spec Panel Findings — Resolution

| Finding | Severity | Resolution |
|---------|----------|------------|
| «Все»/«all» unrepresentable under absent=active-only semantics (completeness + simplicity, agreement) | BLOCKER | Fixed §4: "all" intentionally not expressible; dropdown reduced to 2 options (§7.1) |
| Default filter is «Все» in masters/locations → feature broken by default | BLOCKER | Fixed §7.1: default `'active'` everywhere |
| Filter mapping `'all'→null` doesn't match reality (`''` used) | MAJOR | Fixed §7.1–7.2: state is `'active' \| 'archived'`, no `''`/`'all'` |
| `per_page=100` cap truncates archive views | MAJOR | Accepted limitation — out of scope (§3), pre-existing pagination behavior unchanged |
| ServiceService.list / GenericService.list double-where hazard | MAJOR/MINOR | Fixed §5.2/§5.3: explicit replacement of unconditional where + exclusion from `**filters` |
| Empty states unspecified | MINOR | Out of scope (§3): existing generic "not found" row |
| Scenario 1 mislabels default filter | MINOR | Fixed §8 |
| Status badge column `defaultVisible: false` vs visual check | MINOR | Fixed §7.4/§11: visibility unchanged, check reworded |
| MaterialsTable new test file beyond minimal mandate | MINOR | Scoped to mapping-only test (§9) |
| `is_active=true` case adds zero behavioral coverage | MINOR | Reduced to one parametrized instance (§9) |

Perspectives feasibility / consistency / best-practices: unavailable (subagent returned empty after 3 attempts each).

## 13. Open Questions

None blocking. One visible behavior change to confirm at G1b: the «Все» dropdown option disappears from the 4 tables (it was dead/duplicate). Data shown by default is unchanged.
