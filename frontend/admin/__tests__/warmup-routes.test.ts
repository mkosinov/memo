import { describe, it, expect } from 'vitest';
import { WARMUP_ROUTES } from '../e2e/fixtures/warmup-routes';

describe('WARMUP_ROUTES', () => {
  it('contains the 9 canonical routes in the same order as e2e-shard-start.sh', () => {
    expect(WARMUP_ROUTES).toEqual([
      '/',
      '/schedule',
      '/clients',
      '/records',
      '/services',
      '/masters',
      '/locations',
      '/tags',
      '/photos',
    ]);
  });

  it('has exactly 9 routes, all starting with "/"', () => {
    expect(WARMUP_ROUTES).toHaveLength(9);
    for (const route of WARMUP_ROUTES) {
      expect(route.startsWith('/')).toBe(true);
    }
  });
});
