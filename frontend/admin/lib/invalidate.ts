/**
 * Shared invalidation map — single source of family-level cache invalidation
 * rules (GH #239, spec §4.1/D1, §2.7). Consumed by BOTH the SSE provider
 * (server-push events) and the own-mutation sites (hooks + tables).
 *
 * Rule for future code (binding): family cascade → this table;
 * id / condition → the hook (point keys like qk.record(id) and conditional
 * extras stay in the mutation hooks, layered ON TOP of invalidateEntities).
 *
 * Family = a query-key prefix that covers every reader of the entity:
 *   ['activities'] covers activityRange(weekStart, weekEnd) +
 *   activitiesForRecords(ids); ['payments'] covers recordPayments(id) +
 *   paymentTotals(ids); ['visitors'] covers visitors(clientId).
 * Singular point keys (['record', id], ['client', id], ['activity', id]) are
 * NOT prefix-covered — accepted limitation (spec §4.1): an external change
 * does not refetch an open detail modal; detail views converge on next open.
 *
 * Sets may be slightly WIDER than any single call site's old set — correct
 * for external events, one cheap extra refetch for own mutations (spec §2.7).
 * Seeded from the live-tree audit of all former invalidateQueries sites.
 */
import type { QueryClient } from '@tanstack/react-query';
import { qk } from './queryKeys';

/** Mirrors the backend canonical entity names (backend/src/events/entities.py)
 *  MINUS `users` — the backend emits it (MasterService.archive/restore also
 *  flips user.is_active) but the frontend has no users query family; the
 *  runtime skip below handles it (spec §5: unknown entity → skip + dev log).
 *  Kept in sync by the drift-guard test __tests__/invalidate.test.ts. */
export type EntityName =
  | 'clients'
  | 'records'
  | 'activities'
  | 'masters'
  | 'services'
  | 'locations'
  | 'materials'
  | 'tags'
  | 'photos'
  | 'visitors'
  | 'visits'
  | 'payments'
  | 'user_settings';

/**
 * FAMILY RULES — audited union per entity (site → former invalidation set):
 * - clients:     useClientsMutations.ts (every mutation: ['clients'] + ['records'])
 * - records:     useDeleteRecord.ts (['records'] + ['visitors'] — the visits
 *                cascade shrinks per-client visitor counts); hooks keep the
 *                point key ['record', id] ON TOP
 * - activities:  ScheduleDataContext.tsx (activityRange prefix — covers
 *                activitiesForRecords readers too)
 * - masters:     useMastersMutations.ts + MastersTable.tsx
 *                (delete/resolve also refresh ['records'] via useRecordData)
 * - services:    useServicesMutations.ts (#223: create/update also touch
 *                ['materials'] — «Где используется» counters; delete also
 *                ['records']) + ServicesTable.tsx
 * - locations:   useLocationsMutations.ts + LocationsTable.tsx
 *                (delete/resolve also refresh ['records'])
 * - materials:   useMaterialsMutations.ts + MaterialsTable.tsx
 * - tags:        useTagsMutations.ts
 * - photos:      usePhotosMutations.ts
 * - visitors:    ['visitors'] prefix (visitors(clientId) readers)
 * - visits:      no ['visits'] family exists — a visit write recalcs the
 *                parent record (backend VisitService hooks mark `records`)
 * - payments:    ['payments'] covers recordPayments(id) + paymentTotals(ids);
 *                plus ['records'] (R4/US-4: RecordsTable reads `paid` from
 *                the view row — useRecordMutations payment paths)
 * - user_settings: no query family — UserSettingsContext syncs itself
 */
export const INVALIDATION_MAP: Record<EntityName, readonly (readonly unknown[])[]> = {
  clients: [qk.clients, qk.records],
  records: [qk.records, qk.visitorsList],
  activities: [['activities']],
  masters: [qk.masters, qk.records],
  services: [qk.services, qk.materials, qk.records],
  locations: [qk.locations, qk.records],
  materials: [qk.materials],
  tags: [qk.tags],
  photos: [qk.photos],
  visitors: [qk.visitorsList],
  visits: [qk.records],
  payments: [['payments'], qk.records],
  user_settings: [],
};

/**
 * Invalidate the family prefixes for the given entity names.
 * Deduplicates identical families across the union of the entries;
 * unknown names (runtime JSON past the TS union — e.g. backend-only
 * `users`) are skipped with a dev-mode warning (spec §5).
 */
/** Shared walk of the map: dedupes identical families across the union and
 *  skips unknown names (runtime JSON past the TS union — e.g. backend-only
 *  `users`) with a dev-mode warning (spec §5). Single source of the
 *  semantics shared by the sync and awaitable variants. */
function distinctFamilies(entities: readonly string[]): readonly (readonly unknown[])[] {
  const result: (readonly unknown[])[] = [];
  const seen = new Set<readonly unknown[]>();
  for (const e of entities) {
    const families = INVALIDATION_MAP[e as EntityName];
    if (!families) {
      if (process.env.NODE_ENV !== 'production')
        console.warn('[events] unknown entity', e);
      continue;
    }
    for (const k of families) {
      if (!seen.has(k)) {
        seen.add(k);
        result.push(k);
      }
    }
  }
  return result;
}

/**
 * Invalidate the family prefixes for the given entity names (fire-and-forget;
 * the SSE provider uses this).
 */
export function invalidateEntities(qc: QueryClient, entities: readonly string[]): void {
  for (const k of distinctFamilies(entities))
    void qc.invalidateQueries({ queryKey: k });
}

/**
 * Awaitable variant (GH #140 contract, #239 quality round): resolves only
 * after every family's refetch has landed, so `mutateAsync().then()` sees
 * fresh cache. Same dedup + unknown-entity semantics as invalidateEntities.
 * Used at own-mutation sites where awaiting was the pre-existing contract.
 */
export async function invalidateEntitiesAsync(
  qc: QueryClient,
  entities: readonly string[],
): Promise<void> {
  for (const k of distinctFamilies(entities))
    await qc.invalidateQueries({ queryKey: k });
}
