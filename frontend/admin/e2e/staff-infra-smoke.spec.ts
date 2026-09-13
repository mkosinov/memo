/**
 * staff-infra-smoke.spec.ts — GH #266 Task 7 DoD smoke.
 *
 * Proves the new e2e infrastructure works WITHOUT depending on the (still
 * old, T8-rewrite) staff screen — every assertion is an API or direct-SQL
 * check, which the task DoD explicitly allows and which is the most stable
 * option while the masters screen is being rewritten.
 *
 * Two serial tests prove the two halves of the DoD:
 *   1. Factory creation — `createTestStaff` (master section + positions +
 *      account), `createTestMaster` (wrapper), and `linkUserToStaff` all
 *      write the right rows across the 4 restructured tables. The created
 *      rows are INTENTIONALLY LEAKED (no cleanup) so test 2 can prove the
 *      per-test reset removed them.
 *   2. Reset between tests — the per-test `seedReset` fixture (fixtures/
 *      test.ts → seed-reset.ts RESET_SQL) ran before this test and must have
 *      dropped every non-seed staff/masters/positions/staff_positions row,
 *      detached the leaked users (FK-clean), and left the seed (m1–m5, m7;
 *      master/admin/smm; sort_order) intact.
 *
 * Serial mode + workers:1 (pinned by playwright.config and enforced by the
 * seed-reset fixture) guarantee test 1 runs before test 2 in this worker, so
 * the module-level id hand-off is reliable.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  createTestMaster,
  createTestStaff,
  linkUserToStaff,
  seedUser,
  E2E_PASSWORD,
} from './fixtures/factories';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Seed staff ids preserved by the migration (m6 never existed). */
const SEED_STAFF = ['m1', 'm2', 'm3', 'm4', 'm5', 'm7'];

// Hand-off from test 1 → test 2 (serial, single worker — see file header).
const leaked: { staffA?: string; staffB?: string; masterC?: string; phoneA?: string; phoneB?: string } = {};

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7998${String(Date.now()).slice(-7)}${phoneCounter}`;
}

test.describe.configure({ mode: 'serial' });

test.describe('GH #266 T7 — staff e2e infrastructure smoke', () => {
  test('factory creates staff (master section + positions + account) — leaked for the reset test', async ({ request }) => {
    // ── A. Full card: master section + position + account in one POST ──────
    const phoneA = uniquePhone();
    const staffA = await createTestStaff(request, {
      first_name: 'Смоук',
      last_name: `СотрудниковА${Date.now()}`,
      master: { specialty: 'керамика', color: '#123456' },
      positions: ['master'],
      user: { phone: phoneA, password: E2E_PASSWORD },
    });
    expect(staffA.id).toBeTruthy();

    // VERIFY API — GET /staff/{id} reflects the composite card.
    const getA = await request.get(`${BACKEND}/api/v1/staff/${staffA.id}`);
    expect(getA.status()).toBe(200);
    const bodyA = await getA.json();
    expect(bodyA.master).toMatchObject({ specialty: 'керамика', color: '#123456' });
    expect(bodyA.position_ids).toEqual(['master']);
    expect(bodyA.archived).toBe(false);

    // VERIFY API — an acting master appears in the read-only /masters view.
    const allMasters = await (await request.get(`${BACKEND}/api/v1/masters/all`)).json();
    expect(allMasters.map((m: { id: string }) => m.id)).toContain(staffA.id);

    // VERIFY DB — one row in each of the 4 restructured tables + the account.
    expect(queryDBRow(`SELECT id FROM staff WHERE id='${staffA.id}'`)).not.toBeNull();
    expect(queryDBRow(
      `SELECT staff_id, specialty, color FROM masters WHERE staff_id='${staffA.id}'`,
    )).toMatchObject({ specialty: 'керамика', color: '#123456' });
    expect(queryDBRows(
      `SELECT * FROM staff_positions WHERE staff_id='${staffA.id}' AND position_id='master'`,
    )).toHaveLength(1);
    expect(queryDBRow(
      `SELECT staff_id FROM users WHERE phone='${phoneA}'`,
    )).toMatchObject({ staff_id: staffA.id });

    // ── B. Card WITHOUT a master section (S1 semantics) + linkUserToStaff ──
    const phoneB = uniquePhone();
    const staffB = await createTestStaff(request, {
      first_name: 'Смоук',
      last_name: `СотрудниковБ${Date.now()}`,
      positions: ['smm'],
    });
    // A pre-existing account (no create_user) linked via the SQL helper.
    seedUser({ phone: phoneB });
    linkUserToStaff(phoneB, staffB.id);
    expect(queryDBRow(`SELECT staff_id FROM users WHERE phone='${phoneB}'`))
      .toMatchObject({ staff_id: staffB.id });

    // No master section → NOT an acting master → absent from /masters.
    const allMastersB = await (await request.get(`${BACKEND}/api/v1/masters/all`)).json();
    expect(allMastersB.map((m: { id: string }) => m.id)).not.toContain(staffB.id);
    expect(queryDBRow(`SELECT staff_id FROM masters WHERE staff_id='${staffB.id}'`)).toBeNull();

    // ── C. createTestMaster wrapper → a staff card WITH a master section ───
    const masterC = await createTestMaster(request);
    expect(masterC.id).toBeTruthy();
    const allMastersC = await (await request.get(`${BACKEND}/api/v1/masters/all`)).json();
    expect(allMastersC.map((m: { id: string }) => m.id)).toContain(masterC.id);
    expect(queryDBRow(`SELECT color FROM masters WHERE staff_id='${masterC.id}'`)).not.toBeNull();

    // Hand off to test 2; deliberately NO cleanup — test 2 proves the reset.
    leaked.staffA = staffA.id;
    leaked.staffB = staffB.id;
    leaked.masterC = masterC.id;
    leaked.phoneA = phoneA;
    leaked.phoneB = phoneB;
  });

  test('per-test reset dropped the leaked staff and kept the seed intact', async ({ request }) => {
    // The seedReset fixture ran BEFORE this test. Everything test 1 leaked
    // across the 4 tables must be gone, the seed must be untouched.
    expect(leaked.staffA, 'test 1 must have run first (serial)').toBeTruthy();

    for (const id of [leaked.staffA!, leaked.staffB!, leaked.masterC!]) {
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${id}'`)).toBeNull();
      expect(queryDBRow(`SELECT staff_id FROM masters WHERE staff_id='${id}'`)).toBeNull();
      expect(queryDBRows(`SELECT * FROM staff_positions WHERE staff_id='${id}'`)).toHaveLength(0);
    }

    // Leaked users are KEPT (reset never deletes users — the auth cookie
    // survives, #252) but DETACHED so no staff_id FK dangles.
    expect(queryDBRow(`SELECT staff_id FROM users WHERE phone='${leaked.phoneA}'`))
      .toMatchObject({ staff_id: null });
    expect(queryDBRow(`SELECT staff_id FROM users WHERE phone='${leaked.phoneB}'`))
      .toMatchObject({ staff_id: null });

    // Seed preserved: 6 staff cards, correct sort_order, 3 positions, and the
    // seeded master account still linked to m1.
    expect(queryDBRows(`SELECT id FROM staff WHERE id IN (${SEED_STAFF.map((s) => `'${s}'`).join(',')})`))
      .toHaveLength(SEED_STAFF.length);
    expect(queryDBRow(`SELECT sort_order FROM staff WHERE id='m1'`)).toMatchObject({ sort_order: 0 });
    expect(queryDBRow(`SELECT sort_order FROM staff WHERE id='m7'`)).toMatchObject({ sort_order: 5 });
    expect(queryDBRows(`SELECT id FROM positions WHERE id IN ('master','admin','smm')`)).toHaveLength(3);
    expect(queryDBRow(`SELECT staff_id FROM users WHERE phone='+79990000002'`))
      .toMatchObject({ staff_id: 'm1' });

    // A fresh card still creates cleanly after the reset (and cleans up).
    const fresh = await createTestStaff(request, {
      first_name: 'Свежий',
      last_name: `ПослеРесета${Date.now()}`,
      master: { specialty: 'живопись', color: '#654321' },
      positions: ['master'],
    });
    try {
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${fresh.id}'`)).not.toBeNull();
      const all = await (await request.get(`${BACKEND}/api/v1/masters/all`)).json();
      expect(all.map((m: { id: string }) => m.id)).toContain(fresh.id);
    } finally {
      await cleanup(request, `/api/v1/staff/${fresh.id}`);
    }
  });
});
