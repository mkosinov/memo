import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

test('US-M05: Admin can change record status via icon picker', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  await openModal(page);

  // Switch to first client tab
  const clientTab = page.locator('[data-testid^="tab-client-"]').first();
  await expect(clientTab).toBeVisible({ timeout: 5_000 });
  await clientTab.click();

  // Wait for the client tab to load
  await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible();

  // Find first visit's status trigger (StatusPicker)
  const statusTrigger = page.locator('[data-testid$="-status-trigger"]').first();
  await expect(statusTrigger).toBeVisible({ timeout: 5_000 });
  await statusTrigger.click();

  // The StatusPicker popover should appear with 4 status options
  const popover = page.locator('[data-testid$="-status-popover"]').first();
  await expect(popover).toBeVisible({ timeout: 3_000 });

  // Verify the options exist
  const options = popover.locator('[data-testid$="-status-option-cancelled"]');
  await expect(options).toBeVisible();

  // Select "Отменил" (cancelled)
  await options.click();

  // Verify the picker closed
  await expect(popover).not.toBeVisible({ timeout: 3_000 });
});
