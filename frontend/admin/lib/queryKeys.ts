// Single source of truth for entity query keys (GH #140, spec §4).
// ORTHOGRAPHY-ONLY: key shapes, raw/domain key-sharing and prefix-invalidation
// semantics MUST NOT change — a different shape breaks dedupe/invalidation.
//
// Hook taxonomy (naming rules — canonical location, ARCHITECTURE.md links here):
//   use<Entity>           domain-selected lookup (archived dropped, domain types)
//   use<Entity>Raw        raw response (archived included), SAME key as lookup
//   use<Entity>Table      factory paged-list state (createPagedListContext)
//   use<Entity>Mutations  mutation family
//   point hooks (useClient, useActivity, …) — single-entity reads
// `useClients` is PERMANENTLY RESERVED-VACANT (list = useClientsTable).
//
// Raw/lookup hook pairs share a key ⇒ they MUST share staleTime
// (shared-key observers take the most pessimistic value).
// Dictionary staleTime = 1 hour: a load-reduction default only —
// external updates arrive via the SSE invalidation channel (#239),
// and family invalidation rules live in lib/invalidate.ts
// (INVALIDATION_MAP — single source for SSE + own mutations).

export const DICT_STALE_TIME = 60 * 60 * 1000;

export const qk = {
  // ── Point keys ──
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
  // ── List prefixes (factory contexts + invalidation targets) ──
  clients: ['clients'] as const,
  records: ['records'] as const,
  masters: ['masters'] as const,
  // GH #266: the staff directory has its OWN paged-list family (StaffContext,
  // queryKeyPrefix 'staff'). Distinct from `masters` (the read-only acting-master
  // view the schedule filters consume). A staff write invalidates BOTH.
  staff: ['staff'] as const,
  // GH #266: positions dictionary prefix — shared by the /all lookup
  // (hooks/usePositions.ts: StaffModal checkboxes, StaffTable cells) and the
  // paged dictionary screen (contexts/PositionsContext.tsx, T9). NOT in the SSE
  // invalidate map (spec «SSE-сущности»: positions/staff_positions omitted —
  // the frontend mirror has no positions family); own mutations invalidate the
  // prefix directly (hooks/usePositionsMutations.ts).
  positions: ['positions'] as const,
  services: ['services'] as const,
  locations: ['locations'] as const,
  materials: ['materials'] as const,
  tags: ['tags'] as const,
  photos: ['photos'] as const,
  visitorsList: ['visitors'] as const, // prefix invalidation (useDeleteRecord)
} as const;
