import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';

test('US-M04: Admin can open client profile from a record', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open an activity with at least one record
  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();
  await switchToRecordsTab(page);

  // Click "Открыть профиль" on first record
  const firstRecord = page.locator('[data-testid="record"]').first();
  await firstRecord.locator('button:has-text("Открыть профиль")').click();

  // Assert: URL changes to /client/{id}
  await expect(page).toHaveURL(/\/client\/\d+/);

  // Assert: client card is visible
  await expect(page.locator('[data-testid="client-card"]')).toBeVisible();

  // Assert: activity modal is closed
  await expect(page.locator('[role="dialog"]')).not.toBeVisible();
});
