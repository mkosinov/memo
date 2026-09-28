/**
 * S6 — Client delete commit-contract validation (spec §4.1, direct API).
 *
 * The deferred conveyor's COMMIT (DELETE WITH body) validates against the
 * FK matrix (§4): wrong action → 422 naming the dep; missing non-auto dep
 * → 422; correct body → 204 one-transaction delete. The bare DELETE is a
 * contract violation now — 422 `expected_state_required` BEFORE any DB
 * access (unknown id included). No rows must change on failed attempts.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestClient,
  createTestClientTag,
  createTestMaster,
  createTestRecord,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

test.describe('S6 — Client delete commit-contract validation', () => {
  test('wrong action 422, missing dep 422, correct resolutions+expected 204', async ({ request }) => {
    // 1. SETUP — client with records + visitors (needs BOTH resolutions).
    const client = await createTestClient(request, { name: `S6 Client ${Date.now()}` });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);
    const tag = await createTestClientTag(request, client.id);
    const visitorId = queryDBRow(
      `SELECT id FROM visitors WHERE client_id='${client.id}'`,
    )!.id as string;

    try {
      // Seed the dependency chain: the record creates 1 visitor (seat) on
      // the client. The PURE dry-run preview proves the deps exist (the
      // preview itself never mutates).
      const dryRun = await request.delete(`${BACKEND}/api/v1/clients/${client.id}?dry_run=true`);
      expect(dryRun.status()).toBe(409);
      const dryJson = await dryRun.json();
      expect(dryJson.detail).toBe('has_dependencies');
      const depNames = dryJson.dependencies.map((d: any) => d.entity);
      expect(depNames).toEqual(expect.arrayContaining(['records', 'visitors', 'client_tags']));

      // ── BARE DELETE (the removed legacy form) → 422 before any probe ──
      const bare = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`);
      expect(bare.status()).toBe(422);
      expect((await bare.json()).detail).toBe('expected_state_required');

      // ── WRONG ACTION — records only allows nullify ────────────────────
      // (expected covers BOTH choice deps so the stale check passes and the
      // 422 comes from the resolutions validation itself, §4.1.3.)
      const wrongAction = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: {
          resolutions: { records: 'cascade', visitors: 'cascade' },
          expected: { records: [record.id], visitors: [visitorId] },
        },
      });
      expect(wrongAction.status()).toBe(422);
      // Backend error envelope names the violation (ResolutionError detail).
      expect((await wrongAction.json()).detail).toBeTruthy();

      // ── MISSING DEP — visitors resolution omitted (full expected: the
      //    missing-422 branch, not the stale-409 one) ────────────────────
      const missingDep = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: {
          resolutions: { records: 'nullify' },
          expected: { records: [record.id], visitors: [visitorId] },
        },
      });
      expect(missingDep.status()).toBe(422);
      expect((await missingDep.json()).detail).toBeTruthy();

      // ── STALE EXPECTED — a visitor the caller never confirmed ──────────
      // (subset semantics: now_ids ⊄ expected → 409 `stale_dependencies`
      // BEFORE the resolutions validation could 422 — the D7 order pin.)
      const stale = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: {
          resolutions: { records: 'nullify', visitors: 'cascade' },
          expected: { records: [record.id], visitors: [] },
        },
      });
      expect(stale.status()).toBe(409);
      expect((await stale.json()).detail).toBe('stale_dependencies');

      // ── NO ROWS MODIFIED — every entity still intact ──────────────────
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).not.toBeNull();
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBe(client.id);
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM visitors WHERE client_id='${client.id}'`)!.n).toBe(1);

      // ── CORRECT RESOLUTIONS + EXPECTED — 204, everything cascades ─────
      const ok = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: {
          resolutions: { records: 'nullify', visitors: 'cascade' },
          expected: { records: [record.id], visitors: [visitorId] },
        },
      });
      expect(ok.status()).toBe(204);
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).toBeNull();
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBeNull();
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM visitors WHERE client_id='${client.id}'`)!.n).toBe(0);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/tags/${tag.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('blocked staff card with body still rejected → 422 (activities can never resolve)', async ({ request }) => {
    // Complement of §4.4: "activities always blocks — DELETE with body →
    // 422 communicates archive instead". GH #266: the master write moved to
    // the staff card; activities block via the masters extension row.
    // NB: `expected` must COVER the activity ids — the stale check runs
    // first (D7 order pin) and an uncovered dep is a 409, not this 422.
    const master = await createTestMaster(request);
    const activity = await createTestActivity(request, { master_id: master.id });
    try {
      const resp = await request.delete(`${BACKEND}/api/v1/staff/${master.id}`, {
        data: {
          resolutions: { activities: 'cascade' },
          expected: { activities: [activity.id] },
        },
      });
      expect(resp.status()).toBe(422);
      // Card intact — cannot be deleted while activities exist.
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${master.id}'`)).not.toBeNull();
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });
});
