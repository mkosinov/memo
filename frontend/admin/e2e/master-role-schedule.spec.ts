/**
 * master-role-schedule.spec.ts — GH #263 T10, scenario S1.
 *
 * S1 — «Расписание мастера»: под своим сеансом (seed master m1,
 * +79990000002) в сетке расписания видны ТОЛЬКО свои занятия; занятия
 * чужого мастера отсутствуют.
 *
 * RED note (TDD): the backend scope landed in T2 (backend TDD; e2e is the
 * acceptance layer — plan T10 guidance). The strict assertions below were
 * validated RED during backend TDD (backend/tests/test_master_scope_read.py
 * pins the activities list filter); here they pin the LIVE contract:
 * an activity created for a foreign master never appears in the schedule
 * grid of the master session, while the master's own factory activity
 * does — and GET /activities returns only m1 rows.
 *
 * Setup roles: the master token matrix has no activities:write / staff:write
 * (spec D7), so BOTH fixtures are created via the admin context (own rows
 * pinned to master_id 'm1'); the page, its data fetches and every scope
 * assertion ride the master session.
 *
 * Isolation: fixtures/test.ts resets the DB to seed before EVERY test, so
 * both activities are factory-created inside the test and cleaned up in
 * `finally`.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import { waitForScheduleReady } from './fixtures/helpers';
import { createTestActivity, createTestMaster, cleanup } from './fixtures/factories';

test.describe('GH #263 S1 — master schedule shows only own activities', () => {
  useMasterSession();

  test('own activity renders in the grid; foreign master activity is absent', async ({
    page,
    request,
  }) => {
    // SETUP (admin pen) — a foreign master with an activity of his own…
    const admin = await adminApiContext();
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Расписание ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    // …and the session master's OWN activity (seed m1 = authed master).
    const ownActivity = await createTestActivity(admin, { master_id: 'm1' });

    try {
      // The API surface is already scoped — the schedule data fetch must
      // never return the foreign activity (master session, NOT admin).
      const listResp = await request.get(
        `${process.env.BACKEND_URL || 'http://127.0.0.1:8001'}/api/v1/activities`,
      );
      expect(listResp.ok()).toBeTruthy();
      const list = await listResp.json();
      const items: Array<{ id: string }> = list.items ?? list;
      expect(items.some((a) => a.id === ownActivity.id)).toBe(true);
      expect(items.some((a) => a.id === foreignActivity.id)).toBe(false);

      // ACTION — open the schedule grid as the master.
      await waitForScheduleReady(page);

      // VERIFY UI — own card is in the grid; foreign card is not.
      await expect(
        page.locator(`[data-testid="activity-${ownActivity.id}"]`),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.locator(`[data-testid="activity-${foreignActivity.id}"]`),
      ).toHaveCount(0);
    } finally {
      await cleanup(admin, `/api/v1/activities/${ownActivity.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });
});
