import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

// Tests in this file are temporarily marked as test.fixme due to
// pre-existing flakes in the parallel-shard E2E setup. See GH issue
// #156 for the proper fix.

test('US-M09: Modal does not jump when switching tabs [GH #156 — unblocked by #124 Wave 1 openModal fix]', async ({ page }) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  await openModal(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Measure initial position
  const initialBox = await dialog.boundingBox();
  expect(initialBox).not.toBeNull();

  // Switch to first client tab
  const clientTab = page.locator('[data-testid^="tab-client-"]').first();
  await expect(clientTab).toBeVisible({ timeout: 5_000 });
  await clientTab.click();
  await page.waitForTimeout(300);
  const recordsBox = await dialog.boundingBox();

  // Switch back to Settings
  await page.locator('[data-testid="tab-settings"]').click();
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
