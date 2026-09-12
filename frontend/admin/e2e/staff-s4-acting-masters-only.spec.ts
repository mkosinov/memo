/**
 * S4 (GH #266) — «Создание занятия: только действующие мастера».
 *
 * The master pickers on the activity-creation surfaces are fed by the
 * read-only /api/v1/masters view, which serves ACTING masters only
 * (masters.is_active = true). An archived master section disappears from
 * every creation list, and the server-side TOCTOU guard rejects an activity
 * POST/PUT that still targets it (422 MASTER_NOT_ACTIVE — spec «Контракты
 * ошибок»).
 *
 * UI-driven for the creation picker (StampPanel — the мастер selector of the
 * «create activity» flow), API/SQL for the view contract and the TOCTOU guard.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  createTestActivity,
  createTestStaff,
} from './fixtures/factories';
import { waitForScheduleReady } from './fixtures/helpers';
import { openCombobox } from './helpers/combobox';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const SPECIALTY = 'S4-специальность';
const COLOR = '#4A7C59';

test.describe('S4 — activity creation lists acting masters only', () => {
  test('an archived master section leaves every creation list; POST is rejected', async ({ page, request }) => {
    // 1. SETUP — a staff card WITH an acting master section.
    const staff = await createTestStaff(request, {
      first_name: 'Действующий',
      last_name: `Вархивнов${Date.now()}`,
      master: { specialty: SPECIALTY, color: COLOR },
      positions: ['master'],
    });

    let activityId: string | undefined;
    try {
      // Baseline — acting: present in the view and in the creation picker.
      let actingIds = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
        Array<{ id: string }>).map((m) => m.id);
      expect(actingIds).toContain(staff.id);

      await waitForScheduleReady(page);
      await openStampMasterPickerAndExpect(page, staff.id, 'visible');

      // 2. ACTION — archive the master section (Gap A flag, D7: row KEPT).
      const patch = await request.patch(`${BACKEND}/api/v1/staff/${staff.id}`, {
        data: {
          master: { specialty: SPECIALTY, color: COLOR, archived: true },
        },
      });
      expect(patch.status()).toBe(200);
      expect(queryDBRow(
        `SELECT is_active FROM masters WHERE staff_id='${staff.id}'`,
      )).toMatchObject({ is_active: 0 });

      // 3. VERIFY API — gone from the acting-masters view (both shapes).
      actingIds = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
        Array<{ id: string }>).map((m) => m.id);
      expect(actingIds).not.toContain(staff.id);
      // Positive control — seed masters still listed (the view isn't empty).
      expect(actingIds).toContain('m1');

      // 4. VERIFY UI — reload the schedule; the creation picker (StampPanel)
      //    no longer offers the archived master, seed masters stay.
      await waitForScheduleReady(page);
      await openStampMasterPickerAndExpect(page, staff.id, 'hidden');

      // 5. VERIFY API — TOCTOU guard: a stale client still POSTing the
      //    archived master gets 422 MASTER_NOT_ACTIVE, no activity row.
      const [servicesJson, locationsJson] = await Promise.all([
        request.get(`${BACKEND}/api/v1/services`).then((r) => r.json()),
        request.get(`${BACKEND}/api/v1/locations`).then((r) => r.json()),
      ]);
      // #182: list endpoints are paginated ({items,…}) — unwrap envelopes.
      const services = (servicesJson.items ?? servicesJson) as
        Array<{ id: string; duration?: number }>;
      const locations = (locationsJson.items ?? locationsJson) as
        Array<{ id: string }>;
      const rejected = await request.post(`${BACKEND}/api/v1/activities`, {
        data: {
          master_id: staff.id,
          service_id: services[0].id,
          location_id: locations[0].id,
          start: new Date().toISOString().slice(0, 19),
          duration: services[0].duration || 90,
          capacity: 8,
          is_private: false,
        },
      });
      expect(rejected.status()).toBe(422);
      expect((await rejected.json()).detail.code).toBe('MASTER_NOT_ACTIVE');
      expect(queryDBRow(
        `SELECT COUNT(*) AS n FROM activities WHERE master_id='${staff.id}'`,
      )).toMatchObject({ n: 0 });

      // 6. VERIFY — restore (archived:false) puts the master back on the
      //    creation list and an activity can be created again.
      const restore = await request.patch(`${BACKEND}/api/v1/staff/${staff.id}`, {
        data: {
          master: { specialty: SPECIALTY, color: COLOR, archived: false },
        },
      });
      expect(restore.status()).toBe(200);
      actingIds = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
        Array<{ id: string }>).map((m) => m.id);
      expect(actingIds).toContain(staff.id);

      const activity = await createTestActivity(request, { master_id: staff.id });
      activityId = activity.id;
      expect(activity.master_id).toBe(staff.id);
    } finally {
      // 7. CLEANUP
      if (activityId) await cleanup(request, `/api/v1/activities/${activityId}`);
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});

/**
 * Open the StampPanel «Мастер» combobox (the master selector of the
 * create-activity flow) and assert the option for *staffId* is
 * visible/hidden. Seed master m1 is asserted visible as the positive
 * control (a broken/empty picker must not pass the `hidden` branch).
 */
async function openStampMasterPickerAndExpect(
  page: import('@playwright/test').Page,
  staffId: string,
  expected: 'visible' | 'hidden',
): Promise<void> {
  const panel = page.locator('[data-testid="right-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
  }
  const trigger = page.locator(
    '[data-testid="stamp-master-picker"] [data-testid="combobox-trigger"]',
  );
  await expect(trigger).toBeVisible();
  const dropdown = await openCombobox(page, trigger);

  // Positive control — an acting seed master is always offered.
  await expect(dropdown.locator('[data-testid="combobox-option-m1"]')).toBeVisible();

  const option = dropdown.locator(`[data-testid="combobox-option-${staffId}"]`);
  if (expected === 'visible') {
    await expect(option).toBeVisible();
  } else {
    await expect(option).toHaveCount(0);
  }
  // Close the dropdown so the next page interaction starts clean.
  await trigger.click();
  await expect(dropdown).toBeHidden();
}
