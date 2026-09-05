# Entity Hooks + Dissolve ClientsContext (#140) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all admin server-data access on entity hooks + `lib/queryKeys.ts`; dissolve the globally-mounted ClientsContext onto `createPagedListContext`; fix the beyond-first-20 «Без контакта» modal bug and the quick-add staleness bug.

**Architecture:** Orthography-only key migration (every query key keeps its exact current shape; single source `lib/queryKeys.ts`). /clients becomes the 6th factory table (factory gains optional `filters` + `defaultSort`). New point hooks (`useClient` etc.) and raw-lookup hooks (`useMastersRaw` etc.) replace every direct `useQuery` in components. ScheduleContext is NOT restructured (#141) — keys + dict queries only.

**Tech Stack:** Next.js 14 App Router, TanStack Query v5, Vitest + Testing Library, Playwright e2e.

**Spec:** `docs/specs/2026-09-05-entity-hooks-dissolve-clients-context-design.md` (binding; G1a-locked decisions §2, G1b amendments: dict staleTime = 1 HOUR, no-external-invalidation assumption §6.3).

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/entity-hooks-dissolve-clients-context-140`.

---

## Behavioral Delta

How this behaves for the user, mapped to spec acceptance criteria:

- **/schedule stops downloading the client list** — schedule loads faster; zero `/api/v1/clients` requests anywhere except /clients (new e2e guard).
- **Activity modal shows the client name+phone on EVERY record tab** — even for clients beyond the first 20 active/archived (bug fix; tabs fill in progressively: brief «…» then name/phone).
- **/clients looks and behaves identically** (load, 12 filters, sort, pagination, status, deep-link `?clientId=`, CRUD, 409-delete dialogs) — except filters/pagination now reset when you leave the page and come back (was: global, survived navigation).
- **A client created via schedule quick-add appears in /clients immediately** (was: up to 30s stale).
- **Dictionaries refresh at most once per hour** (was 5 min; photos page: was never). Your own edits always appear instantly (mutation invalidation); another admin's edits may take up to 1h to reach you (accepted, #239 tracks server-push eval).
- **Activity modal — statistics row becomes uniform for all clients** (disclosed plan-review delta, refines spec §7 "no UI changes"): the «Статистика» block in record tabs previously showed server stats ONLY for first-20 clients (paged map) and «—» for everyone else; now it derives real aggregates (records count / last record / missed / paid) over the same 100-record window the tab already lists — same numbers for first-20 clients in practice, real numbers instead of «—» for the rest. No markup/copy changes.
- **No visual changes** — zero markup/copy/style edits; all existing visual baselines stay.

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `frontend/admin/lib/queryKeys.ts` | CREATE | `qk` key factory (single source) + `DICT_STALE_TIME` + taxonomy header |
| `frontend/admin/hooks/useClient.ts` | CREATE | `useClient(id)`, `useClientRecords(id)` |
| `frontend/admin/hooks/usePayments.ts` | CREATE | `usePaymentTotals(ids)` |
| `frontend/admin/hooks/useTags.ts` | CREATE | `useTagsRaw()` |
| `frontend/admin/hooks/useActivities.ts` | MODIFY | + `useActivity(id)`, `useActivityRecords(id)`, `useActivitiesForRecords(ids)`; qk keys |
| `frontend/admin/hooks/useMasters.ts` / `useLocations.ts` / `useServices.ts` | MODIFY | + `use<entity>Raw()`; staleTime 1h; qk keys |
| `frontend/admin/hooks/useClientsMutations.ts` | CREATE | 7 client mutation hooks (mirror useLocationsMutations) |
| `frontend/admin/contexts/createPagedListContext.tsx` | MODIFY | + `filters`/`defaultSort` options, overload-typed |
| `frontend/admin/contexts/ClientsContext.tsx` | REWRITE | 316-line hand-rolled → ~30-line factory file |
| `frontend/admin/contexts/ScheduleContext.tsx` | MODIFY | keys→qk; dict raw queries→raw hooks (NO restructure) |
| `frontend/admin/contexts/PhotosContext.tsx` | MODIFY | dict queries→raw hooks; keys→qk |
| `frontend/admin/app/providers.tsx` | MODIFY | remove ClientsProvider |
| `frontend/admin/app/(main)/clients/page.tsx` | MODIFY | mount ClientsProvider; useClientsTable; deep-link preserved |
| `frontend/admin/app/(main)/clients/components/*` | MODIFY | off useClients() → useClientsTable + useClientsMutations |
| `frontend/admin/app/components/modal/ActivityDetailsModal/*` | MODIFY | per-tab useClient; useActivityRecords; paged map deleted |
| `frontend/admin/app/(main)/records/components/ClientQuickCard.tsx`, `BookingFilters.tsx` | MODIFY | point/raw hooks replace direct useQuery |
| `frontend/admin/hooks/useRecordData.ts`, `useRecordMutations.ts`, `useDeleteRecord.ts`, `*Mutations.ts` | MODIFY | qk keys; createClient staleness fix |
| `frontend/admin/app/(main)/photos/components/PhotoModal.tsx`, `PhotosFilters.tsx` | MODIFY | raw hooks replace direct useQuery |
| `frontend/admin/lib/cache/recordCacheSync.ts` | MODIFY | qk key |
| `packages/api-client/src/endpoints.ts`, `endpoints.test.ts` | MODIFY | delete dead `getClients` |
| `docs/ARCHITECTURE.md` | MODIFY | + `## Data Access Patterns` section |
| tests | MODIFY/CREATE | see per-task |

**Commits:** per-task, message prefix `refactor(#140):` / `test(#140):` / `docs(#140):`. Single PR at the end.

**Test commands** (run from `frontend/admin` unless noted): `npx vitest run <paths>` for targeted, `npm run test` full unit; `npx tsc --noEmit` typecheck; `npm run lint`. api-client: `cd packages/api-client && npx vitest run`.

---

## Task 1: lib/queryKeys.ts + point/raw hooks + hooks-layer key migration
### Classification: standard
### Required Docs
- Spec `docs/specs/2026-09-05-entity-hooks-dissolve-clients-context-design.md` §3 (naming), §4 (key inventory — THE binding table), §5.6
- Skill: `test-driven-development` (RED-GREEN for the hook suite)

### Task Description
Create the single key source + all new hooks; migrate every inline key in `frontend/admin/hooks/*` and `frontend/admin/lib/cache/recordCacheSync.ts`. Components/contexts come later (Tasks 4-8) — do NOT touch them here.

**1.1** CREATE `frontend/admin/lib/queryKeys.ts`:

```ts
// Single source of truth for entity query keys (GH #140, spec §4).
// ORTHOGRAPHY-ONLY: key shapes, raw/domain key-sharing and prefix-invalidation
// semantics MUST NOT change — a different shape breaks dedupe/invalidation.
//
// Hook taxonomy (naming rules — canonical location, ARCHITECTURE.md links here):
//   use<Entity>         domain-selected lookup (archived dropped, domain types)
//   use<Entity>Raw      raw response (archived included), SAME key as lookup
//   use<Entity>Table    factory paged-list state (createPagedListContext)
//   use<Entity>Mutations  mutation family
//   point hooks (useClient, useActivity, …) — single-entity reads
// `useClients` is PERMANENTLY RESERVED-VACANT (list = useClientsTable).
//
// Raw/lookup hook pairs share a key ⇒ they MUST share staleTime
// (shared-key observers take the most pessimistic value).
// Dictionary staleTime = 1 hour (G1b Amendment 1): admin pages stay open
// indefinitely; correctness relies on own-mutation invalidation (spec §6.3 —
// no WebSocket/SSE/polling exists; #239 tracks server-push eval).

export const DICT_STALE_TIME = 60 * 60 * 1000;

export const qk = {
  // ── Point keys ──────────────────────────────────────────────────────────
  client: (id: string) => ['client', id] as const,
  clientRecords: (id: string) => ['records', 'client', id] as const,
  activityRecords: (id: string) => ['records', 'activity', id] as const,
  paymentTotals: (ids: string[]) => ['payments', 'totals', ids] as const,
  activitiesForRecords: (ids: string[]) => ['activities', 'for-records', ids] as const,
  activity: (id: string) => ['activity', id] as const,
  activityRange: (weekStart: string, weekEnd: string) => ['activities', weekStart, weekEnd] as const,
  visitors: (clientId: string) => ['visitors', clientId] as const,
  recordPayments: (recordId: string) => ['payments', recordId] as const,
  record: (id: string) => ['record', id] as const,
  // ── List prefixes (factory contexts + invalidation targets) ─────────────
  clients: ['clients'] as const,
  records: ['records'] as const,
  masters: ['masters'] as const,
  services: ['services'] as const,
  locations: ['locations'] as const,
  materials: ['materials'] as const,
  tags: ['tags'] as const,
  photos: ['photos'] as const,
  visitorsList: ['visitors'] as const, // prefix invalidation (useDeleteRecord)
} as const;
```

**1.2** CREATE `frontend/admin/hooks/useClient.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { getClientById, getRecords } from '@memo/api-client';
import type { ClientResponse, RecordResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/** Single client by id — key shared with ClientQuickCard/ActivityDetailsModal (dedupe). */
export function useClient(id: string | undefined) {
  return useQuery<ClientResponse>({
    queryKey: qk.client(id ?? ''),
    queryFn: () => getClientById(id!),
    enabled: !!id,
  });
}

/** All records of one client (per_page 100 — current semantics, spec §3). */
export function useClientRecords(id: string | undefined, enabled = true) {
  return useQuery<RecordResponse[]>({
    queryKey: qk.clientRecords(id ?? ''),
    queryFn: () => getRecords({ client_id: id!, per_page: 100 }).then((r) => r.items),
    enabled: !!id && enabled,
  });
}
```

(Type note: `getClientById` returns `ClientResponse` — NOT ClientWithStats. Plan-review finding 2 resolved in Task 6: ClientTab stats re-source.)

**1.3** CREATE `frontend/admin/hooks/usePayments.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { getPaymentTotals } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/** Payment totals for a set of record ids (ids array participates in the key). */
export function usePaymentTotals(ids: string[]) {
  return useQuery({
    queryKey: qk.paymentTotals(ids),
    queryFn: () => getPaymentTotals(ids),
    enabled: ids.length > 0,
  });
}
```

**1.4** CREATE `frontend/admin/hooks/useTags.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/** Raw tags (post-#213 canonical /all fetcher) — PhotosFilters chips typeahead. */
export function useTagsRaw() {
  return useQuery<TagResponse[]>({
    queryKey: qk.tags,
    queryFn: () => getAllTags(),
    staleTime: DICT_STALE_TIME,
  });
}
```

**1.5** MODIFY `frontend/admin/hooks/useMasters.ts` — staleTime `5 * 60 * 1000` → `DICT_STALE_TIME`, key → `qk.masters`, and APPEND:

```ts
/** Raw masters incl. `archived` — SAME key as useMasters (dedupe); keep staleTimes aligned. */
export function useMastersRaw() {
  return useQuery<MasterResponse[]>({
    queryKey: qk.masters,
    queryFn: () => getAllMasters(),
    staleTime: DICT_STALE_TIME,
  });
}
```

Do the same in `useLocations.ts` (`useLocationsRaw`, `getAllLocations`, `LocationResponse`) and `useServices.ts` (`useServicesRaw`).

**1.6** MODIFY `frontend/admin/hooks/useActivities.ts` — existing `useActivities(weekStart, weekEnd)` key → `qk.activityRange(weekStart, weekEnd)` (keep everything else); APPEND:

```ts
/** Single activity by id — ClientTab (:72) + activities-for-records bundles. */
export function useActivity(id: string | undefined) {
  return useQuery<ActivityResponse>({
    queryKey: qk.activity(id ?? ''),
    queryFn: () => getActivity(id!),
    enabled: !!id,
  });
}

/** All records of one activity (per_page 100 — current semantics, spec §3). */
export function useActivityRecords(activityId: string | undefined, enabled = true) {
  return useQuery<RecordResponse[]>({
    queryKey: qk.activityRecords(activityId ?? ''),
    queryFn: () => getRecords({ activity_id: activityId!, per_page: 100 }).then((r) => r.items),
    enabled: !!activityId && enabled,
  });
}

/** Activities for a set of record ids (Promise.all bundle — current semantics). */
export function useActivitiesForRecords(recordActivityIds: string[]) {
  return useQuery<ActivityResponse[]>({
    queryKey: qk.activitiesForRecords(recordActivityIds),
    queryFn: () => Promise.all(recordActivityIds.map((id) => getActivity(id))),
    enabled: recordActivityIds.length > 0,
  });
}
```

(Import `getActivity`, `getRecords` and the needed response types from `@memo/api-client`.)

**1.7** Key migration in hooks layer — mechanical replace, zero semantic change:
- `useRecordData.ts`: `['record', recordId]`→`qk.record(recordId)`; `['visitors', clientId]`→`qk.visitors(clientId)`; `['activity', record?.activity_id]`→`qk.activity(record?.activity_id ?? '')` (keep `enabled` guard); raw `['services']`/`['masters']`/`['locations']` queries (:32-45) → REPLACE the three `useQuery` blocks with `useServicesRaw()`/`useMastersRaw()`/`useLocationsRaw()` (keep the same destructured names); `['payments', recordId]`→`qk.recordPayments(recordId)`. Import raw hooks — DELETE the now-unused `getAll*` imports.
- `useRecordMutations.ts`: every `['record', recordId]`→`qk.record(recordId)`, `['records']`→`qk.records`, `['visitors', data.client_id]`/`['visitors', clientId]`→`qk.visitors(...)`. (The `qk.clients` staleness invalidation is Task 9 — NOT here.)
- `useDeleteRecord.ts`: `['records']` (both the `setQueriesData` :37-40 and `invalidateQueries` :44) → `qk.records`; `['record', id]`→`qk.record(id)`; the `['visitors']` PREFIX invalidation (:46) → `qk.visitorsList` (list prefix added to qk in step 1.1).
- `useMastersMutations.ts`/`useServicesMutations.ts`/`useLocationsMutations.ts`/`useMaterialsMutations.ts`/`useTagsMutations.ts`/`usePhotosMutations.ts`: `['masters']`→`qk.masters` etc. (all `invalidateQueries` calls).
- `lib/cache/recordCacheSync.ts:61`: `['records']`→`qk.records`.

**1.8** RED-GREEN hook tests — extend `frontend/admin/__tests__/useReactQueryHooks.test.tsx` (follow its existing describe pattern; wrap renderHook in QueryClientProvider with `vi.mock('@memo/api-client')`):
- `useClient`: success returns data; `enabled:false` when id undefined (no fetch); key equality `qk.client('c1')` → `['client','c1']`.
- `useClientRecords`/`useActivityRecords`: `.then(r=>r.items)` mapping; enabled gates.
- `usePaymentTotals`: disabled for `[]`.
- `useActivitiesForRecords`: disabled for `[]`; calls getActivity per id.
- `useActivity`: enabled gate.
- `useMastersRaw` vs `useMasters`: SAME key `['masters']` asserted via `queryClient.getQueryCache().find` — the dedupe pin (spec §8, #1 risk). Same for services/locations/tags pairs.

**1.9** Run: `npx vitest run __tests__/useReactQueryHooks.test.tsx` → green. `npx tsc --noEmit` → 0 errors. `npm run lint` → clean.

**1.10** Commit: `refactor(#140): add lib/queryKeys.ts + point/raw hooks, migrate hooks-layer keys`.

### DoD
- New hooks exist with qk keys + 1h dict staleTime; hooks layer has zero inline entity key literals except none (verify: `grep -rn "queryKey: \['" frontend/admin/hooks frontend/admin/lib/cache` → only `lib/queryKeys.ts` hits). Hook suite green; tsc/lint clean.

---

## Task 2: api-client — delete dead getClients
### Classification: trivial
### Required Docs
- Spec §5.7

### Task Description
**2.1** `packages/api-client/src/endpoints.ts`: delete `export async function getClients(...)` (:374-376, hardcodes per_page=100).
**2.2** `packages/api-client/src/index.ts`: uses `export * from './endpoints'` — no literal `getClients` re-export exists; nothing to edit here (verify with `grep -n "getClients\b" packages/api-client/src/index.ts`; skip if only the star-export).
**2.3** `packages/api-client/src/endpoints.test.ts`: remove `getClients` from the import list (:3) and delete `describe('getClients', ...)` (:459-466).
**2.4** Run: `cd packages/api-client && npx vitest run` → all green (was 243 passing, now 242 tests). `npx tsc --noEmit` → 0.
**2.5** Frontend test-tree cleanup (plan-review finding 3 — `getClients` IS imported by two test files):
- `frontend/admin/__tests__/page.test.tsx` (:23,28,55,69): its "zero clients on /schedule" guard is superseded by e2e US-1 (Task 11) — trim the getClients-specific assertions (keep the rest of the page smoke test intact).
- `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` (:45,59): remove `getClients` from the api-client mock — Task 6 rewrites these describes anyway; land this edit in Task 2 to keep tsc green from here on.
- Verify: `grep -rnE "getClients\(" frontend apps 2>/dev/null` → zero matches (word-boundary distinguishes from `getClientsPaged`/`getClientsWithStats`).

### DoD
- Export gone (incl. test-tree imports), api-client suite green, frontend tsc green.
**2.6** Commit (from repo root): `chore(#140): delete dead getClients (per_page=100) from api-client`.

---

## Task 3: factory — filters + defaultSort options
### Classification: standard
### Required Docs
- Spec §5.1, §5.2 (binding key shape: `['clients', page, perPage, filters, sortBy, sortOrder]`)
- Existing factory: `frontend/admin/contexts/createPagedListContext.tsx` (read fully — you modify it)
- Existing tests: `frontend/admin/__tests__/createPagedListContext.test.tsx` (follow its patterns)

### Task Description
Extend `createPagedListContext` — existing 5 consumers must be BIT-IDENTICAL (keys, types, runtime).

**3.1** RED — add failing tests to `createPagedListContext.test.tsx` for a filters-configured context:
- initial state: `filters` equals defaults, `sortBy`/`sortOrder` equal `defaultSort` values.
- `setFilters(patch)` merges + resets page to 1 (fetch called with page 1).
- `resetFilters()` restores defaults + resets page.
- query key shape: `['items', 1, 20, filtersObj, 'name', 'asc']` — assert via `queryClient.getQueryCache().find({ queryKey: ['items'] })` key inspection or fetch-mock call args.
- a NON-filters context (existing style) key is UNCHANGED: `['items', 1, 10, null, 'asc']` (no filters slot, sortBy null) — the bit-identical pin.
- `defaultSort` absent → `sortBy` starts `null` (existing behavior pin).
- page-clamp parity (spec §5.2): delete last row of the only page-2 entry → page steps back to 1 (factory `:154-156` already implements the hand-rolled `:302-307` semantics — this test PINS it).

**3.2** GREEN — modify `createPagedListContext.tsx`:

```ts
export interface PagedListConfigWithFilters<T, F extends object> extends PagedListConfig<T> {
  /** Structured server filters — object goes into the query key wholesale (spec §5.2). */
  filters: { defaults: F };
  /** Initial sort — sent on the first fetch (dict tables keep null = server default). */
  defaultSort?: { sortBy: string; sortOrder: SortOrder };
}

export interface PagedListFiltersState<F> {
  filters: F;
  setFilters: (patch: Partial<F>) => void;
  resetFilters: () => void;
}

// Overloads: filters-configured factories expose filters state; classic don't.
export function createPagedListContext<T, F extends object>(
  config: PagedListConfigWithFilters<T, F>,
): { Provider: React.ComponentType<{ children: React.ReactNode }>; usePagedList: () => PagedListContextValue<T> & PagedListFiltersState<F> };
export function createPagedListContext<T>(
  config: PagedListConfig<T>,
): { Provider: React.ComponentType<{ children: React.ReactNode }>; usePagedList: () => PagedListContextValue<T> };
export function createPagedListContext<T, F extends object>(
  config: PagedListConfig<T> & Partial<PagedListConfigWithFilters<T, F>>,
) {
  // … single runtime implementation
```

Inside the implementation:
- Destructure `filtersDefaults = config.filters?.defaults as F | undefined`, `defaultSort`.
- `const [filters, setFiltersState] = useState<F | undefined>(filtersDefaults)`.
- `const [sortBy, setSortBy] = useState<string | null>(defaultSort?.sortBy ?? null)`; `const [sortOrder, setSortOrder] = useState<SortOrder>(defaultSort?.sortOrder ?? 'asc')`.
- Query key (order matters — filters slot AFTER perPage, BEFORE status):
```ts
const queryKey: unknown[] = [queryKeyPrefix, page, perPage];
if (filters !== undefined) queryKey.push(filters);
if (withStatus) queryKey.push(status);
queryKey.push(sortBy, sortOrder);
if (serverSearch) queryKey.push(q ?? '');
```
  (Existing no-filters consumers: identical arrays to today — verified by the 3.1 pin.)
- `queryFn` passes `...(filters !== undefined ? { filters } : {})` into the fetcher params — extend `PagedListFetcherParams` with `filters?: unknown` and type the configured fetcher as receiving `{ filters: F }` via the config interface (concrete: `PagedListConfigWithFilters` overrides `fetcher: (params: PagedListFetcherParams & { filters: F }) => Promise<PaginatedResponse<T>>`).
- `setFilters` callback: merge + `setPage(1)` (mirrors hand-rolled :126-129). `resetFilters`: `setFiltersState(filtersDefaults)` + `setPage(1)`.
- Include `filters`/`setFilters`/`resetFilters` in the context value ONLY when configured (spread conditionally: `...(filters !== undefined ? { filters, setFilters, resetFilters } : {})`). The classic overload type doesn't expose them; runtime extra members are harmless but keep the value memo-stable — build the object exactly as today plus the conditional spread.
- The `setSort`/`setPerPage`/`setStatus`/clamp logic: UNCHANGED. `defaultSort` note: `setSort` still works; the only delta is initial state.

**3.3** Run: `npx vitest run __tests__/createPagedListContext.test.tsx` → green (new + all existing). `npx tsc --noEmit` → 0 (the 5 existing factory files must compile untouched — if their inference breaks, fix the overload signatures, not the consumers).

**Typing note (plan-review finding 6b):** `PagedListConfig` is currently NOT exported and its `fetcher` takes base params — the sketch above must be adjusted at implementation time: export `PagedListConfig` (or inline its members), and instead of narrowing `fetcher` inside the interface extension, declare the with-filters overload's config as `Omit<PagedListConfig<T>, 'fetcher'> & { fetcher: (params: PagedListFetcherParams & { filters: F }) => Promise<PaginatedResponse<T>>; filters: { defaults: F }; defaultSort?: ... }`. The runtime implementation stays ONE function consuming `config.filters?.defaults`. Keep the public result types named (`PagedListFiltersState<F>` above) so Task 4's ClientsContext gets typed `filters: ClientFilters` without casts.

**3.4** Commit: `feat(#140): createPagedListContext filters + defaultSort options (overload-typed)`.

### DoD
- New factory tests green; existing factory consumers compile with ZERO edits (bit-identical pins asserted); tsc clean.

---

## Task 4: useClientsMutations + ClientsContext → factory + providers unmount + page mount
### Classification: standard
### Required Docs
- Spec §5.1, §5.3; mirror file `frontend/admin/hooks/useLocationsMutations.ts` (read fully)
- Current `frontend/admin/contexts/ClientsContext.tsx` (read fully — you delete/replace it; the ClientFilters type + defaultFilters MOVE)
- Current `frontend/admin/app/providers.tsx` + `__tests__/Providers.test.tsx`

### Task Description
**4.1** CREATE `frontend/admin/hooks/useClientsMutations.ts` — mirror `useLocationsMutations.ts` structure exactly (per-hook `useQueryClient`; `ApiError` 409 capture with `dependencies` parking + `onMutate` clear in `useDeleteClient`). Invalidations: EVERY hook onSuccess invalidates BOTH `qk.clients` AND `qk.records` (spec §5.3 — current :145-148 parity; records rows carry denormalized client name):

```ts
'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createClient, updateClient, patchClient, deleteClient, archiveClient,
  restoreClient, resolveDeleteClient, ApiError,
} from '@memo/api-client';
import type { ClientCreate, ClientUpdate, DependencyNode, ClientResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

const useInvalidateClients = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.clients });
    await queryClient.invalidateQueries({ queryKey: qk.records });
  };
};

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (data: ClientCreate) => createClient(data), onSuccess: invalidate });
}
export function useUpdateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientUpdate }) => updateClient(id, data),
    onSuccess: invalidate,
  });
}
export function usePatchClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => patchClient(id, data),
    onSuccess: invalidate,
  });
}
/** Dry-run hard delete (#207 §7.3): 204 (no deps) or 409 + tree parked in `dependencies`. */
export function useDeleteClient() {
  const invalidate = useInvalidateClients();
  const [dependencies, setDependencies] = useState<DependencyNode[] | null>(null);
  const mutation = useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onMutate: () => setDependencies(null),
    onSuccess: invalidate,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDependencies(err.dependencies);
      }
    },
  });
  return { ...mutation, dependencies };
}
export function useArchiveClient() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (id: string) => archiveClient(id), onSuccess: invalidate });
}
export function useRestoreClient() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (id: string) => restoreClient(id), onSuccess: invalidate });
}
export function useResolveDeleteClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, resolutions }: { id: string; resolutions: Record<string, string> }) =>
      resolveDeleteClient(id, resolutions),
    onSuccess: invalidate,
  });
}
```
(Adjust import names if api-client exports differ — check `endpoints.ts` signatures for createClient input type; `ClientResponse` return types on archive/restore like the context did.)

**4.2** REWRITE `frontend/admin/contexts/ClientsContext.tsx` — move `ClientFilters` interface + `defaultFilters` (verbatim from :24-52) into this file, then:

```tsx
'use client';
import { createPagedListContext } from './createPagedListContext';
import { getClientsWithStats } from '@memo/api-client';
import type { ClientWithStats } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

// (ClientFilters interface + defaultFilters — verbatim from the old file)

const { Provider, usePagedList } = createPagedListContext<ClientWithStats, ClientFilters>({
  queryKeyPrefix: qk.clients[0],
  fetcher: (p) =>
    getClientsWithStats({
      page: p.page,
      per_page: p.per_page,
      ...(p.sort_by ? { sort_by: p.sort_by, sort_order: p.sort_order } : {}),
      ...p.filters,
      // search→q rename (#212): ≥2 chars sends q; raw `search` suppressed after spread
      q: p.filters.search.length >= 2 ? p.filters.search : undefined,
      search: undefined,
    }),
  withStatus: false,                 // status lives inside the 12-field filters
  filters: { defaults: defaultFilters },
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },
  defaultPerPage: 20,
});

export const ClientsProvider = Provider;
/** Table list state (server-paginated, page-scoped). Lookup-by-id = useClient (hooks/useClient). */
export const useClientsTable = usePagedList;
```
Note: `defaultPerPage: 20` preserves the current page size (factory default is 10). DELETE everything else in the old file (mutations, page-clamp, dependencies parking, `useClients`).

**4.3** `frontend/admin/app/providers.tsx`: remove the `ClientsProvider` import + wrapper (:42 area). Tree becomes ErrorBoundary > UIProvider > QueryClientWithErrorReporting > PendingActionsProvider > UserSettingsProvider.
**4.4** `frontend/admin/__tests__/Providers.test.tsx` (:36-73): remove the ClientsProvider line from the hardcoded order assertion.
**4.5** `frontend/admin/app/(main)/clients/page.tsx`: `ClientsPage` wrapper becomes `<ClientsProvider><ScheduleProvider><Suspense>…` (ClientsProvider OUTERMOST — it feeds ClientsTable/Filters below); in `ClientsPageContent` replace `useClients()` with `useClientsTable()`; destructured `{ clients, setFilters, isPending, isFetching }` → `{ items, setFilters, isPending, isFetching }`; `clients.find(...)` (:54) → `items.find(...)`; `clients.length === 0` (:71) → `items.length === 0`. All deep-link effects (:31-75) stay verbatim.
**4.6** This task leaves ClientsTable/ClientsFilters/ClientCardModal compiling? NO — and ActivityDetailsModal.tsx :7 is a FOURTH consumer (plan-review r2 blocker: it only migrates in Task 6, breaking tsc + runtime at the 4+5 commit boundary). Clean cut, pre-production: land Tasks 4+5+6 as ONE atomic commit — execute all three in the same working session, commit together: `refactor(#140): /clients onto factory + useClientsMutations, per-tab modal resolution, unmount global ClientsProvider`. (Tasks separated in the plan for review clarity; Task 6's unit-test rewrite lands in the same commit.)
**4.7** Run after Task 5 lands: `npx vitest run __tests__/ClientsPage.test.tsx __tests__/Providers.test.tsx` (these two will have been re-based in Task 5), full `npm run test`, `npx tsc --noEmit`.

### DoD
- `contexts/ClientsContext.tsx` ≤ ~40 lines (factory file); providers.tsx has no ClientsProvider; page mounts it; components (Task 5) compile; suite green.

---

## Task 5: /clients components + test re-base (atomic with Task 4's commit)
### Classification: standard
### Required Docs
- Spec §5.1, §5.3, §5.4 (parking re-wiring), §8 (mock shift)
- `frontend/admin/__tests__/helpers/mockContexts.ts` (createMockClientsContext ~:150-200 — you replace it)
- `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`, `ClientsFilters.tsx`, `ClientCardModal.tsx` (read the useClients() usage regions)

### Task Description
**5.1** `ClientsTable.tsx` (:21-25): `useClients()` → `useClientsTable()` for state (`items, total, page, perPage, sortBy, sortOrder, isLoading, isPending, isFetching, error, refetch, setPage, setPerPage, setSort`); mutation destructuring (`deleteClient, archiveClient, restoreClient, resolveDeleteClient, dependencies`) → local hooks:
```ts
const deleteMutation = useDeleteClient();
const archiveMutation = useArchiveClient();
const restoreMutation = useRestoreClient();
const resolveDeleteMutation = useResolveDeleteClient();
const { dependencies } = deleteMutation;
```
Rewire call sites: `deleteClient(id)` → `await deleteMutation.mutateAsync(id)` (keep the existing 409-catch flow — `err.dependencies ?? dependencies ?? []` works: both now come from the local hook), `resolveDeleteClient(id, resolutions)` → `resolveDeleteMutation.mutateAsync({ id, resolutions })`, `archiveClient(id)`/`restoreClient(id)` → respective `mutateAsync(id)`. DeleteDialog props unchanged.
**5.2** `ClientsFilters.tsx` (:40): `useClients()` → `useClientsTable()`; same `filters`/`setFilters`/`resetFilters` names (factory provides all three). `ClientFilters` type import path unchanged (still exported from `@/contexts/ClientsContext`).
**5.3** `ClientCardModal.tsx` (:27): replace context mutations with the 7 local hooks (same rewire pattern as 5.1; `createClient`→`useCreateClient().mutateAsync`, `updateClient`→`useUpdateClient` with `{id, data}`, `patchClient` if used → `usePatchClient`). Records/activities queries (:91-105) → `useClientRecords(client?.id, isOpen && mode === 'view')` + `useActivitiesForRecords(records?.map(r => r.activity_id) ?? [])` (delete the two `useQuery` blocks + `getRecords`/`getActivity` imports).
**5.4** `helpers/mockContexts.ts`: DELETE `createMockClientsContext` + `ClientsContextType` import; ADD:
```ts
export function createMockClientsTableState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    items: [], visibleItems: undefined, total: 0, page: 1, perPage: 20,
    sortBy: 'name', sortOrder: 'asc' as const, status: 'active' as const,
    isPending: false, isLoading: false, isFetching: false, error: null, search: '',
    filters: { /* defaultFilters copy */ search: '', status: 'active', created_from: '', created_to: '', updated_from: '', updated_to: '', min_records: null, max_records: null, min_paid: null, max_paid: null, missed_from: null, missed_to: null },
    setPage: vi.fn(), setPerPage: vi.fn(), setSort: vi.fn(), setStatus: vi.fn(),
    setSearch: vi.fn(), setFilters: vi.fn(), resetFilters: vi.fn(), refetch: vi.fn(),
    ...overrides,
  };
}
```
**5.5** Re-base the 5 mock-consuming suites onto real provider or the new fixture:
- `ClientsFilters.test.tsx`, `ClientsTable.test.tsx`, `ClientsPage.test.tsx`, `ClientsIntegration.test.tsx`, `ClientCardModal.test.tsx`: replace `vi.mock('@/contexts/ClientsContext')` + `createMockClientsContext` with EITHER mounting the real `ClientsProvider` (preferred for page/integration — mock `@memo/api-client` fetchers instead) OR `vi.mock` the new factory export returning `createMockClientsTableState()`. Mutation consumers mock `@/hooks/useClientsMutations` at hook level (`vi.mock('@/hooks/useClientsMutations', ...)` returning spies with `mutateAsync: vi.fn()` + `dependencies: null`).
- DELETE `__tests__/ClientsContext.test.tsx` (427 ln) — coverage moves to factory tests (Task 3) + useClientsMutations suite + page integration.
**5.6** ADD `__tests__/useClientsMutations.test.tsx`: for each of the 7 hooks — success path invalidates BOTH `['clients']` and `['records']` (spy on `queryClient.invalidateQueries`); `useDeleteClient` 409 parks `dependencies` (`ApiError` mock with `status: 409, dependencies: [...]`) and `onMutate` clears a prior tree. Follow `useLocationsMutations` test patterns if a suite exists; else useReactQueryHooks patterns.
**5.7** Run: `npm run test` (full) → green; `npx tsc --noEmit`; `npm run lint`.
**5.8** Commit (TOGETHER with Tasks 4 and 6 — single atomic commit, see 4.6): `refactor(#140): /clients onto factory + useClientsMutations, per-tab modal resolution, unmount global ClientsProvider`.

### DoD
- Zero `useClients(` references remain (`grep -rn "useClients(" frontend/admin` → empty; `useClientsTable` only). ClientsContext.test.tsx deleted. At the atomic commit point: full suite + tsc green (ActivityDetailsModal migrated in the same commit per 4.6).

---

## Task 6: ActivityDetailsModal — per-tab client resolution
### Classification: standard
### Required Docs
- Spec §5.4 (THE design), §6 US-2, §8 (test rewrite)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` (read fully), `ClientTab.tsx`
- `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` :470-660 (pins you delete/rewrite)

### Task Description
**6.1** RED — rewrite the affected describes in `ActivityDetailsModal.test.tsx`:
- Mock `@/hooks/useClient` (and `useActivityRecords` if not exercised via provider mocks) at module level: `useClient` returns configurable `{ data, isPending, isError }`.
- New pins: (a) tab strip renders ALL record tabs immediately with placeholder while client pending; (b) each tab label/content shows resolved name+phone when `useClient` resolves — INCLUDING non-active tabs (US-2 core); (c) «Без контакта» appears ONLY when `useClient` errors; (d) zero dependence on any clients list (`useClientsTable` NOT called — assert the module isn't imported).
**6.2** GREEN — modify `ActivityDetailsModal.tsx`:
- Remove `useClients()` import/usage + `clientsWithStats` map (:68-70 region) + the `fallbackClient` query (:81-88).
- Records: `useQuery(['records','activity',...])` → `useActivityRecords(activity.id, isOpen)`.
- Tab strip labels: introduce a small component IN THIS FOLDER (`ClientLabelById.tsx`):
```tsx
'use client';
import { useClient } from '@/hooks/useClient';
/** Progressive client label for a record tab (spec §5.4): «…» → name; «Без контакта» on error OR no client_id. */
export function ClientLabelById({ clientId }: { clientId: string | undefined }) {
  const { data, isPending, isError } = useClient(clientId);
  if (!clientId || isError) return <>Без контакта</>;
  if (isPending || !data) return <>…</>;
  return <>{data.name || 'Дорогой гость'}</>;
}
```
  Tab label uses `<ClientLabelById clientId={record.client_id} />` (check the current label builder — preserve any phone formatting the tab strip already shows; if the current strip shows only the name, keep only the name).
- `ClientTab.tsx`: resolve its client via `useClient(record.client_id)` (progressive: «…»/«Без контакта» states, same as ClientLabelById incl. the `!client_id` → «Без контакта» rule); its activity query (:72-76) → `useActivity(record?.activity_id)`. The `client` PROP from the modal's map is removed — ClientTab owns resolution.
  **Stats re-source (plan-review r1-f2 + r2-f3 decision):** `useClient` returns `ClientResponse` (no `records_count/missed_records/last_record/total_paid`), and ClientStatistics renders an all-«—» grid when `stats` is undefined — a visible regression for first-20 clients, and per-record fabrication is forbidden. DECISION: ClientTab derives REAL client aggregates from data it can load via the new hooks: `useClientRecords(clientId)` (already created in Task 1) → `recordsCount = clientRecords.length`, `lastRecord = max(record.start_time)` (check the field the modal already displays dates from), `missedRecords`/`totalPaid` from the visits/payments the tab already loads aggregated over those records (same 100-record window the records list uses — consistent with current data horizon). NEVER fabricate a per-record value as a client aggregate. If a field is genuinely underivable, omit it («—») — uniform for ALL clients, fixing today's inconsistency (stats previously only for first-20 clients).
  **Anonymous-record rule (plan-review finding 4):** records with `client_id == null` → label and tab show «Без контакта» immediately (no query, no «…»). Apply in BOTH `ClientLabelById` and ClientTab: `if (!clientId) return <>Без контакта</>`.
- Keep `window.open('/clients?clientId=' + id)` (:119) and all settings-tab logic untouched.
**6.3** Run: `npx vitest run __tests__/ActivityDetailsModal.test.tsx` → green; then full `npm run test`; `npx tsc --noEmit`.
**6.4** Commit: TOGETHER with Tasks 4+5 (single atomic commit, see 4.6).

### DoD
- Modal has zero clients-list dependency (`useClients`/`useClientsTable` absent from the module); per-tab resolution unit-pinned (incl. anonymous-record «Без контакта»); suite + tsc green at the atomic commit. E2E for US-2 is Task 11.

---

## Task 7: records surfaces + ScheduleContext + PhotosContext key/raw migration
### Classification: standard
### Required Docs
- Spec §4 map (rows: ClientQuickCard, BookingFilters, useRecordData, ScheduleContext, PhotosContext), §5.5
- `frontend/admin/contexts/ScheduleContext.tsx` :265-300 (dict query region), `frontend/admin/contexts/PhotosContext.tsx` :140-160

### Task Description
**7.1** `ClientQuickCard.tsx` (:41-64): replace the four `useQuery` blocks with `useClient(clientId)`, `useClientRecords(clientId)`, `useActivitiesForRecords(clientRecords.map(r => r.activity_id))`, `usePaymentTotals(recordIds)` — preserve local variable names/destructuring (`client`, `clientRecords`, `recordActivities`, paymentTotals) so the rest of the file is untouched. Delete now-unused api-client imports.
**7.1b** Visitors-prefix invalidations (plan-review finding 1 — two surfaces, NOT in ClientQuickCard):
- `app/components/modal/ActivityDetailsModal/ClientTab.tsx:118` `invalidateQueries({ queryKey: ['visitors', clientId] })` → `qk.visitors(clientId)` (land with Task 6's ClientTab edit if Task 6 runs first; this line is the ownership anchor either way).
- `app/(main)/clients/components/ClientRecordTab.tsx:172` `invalidateQueries({ queryKey: ['visitors', clientId] })` → `qk.visitors(clientId)` + migrate any other inline entity keys in that file (grep it).
**7.2** `BookingFilters.tsx` (:56-70): the three raw `useQuery` blocks → `const { data: locations = [] } = useLocationsRaw();` etc. Keep the downstream `!archived` filters + label transforms verbatim (:71+). staleTime note: 5min → 1h via the hook (accepted §7.5).
**7.3** `ScheduleContext.tsx` (NO restructure — #141 owns it):
- `:270-272` activities `useQuery` key → `qk.activityRange(weekStart, weekEnd)` (keep the local `activityQueryKey` variable — used at :310-367 — just build it via qk).
- `:273-287` the three dict raw `useQuery` blocks → `useMastersRaw()`/`useServicesRaw()`/`useLocationsRaw()` (preserve destructured names like `mastersRaw = []`).
- `:290-292` `useMasters`/`useServices`/`useLocations` calls: UNCHANGED (already hooks).
- Any other inline key in the file → qk (grep it).
**7.4** `PhotosContext.tsx`: `:148-157` two dict queries → `useServicesRaw()`/`useLocationsRaw()` (staleTime Infinity → 1h, accepted §7.5); `:82` `refetchQueries(['photos'])` → `qk.photos`; `:86` key prefix → `qk.photos[0]` (the object params `{ page, perPage, sortBy, ... }` in the key stay verbatim).
**7.4b** Remaining context/component key literals (spec §4 map completeness — the 10.1 gate requires them):
- `contexts/RecordsContext.tsx` :80: `queryKey: ['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` → `queryKey: [qk.records[0], page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` (first element sourced; rest are state params). Also its `:73` `refetchQueries(['records'])` → `qk.records`.
- 5 dict factory contexts (`TagsContext`/`MastersContext`/`LocationsContext`/`ServicesContext`/`MaterialsContext`): `queryKeyPrefix: 'tags'` etc. → `queryKeyPrefix: qk.tags[0]` etc. (import qk; one line each).
- 4 dict tables (refetch-after-reorder handlers): `MastersTable.tsx` :212-213, `ServicesTable.tsx` :202-203, `LocationsTable.tsx` :234-235, `MaterialsTable.tsx` :191 — inline `invalidateQueries({ queryKey: ['masters'] })`/`['records']` etc. → `qk.masters`/`qk.records` etc.
**7.5** Run: `npx vitest run __tests__/BookingFilters.test.tsx __tests__/ClientQuickCard.test.tsx __tests__/PhotosContext.test.tsx __tests__/scheduleIntegration.test.tsx` (plus any ScheduleContext suite: `ls __tests__ | grep -i schedule`) → green (adjust mock setup only if suites mock the deleted inline queries — they should mock `@memo/api-client`, which still works through the hooks). Full `npm run test`; `npx tsc --noEmit`.
**7.6** Commit: `refactor(#140): records/photos/schedule surfaces + dict contexts onto hooks + qk keys`.

### DoD
- Zero direct `useQuery` outside hooks/contexts in these files; keys qk-sourced; suites green.

---

## Task 8: photos components — raw hook adoption
### Classification: small
### Required Docs
- Spec §4 map (PhotosFilters/PhotoModal rows), §6.2 (typeaheads stay direct calls)

### Task Description
**8.1** `PhotosFilters.tsx` (:35-39): `useQuery<TagResponse[]>({ queryKey: ['tags'], ... })` → `const { data: tags = [] } = useTagsRaw();` — delete the `useQuery` import if now unused. The `getClientsPaged`/`getActivities` typeahead callbacks (:93-98 etc.) stay DIRECT api-client calls (spec §6.2 — out of scope).
**8.2** `PhotoModal.tsx` (:252-257): `useQuery<LocationResponse[]>({ queryKey: ['locations'], staleTime: Infinity })` → `const { data: locations = [] } = useLocationsRaw();`. The `getClientsPaged` searchFn (:131) stays.
**8.3** Run: `npx vitest run __tests__/PhotoModal.test.tsx` + photos filter suites → green; `npx tsc --noEmit`.
**8.4** Commit: `refactor(#140): photos components onto raw dict hooks`.

### DoD
- `grep -rn "useQuery(" frontend/admin/app` → ZERO hits (all components now clean — the DoD gate 3).

---

## Task 9: useRecordMutations — quick-add staleness fix
### Classification: small
### Required Docs
- Spec §5.6; `frontend/admin/hooks/useRecordMutations.ts` :78-145 (createRecord flow)

### Task Description
**9.1** RED — in the `useRecordMutations` suite (find it: `grep -rln "useRecordMutations" frontend/admin/__tests__`): add tests — record creation via the NEW-CLIENT path invalidates `['clients']` for BOTH branches: (a) phone-409 catch branch (:90-95) and (b) phone-less quick-add `else` branch (:97-104); the EXISTING-client branch (getClientByPhone hits, :87-88) does NOT.
**9.2** GREEN — in `createRecordMutation`, set a `let createdClientId: string | null = null` in BOTH client-created branches (assign the created client's id); after the record succeeds:
```ts
if (createdClientId !== null) {
  await queryClient.invalidateQueries({ queryKey: qk.clients });
}
```
(awaited — mutation stays pending until refetch lands, US-6 "immediately visible"; covers both create branches, skips the existing-client reuse path).
**9.3** Run the suite → green; `npx tsc --noEmit`.
**9.4** Commit: `fix(#140): schedule quick-add client creation invalidates clients list (staleness fix)`.

### DoD
- Unit pin green (both branches). E2E US-6 is Task 11.

---

## Task 10: sweep — key-equality pins, grep gates, full unit suite
### Classification: standard
### Required Docs
- Spec §8, §10 (acceptance gates 3-4)

### Task Description
**10.1** Grep gates (all must be EMPTY; patterns account for generic-annotated calls `useQuery<T>(` and must NOT match `useQueryClient`):
- `grep -rnE "useQuery[<(]" frontend/admin/app | grep -v __tests__` → zero (components never call useQuery; the `[<(]` excludes useQueryClient).
- `grep -rnE "queryKey: ?\['(clients|records|masters|services|locations|materials|tags|photos|client|record|activity|activities|visitors|payments)'" frontend/admin/hooks frontend/admin/contexts frontend/admin/app frontend/admin/lib | grep -v __tests__ | grep -v queryKeys.ts` → zero (all entity key literals live in lib/queryKeys.ts).
**10.2** Extend `useReactQueryHooks.test.tsx` if any Task-1 pin is missing for pairs migrated later (PhotosContext raw usage is covered by 7-task suites; hooks-only pins suffice).
**10.3** Full local gates: `npm run test` (full vitest), `npx tsc --noEmit`, `npm run lint`, `cd packages/api-client && npx vitest run && npx tsc --noEmit`. All green.
**10.4** Commit (if anything needed adjusting): `test(#140): sweep gates + key-equality pins`.

### DoD
- Both grep gates empty; full unit/type/lint green.

---

## Task 11: e2e US-1/US-2/US-6 + ARCHITECTURE.md docs
### Classification: standard
### Required Docs
- Spec §6 (US mapping — THE binding table), §9 (docs section), §6.3 (assumptions note)
- Skill: `vitest-playwright-patterns` (e2e Full Cycle pattern)
- Existing e2e: `frontend/admin/e2e/clients.spec.ts` (19 tests — helpers/factories), `frontend/admin/e2e/activity-details-modal.spec.ts` (modal-open pattern), `frontend/admin/e2e/unify-caches.spec.ts` (network-guard patterns US-6/US-7 :409-556)

### Task Description
**11.1** RED-GREEN e2e **US-1** (add to `clients.spec.ts`): navigate DIRECTLY to `/schedule`; collect requests matching `**/api/v1/clients*`; assert zero after load settles (networkidle + small buffer):
```ts
test('US-1: /schedule fires zero clients requests', async ({ page }) => {
  const clientsRequests: string[] = [];
  page.on('request', (req) => { if (req.url().includes('/api/v1/clients')) clientsRequests.push(req.url()); });
  await page.goto('/schedule');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(clientsRequests).toHaveLength(0);
});
```
(Follow the file's existing auth/baseURL setup helpers; adapt to its fixture conventions.)
**11.2** RED-GREEN e2e **US-2** (add to `activity-details-modal.spec.ts`): seed 21+ active clients via API (`request.post('/api/v1/clients', ...)` — follow existing factory helpers in clients.spec.ts; unique names `us2-client-XX` so default name-sort puts the target beyond position 20); create one activity + one record whose client is the LAST seeded one (follow this spec's existing activity/record seeding); open the activity modal from /schedule (existing pattern); assert the record tab shows the client's name and phone (not «Без контакта»), and the tab label resolves.
**11.3** RED-GREEN e2e **US-6** (add to `clients.spec.ts`): on `/schedule`, use the quick-add flow to create a booking with a NEW client (name+phone; follow the quick-add/new-booking pattern used in existing specs — see records.spec.ts / schedule creation tests); then navigate to /clients via **SPA navigation** (`page.click` on the sidebar/nav link to /clients — NOT `page.goto`, which full-reloads and recreates the QueryClient, making the invalidation path vacuous); assert the new client's name is visible in the table WITHOUT reload (default status filter = active; new client is active; default sort name/asc). The 9.1 unit pin is the primary invalidation gate; this e2e guards the user-visible flow.
**11.4** Run the three (serially if the repo convention: `npx playwright test e2e/clients.spec.ts -g "US-" e2e/activity-details-modal.spec.ts` per local conventions; e2e env per `dev-workflow` / tester). Then the full affected specs: clients.spec.ts (now 20+ tests — all 19 originals green UNEDITED), clients-delete-cascade, clients-delete-invalid-resolution, admin-opens-profile, unify-caches, records-view (US-2 per_page=100 guard stays green), archive-restore-parity, wave6-status-shared.
**11.5** ADD `## Data Access Patterns` section to `docs/ARCHITECTURE.md` (~40 lines, after `## Separation Principles` block): hook taxonomy table (lookup `use<Entity>` / raw `use<Entity>Raw` / point hooks / `use<Entity>Table` / `use<Entity>Mutations`), the rule «components never call `useQuery` or write query-key literals — they use hooks; keys live only in `frontend/admin/lib/queryKeys.ts`», `DICT_STALE_TIME = 1h` rationale + own-mutation-invalidation assumption (no WebSocket/SSE — #239), shared-key staleTime-alignment caveat, framing note (2026 TanStack guidance leans `queryOptions`; this codebase standardizes on thin hooks + central qk — explicit team-governance choice).
**11.6** Commit: `test(#140): e2e US-1/US-2/US-6 + docs: data-access patterns section` (two commits if cleaner: `test(#140): …` and `docs(#140): …`).

### DoD
- 3 new e2e green; all listed existing suites green unedited; ARCHITECTURE.md section merged. Spec DoD 1-8 all satisfied.

---

## Final Gate (after Task 11 — architect runs)
- Full local fast suites per finishing policy (vitest full, tsc, lint, api-client, backend untouched → skip pytest if zero backend diffs, else run).
- Visual compliance: N/A (spec marks it) — clients visual baselines must stay pixel-green via e2e visual-regression spec.
- PR: single PR `refactor(#140): unify server-data access on entity hooks, dissolve ClientsContext` — closes #140.
