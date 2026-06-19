import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

test('US-M09: Modal does not jump when switching tabs', async ({ page }) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Measure initial position
  const initialBox = await dialog.boundingBox();
  expect(initialBox).not.toBeNull();

  // Switch to Records tab
  await page.click('button[role="tab"]:has-text("Запись")');
  await page.waitForTimeout(300);
  const recordsBox = await dialog.boundingBox();

  // Switch back to Settings
  await page.click('button[role="tab"]:has-text("Настройка")');
  await page.waitForTimeout(300);
  const settingsBox = await dialog.boundingBox();

  // Width must be unchanged across all three states
  expect(recordsBox?.width).toBe(initialBox?.width);
  expect(settingsBox?.width).toBe(initialBox?.width);

  // Height is fixed (within tolerance)
  expect(Math.abs((recordsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);
  expect(Math.abs((settingsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);

  // X position unchanged (no horizontal shift)
  expect(recordsBox?.x).toBe(initialBox?.x);
  expect(settingsBox?.x).toBe(initialBox?.x);
});
