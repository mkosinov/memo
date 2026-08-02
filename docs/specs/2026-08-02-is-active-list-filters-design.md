# GH #195 — `status` Filter Param in List Endpoints for Soft-Delete Entities + Frontend Archive Filters

**Date:** 2026-08-02
**Issue:** GH #195
**Status:** Design (awaiting G1b approval, rev 6 — enum `status` param with safe default per user decision)
**Reference implementation:** Clients entity (aligned to the same convention in this feature)

---

## 1. Problem Statement

Soft-delete entities (masters, locations, services, materials) support archive/restore (`is_active` flag; restore = `PATCH /{id}` with `{is_active: true}` via the Patch schemas — there is no dedicated restore endpoint), but their **list endpoints always return only active records**. The admin tables therefore cannot show archived records, and the existing status filter dropdowns in 4 tables are **dead client-side filters** — they filter only within the already-active-only page of data, so "Все" and "Архив" never show archived rows.

Additionally, the **clients endpoint has a latent gap**: `services/client.py` (~103–106) coerces absent `is_active` to active-only, and there is no server-side way to request archived-only clients — the ClientsTable «Неактивные» filter never shows archived rows server-side. Clients is aligned to the new convention in this feature.

## 2. Goals

1. Single enum query param **`status: Literal["active", "archived", "all"] = "active"`** across routers → services → repository for masters, locations, services, materials **and clients** list endpoints.
2. **Safe default (user decision):** absent param = `active` = active only. All existing param-less callers (public web schedule, RecordsContext picker, clients phone search) keep working **unchanged**.
3. Introduce `SoftDeleteService(GenericService)` — polymorphism replaces soft_delete branching: base `GenericService` has NO is_active knowledge; the subclass applies the status filter.
4. Rename repository param `include_inactive: bool = False` → `status: ActivityStatus = ACTIVE` (dead parameter — zero callers today, rename trivially safe).
5. Admin tables for masters/locations/services/materials: server-side three-option archive filtering («Активные» default / «Все» / «Архив»), dead client-side status filtering removed.
6. Align **clients** to the same enum (frontend ClientsFilters tri-state maps onto it; «Неактивные» gains proper server-side archived-only).

## 3. Explicitly Out of Scope (YAGNI)

- **No new archive/restore button work** — existing buttons already invalidate queries.
- **No E2E tests** — project practice is unit/integration only.
- **Pagination/`per_page` behavior** — unchanged (tables fetch `per_page: 100` and slice client-side; archive/all views inherit the same cap — accepted limitation).
- **Empty-state UX copy** — filtered-empty views use the existing generic "not found" row.
- **Delete-on-archived-row UX** — known limitation (accepted): row «Удалить» on an already-archived record → `SoftDeleteRepository.delete` returns `False` → 404 toast (all 5 entities; newly reachable via «Архив»/«Все» views). Follow-up: hide the delete action for archived rows.
- **Clients restore UI** — archived clients visible under «Все»/«Неактивные» but unrestorable from the UI (ClientPatch omits `is_active`; covered by the existing ClientsTable restore-buttons follow-up issue).
- **Backend Update-schema `is_active: bool = True` default** — root resurrection hazard, documented in §7.5; fixing the schema itself is out of scope.
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
- Name `status` (user-suggested): matches the existing UI vocabulary — the dropdowns are already called "status filter" in all 4 tables and ClientsFilters. Values `active`/`archived`/`all` are self-describing in URLs, logs, and tests.
- Rejected alternatives: `is_active=...` with 3 states (rejected by user in rev 5 — uncomfortable absent=all semantics; a bool param also can't express 3 states safely); `filter=...` (vague).
- **Safe default = active:** every existing param-less caller (public web schedule `frontend/web/useSchedule.ts`, `RecordsContext.tsx:89` client picker, clients phone search, any out-of-repo consumer) keeps receiving active-only — no caller audit needed (replaces rev 5's §4a; see §4a below).

**Internal normalized form (architect's choice, documented):** one shared enum across the whole chain — `ActivityStatus(str, Enum)` with `ACTIVE`/`ARCHIVED`/`ALL`, defined once in the schemas layer (neutral module, e.g. an existing `schemas/common.py`; plan picks the exact location) and used by routers, `SoftDeleteService.list`, `ServiceService.list`, and `SoftDeleteRepository.list`. FastAPI parses StrEnum query params natively. Single vocabulary end-to-end; no stringly-typed literals scattered; no internal `None = all` semantics (the rev-5 discomfort).

### 4a. Safe default — no caller audit required (simplification vs rev 5)

Because absent param = active only, **all existing param-less callers keep working unchanged**: `frontend/web/app/hooks/useSchedule.ts:41/47/53`, `frontend/admin` RecordsContext.tsx:89, `clients.py` phone search, schedule/booking selects. Rev 5's mandatory caller audit is replaced by a **verification note**: the plan/PR must confirm (via existing tests + a grep sweep) that no caller previously relied on `include_inactive=True` (verified dead in rev-5 panel) and that existing test suites pass unchanged.

## 5. Backend Changes

### 5.1 `backend/src/repositories/generic.py` — SoftDeleteRepository.list

- Rename `include_inactive: bool = False` → `status: ActivityStatus = ActivityStatus.ACTIVE` (dead param — zero callers, trivially safe).
- Logic:
  - `ACTIVE` → `where(table.is_active)`
  - `ARCHIVED` → `where(not_(table.is_active))`
  - `ALL` → no is_active filter

### 5.2 `backend/src/services/generic.py` — GenericService + NEW SoftDeleteService (user decision: polymorphism)

- **Base `GenericService`:** NO is_active knowledge at all — no param, no `soft_delete` branching in `list()` (the current `if self._model.soft_delete:` guard + unconditional `where(table.is_active)` at ~65–66 is removed from base). `TagService` and `VisitorService` stay on base `GenericService` — structurally unaffected (eliminates the rev-4 BLOCKER by construction).
- **NEW `SoftDeleteService(GenericService)`:** overrides `list()` accepting `status: ActivityStatus = ActivityStatus.ACTIVE`; applies the §4 mapping (`ACTIVE` → `where(is_active)`, `ARCHIVED` → `where(not_(is_active))`, `ALL` → no filter); `get()` unchanged (no is_active filter today).
- **Migration:** Master, Location, Material, **Client** services move from `GenericService` → `SoftDeleteService`. (Client is a soft-delete model — `AbstractModelSoftDelete`. ClientService keeps its custom list/stats overrides; the inherited `SoftDeleteService.list` governs the generic path used by phone search, §5.5.)
- The `status` param is an **explicit named parameter**, never routed through `**filters` (double-where hazard from rev-3 panel).

### 5.3 `backend/src/services/service.py` — ServiceService (lines 31–54)

- Inherits `SoftDeleteService` (moves off base `GenericService`), keeps its eager-load override (tariffs/tags).
- Its overridden `list()` replaces the unconditional `.where(Service.is_active)` (~line 41) with the status-driven clause (§4 mapping), keeping `status` out of the `**filters` loop (~44–46). May compose with the superclass clause instead of duplicating it if trivial (simplicity-panel direction, plan-level choice).

### 5.4 Routers — query param

`backend/src/api/v1/masters.py`, `locations.py`, `services.py`, `materials.py`, **and `clients.py`** (one convention across all 5):

- Query param `status: ActivityStatus = ActivityStatus.ACTIVE`.
- Pass through to the corresponding service `.list()`.
- Absent = active only (safe default).

### 5.5 Clients alignment (in scope, minimal)

- `backend/src/schemas/client.py` — `ClientListParams`: replace `is_active: bool | None = None` (line ~75) with `status: ActivityStatus = ActivityStatus.ACTIVE`.
- `backend/src/services/client.py` (~103–106): replace the `is_active_filter = params.is_active if ... is not None else True` logic with the §4 mapping (`ARCHIVED` → `where(not_(Client.is_active))`, `ALL` → no filter, `ACTIVE` default → `where(Client.is_active)`). Fixes the latent gap: «Неактивные» now works server-side.
- **Phone search:** `GET /api/v1/clients/search?phone=` (clients.py:41–57, calls `service.list(phone=...)`) — after ClientService migrates to `SoftDeleteService` (§5.2), the subclass default `status=ACTIVE` keeps it active-only **automatically; no code change needed** (rev-5's explicit `is_active=True` simplifies away). Booking dedupe (useRecordMutations.ts:88, NewBookingTab.tsx:40) unaffected.
- **ClientsTable default filter:** `ClientsContext.defaultFilters.is_active = null` («Все» default) — under the new enum, `null` would map to `status=all`, surfacing archived clients in the default view. Change the default to «Активные» (`status: 'active'`) so the default view is unchanged. This is the only ClientsContext change.
- **Restore gap (documented, out of scope):** restore is `PATCH /{id}` with `{is_active: true}`; `ClientPatch`/`ClientUpdate` omit `is_active` — archived clients visible under «Все»/«Неактивные» but cannot be restored from the UI (existing follow-up issue).

## 6. API Client Changes

`packages/api-client/src/endpoints.ts`:

- `ListParams` += `status?: "active" | "archived" | "all" | null` (string union mirroring the backend enum; no `is_active` param is added).
- `listQuery()` appends `status` whenever it is not `null`/`undefined` (including explicit `"active"` — harmless, matches server default, keeps queryFn code branch-free).
- `getMasters` / `getLocations` / `getServices` / `getMaterials` pick it up automatically through `ListParams`.
- **`getClientsWithStats` (endpoints.ts:270–283):** switch its param passing from `is_active` (bool) to the new `status` enum, matching the updated `ClientListParams`.
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

### 7.5 Editing archived rows — preserve `is_active` (confirmed-needed; user accepted via rev-6 round, §12)

Scenarios 2–3 make archived rows clickable into the edit modal for the first time. Hazard: the edit modals don't send `is_active`, the 4 `Update` schemas default `is_active: bool = True` (schemas/master.py:29, material.py:20, location.py:33, service.py:56), and `GenericService.update` does `model_dump()` — a PUT edit of an archived entity would **silently flip it back to active**.

**Fix (frontend, minimal):** the edit modals for the 4 entities include the record's current `is_active` value in the update payload. No UI change, no backend update-path change, no schema change. **Noted root hazard:** the backend `Update`-schema default remains a resurrection trap for any *future* or non-modal PUT caller — flagged here so it isn't reintroduced.

### 7.6 Clients frontend

- `ClientsContext.defaultFilters`: `is_active: null` → `status: 'active'` (§5.5 — keeps the default view active-only).
- `ClientsFilters` tri-state («Все»/«Активные»/«Неактивные»): map to `status` `'all'/'active'/'archived'` respectively (currently maps to `is_active` null/true/false). «Неактивные» now gets proper server-side archived-only data.
- No other ClientsTable changes.

## 8. User Scenarios (Acceptance Criteria)

1. `/masters` → filter shows «Активные» selected (default) → request `?status=active` (or param-less) → only active masters, data identical to today.
2. Filter «Все» → request `?status=all` → active + archived masters visible together; archived rows identifiable («Восстановить» button / status badge if column enabled).
3. Filter «Архив» → request `?status=archived` → only archived masters → «Восстановить» button returns a master to active; after invalidation the row disappears from the archive view.
3a. Inverse flow: in «Активные» view, archiving a row → after invalidation the row disappears from the active view (and appears under «Архив»).
4. Same behavior on `/locations`, `/services`, `/materials` (options «Активные»/«Все»/«Архив», default «Активные»).
5. `/clients` — default view unchanged («Активные» default); «Все» shows active + archived; «Неактивные» now returns archived-only **server-side** (was silently active-only). Archived clients visible but not restorable from the UI (§5.5 restore gap, follow-up issue).
6. API contract: `GET /api/v1/masters` (and /locations, /services, /materials, /clients) **without** `status` returns active only — unchanged for all existing callers (public web schedule, record-form pickers, phone search).

## 9. Testing Approach

### Backend (pytest)

- Extend the `TestClientListFilterIsActive` pattern (`backend/tests/test_client_stats.py:420–450`) for the 4 entities, parametrized: **absent (=active) / `status=archived` / `status=all`** — all three behaviorally distinct. (Class may be renamed to reflect the `status` param.)
- **Update the existing clients tests** to the enum param: absent/`active` → active only; `all` → active + archived (must assert archived inclusion, not just `total >= 1` — rev-5 panel); `archived` → archived only (new server-side behavior).
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

### Rev 6 panel (enum `status` encoding) — pending, see G1b report

## 13. Open Questions

None blocking. All encoding semantics, naming rationale, and scope boundaries are documented above.
