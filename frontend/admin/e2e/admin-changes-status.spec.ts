import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { switchToRecordsTab, getRecordStatus } from './fixtures/scenarios';

test('US-M05: Admin can change record status via icon picker', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();
  await switchToRecordsTab(page);

  // Find first record's status icon
  const firstRecord = page.locator('[data-testid="record"]').first();
  const recordName = (await firstRecord.locator('[data-testid="client-name"]').textContent()) ?? '';
  const statusIcon = firstRecord.locator('[data-testid="status-icon"]');
  await statusIcon.click();

  // Picker opens with 4 options (icons, Russian labels in tooltips)
  const picker = page.locator('[data-testid="status-picker"]');
  await expect(picker).toBeVisible();
  const options = picker.locator('[data-status]');
  await expect(options).toHaveCount(4);
  await expect(picker).toContainText('Ожидание');
  await expect(picker).toContainText('Посетил');
  await expect(picker).toContainText('Отменил');
  await expect(picker).toContainText('Неявка');

  // Select "Отменил"
  await picker.locator('[data-status="cancelled"]').click();

  // Assert: icon updated
  await expect.poll(async () => getRecordStatus(page, recordName)).toBe('cancelled');
});
