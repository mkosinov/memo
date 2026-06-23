import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

test('US-M01: "Приватное" label is stacked above selector', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open any activity via custom event (bypasses @dnd-kit pointer interception)
  await openModal(page);

  // Switch to Settings tab
  await page.locator('[data-testid="tab-settings"]').click();
  await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

  // Find "Приватное" label and its toggle
  const label = page.locator('span:has-text("Приватное")');
  const toggle = page.locator('[data-testid="toggle-private"]');

  await expect(label).toBeVisible();
  await expect(toggle).toBeVisible();

  // Assert: label is above toggle (smaller y-coordinate)
  const labelBox = await label.boundingBox();
  const toggleBox = await toggle.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  if (labelBox && toggleBox) {
    expect(labelBox.y).toBeLessThanOrEqual(toggleBox.y);
  }
});
