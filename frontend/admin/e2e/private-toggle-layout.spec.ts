import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

test('US-M01: "Приватное" label is stacked above selector', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open any activity
  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();

  // Switch to Settings tab
  await page.click('button[role="tab"]:has-text("Настройка")');

  // Find "Приватное" label and its selector
  const label = page.locator('label:has-text("Приватное")');
  const selector = page.locator('[data-testid="private-selector"]');

  await expect(label).toBeVisible();
  await expect(selector).toBeVisible();

  // Assert: label is above selector (smaller y-coordinate)
  const labelBox = await label.boundingBox();
  const selectorBox = await selector.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(selectorBox).not.toBeNull();
  if (labelBox && selectorBox) {
    expect(labelBox.y).toBeLessThan(selectorBox.y);
    // And NOT side-by-side (label.x should be less than selector.x with similar y, or label.y much less than selector.y)
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(selectorBox.y + 5);
  }
});
