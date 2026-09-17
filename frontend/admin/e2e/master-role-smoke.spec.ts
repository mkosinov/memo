/**
 * master-role-smoke.spec.ts — GH #263 T8: smoke for the master e2e
 * infrastructure (T9/T10 build the S1–S8 scenarios on top of it).
 *
 * Proves the full master-session harness: globalSetup logged the seeded
 * demo master (#247 §3.11, +79990000002) in, the shard-scoped storageState
 * file exists and carries a LIVE session — the guarded /auth/me answers
 * 200 with user.role === 'master'. Request-helper conventions follow
 * auth-session.spec.ts (page.request shares the context's storageState
 * cookies and correct fetch metadata).
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('GH #263 T8 — master session smoke', () => {
  useMasterSession();

  test('master storageState carries a live session and /auth/me returns role=master', async ({ request }) => {
    const me = await request.get(`${BACKEND}/api/v1/auth/me`);
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body?.user?.role).toBe('master');
    // Seed contract #247 §3.11: the demo master is linked to staff card m1.
    expect(body?.user?.master_id).toBe('m1');
  });
});
