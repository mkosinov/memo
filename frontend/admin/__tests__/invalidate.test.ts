import { describe, it, expect, vi } from 'vitest';
import { INVALIDATION_MAP, invalidateEntities } from '@/lib/invalidate';
import { qk } from '@/lib/queryKeys';
import { QueryClient } from '@tanstack/react-query';

/**
 * Drift guard (spec §4.1): the backend canonical entity list —
 * backend/src/events/entities.py. Backend emits 14 names incl. `users`
 * (MasterService.archive/restore also flips user.is_active); `users` has NO
 * frontend query family (no users query exists in the admin cache), so the
 * map covers the other 13 and unknown names are skipped at runtime by
 * invalidateEntities (dev-mode log).
 */
const BACKEND_ENTITIES = [
  'clients', 'records', 'activities', 'masters', 'services', 'locations',
  'materials', 'tags', 'photos', 'visitors', 'visits', 'payments', 'user_settings',
];
const BACKEND_ONLY_NO_FRONTEND_CACHE = ['users'];

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
});
