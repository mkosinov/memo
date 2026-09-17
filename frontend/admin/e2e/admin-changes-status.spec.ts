import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

test('US-M05: Admin can change record status via icon picker', async ({
  page,
  request,
}) => {
  // Own factory record (GH #252): the coarse record-status handler REWRITES
  // the record's visits (delete + recreate) — on a seed record that
  // permanently deletes seed visits v1/v2 (the canonical reset never
  // restores seed rows) and poisons every later spec incl. the
  // records-table visual baselines (CI run 35179631302 root cause).
  const client = await createTestClient(request);
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id);

  try {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    await openModal(page, { recordId: record.id });

    // Switch to our record's client tab
    const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
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
  } finally {
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});
