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
| `useClientsMutations` | hooks file | invalidates `['clients']` + `['records']` | `useCreateClient`/`useUpdateClient`/`usePatchClient`/`useDeleteClient`/`useArchiveClient`/`useRestoreClient`/`useResolveDeleteClient` (409-deps `dependencies` parking). **ALL hooks invalidate both lists** — mirrors current `invalidateClients` :145-148 exactly (client stats/names appear in record views). Mirror file: `useLocationsMutations` |
| `useClient(id)` | point hook | `['client', id]` | `getClientById`; error propagates as-is (no silent-undefined masking) |
| `useClientRecords(id)` | point hook | `['records','client',id]` | `getRecords` per_page 100 (current semantics) |
| `useActivityRecords(id)` | point hook | `['records','activity',id]` | `getRecords` per_page 100 (current semantics) |
| `usePaymentTotals(ids)` | point hook | `['payments','totals',ids]` | `getPaymentTotals`, ids array in key |
| `useActivitiesForRecords(ids)` | point hook | `['activities','for-records',ids]` | Co-located in `hooks/useActivities.ts` |
| `useActivity(id)` | point hook | `['activity', id]` | `getActivity`, co-located in `hooks/useActivities.ts` (consumer: ClientTab :72-76) |
| `useMastersRaw`/`useServicesRaw`/`useLocationsRaw` | raw-lookup hooks | `['masters']`/`['services']`/`['locations']` | **Same keys** as `useMasters`/`useServices`/`useLocations` (dedupe preserved), NO select — returns raw responses incl. `archived`. Co-located in the existing `use*.ts` files |
| `useTagsRaw` | raw-lookup hook | `['tags']` | PhotosFilters tags chips (§4 map) |

**Naming rules (canonical location: `lib/queryKeys.ts` header; ARCHITECTURE.md §Data Access cross-references it — no duplicate copy):** `use<Entity>` = domain-selected lookup; `use<Entity>Raw` = raw response (archived included); `use<Entity>Table` = factory paged-list state; `use<Entity>Mutations` = mutation family. `useClients` is permanently reserved-vacant. Co-located raw/lookup hook pairs MUST keep identical staleTime (shared-key observers take the most pessimistic staleTime — divergence silently slows the other observer). **Dictionary staleTime = 1 hour** (G1b Amendment 1) for both raw and lookup dict hooks — admin pages stay open indefinitely; 5-min refetch cycles are excessive; correctness relies on own-mutation invalidation.

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
} as const;
```

(Note: exact accessor naming inside qk may be adjusted by the plan; the binding contract is the **key shapes above and the single-file sourcing rule**, not the accessor names. The clients 12-field filters object goes into the clients list key wholesale as state data — it needs no qk helper.)

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
| `hooks/useDeleteRecord.ts` :36-46 | `['records']` setQueriesData + invalidate, `['record',id]`, `['visitors']` | qk (incl. the `setQueriesData` at :37-40) | same |
| `app/components/modal/ActivityDetailsModal/ClientTab.tsx` :72-76, :118 | `['activity',id]` query; `['visitors', clientId]` invalidation | `useActivity(id)`; qk | same |
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
    ...p.filters,
    // search lives INSIDE filters (deep-link #216 writes setFilters({search,...})).
    // Server renamed search→q in #212; send q (clamped ≥2, current :121 semantics)
    // and explicitly suppress the raw `search` param after the spread:
    ...(p.filters.search && p.filters.search.length >= 2 ? { q: p.filters.search } : {}),
    search: undefined,
  }),
  withStatus: false,        // status is one of the 12 filter fields (default 'active',
                            // current :41), NOT a toolbar toggle — flows inside `filters`
  filters: { defaults: DEFAULT_CLIENTS_FILTERS },  // 12-field set, incl. search + status
  serverSearch: false,      // NO factory search state — search is filters.search; key keeps
                            // the exact current 5-slot shape (orthography-only)
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },  // NEW factory option, §5.2 — current
                            // hand-rolled default; dict tables don't pass it (unchanged)
});
export const ClientsProvider = Provider;
export const useClientsTable = usePagedList;
```

**Key shape stays EXACTLY `['clients', page, perPage, filters, sortBy, sortOrder]`** — search and status travel inside the `filters` object (as today), no separate q slot. This is what makes the migration orthography-only.

**Page mounting** (`app/(main)/clients/page.tsx`): page wraps its content in `<ClientsProvider>` (as masters/locations pages do) — the `ScheduleProvider` wrap (:133, feeds ClientRecordTab gridFrequency) stays as-is. Deep-link #216 logic (UUID search effects :31-75, consumed-latch, URL cleanup on close) stays page-level, unchanged except `useClients()` → `useClientsTable()`; its `setFilters({ search, status })` calls keep working because search/status remain filter fields. The consumed-latch (`consumedClientIdRef`) is a per-mount ref — page-scoped state makes it MORE correct (fresh latch per entry), no change needed; covered unedited by test 19.

### 5.2 Factory extensions — `filters` param + `defaultSort`

`createPagedListContext` gains two optional capabilities:

```ts
createPagedListContext<T, F extends object | undefined = undefined>({
  ..., filters?: { defaults: F }, defaultSort?: { sortBy: string; sortOrder: 'asc' | 'desc' }
})
```

- If `filters` option is given: `PagedListState` gains `filters: F` + `setFilters(patch: Partial<F>)`. Typing via **function overloads** (not conditional types): the F-given overload returns a context value including `filters`/`setFilters`; the F-undefined overload returns the current shape. This avoids "present iff option given" runtime conditionals — the context value simply ALWAYS carries `filters`/`setFilters` when the factory was created with the option, and the overload selects the right static type. (Note: the existing `status`/`setStatus` members are always present at runtime; `filters` follows the same always-present-at-runtime, overload-typed pattern — simpler and consistent.)
- Query key: `[prefix, page, perPage, ...(filters ? [filters] : []), sortBy, sortOrder]` (+ trailing `q` slot ONLY for `serverSearch:true` consumers, as today). Existing 5 consumers (no `filters`, 4 with `serverSearch`) → keys bit-identical.
- Fetcher params gain `filters: F` (absent for F-undefined consumers).
- `defaultSort`: initial `sortBy`/`sortOrder` state (today always `null`/undefined until first user sort). Dict tables pass nothing → unchanged.
- Page-clamp: the factory's existing clamp (:154-156) fires on derived `items.length === 0`; the hand-rolled version (:302-307) guards `!isPending && !isFetching` — the factory already carries this #139-era guard; verify by factory test, port the guard delta if missing.
- **YAGNI note:** dicts keep client-side filter bars; both params are clients-only today.

### 5.3 hooks/useClientsMutations.ts (new)

Mirror of `useLocationsMutations.ts`: `useCreateClient`, `useUpdateClient`, `usePatchClient`, `useDeleteClient` (dry-run: 204 fast-path / 409 + `dependencies` parking via `ApiError` capture + `onMutate` clear), `useArchiveClient`, `useRestoreClient`, `useResolveDeleteClient`. Invalidation: **every hook invalidates `qk.clients` AND `qk.records`** on success — exactly mirroring current `invalidateClients` :145-148 (client names/stats appear inside record rows; narrowing to delete-family would be a silent behavior change).

**409-deps parking re-wiring (US-5):** today `dependencies` is parked on the context (:191-196) and read by ClientCardModal via `useClients().dependencies`. After migration each hook call owns its `dependencies` state — same as LocationsTable/MastersTable already work with `useLocationsMutations`. Consumer re-wiring: ClientsTable delete handler and ClientCardModal each call `useDeleteClient()` where they previously destructured context mutations; the DeleteDialog reads `deleteMutation.dependencies` from the SAME hook instance that ran `.mutateAsync(id)` (local instance — no cross-consumer sharing exists today: each delete is initiated and dialog-rendered in one component). Use test 19/cascade suites unedited as the pin.

### 5.4 ActivityDetailsModal — per-record client resolution (US-2 fix)

Current: paged map `:68-98` + per-active-record `getClientById` fallback :81-88 (beyond-first-20 gap → «Без контакта»). New:

- Drop the `useClients()` paged-map dependency entirely.
- **Each record tab** (not just the active one) resolves its client: the tab list is derived from the `useActivityRecords` query, and per-record `useClient(record.client_id)` observers are mounted for the tab strip (a small `<ClientNameById id>` subcomponent or equivalent per-tab hook call — rules of hooks satisfied since records render as a list). Progressive render: tabs render immediately; name/phone fill in when each query lands (placeholder «…» while loading; on error — current «Без контакта» styling as graceful fallback).
- Waterfall note: tab queries fire after `useActivityRecords` settles; typical activities (1-5 records) are unaffected; shared client_ids dedupe to one query. Accepted (G1a decision 1).
- `window.open('/clients?clientId=' + id)` :119 stays.
- `useActivityRecords(activity.id)` replaces the direct `useQuery` :58-61.
- No composite endpoint (G1a-locked).
- **Dedupe:** `['client', id]` shared with ClientQuickCard (:42); multiple tabs of the same client in one modal share one query (React Query key dedupe).

### 5.5 ScheduleContext — keys→qk + raw hooks ONLY (not rewritten)

Per G1a decision 4: `:269-272` activities → `qk.activityRange`; `:273-287` dict raw `useQuery` calls → `useMastersRaw`/`useServicesRaw`/`useLocationsRaw`; `:290-292` domain-selected hooks stay; internal `activityQueryKey` (:310-367) sourced from qk. Zero structural changes — #141 owns the rewrite.

### 5.6 Staleness fix — useRecordMutations createClient

The createClient path inside `createRecordMutation` (:78-105; new-client branch :90-94) — add `invalidateQueries({ queryKey: qk.clients })` **scoped to the client-created branch** (not the existing-client reuse branch :87-88), alongside the existing `invalidateRecordAndLists()` (:142). Return/await the invalidation so the mutation stays pending until refetch (US-6 "immediately visible" without flash). Other record mutations untouched.

### 5.7 Dead code — delete getClients

`packages/api-client/src/endpoints.ts:374-376` (`getClients`, hardcoded per_page=100): delete export, remove from `index.ts`/`endpoints.test.ts` import list (:3), delete `describe('getClients')` (:459-466). Zero prod consumers verified. Remaining client fetchers (`getClientsWithStats`, `getClientsPaged`, `getClientById`, `getClientByPhone`) untouched.

## 6. User Scenarios → e2e mapping

| US | Scenario | E2E |
|---|---|---|
| US-1 | /schedule load fires ZERO `/api/v1/clients` requests | **NEW test** (schedule or clients spec): navigate directly to /schedule, track `**/api/v1/clients*` during load+render → expect 0 hits (direct navigation — not /clients→/schedule, which legitimately carries cached/list traffic). List-agnostic guard; supersedes the per_page=100-only records-view guard |
| US-2 | Activity modal with client beyond first-20-active/archived shows name+phone on ALL record tabs | **NEW test** (activity-details-modal.spec): seed 21+ active clients, open modal for an activity whose record's client is past position 20, assert name+phone on every record tab (tab strip + tab content). Unit pin: rewritten ActivityDetailsModal tests (per-tab resolution asserted for non-active tabs too) |
| US-3 | /clients table full behavior (load/filters/sort/pagination/status) | existing 19 clients.spec tests stay green unedited |
| US-4 | Deep-link `?clientId=` narrowing + modal + cleanup | existing clients.spec test 19 (:695-742) stays green unedited |
| US-5 | CRUD + 409-deps delete flow | clients-delete-cascade.spec, clients-delete-invalid-resolution.spec, admin-opens-profile.spec stay green unedited |
| US-6 | Client created via schedule quick-add immediately visible in /clients | **NEW test**: quick-add creates client → navigate /clients → client row visible (default sort name/asc, default filter status:active — new client is active; assert by name/phone text in table) without reload. Unit: useRecordMutations invalidation assertion (client-created branch only) |

**Regression guards:** records-view.spec US-2 (zero per_page=100 clients fetches on /records) stays green — the per_page=100 fetcher (`getClients`) is deleted outright (§5.7), so the old guard becomes vacuously true; the NEW US-1 guard (zero `/api/v1/clients*` on /schedule) supersedes it as the real protection. unify-caches.spec US-6/US-7 (:409-556), archive-restore-parity :51, wave6-status-shared, visual-regression clients baselines — all stay green.

### 6.1 Accepted behavioral changes (user-approved at G1a)

1. /clients filters/pagination become **page-scoped** — reset on leaving the page (today global, survive route changes). Deep-link #216 flows unaffected (one-shot within a mount).
2. **Zero clients-list requests on any page except /clients** — enforced by the US-1 e2e guard.

### 6.2 Out of scope (explicit)

#141 ScheduleContext split; ClientInfoTab bare promises; RemoteSearchSelect typeahead + `getClientsPaged` pickers (PhotoModal :131, PhotosFilters :95); Photos/Records contexts migration onto the factory; any composite display-lookup endpoint (#213 already shipped for records view); backend changes.

### 6.3 Infrastructure assumptions (G1b Amendment 2)

No external-event cache invalidation exists today — no WebSocket, no SSE, no polling. Cache correctness rests **entirely on invalidations from the client's own mutations**. This is the standing assumption behind all staleTime choices (incl. the 1h dictionary staleTime, §7.5) and behind prefix-invalidation breadth (e.g. client mutations invalidating the whole `['records']` prefix because records rows are composite view rows carrying denormalized client name/phone). Follow-up #239 (server push channel evaluation) filed for the backlog.

## 7. Behavioral delta

1. /clients filters/pagination now reset on leaving the page (§6.1) — approved.
2. No page except /clients fetches the clients list (§6.1) — approved; new e2e guard.
3. ActivityDetailsModal record tabs resolve clients per-record with progressive render — name/phone may appear a tick after tab render instead of synchronously from the paged map; beyond-first-20 clients now always resolve (bug fix, US-2).
4. Schedule quick-add-created clients appear immediately in /clients (staleness fix, US-6).
5. Dictionary staleTime unifies to **1 hour** for all dict hooks (raw AND lookup — they share keys, must stay aligned): today lookup hooks (`useMasters`/`useServices`/`useLocations`) and BookingFilters/ScheduleContext/useRecordData raw queries use 5min while PhotosContext uses `Infinity` on the same keys. Post-migration all observe 1h. Accepted tradeoff (G1b Amendment 1): edits by a second admin/tab propagate with up to 1h delay unless an own mutation/invalidation refreshes the cache (mutations still invalidate — own edits are always immediate). Invisible in single-admin flows; shared-key observers take the most pessimistic staleTime anyway, so one aligned value per key is the only sound end-state.
6. No UI/markup/copy changes to any table, filter bar, or modal — visual baselines unchanged.

## 8. Testing strategy

**Unit/integration (vitest):**

- `__tests__/ClientsContext.test.tsx` (427 ln) → **deleted** (it mounts the old provider/useClients — nothing to re-mock); its coverage splits into: factory `filters`+`defaultSort` tests (extend existing `createPagedListContext.test.tsx`), `useClientsMutations` suite (new), page-level integration (existing `ClientsPage.test`/`ClientsIntegration.test` re-based onto real provider).
- Mock shift: `vi.mock('@/contexts/ClientsContext')` in ClientsPage/ClientsTable/ClientsFilters/ClientsIntegration/ClientCardModal/ActivityDetailsModal tests + `helpers/mockContexts.ts` `createMockClientsContext` (~:150-200, used by 5 test files) → real provider mount or a `createMockClientsTableState()` fixture (mirrors #139 `makeTableState` precedent). Component suites that consumed context mutations (ClientsTable delete handler, ClientCardModal 7 mutations) re-wire to `useClientsMutations` hooks (mock at hook level).
- `ActivityDetailsModal.test.tsx` :470-660 (paged-map-first label resolution pins, :537-553 fallback pin, :574,:617) → **rewritten** for per-tab `useClient`: mock `hooks/useClient` (N parallel queries), assert progressive placeholder → resolved name/phone on ALL tabs (incl. non-active), assert «Без контакта» ONLY on query error. Old fallback pins are deleted with the mechanism (nothing to re-pin — the paged map is gone).
- New hook coverage in `useReactQueryHooks.test.tsx` pattern: useClient, useClientRecords, useActivityRecords, usePaymentTotals, useActivitiesForRecords, useActivity, useMastersRaw/useServicesRaw/useLocationsRaw/useTagsRaw — each asserts key equality with the sibling lookup hook (the #1 risk pin).
- `Providers.test.tsx:36-73` — ClientsProvider removed from the hardcoded order.
- `useRecordMutations` — createClient branch invalidates `['clients']` (existing-client branch does NOT).
- api-client: getClients describe block deleted; remaining suite green.

**E2E:** §6 — 3 new tests (US-1, US-2, US-6), all listed existing suites stay green unedited.

**Visual:** no UI change → baselines stay; standard visual gate run at phase end (skip-safe).

## 9. Docs impact (G1a decision 6)

New `## Data Access Patterns` section in `docs/ARCHITECTURE.md` (~40 lines, after Separation Principles): hook taxonomy (lookup `use<Entity>` / raw `use<Entity>Raw` / point hooks / `use<Entity>Table` factory / `use<Entity>Mutations`), the project rule «components never call `useQuery` or write query-key literals — they use hooks; keys live only in `lib/queryKeys.ts`», qk pointer. Framing note (2026 TanStack guidance leans toward `queryOptions` factories; this codebase standardizes on thin hooks + central qk instead — documented explicitly as a team-governance choice, with the shared-key staleTime-alignment caveat). Domain-rules files untouched (no entity fields/validation change).

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
| Key-migration typo breaks dedupe (double fetches) or invalidation misses | Orthography-only rule; key-equality unit assertions; US-1 e2e; grep sweep gate (no inline entity keys). Scale note: ~80 key call sites across hooks/contexts/components — migration is mechanical but wide; plan sequences hooks/contexts first, components+tests second, grep gate after each |
| ActivityDetailsModal rewrite churns label-resolution pins | Tests rewritten in the same task (not deferred); progressive placeholder explicitly asserted on all tabs incl. non-active |
| Factory `filters`/`defaultSort` extension drifts into over-general machinery | Both optional; only clients passes them; YAGNI documented for dicts |
| PhotoModal/PhotosFilters hook adoption changes typeahead timing | Hooks keep same keys + staleTime; typeaheads are direct api-client calls — untouched |
| Deep-link #216 regresses on factory setFilters | Test 19 stays green unedited (binding); search/status stay filter fields — key shape and setFilters semantics unchanged; consumed-latch is per-mount (page-scoped state makes it more correct) |
| Page-clamp behavior lost in factory migration | Factory clamp (:154-156) verified against hand-rolled :302-307 semantics (incl. !isPending/!isFetching guard); covered by factory tests |
| 409-deps parking moves from context-level to hook-instance-level | Each delete is initiated + dialog-rendered in ONE component (ClientsTable, ClientCardModal); cascade/invalid-resolution e2e unedited pins the flow |

## Visual Compliance Checks

- [ ] N/A — pure data-access refactor, no UI changes (behavioral e2e guards §6 replace visual diffs; clients visual baselines must stay pixel-green)

## Questions for G1b

All panel findings (5/5 returned: 1 blocker, 6 majors, ~15 minors) are already folded into the sections above:

- **Q1 (resolved — spec as written):** /clients stays `withStatus:false` with status+search inside the 12-field `filters` object → key shape and deep-link `setFilters` semantics unchanged (§5.1). This was the completeness/consistency blocker cluster: factory `serverSearch` state would have competed with `filters.search` and changed the key shape.
- **Q2 (accepted):** PhotoModal `['locations']` :252-257 + PhotosFilters `['tags']` :35-39 added to scope (§4 map) — direct useQuery missed by the G1a inventory; same keys, zero semantic change, forced by DoD gate 3 anyway.
- **Q3 (dropped):** `useVisitors.ts` hook was speculative (only real consumer `useRecordData` is itself a hook; other sites are invalidation call-sites needing the qk key, and the named fetcher was wrong). Removed — `['visitors', clientId]` lives in qk only.
- **Q4 (accepted):** US-2 e2e with lean 21+ client seeding + unit pins (§6).
- **Best-practices note (accepted as framing):** 2026 TanStack guidance leans toward `queryOptions` factories; this codebase standardizes on thin hooks + central qk — §9 documents it explicitly as a team-governance choice with the shared-key staleTime caveat, not as community canon.

Remaining question for the user: **none blocking** — approve, or flag any line for revision.
