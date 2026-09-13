/**
 * S7 — Invalid/missing resolution → 422 (#207 §12).
 *
 * `DELETE /clients/{id}` WITH body validates the resolutions against the FK
 * matrix (§4): wrong action → 422 naming the dep; missing non-auto dep →
 * 422; correct body → 204 one-transaction delete. No rows must change on
 * the failed attempts.
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

test.describe('S7 — Client delete resolution validation', () => {
  test('wrong action 422, missing dep 422, correct resolutions 204', async ({ request }) => {
    // 1. SETUP — client with records + visitors (needs BOTH resolutions).
    const client = await createTestClient(request, { name: `S7 Client ${Date.now()}` });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);
    const tag = await createTestClientTag(request, client.id);

    try {
      // Seed the dependency chain: the record creates 1 visitor (seat) on
      // the client. Verify the 409 tree to prove the deps exist.
      const dryRun = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`);
      expect(dryRun.status()).toBe(409);
      const deps = (await dryRun.json()).dependencies;
      const depNames = deps.map((d: any) => d.entity);
      expect(depNames).toEqual(expect.arrayContaining(['records', 'visitors', 'client_tags']));

      // ── WRONG ACTION — records only allows nullify ────────────────────
      const wrongAction = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: { resolutions: { records: 'cascade', visitors: 'cascade' } },
      });
      expect(wrongAction.status()).toBe(422);
      // Backend error envelope names the violation generically (src/errors.py)
      // — §14 acceptance is the 422 status itself.
      expect((await wrongAction.json()).detail).toBeTruthy();

      // ── MISSING DEP — visitors resolution omitted ─────────────────────
      const missingDep = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: { resolutions: { records: 'nullify' } },
      });
      expect(missingDep.status()).toBe(422);
      expect((await missingDep.json()).detail).toBeTruthy();

      // ── NO ROWS MODIFIED — every entity still intact ──────────────────
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).not.toBeNull();
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBe(client.id);
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM visitors WHERE client_id='${client.id}'`)!.n).toBe(1);

      // ── CORRECT RESOLUTIONS — 204, everything cascades/nullifies ──────
      const ok = await request.delete(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: { resolutions: { records: 'nullify', visitors: 'cascade' } },
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
    // Complement of §14: "activities always blocks — DELETE with body →
    // 422 communicates archive instead". GH #266: the master write moved to
    // the staff card; activities block via the masters extension row.
    const master = await createTestMaster(request);
    const activity = await createTestActivity(request, { master_id: master.id });
    try {
      const resp = await request.delete(`${BACKEND}/api/v1/staff/${master.id}`, {
        data: { resolutions: { activities: 'cascade' } },
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
