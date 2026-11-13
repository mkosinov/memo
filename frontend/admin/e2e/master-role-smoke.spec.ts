/**
 * master-role-smoke.spec.ts — GH #263 T8: smoke for the master e2e
 * infrastructure (T9/T10 build the S1–S8 scenarios on top of it);
 * retargeted to the #584 /my-namespace (spec §7 scenario 2: «чистый
 * мастер — профиль и снапшот из /my/master»).
 *
 * Proves the full master-session harness: globalSetup logged the seeded
 * demo master (#247 §3.11, +79990000002) in, the shard-scoped storageState
 * file exists and carries a LIVE session — the whoami `GET /api/v1/my`
 * answers 200 with the master account + `roles: ["master"]` (the former
 * `/auth/me` wire is deleted → 404), and the master-branch profile
 * `GET /api/v1/my/master` returns the linked staff card's names plus the
 * master section and the login-shaped card snapshot. Request-helper
 * conventions follow auth-session.spec.ts (page.request shares the
 * context's storageState cookies and correct fetch metadata).
 */
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { seedId } from './fixtures/seed-ids';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = resolveBackendUrl();

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import: CI's `playwright --list` collects specs before the
// shard stack seeds the DB.
test.beforeAll(() => {
  M1 = seedId('staff', 'last_name', 'Середа');
});

let M1 = '';

test.describe('GH #263 T8 — master session smoke', () => {
  useMasterSession();

  test('master storageState carries a live session: whoami roles [master], /my/master profile + snapshot', async ({ request }) => {
    // The whoami (#584 §4.1): account data + roles — the staff-only
    // context resolves exactly one role, the staff one.
    const who = await request.get(`${BACKEND}/api/v1/my`);
    expect(who.status()).toBe(200);
    const whoBody = await who.json();
    expect(whoBody?.phone).toBe('+79990000002');
    expect(whoBody?.roles, 'the staff-only context carries no client role')
      .toEqual(['master']);

    // The master-branch profile (#584 §4.3): the flat profile + the
    // account half (user_id/phone/email/permissions) + the master-only
    // section and snapshot.
    const profile = await request.get(`${BACKEND}/api/v1/my/master`);
    expect(profile.status()).toBe(200);
    const prof = await profile.json();
    expect(prof?.role).toBe('master');
    expect(prof?.user_id).toBe(whoBody?.id);
    // Seed contract #247 §3.11: the demo master is linked to the first
    // seed staff card (Ольга Середа; GH #491 — the id resolves by business
    // key). The #584 profile response carries no staff-card id — the link
    // is pinned through the DB (names below prove WHICH card on the wire).
    expect(prof?.first_name).toBe('Ольга');
    expect(prof?.last_name).toBe('Середа');
    expect(prof?.master).toMatchObject({ first_name: 'Ольга', last_name: 'Середа' });
    expect(prof?.master_section, 'the seed master carries a masters section')
      .not.toBeNull();
    const link = queryDBRow(
      `SELECT staff_id FROM users WHERE phone='+79990000002'`,
    ) as unknown as { staff_id: string } | null;
    expect(link?.staff_id).toBe(M1);
  });
});
