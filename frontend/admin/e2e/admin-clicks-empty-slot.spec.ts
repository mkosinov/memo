import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

test('US-S01: Admin can click empty slot to create activity', async ({
  page,
}) => {
  // ARRANGE: on /schedule
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // ACT: click an empty time slot
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await emptySlot.click();

  // ASSERT: create-activity dialog opens with prefilled fields
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="start"]')).not.toHaveValue('');
  await expect(dialog.locator('input[name="end"]')).not.toHaveValue('');
});
