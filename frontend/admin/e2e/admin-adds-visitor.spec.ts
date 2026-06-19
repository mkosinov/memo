import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { openActivityByTitle, addVisitor, switchToRecordsTab } from './fixtures/scenarios';
import { queryDBRow } from './fixtures/db-query';

test('US-M03: Admin can add visitor and see it in modal without F5', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open an activity
  const card = page.locator('[data-testid^="activity-"]').first();
  const titleText = (await card.textContent()) ?? '';
  await card.click();

  // Switch to Records tab
  await switchToRecordsTab(page);

  // Add a visitor
  const recordId = await addVisitor(page, {
    name: 'Тест Тестов',
    phone: '+79991234567',
    seats: 2,
  });

  // US-M03 assertions
  const record = page.locator('[data-testid="record"]').filter({
    hasText: 'Тест Тестов',
  });
  await expect(record).toBeVisible();
  await expect(record).toContainText('+79991234567');
  await expect(record).toContainText('2 места'); // US-M07

  // US-M08: name is shown (not just phone)
  await expect(record.locator('[data-testid="client-name"]')).toContainText('Тест Тестов');

  // Verify in DB
  const row = await queryDBRow(`SELECT seats, status FROM records WHERE id = '${recordId}'`);
  expect(row?.seats).toBe(2);

  // No F5: do not call page.reload()
});
