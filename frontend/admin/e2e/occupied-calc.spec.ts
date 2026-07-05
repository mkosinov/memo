import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { createTestActivity, createTestClient, createTestRecord } from './fixtures/factories';

// Pending bug #84: current code counts records (2), not sum of visits (4).
// Marked fixme — will PASS once bug #84 is fixed.
test.fixme('US-S03: occupied = sum of visits for active records (excludes cancelled) — pending bug #84 fix', async ({
  page,
  request,
}) => {
  // ARRANGE: activity with capacity 20
  const activity = await createTestActivity(request, { capacity: 20 });

  // Record A: 1 visit (default)
  const client1 = await createTestClient(request);
  await createTestRecord(request, activity.id, client1.id);

  // Record B: 3 visits (override visits array)
  const client2 = await createTestClient(request);
  await createTestRecord(request, activity.id, client2.id, {
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
  // Bug #84: current code counts records (2), not sum of visits (4)
  // This assertion is intentionally RED — FAILS now, PASS after bug #84 fix.
  const card = page.locator(`[data-testid="activity-${activity.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('4/20');
});
