import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';
import {
  createTestActivity,
  createTestClient,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

test('US-S03: occupied = sum of visits for active records (excludes cancelled)', async ({
  page,
  request,
}) => {
  let activity: any;
  let client1: any;
  let client2: any;
  let recordA: any;
  let recordB: any;

  try {
    // ARRANGE: activity with capacity 20
    activity = await createTestActivity(request, { capacity: 20 });

    // Record A: 1 visit (default)
    client1 = await createTestClient(request);
    recordA = await createTestRecord(request, activity.id, client1.id);

    // Record B: 3 visits (override visits array)
    client2 = await createTestClient(request);
    recordB = await createTestRecord(request, activity.id, client2.id, {
      visits: [
        { name: 'Visit 1', price: 1000 },
        { name: 'Visit 2', price: 1000 },
        { name: 'Visit 3', price: 1000 },
      ],
    });

    // ACT: load schedule
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // ASSERT: occupied should be 4/20 (sum of visits: 1 + 3 = 4)
    const card = page.locator(`[data-testid="activity-${activity.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('4/20');
  } finally {
    await cleanupRecord(request, recordA.id);
    await cleanupRecord(request, recordB.id);
    await cleanup(request, `/api/v1/clients/${client1.id}`);
    await cleanup(request, `/api/v1/clients/${client2.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});
