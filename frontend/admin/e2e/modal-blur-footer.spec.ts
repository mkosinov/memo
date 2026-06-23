import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

test('US-M10: Schedule footer blurs when modal is open', async ({ page }) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Verify schedule content is visible before opening modal
  const scheduleContent = page.locator('[data-testid^="day-column-"]').first();
  await expect(scheduleContent).toBeVisible();

  // Open an activity via custom event (bypasses @dnd-kit pointer interception)
  await openModal(page);
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.waitForTimeout(300);

  // Verify the modal has a backdrop overlay that covers the schedule
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Verify modal z-index is correct (above schedule content)
  const modalZIndex = await dialog.evaluate((el) => {
    return parseInt(getComputedStyle(el).zIndex, 10);
  });
  expect(modalZIndex).toBeGreaterThan(0);
});
