import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  INVALIDATION_MAP,
  invalidateEntities,
  invalidateEntitiesAsync,
} from '@/lib/invalidate';
import { qk } from '@/lib/queryKeys';
import { QueryClient } from '@tanstack/react-query';

/**
 * Drift guard (spec §4.1): the backend canonical entity list —
 * backend/src/events/entities.py. Backend emits 16 names (GH #266: +staff,
 * +positions) incl. `users` (StaffService.archive/restore also flips
 * user.is_active) and `positions` (PositionService — admin has no positions
 * query family); they have NO frontend query family, so the map covers the
 * other 14 and unknown names are skipped at runtime by invalidateEntities
 * (dev-mode log).
 */
const BACKEND_ENTITIES = [
  'clients', 'records', 'activities', 'masters', 'services', 'locations',
  'materials', 'tags', 'photos', 'visitors', 'visits', 'payments', 'user_settings',
  'staff',
];
const BACKEND_ONLY_NO_FRONTEND_CACHE = ['users', 'positions'];

describe('INVALIDATION_MAP', () => {
  it('targets are real qk exports or real query-family prefixes', () => {
    // Factory-produced keys (sample args) — proves a raw single-element
    // prefix actually covers existing queries. ['activities'] is the shared
    // prefix of activityRange + activitiesForRecords; ['payments'] of
    // recordPayments + paymentTotals (no qk export exists for these two
    // families — they live only as prefixes of parameterized factories).
    const factoryKeys = [
      qk.client('x'), qk.clientRecords('x'), qk.activityRecords('x'),
      qk.paymentTotals(['x']), qk.activitiesForRecords(['x']), qk.activity('x'),
      qk.activityRange('a', 'b'), qk.visitors('x'), qk.recordPayments('x'),
      qk.record('x'),
    ];
    const qkExports = new Set<unknown>(Object.values(qk));
    for (const keys of Object.values(INVALIDATION_MAP)) {
      for (const k of keys) {
        const ok =
          qkExports.has(k) || factoryKeys.some((f) => f[0] === k[0]);
        expect(
          ok,
          `invalidation target ${JSON.stringify(k)} is neither a qk export nor a real family prefix`,
        ).toBe(true);
      }
    }
  });

  it('mirrors the backend entity list (drift guard)', () => {
    for (const e of BACKEND_ENTITIES) expect(INVALIDATION_MAP).toHaveProperty(e);
    for (const e of BACKEND_ONLY_NO_FRONTEND_CACHE)
      expect(INVALIDATION_MAP).not.toHaveProperty(e);
  });

  it('pins every entry to its EXACT family set (dropping one fails)', () => {
    // Per-entry value assertions — each entry's families are pinned
    // exhaustively, so removing or swapping a family breaks this test.
    const expected: Record<string, readonly (readonly unknown[])[]> = {
      clients: [qk.clients, qk.records],
      records: [qk.records, qk.visitorsList],
      activities: [['activities']],
      masters: [qk.masters, qk.records],
      staff: [qk.masters, qk.records],
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
    for (const [entity, families] of Object.entries(expected)) {
      for (const family of families)
        expect(
          INVALIDATION_MAP[entity as keyof typeof INVALIDATION_MAP],
          `map['${entity}'] should contain ${JSON.stringify(family)}`,
        ).toContainEqual(family);
      expect(
        INVALIDATION_MAP[entity as keyof typeof INVALIDATION_MAP],
        `map['${entity}'] should have exactly ${families.length} families`,
      ).toHaveLength(families.length);
    }
  });
});

describe('invalidateEntities', () => {
  it('invalidates each family prefix via the query client', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    // records → [qk.records, qk.visitorsList]; visits → [qk.records] (no
    // visits prefix — a visit write recalcs the parent record).
    invalidateEntities(qc, ['records', 'visits']);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.records });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.visitorsList });
    expect(spy).toHaveBeenCalledTimes(2); // one per DISTINCT family in the union
  });

  it('deduplicates shared family targets across the union', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    // masters → [qk.masters, qk.records]; services → [qk.services, qk.materials, qk.records]
    invalidateEntities(qc, ['masters', 'services']);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.masters });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.services });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.materials });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.records });
    expect(spy).toHaveBeenCalledTimes(4); // qk.records deduped
  });

  it('skips unknown entity names with a dev-mode warning', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invalidateEntities(qc, ['users', 'no_such_entity']);
    expect(spy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('user_settings maps to no family (context syncs itself)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateEntities(qc, ['user_settings']);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['activities', [['activities']] as const],
    ['payments', [['payments']] as const],
  ] as const)(
    "literal prefix family for '%s' is invalidated with exactly that queryKey",
    (entity, [family]) => {
      const qc = new QueryClient();
      const spy = vi.spyOn(qc, 'invalidateQueries');
      invalidateEntities(qc, [entity]);
      // ['activities'] covers activityRange + activitiesForRecords;
      // ['payments'] covers recordPayments + paymentTotals — no qk export
      // exists for these families, they are literal prefixes (see FAMILY
      // RULES header in lib/invalidate.ts). payments additionally invalidates
      // qk.records (R4/US-4).
      expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toContainEqual(
        family,
      );
    },
  );
});

describe('invalidateEntitiesAsync', () => {
  let qc: QueryClient;
  let spy: Mock;

  beforeEach(() => {
    qc = new QueryClient();
    spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  });

  it('resolves only after every family refetch has landed (GH #140 contract)', async () => {
    let recordsLanded = false;
    let visitorsLanded = false;
    spy.mockImplementation(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey === qk.records) {
        await new Promise((r) => setTimeout(r, 20));
        recordsLanded = true;
      } else if (queryKey === qk.visitorsList) {
        await new Promise((r) => setTimeout(r, 5));
        visitorsLanded = true;
      }
      return undefined;
    });

    await invalidateEntitiesAsync(qc, ['records']);
    // GH #140: mutateAsync().then() must run AFTER the refetches land.
    expect(recordsLanded).toBe(true);
    expect(visitorsLanded).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps dedup + unknown-entity semantics of the sync variant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await invalidateEntitiesAsync(qc, ['masters', 'services', 'users']);
    // masters → [qk.masters, qk.records]; services → [qk.services,
    // qk.materials, qk.records] — qk.records deduped; 'users' skipped.
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toEqual([
      qk.masters,
      qk.records,
      qk.services,
      qk.materials,
    ]);
    expect(warn).toHaveBeenCalled();
  });
});
