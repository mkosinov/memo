# GH #195 — `is_active` Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval)
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
- No changes to non-soft-delete entities.

## 4. Naming Convention (user decision)

Single `is_active: bool | None` across the whole chain — API → services → repository.

Semantics:

| Value | Meaning |
|-------|---------|
| absent / `None` | active only (`where(table.is_active)`) — **current default, backward compatible** |
| `true` | active only (explicit) |
| `false` | archived only (`where(table.is_active == False)`) |

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `is_active: bool | None = None`.
- Logic:
  - `is_active is None` → `where(table.is_active)` (active only, current default)
  - explicit value → `where(table.is_active == is_active)`
- Internal method — safe to rename, but all callers must be updated in the same PR.

### 5.2 `backend/src/services/generic.py` — GenericService.list (lines 54–79)

- Accepts `is_active: bool | None = None`.
- Same semantics as 5.1.
- **NOTE:** GenericService.list builds its own inline SQL (does NOT delegate to the repository) — both implementations must be kept in sync.

### 5.3 `backend/src/services/service.py` — ServiceService.list (lines 31–54)

- Eager-loads tariffs/tags; add the same `is_active` support.

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`:

- Add query param `is_active: bool | None = None`.
- Pass through to the corresponding service `.list()`.
- Absent = active only (backward compatible).

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `is_active?: boolean | null`.
- `listQuery()` appends `is_active` to the query string when it is not `null`/`undefined` (`true`/`false` are appended).
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.

## 7. Frontend Changes (admin) — 4 tables, server-side filtering

User decision: **minimal changes, like ClientsTable but WITHOUT contexts — tables keep local state.**

Files:

- `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
- `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (note: lives under `services/components/`)

Changes per table:

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same pattern for locations/services/materials).
2. **queryFn:** map filter → `is_active`: `'active' → true`, `'all' → null`, `'archived' → false`; pass into the getter (`getMasters({ ..., is_active })` etc.).
3. **Remove dead client-side status filtering:**
   - MastersTable lines ~86–100
   - LocationsTable lines ~89–103
   - ServicesTable lines ~219–227
   - MaterialsTable lines ~143–151
4. **Archive/restore buttons** — already exist and invalidate queries — no changes.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter «Активные» (default) → only active masters, exactly as today (no request param change visible to the user).
2. Filter «Все» → request with `is_active=null` (param omitted) → active + archived visible; archived rows show status badge.
3. Filter «Архив» → request with `is_active=false` → only archived → «Восстановить» button returns a master to active (row disappears from the archive view after invalidation).
4. Same behavior on `/locations`, `/services`, `/materials`.
5. `/clients` — unchanged.

## 9. Testing Approach

### Backend (pytest)

- Copy the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities: default (absent) / `is_active=true` / `is_active=false` cases.
- Unit tests for `GenericService.list` and `ServiceService.list` with `is_active` (None/true/false).

### API client (vitest)

- `listQuery()` serializes `is_active` correctly (true/false appended, null/undefined omitted).

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables).
- Add minimal MaterialsTable filter + queryKey test (currently zero unit-test coverage for this file).
- Verify queryFn receives correct `is_active` mapping.

## 10. Key Code Facts (verified by exploration)

- Backend code is at `backend/src/` (NOT `backend/app`).
- `GenericService.list` duplicates repository logic inline — both must be updated in sync.
- `MaterialsTable.tsx` lives under `services/components/` and has zero unit-test coverage.
- Reference (clients, already working):
  - `backend/src/schemas/client.py:75` (`is_active` param)
  - `backend/src/api/v1/clients.py:60–66`
  - `backend/tests/test_client_stats.py:420–450` (`TestClientListFilterIsActive` — test pattern to copy)
  - `frontend/admin/app/(main)/clients/` wiring chain
  - `packages/api-client/src/endpoints.ts:270–283` (`getClientsWithStats` generic params)

## 11. Visual Compliance Checks

- [ ] `/masters`: status filter («Активные»/«Все»/«Архив») visible and switches table content
- [ ] `/masters`: «Архив» shows only archived masters with status badge; «Восстановить» button present on archived rows
- [ ] `/locations`: same filter behavior
- [ ] `/services`: same filter behavior
- [ ] `/materials` (tab/section under services): same filter behavior
- [ ] `/clients` page renders unchanged

## 12. Open Questions

None — design concept approved at G1a (2026-08-02).
