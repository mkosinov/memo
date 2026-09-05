# GH #140 — Unify server-data access on entity hooks; dissolve ClientsContext

- **Issue:** #140 `refactor(admin): unify server-data access on entity hooks, dissolve ClientsContext`
- **Status:** DESIGN phase, G1a passed 2026-09-05
- **Scope:** `frontend/admin` + `packages/api-client` (one dead export removed) — zero backend changes
- **Explore grounding:** session `ses_f8fcab532ffe4j8E0ZYOJK6Eaf` (file:line facts baked in below)

---

## 1. Context & Problem

Since the #139/#205/#212/#213 waves, server data in admin is accessed through **three coexisting idioms**:

1. `createPagedListContext` factory contexts (Masters/Locations/Materials/Services/Tags)
2. A hand-rolled `ClientsContext` (316 lines) mounted globally in `app/providers.tsx:42`
3. Scattered direct `useQuery` calls in components with inline query keys

The consequences:

- **«Без контакта» degradation:** `ActivityDetailsModal` resolves client names from the paged `useClients()` map (pages loaded by /clients). Clients **beyond the first 20 active/archived** are absent from that map → their record tabs show «Без контакта». User reproduced this in the playground.
- **Global fetch cost:** `ClientsContext` is mounted app-wide; every page mounts `useQuery(['clients', ...])` unguarded → /schedule and every other page fetch the clients list on load (issue DoD: no `getClientsWithStats` on /schedule).
- **Key orthography drift:** the same logical key (`['locations']`, `['client', id]`, `['records','client',id]`) is hand-written in 10+ files. Rename work (#141 ScheduleContext split) is risky while keys are duplicated.
- **Staleness bug:** client created via schedule quick-add (`useRecordMutations` createClient path :78-105) invalidates `['record',id]` + `['records']` but NOT `['clients']` (:142) → new client invisible in /clients for ≤30s (staleTime).

## 2. Locked decisions (G1a, user-approved — binding)

1. **ActivityDetailsModal → per-record client queries.** Each record tab resolves its client via new hook `useClient(id)` on key `['client', id]` (key already shared with ClientQuickCard — dedupe). Progressive render (tabs render immediately, name/phone fill in as queries land). This FIXES the «Без контакта» degradation for clients beyond first-20-active/archived. No composite/backend endpoint — deliberately rejected (lazy loading wins: modal not opened for every activity).
2. **/clients → createPagedListContext factory** (same as Masters/Locations/Materials/Services/Tags post-#139/#205/#212). Provider mounted INSIDE the page, removed from `app/providers.tsx`. 12-field filter set extends the factory params (filters object goes into the key wholesale). Deep-link #216 (UUID search, status:all, consumed-latch, URL cleanup on close) stays page-level logic. Mutations (create/update/patch/delete/archive/restore/resolveDelete + 409-deps parking) → `useClientsMutations` (mirror `useLocationsMutations`).
3. **lib/queryKeys.ts — FULL migration of ALL entity query keys** (user explicitly chose full scope over opportunistic). ORTHOGRAPHY-ONLY migration: raw/domain key-sharing (e.g. ScheduleContext raw `['masters']` + useMasters select on same key) and prefix invalidation semantics MUST NOT change — changing them breaks dedupe/causes double fetches.
4. **Hooks everywhere — zero direct useQuery in components.** New point hooks: `useClient(id)`, `useClientRecords(id)` (`['records','client',id]`), `useActivityRecords(id)` (`['records','activity',id]`), `usePaymentTotals(ids)` (`['payments','totals',ids]`), activities-for-records hook (`['activities','for-records',...]`). New raw-lookup hooks: `useMastersRaw`/`useServicesRaw`/`useLocationsRaw` (co-located in existing `use*.ts` files) for consumers needing `archived` (ScheduleContext, BookingFilters, PhotosContext, useRecordData). ScheduleContext is NOT rewritten (#141 is next in trajectory) — only keys→factory + dict raw queries→raw hooks.
5. **Cleanup:** dead `getClients` (per_page=100, zero prod consumers) deleted from api-client; schedule quick-add client creation (useRecordMutations createClient path) starts invalidating client list keys (fixes existing ≤30s staleness bug); docs section on data-access patterns (hook taxonomy + "components never touch useQuery/keys directly" rule + queryKeys.ts pointer) — IN scope, short.
6. **Accepted behavioral changes (user-approved):** (a) /clients filters/pagination become page-scoped (reset on leaving the page; today they're global and survive route changes); (b) zero clients-list requests on any page except /clients (new e2e guard).

## 3. Naming contract (collision guard — binding)

| Name | Kind | Key | Notes |
|---|---|---|---|
| `useClientsTable` | `usePagedList` factory export | `['clients', page, perPage, filters, sortBy, sortOrder]` | Mirrors `useTagsTable`/`useMaterialsTable` naming; **NO `useClients` is ever created** (would collide with `useMasters`/`useLocations`/`useServices` lookup-name conventions) |
| `ClientsProvider` | factory Provider | — | Mounted INSIDE `app/(main)/clients/page.tsx` only |
| `useClientsMutations` | hooks file | invalidates `['clients']` | `useCreateClient`/`useUpdateClient`/`usePatchClient`/`useDeleteClient`/`useArchiveClient`/`useRestoreClient`/`useResolveDeleteClient` (409-deps `dependencies` parking), mirror `useLocationsMutations` |
| `useClient(id)` | point hook | `['client', id]` | `getClientById`; error propagates as-is (no silent-undefined masking) |
| `useClientRecords(id)` | point hook | `['records','client',id]` | `getRecords` per_page 100 (current semantics) |
| `useActivityRecords(id)` | point hook | `['records','activity',id]` | `getRecords` per_page 100 (current semantics) |
| `usePaymentTotals(ids)` | point hook | `['payments','totals',ids]` | `getPaymentTotals`, ids array in key |
| `useActivitiesForRecords(ids)` | point hook | `['activities','for-records',ids]` | Co-located in `hooks/useActivities.ts` |
| `useActivity(id)` | point hook | `['activity', id]` | `getActivity`, co-located in `hooks/useActivities.ts` |
| `useVisitors(clientId)` | point hook | `['visitors', clientId]` | `getVisitors`, new `hooks/useVisitors.ts` (3 consumers justify a file) |
| `useMastersRaw`/`useServicesRaw`/`useLocationsRaw` | raw-lookup hooks | `['masters']`/`['services']`/`['locations']` | **Same keys** as `useMasters`/`useServices`/`useLocations` (dedupe preserved), NO select — returns raw responses incl. `archived`. Co-located in the existing `use*.ts` files |
| `useTagsRaw` | raw-lookup hook | `['tags']` | PhotosFilters tags chips (§4 map) |

**Naming rules (documented in queryKeys.ts header + ARCHITECTURE.md §Data Access):** `use<Entity>` = domain-selected lookup; `use<Entity>Raw` = raw response (archived included); `use<Entity>Table` = factory paged-list state; `use<Entity>Mutations` = mutation family. `useClients` is permanently reserved-vacant.

**Tags typeaheads / photos client-picker NOT converted** (YAGNI): PhotoModal :131 and PhotosFilters :95 call `getClientsPaged` directly inside RemoteSearchSelect callbacks (not useQuery) — out of scope.

## 4. lib/queryKeys.ts — full key inventory (orthography-only)

Single source of truth; every key keeps its **exact current shape** (strings, order, arity). Shape of the module:

```ts
// lib/queryKeys.ts — single source of truth for entity query keys (GH #140).
// ORTHOGRAPHY-ONLY migration: raw/domain key-sharing and prefix-invalidation
// semantics MUST NOT change (G1a decision 3).
export const qk = {
  // Point keys:
  client:          (id: string) => ['client', id] as const,
  clientRecords:   (id: string) => ['records', 'client', id] as const,
  activityRecords: (id: string) => ['records', 'activity', id] as const,
  paymentTotals:   (ids: string[]) => ['payments', 'totals', ids] as const,
  activitiesForRecords: (ids: string[]) => ['activities', 'for-records', ids] as const,
  activity:        (id: string) => ['activity', id] as const,
  activityRange:   (weekStart: string, weekEnd: string) => ['activities', weekStart, weekEnd] as const,
  visitors:        (clientId: string) => ['visitors', clientId] as const,
  recordPayments:  (recordId: string) => ['payments', recordId] as const,
  record:          (id: string) => ['record', id] as const,
  // List prefixes (factory contexts + invalidation targets):
  clients: ['clients'] as const,
  records: ['records'] as const,
  masters: ['masters'] as const,
  services: ['services'] as const,
  locations: ['locations'] as const,
  materials: ['materials'] as const,
  tags: ['tags'] as const,
  photos: ['photos'] as const,
  // Client 12-field filters object (goes into the key wholesale, §5.2):
  clientsFilters: (filters: ClientsFilters) => filters, // identity, for key slot
} as const;
```

(Note: exact helper naming inside qk may be adjusted by the plan; the binding contract is the **key shapes above and the single-file sourcing rule**, not the accessor names.)

**Consumer migration map** (every `queryKey:` / `invalidateQueries` / `cancelQueries` / `setQueriesData` / `refetchQueries` call site in `frontend/admin`):

| Surface | Current key | New | Semantics |
|---|---|---|---|
| `hooks/useMasters.ts` / `useLocations.ts` / `useServices.ts` + new `*Raw` siblings | `['masters']` etc. | qk list prefixes | UNCHANGED — dedupe with ScheduleContext raw + BookingFilters raw preserved |
| `hooks/useActivities.ts` | `['activities', ws, we]` | qk | same |
| `hooks/useRecordData.ts` :15,:21,:27,:32-45,:48 | point keys + raw getAll* | qk + `useMastersRaw`/`useServicesRaw`/`useLocationsRaw` | same |
| `contexts/ScheduleContext.tsx` :269-292, :310-367 | activityRange + raw dicts + internal activityQueryKey | qk + raw hooks (queries `:273-287` → hooks) | same keys; NOT rewritten (#141) |
| `contexts/createPagedListContext.tsx` :96-101 | `[prefix, page, perPage, status?, sortBy, sortOrder, q?]` | prefix sourced from qk (+ new `filters` slot, §5.2) | same for existing 5 consumers |
| `contexts/ClientsContext.tsx` :113 → factory | `['clients', page, perPage, filters, sortBy, sortOrder]` | factory key (§5.2) | same shape |
| `contexts/RecordsContext.tsx` :80 | `['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` | prefix from qk | same |
| `contexts/PhotosContext.tsx` :82,:86,:148,:154 | `['photos',{...}]`, `['services']`,`['locations']` | qk + `useServicesRaw`/`useLocationsRaw` | same |
| `clients/components/ClientCardModal.tsx` :92,:99 | `['records','client',id]`, `['activities','for-records',ids]` | `useClientRecords(id)`, `useActivitiesForRecords(ids)` | same |
| `records/components/ClientQuickCard.tsx` :42-62 | 4 point keys | point hooks | same |
| `records/components/BookingFilters.tsx` :57-67 | raw `['locations']`,`['services']`,`['masters']` | `useLocationsRaw`/`useServicesRaw`/`useMastersRaw` | same keys, zero useQuery in component |
| `modal/ActivityDetailsModal/ActivityDetailsModal.tsx` :59,:82 | `['records','activity',id]`, `['client',id]` | `useActivityRecords`, `useClient` | same |
| `modal/ActivityDetailsModal/ClientTab.tsx` :73 | `['activity',id]` | `useActivity` | same |
| `photos/components/PhotosFilters.tsx` :35-39 | `['tags']` | `useTagsRaw` — **added to scope** (direct useQuery missed by G1a inventory; same key, zero semantic change) | same |
| `photos/components/PhotoModal.tsx` :252-257 | `['locations']` | `useLocationsRaw` — same rationale | same |
| `hooks/useRecordMutations.ts` createClient :78-105,:142 | invalidates `['record',id]`,`['records']` | **+ `qk.clients` invalidation** (staleness fix) | NEW invalidation only |
| all `*Mutations.ts` (masters/services/locations/materials/tags/photos) | inline list keys | qk | same |
| `hooks/useDeleteRecord.ts` :38-46 | `['records']`,`['record',id]`,`['visitors']` | qk | same |
| `lib/cache/recordCacheSync.ts` :61 | `['records']` | qk | same |
| `MastersTable.tsx` :212-213, `ServicesTable.tsx` :202-203, `MaterialsTable.tsx` :191, `LocationsTable.tsx` :234-235 | inline list keys (refetch after drag-reorder) | qk | same |
| `app/providers.tsx` :20 | `query.queryKey` (error logging) | unchanged | — |

**QueryClient default config** (`providers.tsx:25-32`: staleTime 30s, retry 2, refetchOnWindowFocus false) — unchanged.

## 5. Frontend design

### 5.1 /clients — factory migration

**Delete** the hand-rolled `contexts/ClientsContext.tsx` (316 ln) and its test (§8). The file is replaced by a ~20-line factory file mirroring `TagsContext.tsx`:

```tsx
const { Provider, usePagedList } = createPagedListContext<ClientWithStats, ClientsFilters>({
  queryKeyPrefix: 'clients',
  fetcher: (p) => getClientsWithStats({
    page: p.page, per_page: p.perPage,
    ...(p.sortBy ? { sort_by: p.sortBy, sort_order: p.sortOrder } : {}),
    ...(p.q ? { q: p.q } : {}),
    ...p.filters,
  }),
  withStatus: false,        // status is one of the 12 filter fields (active/archived/all),
                            // NOT a toolbar toggle — flows inside `filters` (§5.2)
  filters: { defaults: DEFAULT_CLIENTS_FILTERS },  // 12-field set incl. status: undefined
  serverSearch: true,       // #216 deep-link UUID search uses q
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },
});
export const ClientsProvider = Provider;
export const useClientsTable = usePagedList;
```

**Page mounting** (`app/(main)/clients/page.tsx`): page wraps its content in `<ClientsProvider>` (as masters/locations pages do). Deep-link #216 logic (UUID search effects :31-75, ScheduleProvider wrap :133 for ClientRecordTab gridFrequency, consumed-latch, URL cleanup on close) stays page-level, unchanged except `useClients()` → `useClientsTable()` + factory `setFilters`.

### 5.2 Factory extension — `filters` param

`createPagedListContext` gains an optional generic filters capability:

```ts
createPagedListContext<T, F extends object | undefined = undefined>({ ..., filters?: { defaults: F } })
```

- If `filters` option is given: `PagedListState` gains `filters: F` + `setFilters(patch: Partial<F>)` (like `status`/`setStatus` — present iff option given).
- Query key: `[prefix, page, perPage, ...(filters ? [filters] : []), sortBy, sortOrder, q?]` — the filters object goes into the key wholesale (same as the hand-rolled key today).
- Fetcher params gain `filters: F`.
- Existing 5 consumers pass no `filters` → their keys/types are bit-identical (TS-optional).
- Page-clamp effect (#139 `§6.7`-equivalent, hand-rolled :302-307) — verify factory's existing clamp covers the clients case; port if missing.
- **YAGNI note:** dicts keep client-side filter bars; the param is clients-only today.

### 5.3 hooks/useClientsMutations.ts (new)

Mirror of `useLocationsMutations.ts`: `useCreateClient`, `useUpdateClient`, `usePatchClient`, `useDeleteClient` (dry-run: 204 fast-path / 409 + `dependencies` parking via `ApiError` capture + `onMutate` clear), `useArchiveClient`, `useRestoreClient`, `useResolveDeleteClient`. Invalidation: `qk.clients` on all successes; delete-family also `qk.records` (mirrors current invalidateClients :145-148 + cross-invalidation hygiene).

### 5.4 ActivityDetailsModal — per-record client resolution (US-2 fix)

Current: paged map `:68-98` + per-active-record `getClientById` fallback :81-88 (beyond-first-20 gap → «Без контакта»). New:

- Drop the `useClients()` paged-map dependency entirely.
- Each record tab resolves its client via `useClient(record.client_id)` → progressive render: tab renders immediately; name/phone fill in when the query lands (placeholder «…» while loading; on error — current «Без контакта» styling as graceful fallback).
- `window.open('/clients?clientId=' + id)` :119 stays.
- `useActivityRecords(activity.id)` replaces the direct `useQuery` :58-61.
- No composite endpoint (G1a-locked).
- **Dedupe:** `['client', id]` shared with ClientQuickCard (:42); multiple tabs of the same client in one modal share one query (React Query key dedupe).

### 5.5 ScheduleContext — keys→qk + raw hooks ONLY (not rewritten)

Per G1a decision 4: `:269-272` activities → `qk.activityRange`; `:273-287` dict raw `useQuery` calls → `useMastersRaw`/`useServicesRaw`/`useLocationsRaw`; `:290-292` domain-selected hooks stay; internal `activityQueryKey` (:310-367) sourced from qk. Zero structural changes — #141 owns the rewrite.

### 5.6 Staleness fix — useRecordMutations createClient

Add `invalidateQueries({ queryKey: qk.clients })` to the createClient success path (:142 area). Only this path changes.

### 5.7 Dead code — delete getClients

`packages/api-client/src/endpoints.ts:374-376` (`getClients`, hardcoded per_page=100): delete export, remove from `index.ts`/`endpoints.test.ts` import list (:3), delete `describe('getClients')` (:459-466). Zero prod consumers verified. Remaining client fetchers (`getClientsWithStats`, `getClientsPaged`, `getClientById`, `getClientByPhone`) untouched.

## 6. User Scenarios → e2e mapping

| US | Scenario | E2E |
|---|---|---|
| US-1 | /schedule load fires ZERO `/api/v1/clients` requests | **NEW test** (schedule or clients spec): track `**/api/v1/clients*` during /schedule load+render → expect 0 hits. List-agnostic guard (records-view.spec US-2 `:146-241` only catches `per_page=100`) |
| US-2 | Activity modal with client beyond first-20-active/archived shows name+phone on ALL record tabs | **NEW test** (activity-details-modal.spec): seed 21+ active clients, open modal for an activity whose record's client is past position 20, assert name+phone on the record tab. Unit pin: rewritten ActivityDetailsModal tests |
| US-3 | /clients table full behavior (load/filters/sort/pagination/status) | existing 19 clients.spec tests stay green unedited |
| US-4 | Deep-link `?clientId=` narrowing + modal + cleanup | existing clients.spec test 19 (:695-742) stays green unedited |
| US-5 | CRUD + 409-deps delete flow | clients-delete-cascade.spec, clients-delete-invalid-resolution.spec, admin-opens-profile.spec stay green unedited |
| US-6 | Client created via schedule quick-add immediately visible in /clients | **NEW test**: quick-add creates client → navigate /clients → visible without reload. Unit: useRecordMutations invalidation assertion |

**Regression guards:** records-view.spec US-2 (zero per_page=100 clients fetches on /records) stays green — clients factory provider lives under /clients only, /records never mounts it. unify-caches.spec US-6/US-7 (:409-556), archive-restore-parity :51, wave6-status-shared, visual-regression clients baselines — all stay green.

### 6.1 Accepted behavioral changes (user-approved at G1a)

1. /clients filters/pagination become **page-scoped** — reset on leaving the page (today global, survive route changes). Deep-link #216 flows unaffected (one-shot within a mount).
2. **Zero clients-list requests on any page except /clients** — enforced by the US-1 e2e guard.

### 6.2 Out of scope (explicit)

#141 ScheduleContext split; ClientInfoTab bare promises; RemoteSearchSelect typeahead + `getClientsPaged` pickers (PhotoModal :131, PhotosFilters :95); Photos/Records contexts migration onto the factory; any composite display-lookup endpoint (#213 already shipped for records view); backend changes.

## 7. Behavioral delta

1. /clients filters/pagination now reset on leaving the page (§6.1) — approved.
2. No page except /clients fetches the clients list (§6.1) — approved; new e2e guard.
3. ActivityDetailsModal record tabs resolve clients per-record with progressive render — name/phone may appear a tick after tab render instead of synchronously from the paged map; beyond-first-20 clients now always resolve (bug fix, US-2).
4. Schedule quick-add-created clients appear immediately in /clients (staleness fix, US-6).
5. No UI/markup/copy changes to any table, filter bar, or modal — visual baselines unchanged.

## 8. Testing strategy

**Unit/integration (vitest):**

- `__tests__/ClientsContext.test.tsx` (427 ln) → **deleted**; its coverage splits into: factory `filters` param tests (extend existing `createPagedListContext.test.tsx`), `useClientsMutations` suite (new), page-level integration (existing `ClientsPage.test`/`ClientsIntegration.test` re-based onto real provider).
- Mock shift: `vi.mock('@/contexts/ClientsContext')` in ClientsPage/ClientsTable/ClientsFilters/ClientsIntegration/ClientCardModal/ActivityDetailsModal tests + `helpers/mockContexts.ts:15,146-200` (`createMockClientsContext`) → real provider mount or a `createMockClientsTableState()` fixture (mirrors #139 `makeTableState` precedent).
- `ActivityDetailsModal.test.tsx` ~470-660 (paged-map-first label resolution, :574,:617 getClientById fallback pins) → **rewritten** for per-record `useClient` (progressive render + fallback re-pinned).
- New hook coverage in `useReactQueryHooks.test.tsx` pattern: useClient, useClientRecords, useActivityRecords, usePaymentTotals, useActivitiesForRecords, useActivity, useVisitors, useMastersRaw/useServicesRaw/useLocationsRaw/useTagsRaw (key equality with existing lookup hooks asserted).
- `Providers.test.tsx:36-73` — ClientsProvider removed from the hardcoded order.
- `useRecordMutations` — createClient invalidates `['clients']` assertion.
- api-client: getClients describe block deleted; remaining suite green.

**E2E:** §6 — 3 new tests (US-1, US-2, US-6), all listed existing suites stay green unedited.

**Visual:** no UI change → baselines stay; standard visual gate run at phase end (skip-safe).

## 9. Docs impact (G1a decision 6)

New `## Data Access Patterns` section in `docs/ARCHITECTURE.md` (~40 lines, after Separation Principles): hook taxonomy (lookup `use<Entity>` / raw `use<Entity>Raw` / point hooks / `use<Entity>Table` factory / `use<Entity>Mutations`), the rule «components never call `useQuery` or write query-key literals — they use hooks; keys live only in `lib/queryKeys.ts`», qk pointer. Domain-rules files untouched (no entity fields/validation change).

## 10. Acceptance criteria (DoD)

1. No `getClientsWithStats` requests on /schedule — US-1 e2e green.
2. `ClientsContext.tsx` hand-rolled context deleted (replaced by factory file); its test rewritten to hook/factory-based coverage.
3. Zero direct `useQuery` in `frontend/admin/app/**` components (gate: `grep -rn "useQuery(" frontend/admin/app` → hits only under hooks/ and contexts/).
4. `lib/queryKeys.ts` exists; all entity keys defined there; no inline entity key literals in hooks/contexts/components (grep gate); dedupe/prefix semantics unchanged.
5. records-view.spec US-2 guard stays green; api-client `getClients` deleted, suite green.
6. /clients 19 e2e + deep-link test 19 + delete-cascade/invalid-resolution/admin-opens-profile + unify-caches stay green unedited.
7. US-2 beyond-first-20 modal test green; US-6 staleness fixed (unit + e2e).
8. ARCHITECTURE.md Data Access section merged.

## 11. Failure modes & risks

| Risk | Mitigation |
|---|---|
| Key-migration typo breaks dedupe (double fetches) or invalidation misses | Orthography-only rule; key-equality unit assertions; US-1 e2e; grep sweep gate (no inline entity keys) |
| ActivityDetailsModal rewrite churns label-resolution pins | Tests rewritten in the same task (not deferred); progressive placeholder explicitly asserted |
| Factory `filters` param drifts into over-general machinery | Optional + typed `F extends object`; only clients passes it; YAGNI documented for dicts |
| PhotoModal/PhotosFilters hook adoption changes typeahead timing | Hooks keep same keys + staleTime; typeaheads are direct api-client calls — untouched |
| Deep-link #216 regresses on factory setFilters | Test 19 stays green unedited (binding); consumed-latch logic page-level, untouched |
| Page-clamp behavior lost in factory migration | Factory clamp verified against hand-rolled :302-307 semantics; covered by factory tests |

## Visual Compliance Checks

- [ ] N/A — pure data-access refactor, no UI changes (behavioral e2e guards §6 replace visual diffs; clients visual baselines must stay pixel-green)

## Questions for G1b

1. **Q1 — factory filters param vs withStatus:** /clients status lives in the 12-field filter bar, so spec uses `withStatus:false` + filters-in-key (preserves current key shape + UI). Alternative: reuse factory `withStatus:true` and drop status from filters (changes key shape + UI wiring). **Recommendation: filters-in-key (spec as written).**
2. **Q2 — PhotoModal/PhotosFilters raw hooks added to scope:** G1a inventory missed these two direct-useQuery sites (:252-257, :35-39); spec brings them in (same keys, zero semantic change). Flag for awareness.
3. **Q3 — useVisitors.ts new file** vs co-locating in useRecordData.ts: 3 consumers (useRecordData, ClientTab :72, ClientRecordTab :172) justify a dedicated file. **Recommendation: new file.**
4. **Q4 — US-2 e2e seeding cost:** 21+ clients via API is ~22 requests (lean, acceptable); unit-integration pin runs in parallel. **Recommendation: e2e with lean seeding + unit pin.**
