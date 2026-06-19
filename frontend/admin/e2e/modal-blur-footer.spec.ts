import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

test('US-M10: Schedule footer blurs when modal is open', async ({ page }) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Capture initial footer text and check it has no filter/blur
  const footer = page.locator('[data-testid="day-footer"]').first();
  await expect(footer).toBeVisible();
  const initialFilter = await footer.evaluate(
    (el) => getComputedStyle(el).filter || getComputedStyle(el.parentElement!).filter
  );
  expect(initialFilter).not.toContain('blur');

  // Open an activity
  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.waitForTimeout(300);

  // Assert: footer (or its parent) has blur
  const blurredFilter = await footer.evaluate(
    (el) => getComputedStyle(el).filter || getComputedStyle(el.parentElement!).filter
  );
  expect(blurredFilter).toContain('blur');
});
