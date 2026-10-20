/**
 * S1 (GH #266) — «Сотрудник-СММ не мастер».
 *
 * A staff card WITHOUT a master section (position «СММ» only) is a person,
 * not a schedule master: they never appear in the read-only /api/v1/masters
 * view (paged + bare) nor in the schedule master filter — while seed masters
 * stay in both (positive control: a broken filter/picker that shows NOTHING
 * must also fail this spec, not silently pass the `not.toContain` asserts).
 *
 * API/SQL for the view + tables, UI for the schedule filter dropdown.
 */
import { resolveBackendUrl } from './lib/backend-url';
import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import { cleanup, createTestStaff } from './fixtures/factories';
import { waitForScheduleReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
import { seedId } from './fixtures/seed-ids';

const BACKEND = resolveBackendUrl();

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import: CI's `playwright --list` collects specs before the
// shard stack seeds the DB.
test.beforeAll(() => {
  SEED_STAFF_IDS = ['Середа', 'Большакова', 'П.', 'Тюльпина', 'В.', 'Горох'].map(
    (last_name) => seedId('staff', 'last_name', last_name),
  );
});


// Seed staff ids resolved by business key (GH #491 — seed ids are UUIDs).
let SEED_STAFF_IDS: string[] = [];

test.describe('S1 — SMM employee without a master section', () => {
  test('absent from /api/v1/masters and from the schedule master filter', async ({ page, request }) => {
    // 1. SETUP — a plain employee: position «СММ», NO master section (D5).
    const staff = await createTestStaff(request, {
      first_name: 'СММ',
      last_name: `Внешний${Date.now()}`,
      positions: ['smm'],
    });

    try {
      // The card exists WITH the position — the absences below are caused by
      // the missing master section, not by a failed create.
      const cardResp = await request.get(`${BACKEND}/api/v1/staff/${staff.id}`);
      expect(cardResp.status()).toBe(200);
      const card = await cardResp.json();
      expect(card.position_ids).toEqual(['smm']);
      expect(card.master).toBeNull();

      // 2. VERIFY API — the read-only masters view omits the person
      //    (both the bare /all and the paginated list, D8 contract).
      const allIds = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
        Array<{ id: string }>).map((m) => m.id);
      expect(allIds).not.toContain(staff.id);
      // Positive control — seed masters ARE in the view (an empty/broken
      // view would pass `not.toContain` alone).
      expect(allIds).toEqual(expect.arrayContaining(SEED_STAFF_IDS));

      const paged = await (await request.get(`${BACKEND}/api/v1/masters?page=1&per_page=100`)).json();
      const pagedIds = (paged.items as Array<{ id: string }>).map((m) => m.id);
      expect(pagedIds).not.toContain(staff.id);
      expect(pagedIds).toContain(SEED_STAFF_IDS[0]);

      // 3. VERIFY DB — no masters extension row; the position link is there.
      expect(queryDBRow(
        `SELECT COUNT(*) AS n FROM masters WHERE staff_id='${staff.id}'`,
      )).toMatchObject({ n: 0 });
      expect(queryDBRow(
        `SELECT position_id FROM staff_positions WHERE staff_id='${staff.id}'`,
      )).toMatchObject({ position_id: 'smm' });

      // 4. VERIFY UI — the schedule master filter offers seed masters but
      //    never the SMM employee.
      await waitForScheduleReady(page, SEED_WEEK_MONDAY);
      const mastersFilter = page.locator(
        '[data-testid="center-content"] button[aria-label="Мастера"]',
      );
      await mastersFilter.click();
      const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
      await expect(dropdown).toBeVisible();

      // Positive control — a seed master option is rendered.
      await expect(dropdown.locator(`[data-testid="multiselect-option-${SEED_STAFF_IDS[0]}"]`)).toBeVisible();
      // The SMM employee has no option and their name is nowhere in the list.
      await expect(
        dropdown.locator(`[data-testid="multiselect-option-${staff.id}"]`),
      ).toHaveCount(0);
      await expect(dropdown).not.toContainText(staff.last_name);
    } finally {
      // 5. CLEANUP
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});
