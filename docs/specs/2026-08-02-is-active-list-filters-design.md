# GH #195 — `status` Filter Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval, rev 6 — enum `status` param with safe default per user decision)
**Reference implementation:** Clients entity (aligned to the same convention in this feature)

---

## 1. Problem Statement

Soft-delete entities (masters, locations, services, materials) support archive/restore (`is_active` flag; restore = `PATCH /{id}` with `{is_active: true}` via the Patch schemas — there is no dedicated restore endpoint), but their **list endpoints always return only active records**. The admin tables therefore cannot show archived records, and the existing status filter dropdowns in 4 tables are **dead client-side filters** — they filter only within the already-active-only page of data, so "Все" and "Архив" never show archived rows.

Additionally, the **clients endpoint has a latent gap**: `services/client.py` (~103–106) coerces absent `is_active` to active-only, so the ClientsTable «Все» filter (`is_active=null`) can never show archived clients. (Archived-only via `is_active=false` already works — panel-verified by `test_filter_is_active_false`.) Clients is aligned to the new convention in this feature.

## 2. Goals

1. Single enum query param **`status: Literal["active", "archived", "all"] = "active"`** across routers → services → repository for masters, locations, services, materials **and clients** list endpoints.
2. **Safe default (user decision):** absent param = `active` = active only. All existing param-less callers (public web schedule, RecordsContext picker, clients phone search) keep working **unchanged**.
3. Introduce `SoftDeleteService(GenericService)` — polymorphism replaces soft_delete branching: base `GenericService` has NO is_active knowledge; the subclass applies the status filter.
4. Rename repository param `include_inactive: bool = False` → `status: ArchiveStatus = ACTIVE` (dead parameter — zero callers today, rename trivially safe).
5. Admin tables for masters/locations/services/materials: server-side three-option archive filtering («Активные» default / «Все» / «Архив»), dead client-side status filtering removed.
6. Align **clients** to the same enum (frontend ClientsFilters tri-state maps onto it; «Неактивные» gains proper server-side archived-only).

## 3. Explicitly Out of Scope (YAGNI)

- **No new archive/restore button work** — existing buttons already invalidate queries.
- **No NEW E2E tests** — but existing Playwright specs that assert the changed behavior ARE updated minimally (§9): `e2e/clients.spec.ts:327–359` waits for a URL with `is_active=false`, does `selectOption('false')`, asserts `toHaveValue('')` after reset — all invalid under the enum (`status=archived`, `selectOption('archived')`, reset value `'active'`). (Panel-verified: `masters-crud.spec.ts:64` and `services-crud.spec.ts:34` use `selectOption('archived')`, which still exists as a value — they keep passing.)
- **Pagination/`per_page` behavior** — unchanged (tables fetch `per_page: 100` and slice client-side; archive/all views inherit the same cap — accepted limitation).
- **Empty-state UX copy** — filtered-empty views use the existing generic "not found" row.
- **Delete-on-archived-row UX** — known limitation (accepted): row «Удалить» on an already-archived record → `SoftDeleteRepository.delete` returns `False` → 404 toast (all 5 entities; newly reachable via «Архив»/«Все» views). Follow-up: hide the delete action for archived rows.
- **Clients restore UI** — archived clients visible under «Все»/«Неактивные» but unrestorable from the UI (ClientPatch omits `is_active`; covered by the existing ClientsTable restore-buttons follow-up issue).
- **Backend Update-schema `is_active: bool = True` default** — root resurrection hazard, documented in §7.5; fixing the schema itself is out of scope.
  - *Addressed by GH #184 (rev 4 §3.5): defaults flipped to `bool | None = None`, sticky-field semantics.*
- No changes to non-soft-delete entities (tags, visitors stay on base `GenericService`).

## 4. Param Encoding (user decision, rev 6)

**Route-level enum: `status: Literal["active", "archived", "all"] = "active"`.**

| Param value | Repository/service behavior | Result |
|-------------|------------------------------|--------|
| absent / `active` (default) | `where(table.is_active)` | active only — **safe default, backward compatible** |
| `?status=archived` | `where(NOT table.is_active)` | archived only (server-side, per user decision) |
| `?status=all` | *(no is_active filter)* | active + archived |
| any other value | — | 422 (enum validation) |

**Naming rationale (architect's choice within user mandate):**
- Param name `status` (user-suggested): matches the existing UI vocabulary — the dropdowns are already called "status filter" in all 4 tables and ClientsFilters. Values `active`/`archived`/`all` are self-describing in URLs, logs, and tests. **Verified no collision:** none of the 5 affected entities has a `status` column and none of the 5 endpoints has an existing `status` param (only Record/Visit have status fields — different routers, untouched). Noted divergence: Google AIP-216 reserves "status" for HTTP/gRPC statuses and prefers `state` — dismissed: user-suggested name, local product vocabulary already uses "status" for this filter, no local collision; consistency within the product wins over an external guide here.
- Rejected alternatives: `is_active=...` with 3 states (rejected by user in rev 5); `?include_archived=true` bool à la AIP-132 (cannot express archived-only, which the user explicitly requires server-side).
- **Safe default = active:** every existing param-less caller (public web schedule `frontend/web/useSchedule.ts`, `RecordsContext.tsx:89` client picker, clients phone search, any out-of-repo consumer) keeps receiving active-only — no caller audit needed (§4a).

**Internal normalized form (architect's choice, documented):** one shared enum across the whole chain — **`ArchiveStatus`** (`StrEnum` — stdlib `enum.StrEnum` if the project targets Python 3.11+, else `(str, Enum)`; plan confirms) with `ACTIVE`/`ARCHIVED`/`ALL`, defined in **`src/models/enums.py`** — the existing home of all domain enums (`RecordStatus`, `VisitStatus`, …), a leaf module; NOT in `schemas/` (would create a repositories→schemas layering inversion, flagged by two panels). Name `ArchiveStatus` chosen over `ActivityStatus`: `Activity` is an existing domain entity (master-class) — `ActivityStatus` would read as "status of an Activity" and violate the entity-scoped enum naming precedent. FastAPI parses StrEnum query params natively (422 + correct OpenAPI enum emission — panel-verified).
- Noted divergence (best-practices panel): AIP-132/164 model soft-delete listing as an opt-in bool and treat "all" as query-meta rather than a domain-enum value. Dismissed: the user rejected both bool shapes (revs 4–5) and explicitly mandated a 3-value enum route param; the enum must reach the repository because the 3 behaviors (filter true / filter false / no filter) must be distinguished there. Documented as a conscious deviation.

### 4a. Safe default — no caller audit required (simplification vs rev 5)

Because absent param = active only, **all existing param-less callers keep working unchanged**: `frontend/web/app/hooks/useSchedule.ts:41/47/53`, `frontend/admin` RecordsContext.tsx:89, `clients.py` phone search, schedule/booking selects. Rev 5's mandatory caller audit is replaced by a **verification note**: the plan/PR must confirm (via existing tests + a grep sweep) that no caller previously relied on `include_inactive=True` (verified dead in rev-5 panel) and that existing test suites pass unchanged.

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `status: ArchiveStatus = ArchiveStatus.ACTIVE`.
- **Panel-verified: `SoftDeleteRepository.list` has zero callers** (no service/router invokes it; `GenericService.list` builds its own SQL). The rename is kept for naming consistency per user directive (3 lines, harmless); deleting the dead method is out of scope.
- Logic:
  - `ACTIVE` → `where(table.is_active)`
  - `ARCHIVED` → `where(not_(table.is_active))`
  - `ALL` → no is_active filter

### 5.2 `backend/src/services/generic.py` — GenericService + NEW SoftDeleteService (user decision: polymorphism)

- **Base `GenericService`:** NO is_active knowledge at all — no param, no `soft_delete` branching in `list()` (the current `if self._model.soft_delete:` guard + unconditional `where(table.is_active)` at ~65–66 is removed from base). `TagService` and `VisitorService` stay on base `GenericService` — structurally unaffected (eliminates the rev-4 BLOCKER by construction).
- **NEW `SoftDeleteService(GenericService)`:** overrides `list()` accepting `status: ArchiveStatus = ArchiveStatus.ACTIVE`; applies the §4 mapping (`ACTIVE` → `where(is_active)`, `ARCHIVED` → `where(not_(is_active))`, `ALL` → no filter); `get()` unchanged (no is_active filter today).
- **Migration:** Master, Location, Material, **Client** services move from `GenericService` → `SoftDeleteService`. (Client is a soft-delete model — `AbstractModelSoftDelete`. `ClientService` is currently an **empty `GenericService` subclass** (services/client.py:27–33); the clients stats listing is a **module-level function** `list_clients_with_stats()`, not a method — it gets its own status handling in §5.5. The inherited `SoftDeleteService.list` governs the generic path used by phone search.)
- **Plan verification (from feasibility panel):** enumerate ALL models subclassing `AbstractModelSoftDelete` / having `soft_delete=True` and confirm every corresponding service migrates to `SoftDeleteService` — after the base guard is removed, any missed soft-delete service would silently list archived records. (Tags/visitors are hard-delete and stay on base — structurally safe.)
- The `status` param is an **explicit named parameter**, never routed through `**filters` (double-where hazard from rev-3 panel).

### 5.3 `backend/src/services/service.py` — ServiceService (lines 31–54)

- Inherits `SoftDeleteService` (moves off base `GenericService`), keeps its eager-load override (tariffs/tags).
- Its overridden `list()` replaces the unconditional `.where(Service.is_active)` (~line 41) with the status-driven clause (§4 mapping), keeping `status` out of the `**filters` loop (~44–46). May compose with the superclass clause instead of duplicating it if trivial (simplicity-panel direction, plan-level choice).

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`:

- Query param `status: ArchiveStatus = ArchiveStatus.ACTIVE`.
- Pass through to the corresponding service `.list()`.
- Absent = active only (safe default).

**Clients is a carve-out:** the clients list endpoint (clients.py:60–66) does NOT take a route-level param and does NOT call `service.list()` — it receives filters via `params: ClientListParams = Depends()` and calls the module-level `list_clients_with_stats()`. The `status` field for clients lives inside `ClientListParams` (§5.5). Declaring a route-level `status` on clients.py too would duplicate the parameter.

### 5.5 Clients alignment (in scope, minimal)

- `backend/src/schemas/client.py` — `ClientListParams`: replace `is_active: bool | None = None` (line ~75) with `status: ArchiveStatus = ArchiveStatus.ACTIVE`.
- `backend/src/services/client.py` (~103–106): replace the `is_active_filter = params.is_active if ... is not None else True` logic with the §4 mapping (`ARCHIVED` → `where(not_(Client.is_active))`, `ALL` → no filter, `ACTIVE` default → `where(Client.is_active)`). Fixes the latent gap: «Все» now returns all records server-side (archived-only already worked via `is_active=false` and keeps working as `status=archived`).
- **Phone search:** `GET /api/v1/clients/search?phone=` (clients.py:41–57, calls `service.list(phone=...)`) — after ClientService migrates to `SoftDeleteService` (§5.2), the subclass default `status=ACTIVE` keeps it active-only **automatically; no code change needed** (rev-5's explicit `is_active=True` simplifies away). Booking dedupe (useRecordMutations.ts:88, NewBookingTab.tsx:40) unaffected.
- **ClientsTable default filter:** `ClientsContext.defaultFilters.is_active = null` means the «Все» option is selected by default. Under the new enum, «Все» maps to an explicit `status: 'all'` — so unless the default changes, archived clients surface in the default table view. Change the default to «Активные» (`status: 'active'`) so the default view is unchanged. This is the only ClientsContext change.
- **Old param retirement:** `?is_active=` on `/clients` disappears (undeclared params are silently ignored by FastAPI — no 422). All in-repo callers (ClientsFilters, E2E spec) are updated in the same PR (§7.6, §9); out-of-repo consumers using `is_active=false` would silently get active-only — accepted, documented.
- **Restore gap (documented, out of scope):** restore is `PATCH /{id}` with `{is_active: true}`; `ClientPatch`/`ClientUpdate` omit `is_active` — archived clients visible under «Все»/«Неактивные» but cannot be restored from the UI (existing follow-up issue).

### 5.6 Domain-rules docs (required deliverable, panel-found)

`docs/domain-rules/` is the single source of truth; these entries become imprecise once `?status=` exists and MUST be updated in the feature PR:

- `masters.md:33` ("List all active masters"), `locations.md:39`, `services.md:50`, `materials.md:29` — document the `status` param (default active, `archived`, `all`).
- `clients.md` — document the list `status` filter (currently undocumented) and the `is_active` → `status` param retirement.

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `status?: "active" | "archived" | "all" | null` (string union mirroring the backend enum; no `is_active` param is added).
- `listQuery()` appends `status` whenever it is not `null`/`undefined` (including explicit `"active"` — harmless, matches server default, keeps queryFn code branch-free).
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.
- **`getClientsWithStats` (endpoints.ts:270–283):** no change needed — it is a generic param pass-through (`Record<string, string | number | boolean | null | undefined>`) with no typed `is_active`. The actual clients change sites are `ClientsContext.tsx:81–87` (filters spread) and `ClientsFilters.tsx:46–51` (mapping), covered by §7.6.
- **Frontend type spellings (accepted inconsistency):** the same concept is typed as `ArchiveStatus` (backend), `"active" | "archived" | "all" | null` (`ListParams`), and `'active' | 'all' | 'archived'` (table local state) — structurally identical string unions with no shared domain-package type. Accepted (a `packages/domain` mirror would be nice-to-have, not required); keep union member order consistent (`'active' | 'all' | 'archived'`) across frontend files for readability.
- **Known type-level leak (accepted, documented):** `getVisitors` / `getTags` also take `ListParams` (endpoints.ts:402, 471), so their TS surface gains a `status` their backends don't declare — a call passing it compiles and is silently ignored by FastAPI. Accepted to avoid per-entity param subtypes; add a code comment on `ListParams.status` noting it applies to soft-delete entities only.

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
- Local state values are exactly `'active' | 'all' | 'archived'` — identical to the enum values, so the queryFn mapping is identity (§7.2).

### 7.2 queryKey + queryFn

1. **queryKey:** `['masters']` → `['masters', statusFilter]` (same for locations/services/materials).
2. **queryFn:** pass the filter value straight through as `status` (`getMasters({ ..., status: statusFilter })` — local state values equal enum values by §7.1 design).
3. **`placeholderData: keepPreviousData`** (react-query v5) on all 4 list queries: a queryKey change creates a new pending query, and the tables' `if (isLoading)` gate (e.g. MastersTable.tsx:236) would flash the full-table "Загрузка..." on every dropdown switch — today's client-side filter is instant. `keepPreviousData` is the documented v5 remedy (imported as a helper **function** from `@tanstack/react-query`, passed to `placeholderData` — not a boolean).
4. **Accepted cache divergence (panel-noted):** other contexts (`RecordsContext`, `ScheduleContext`, `useMasters`) keep the bare `['masters']` key — the tables' `['masters', statusFilter]` fetches are separate cache entries, so the same `per_page:100` data may be fetched twice (and re-fetched on every mutation invalidation). Accepted: correctness is unaffected (prefix invalidation covers both), deduplication is out of scope.

### 7.3 Remove dead client-side status filtering

Remove **only the dead status predicate** from the client-side filter memos (the surrounding memo also contains the *search* filter, which must be preserved — e.g. MastersTable.tsx:86–100 is the whole `filteredMasters` memo; only the status lines ~96–97 are dead):

- MastersTable: status predicate lines (~96–97) inside the memo at ~86–100
- LocationsTable: status predicate lines inside the memo at ~89–103
- ServicesTable: status predicate lines at ~219–227
- MaterialsTable: status predicate lines at ~143–151

### 7.4 Unchanged

- **Archive/restore buttons** — already exist and invalidate queries — no changes. **Stated dependency:** mutation hooks invalidate the base key `['masters']` (useMastersMutations.ts:11–36, etc.); react-query v5 `invalidateQueries` prefix-matches by default (`exact: false`), catching the new `['masters', statusFilter]` keys. A test assertion locks this in (§9).
- **Status column visibility** — unchanged (e.g. `defaultVisible: false` in MastersTable stays). Archived rows are identified by the «Восстановить» button (and the status column if enabled); the column is not forced visible.

### 7.5 Editing archived rows — preserve `is_active` (confirmed-needed; user accepted via rev-6 round, §12)

Scenarios 2–3 make archived rows clickable into the edit modal for the first time. Hazard: the edit modals don't send `is_active`, the 4 `Update` schemas default `is_active: bool = True` (schemas/master.py:29, material.py:20, location.py:33, service.py:56), and `GenericService.update` does `model_dump()` — a PUT edit of an archived entity would **silently flip it back to active**.

**Fix (frontend, minimal):** the edit modals for the 4 entities include the record's current `is_active` value in the update payload. No UI change, no backend update-path change, no schema change. **Noted root hazard:** the backend `Update`-schema default remains a resurrection trap for any *future* or non-modal PUT caller — flagged here so it isn't reintroduced.

### 7.6 Clients frontend

- `ClientsContext.defaultFilters`: `is_active: null` → `status: 'active'` (§5.5 — keeps the default view active-only).
- `ClientsFilters` tri-state («Все»/«Активные»/«Неактивные»): map to `status` `'all'/'active'/'archived'` respectively (currently maps to `is_active` null/true/false, ClientsFilters.tsx:46–51; filter spread in ClientsContext.tsx:81–87).
- **`ClientsTable.tsx:37–43` `hasActiveFilters`** (panel-found, required): currently computed from `filters.is_active !== null` — breaks at compile time on the field rename and its semantics must change: the new default `status: 'active'` must NOT count as an active filter (otherwise the "Ничего не найдено/Сбросить фильтры" empty state replaces "Нет клиентов" on an empty active list), while `'all'`/`'archived'` must. Update to `filters.status !== 'active'` (plus the other filter fields as today).
- «Неактивные» continues to show archived-only (already worked via `is_active=false`; now `status=archived`); «Все» gains working server-side all-records behavior.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request `?status=active` (or param-less) → only active masters, data identical to today.
2. Filter «Все» → request `?status=all` → active + archived masters visible together; archived rows identifiable («Восстановить» button / status badge if column enabled).
3. Filter «Архив» → request `?status=archived` → only archived masters → «Восстановить» button returns a master to active; after invalidation the row disappears from the archive view.
3a. Inverse flow: in «Активные» view, archiving a row → after invalidation the row disappears from the active view (and appears under «Архив»).
4. Same behavior on `/locations`, `/services`, `/materials` (options «Активные»/«Все»/«Архив», default «Активные»).
5. `/clients` — default view unchanged («Активные» default); «Все» now correctly shows active + archived clients (the real latent gap); «Неактивные» shows archived-only as before (mechanism changes `is_active=false` → `status=archived`). Archived clients visible but not restorable from the UI (§5.5 restore gap, follow-up issue).
6. API contract: `GET /api/v1/masters` (and /locations, /services, /materials, /clients) **without** `status` returns active only — unchanged for all existing callers (public web schedule, record-form pickers, phone search).

## 9. Testing Approach

### Backend (pytest)

- Extend the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities, parametrized: **absent (=active) / `status=archived` / `status=all`** — all three behaviorally distinct. (Class may be renamed to reflect the `status` param.)
- **Update the existing clients tests** to the enum param: absent/`active` → active only; `all` → active + archived (must assert archived inclusion, not just `total >= 1` — rev-5 panel); `archived` → archived only (behavior unchanged from `is_active=false`, param renamed).
- Phone-search test: `GET /api/v1/clients/search?phone=` returns only active clients (locks §5.5).
- Unit tests for `SoftDeleteService.list` (new class: ACTIVE / ARCHIVED / ALL) and `ServiceService.list` (eager-load override, same 3 states), including keeping `status` out of `**filters`.
- **Regression (simplified by polymorphism):** `GET /api/v1/tags` and `GET /api/v1/visitors` return 200 — structurally guaranteed (tags/visitors stay on base `GenericService`), smoke-level assertion suffices.
- Router-level test: `?status=archived/all` parse; absent → ACTIVE; `?status=foo` → 422 (enum validation).

### API client (vitest)

- `listQuery()` serializes `status` correctly: `"active"/"archived"/"all"` appended, `null`/`undefined` omitted.
- `getClientsWithStats` passes `status` (not `is_active`).

### Frontend (vitest)

- Update existing filter tests (Masters / Locations / Services tables): three-option dropdown, default «Активные», queryFn passes correct `status` for all three states, queryKey includes filter.
- Update clients filter/context tests for the `status` mapping and the new «Активные» default.
- MaterialsTable: **minimal** test of the filter → queryFn/queryKey mapping only (file has zero coverage today; broader coverage not in scope).
- One assertion in the existing mutation-hook tests (e.g. useMastersMutations) locking in **prefix invalidation**: `invalidateQueries({ queryKey: ['masters'] })` must match `['masters', statusFilter]` keys (§7.4).
- **§7.5 test (locks the resurrection fix):** an edit-modal test per entity (or one representative + shared-pattern note) asserting the update payload includes the record's current `is_active` (false for archived rows). Note: the `MasterUpdate` TS type lacks `is_active` (endpoints.ts:124, TODO #178) — the plan decides per entity: extend the TS update type (preferred if trivial) or a documented cast.
- **Existing E2E spec update (minimal):** `frontend/admin/e2e/clients.spec.ts:327–359` — URL assertion `is_active=false` → `status=archived`; `selectOption('false')` → `selectOption('archived')`; reset assertion `toHaveValue('')` → `toHaveValue('active')`.

## 10. Key Code Facts (verified by exploration + panels)

- Backend code is at `backend/src/` (NOT `backend/app`).
- `GenericService.list` duplicates repository logic inline and is shared by hard-delete entities (tags, visitors) via the `soft_delete` guard (~line 65) — rev 6 replaces the guard with `SoftDeleteService` polymorphism.
- `ServiceService.list` (~line 41) has an unconditional `.where(Service.is_active)` plus a `**filters` loop (~44–46).
- Clients latent gap: `services/client.py` ~103–106 `params.is_active if ... is not None else True`; no archived-only path.
- Restore = `PATCH /{id}` with `{is_active: true}` via Patch schemas; `ClientPatch`/`ClientUpdate` omit `is_active` (clients unrestorable).
- `include_inactive` on SoftDeleteRepository.list is a dead parameter (zero callers — rev-5 panel verified).
- Current filter dropdowns: «Все» is the empty string `''` in all 4 tables; defaults differ (`''` masters/locations, `'active'` services/materials).
- `MaterialsTable.tsx` lives under `services/components/` and has zero unit-test coverage.
- Status column in MastersTable is `defaultVisible: false` — left as-is.
- Reference (clients):
  - `backend/src/schemas/client.py:75` (`is_active` param → becomes `status`)
  - `backend/src/api/v1/clients.py:60–66`
  - `backend/tests/test_client_stats.py:420–450` (`TestClientListFilterIsActive` — test pattern to copy, then update for the enum)
  - `frontend/admin/app/(main)/clients/` wiring chain (ClientsContext.defaultFilters, ClientsFilters)
  - `packages/api-client/src/endpoints.ts:270–283` (`getClientsWithStats` param passing)

## 11. Visual Compliance Checks

- [ ] `/masters`: status filter shows exactly three options («Активные»/«Все»/«Архив»), «Активные» selected by default, switching changes table content without a full-table loading flash
- [ ] `/masters`: «Все» shows active + archived masters together
- [ ] `/masters`: «Архив» shows only archived masters; «Восстановить» button present and removes rows from the view after restore
- [ ] `/locations`: same three-option filter behavior
- [ ] `/services`: same three-option filter behavior
- [ ] `/materials` (tab/section under services): same three-option filter behavior
- [ ] `/clients`: default view shows active clients only; «Все» shows active + archived; «Неактивные» shows only archived clients
- [ ] Admin schedule page AND public web schedule (colourmountains.ru) render unchanged (no archived entities — param-less callers keep the safe default)

## 12. Spec Panel Findings — Resolution History

### Rev 2 panel (2026-08-02, 2/5 perspectives available)

| Finding | Severity | Resolution |
|---------|----------|------------|
| «Все»/«all» unrepresentable under absent=active-only semantics (completeness + simplicity, agreement) | BLOCKER | Rev 2 removed «Все»; **user rejected at G1b** → three-state encodings in rev 3+ |
| Default filter is «Все» (`''`) in masters/locations | BLOCKER | Default `'active'` everywhere (§7.1) |
| Filter mapping didn't match reality (`''` used for «Все») | MAJOR | Explicit `'all'` state value (§7.1) |
| `per_page=100` cap truncates archive views | MAJOR | Accepted limitation — out of scope (§3) |
| ServiceService.list / GenericService.list double-where hazard | MAJOR/MINOR | §5.2/§5.3: explicit named param, never via `**filters` |
| Empty states unspecified | MINOR | Out of scope (§3) |
| Status badge column `defaultVisible: false` vs visual check | MINOR | Visibility unchanged, check reworded (§7.4/§11) |
| MaterialsTable new test file beyond minimal mandate | MINOR | Scoped to mapping-only test (§9) |
| `is_active=true` case adds zero behavioral coverage | MINOR | Superseded by enum states (§9) |

### Rev 3/4 panel (2026-08-02, `bool | "all"` encoding; 3/5 available: completeness, simplicity, best-practices ✅; feasibility, consistency ❌)

| Finding | Perspective | Severity | Resolution |
|---------|-------------|----------|------------|
| `soft_delete` guard in GenericService.list load-bearing — tags/visitors share the method; dropping guard → 500 | completeness | BLOCKER | **Rev 5+: eliminated structurally** — `SoftDeleteService` polymorphism, tags/visitors stay on base (§5.2, user decision) |
| «Сбросить» handlers call `setStatus('')`; filter options emit `value=""` | completeness | MAJOR | §7.1: reset → `'active'`, options → `value="all"` |
| Editing archived rows silently resurrects them (Update schemas default `is_active=True`) | completeness | MAJOR | §7.5: modals include record's current `is_active` in payload — **user implicitly accepted this scope via the rev-6 G1b round (2026-08-02)** |
| Filter-switch UX regression: new queryKey + `isLoading` gate → "Загрузка..." flash | best-practices | MAJOR | §7.2: `placeholderData: keepPreviousData` |
| §7.3 line refs covered the *search* filter memo, not just dead status lines | completeness | MINOR | §7.3 corrected: status predicate only |
| Invalid param values → 422 (today silently ignored) | completeness + best-practices | MINOR | §4/§9: enum 422 contract |
| Invalidation depends on default prefix matching — unstated, untested | completeness + best-practices | MINOR | §7.4 stated; §9 assertion added |
| `ListParams` widening leaks the filter param to getVisitors/getTags | completeness + best-practices | MINOR | §6 accepted + documented |
| Inverse archive-in-«Активные» flow missing | completeness | MINOR | §8 scenario 3a |
| Fallback parsing strategy = speculative complexity | simplicity | MINOR | Rev 6: moot — native enum parsing |
| Type alias placement → layering inversion | simplicity | MINOR | §4: enum in neutral schemas-layer module |
| Mixed bool/"all" sentinel acceptable but enum more canonical | best-practices | MINOR | **Rev 6 adopts the enum** per user decision |

### Rev 5 panel (2026-08-02, `bool | None` encoding; 2/5 available: completeness, simplicity ✅; feasibility, consistency, best-practices ❌)

| Finding | Perspective | Severity | Resolution |
|---------|-------------|----------|------------|
| ClientService omitted from SoftDeleteService migration → phone search returns archived clients (booking dedupe) | completeness | MAJOR | §5.2: ClientService migrates; rev 6: subclass default ACTIVE keeps search active-only automatically (§5.5) |
| `frontend/web` useSchedule.ts missed by audit → public schedule renders archived | completeness | MAJOR | Rev 6: **simplified away** — safe default ACTIVE, param-less callers unchanged (§4a) |
| Clients default view flips to «Все» (defaultFilters.is_active=null) → archived unrestorable clients in default view | completeness | MAJOR | §5.5/§7.6: defaultFilters → `'active'` (kept under enum: null would map to `status=all`) |
| `RecordsContext.tsx:89 getClients()` outside audit lists | completeness | MAJOR | Rev 6: **simplified away** — safe default ACTIVE (§4a verification note) |
| Delete on archived row → 404 toast (newly reachable) | completeness | MINOR | §3: accepted limitation + follow-up |
| `include_inactive` is a dead parameter (zero callers) | completeness | MINOR | §5.1: rename trivially safe |
| No restore endpoint; restore = PATCH {is_active:true}; clients unrestorable | completeness | MINOR | §1/§5.5 stated explicitly |
| Clients none-case test passes under both semantics (asserts total>=1) | completeness | MINOR | §9: `all` case must assert archived inclusion |
| §7.5 frontend-only fix leaves backend Update-schema default as trap | completeness | MINOR | §7.5 root hazard documented |
| `''` → `'all'` state rename is optional churn | simplicity | MINOR | Kept: local state values now equal enum values → identity mapping (§7.1/7.2) |
| §7.5 extends pre-approved "minimal frontend" envelope | simplicity | MINOR | User accepted via rev-6 round (§12 rev-3/4 row) |
| is_active logic in 3 places | simplicity | MINOR | §5.3: ServiceService may compose with superclass clause if trivial |

**User encoding decisions:** rev 4 (`bool | "all"`) rejected → rev 5 (`bool | None`, None=all) rejected → **rev 6 (enum `status`, default `active`) approved in principle at G1b pass 3 (2026-08-02)**.

### Rev 6 panel (2026-08-02, enum `status` encoding; **5/5 perspectives available**)

| Finding | Perspective | Severity | Resolution |
|---------|-------------|----------|------------|
| §5.4/§5.5 self-contradiction: clients list uses `ClientListParams=Depends()` → module-level `list_clients_with_stats()`, not `service.list()` | completeness + consistency | MAJOR | §5.4: clients carve-out stated; param lives in `ClientListParams` (§5.5) |
| Clients premise wrong: `is_active=false` already works server-side (test_filter_is_active_false, e2e); real gap is «Все» only | completeness | MAJOR | §1/§5.5/§8/§9 corrected; old-param retirement documented (silent ignore, no 422) |
| Existing E2E `clients.spec.ts:327–359` will break (is_active=false URL, selectOption('false'), toHaveValue('')) and was unaddressed | completeness + consistency | MAJOR | §3 reworded ("no NEW E2E"); §9: minimal update of the 3 assertions. masters/services-crud specs verified unaffected |
| §7.6 "no other ClientsTable changes" false: `hasActiveFilters` (ClientsTable.tsx:37–43) reads `filters.is_active !== null`; new default must NOT count as active filter | consistency | MAJOR | §7.6: update to `filters.status !== 'active'` — required change listed |
| §5.2 misdescribes ClientService (empty subclass; stats = module-level function) | completeness + consistency | MAJOR→MINOR | §5.2 corrected |
| `SoftDeleteRepository.list` has zero callers (dead code) — renaming adds a 4th copy of the mapping | simplicity | MAJOR | §5.1: kept per user directive (3 lines, naming consistency), dead-code status documented; deletion out of scope |
| ALL baked into domain enum diverges from AIP-132/164 (query-meta value) | best-practices | MAJOR | §4: conscious deviation documented — user rejected both bool shapes; repository must distinguish 3 behaviors |
| `status` name vs AIP-216 (reserves "status" for HTTP/gRPC) | best-practices | MAJOR | §4: dismissed with reasoning — user-suggested, local UI vocabulary, verified zero collision on the 5 routers/entities |
| Enum name `ActivityStatus` collides semantically with the Activity domain entity; placement in schemas/ = repo→schemas import | consistency + simplicity + completeness | MINOR | Renamed **`ArchiveStatus`**, placed in `src/models/enums.py` (existing enum home, leaf module) |
| Feasibility BLOCKERs dismissed: (1) `status` param collision — **verified none** on the 5 routers/entities; (2) Update schemas don't declare is_active → 422 — **false**, they declare `is_active: bool = True` (that IS the §7.5 hazard); (3) missed soft-delete service after guard removal | feasibility | BLOCKER→resolved | (1)(2) evidence-dismissed; (3) §5.2: required plan verification — enumerate all AbstractModelSoftDelete models migrate |
| `NOT is_active` index bypass risk | feasibility | MAJOR→MINOR | Accepted: studio-scale tables (tens–hundreds of rows); no mitigation needed |
| §5.5 "null maps to status=all" — rev-5 leftover, wrong under safe default | consistency | MINOR | §5.5 rationale corrected |
| §7.5 untested; `MasterUpdate` TS type lacks `is_active` (TODO #178) | completeness | MINOR | §9: payload assertion added; plan decides type extension vs cast |
| §6 getClientsWithStats instruction was a no-op (generic pass-through) | completeness + consistency | MINOR | §6 corrected: change sites are ClientsContext/ClientsFilters |
| queryKey divergence `['masters', f]` vs `['masters']` → duplicate cached fetches | completeness | MINOR | §7.2 item 4: accepted, correctness unaffected |
| Frontend has 3 type spellings, no domain-package mirror | consistency | MINOR | §6: accepted, consistent union ordering required |
| Domain-rules drift (masters.md:33 etc. say "List all active") | consistency | MINOR | §5.6: required doc updates in feature PR |
| StrEnum: prefer stdlib `enum.StrEnum` on 3.11+; `validate_default` footgun; keepPreviousData is a helper function not boolean | best-practices | MINOR | §4 (StrEnum note); §7.2 (helper import); plan notes |
| Absent=active conflation ("defaulted parameter" vs "absent sentinel") | best-practices | MAJOR→MINOR | Already code-default (`status: ArchiveStatus = ACTIVE`); §4 table documents equivalence |

Verdicts: completeness SOUND_WITH_CONCERNS, consistency SOUND_WITH_CONCERNS, simplicity SOUND_WITH_CONCERNS, feasibility findings resolved, best-practices NEEDS_REVISION (revision items addressed above: naming documented + dismissed with reasoning, ALL-in-enum documented as conscious deviation).

## 13. Open Questions

None blocking. All encoding semantics, naming rationale, and scope boundaries are documented above.
