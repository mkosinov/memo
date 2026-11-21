/**
 * S2 (GH #266) — «Мастера приходят и уходят».
 *
 * Adding the master section to a card makes the person appear in the read-only
 * /masters view (and the schedule master filter); archiving the master section
 * (Gap A: masters.is_active=false, row KEPT) removes them from those lists, but
 * every PAST record still shows their name and color (history alive, D7).
 *
 * UI-driven for the master-section controls (the new Gap A toggle), API/SQL for
 * the record-history assertions (a record needs an activity on an acting master,
 * which must exist before the section is archived).
 */
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestRecord,
  createTestClient,
  createTestStaff,
} from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { seedId } from './fixtures/seed-ids';

const BACKEND = resolveBackendUrl();

const COLOR = '#3FA796';

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import (CI's `playwright --list` collects specs before the
// shard stack seeds the DB). GH #599: the master-section direction is a
// dictionary CHECKBOX — the seed «Живопись» is the scenario's pick.
let ZHIVOPIS_ID = '';

test.beforeAll(() => {
  ZHIVOPIS_ID = seedId('specialties', 'title', 'Живопись');
});

test.describe('S2 — master section add/archive, history alive', () => {
  test('adding the section lists the master; archiving hides them but records keep name+color', async ({ page, request }) => {
    // A card WITHOUT a master section first (a plain employee, S1-like).
    const staff = await createTestStaff(request, {
      first_name: 'Пришёл',
      last_name: `Ушёлнов${Date.now()}`,
      positions: ['smm'],
    });

    let activityId: string | undefined;
    let recordId: string | undefined;
    let clientId: string | undefined;
    try {
      // Baseline — no master section → absent from the acting-master view.
      let actingIds = (await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id);
      expect(actingIds).not.toContain(staff.id);

      // ── ADD the master section through the UI edit modal ────────────────
      await waitForStaffReady(page);
      const row = page.locator(`[data-testid="master-row-${staff.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.locator('[data-testid="master-section-checkbox"]').check();
      // GH #599: directions are dictionary checkboxes (no free-text input);
      // the seed «Живопись» is the section's direction.
      await dialog.locator(`[data-testid="specialty-checkbox-${ZHIVOPIS_ID}"]`).check();
      await dialog.locator('input[placeholder="#5B8C7A"]').fill(COLOR);
      const putPromise = page.waitForResponse((r) =>
        r.url().includes(`/api/v1/staff/${staff.id}`) && r.request().method() === 'PUT',
      );
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const put = await putPromise;
      expect(put.status()).toBe(200);

      // VERIFY — the person is now an acting master (in /masters).
      actingIds = (await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id);
      expect(actingIds).toContain(staff.id);
      // GH #599: masters carries color/activity only; the direction link
      // lives in staff_specialties (checked «Живопись»).
      expect(queryDBRow(`SELECT color, is_active FROM masters WHERE staff_id='${staff.id}'`))
        .toMatchObject({ color: COLOR, is_active: 1 });
      expect(queryDBRows(
        `SELECT specialty_id FROM staff_specialties WHERE staff_id='${staff.id}' AND specialty_id='${ZHIVOPIS_ID}'`,
      )).toHaveLength(1);

      // ── Build history: an activity + record on this (now acting) master ──
      const client = await createTestClient(request, { name: `S2 Клиент ${Date.now()}` });
      clientId = client.id;
      const activity = await createTestActivity(request, { master_id: staff.id });
      activityId = activity.id;
      const record = await createTestRecord(request, activity.id, client.id);
      recordId = record.id;

      // The record resolves the master's name + color while acting.
      const before = await (await request.get(
        `${BACKEND}/api/v1/records/view?date_from=2000-01-01&date_to=2100-01-01&q=${encodeURIComponent(client.name)}`,
      )).json();
      const beforeRow = before.items.find((r: { id: string }) => r.id === record.id);
      expect(beforeRow.master_name).toBe(`${staff.last_name} ${staff.first_name}`);
      expect(beforeRow.master_color).toBe(COLOR);

      // ── ARCHIVE the master section through the UI (Gap A toggle) ─────────
      await waitForStaffReady(page);
      await page.locator(`[data-testid="master-row-${staff.id}"]`).click();
      const archiveDialog = page.getByRole('dialog');
      await expect(archiveDialog).toBeVisible({ timeout: 5_000 });
      await expect(archiveDialog.locator('[data-testid="master-section-checkbox"]')).toBeChecked();
      await archiveDialog.locator('[data-testid="master-archived-checkbox"]').check();
      const putArchivePromise = page.waitForResponse((r) =>
        r.url().includes(`/api/v1/staff/${staff.id}`) && r.request().method() === 'PUT',
      );
      await archiveDialog.getByRole('button', { name: 'Сохранить' }).click();
      expect((await putArchivePromise).status()).toBe(200);

      // VERIFY — gone from the acting-master view (S2 «исчез из списков»).
      actingIds = (await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id);
      expect(actingIds).not.toContain(staff.id);
      // The masters ROW is kept (history), flagged inactive, color intact (D7);
      // the direction link survives the archive too.
      expect(queryDBRow(`SELECT color, is_active FROM masters WHERE staff_id='${staff.id}'`))
        .toMatchObject({ color: COLOR, is_active: 0 });
      expect(queryDBRows(
        `SELECT specialty_id FROM staff_specialties WHERE staff_id='${staff.id}' AND specialty_id='${ZHIVOPIS_ID}'`,
      )).toHaveLength(1);

      // VERIFY — «история жива»: the PAST record still shows the name + color.
      const after = await (await request.get(
        `${BACKEND}/api/v1/records/view?date_from=2000-01-01&date_to=2100-01-01&q=${encodeURIComponent(client.name)}`,
      )).json();
      const afterRow = after.items.find((r: { id: string }) => r.id === record.id);
      expect(afterRow.master_name).toBe(`${staff.last_name} ${staff.first_name}`);
      expect(afterRow.master_color).toBe(COLOR);

      // The PERSON is untouched — still an active staff card (only the master
      // section is archived; D3 independence).
      expect((await (await request.get(`${BACKEND}/api/v1/staff/${staff.id}`)).json()).archived).toBe(false);
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      if (activityId) await cleanup(request, `/api/v1/activities/${activityId}`);
      if (clientId) await cleanup(request, `/api/v1/clients/${clientId}`);
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});
