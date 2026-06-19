import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';

test('US-M06: Admin can manage multiple payments (add and delete)', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  const card = page.locator('[data-testid^="activity-"]').first();
  await card.click();
  await switchToRecordsTab(page);

  // Expand first record's payment section
  const firstRecord = page.locator('[data-testid="record"]').first();
  await firstRecord.locator('button:has-text("Оплата")').click();

  const paymentList = firstRecord.locator('[data-testid="payment-list"]');
  const addBtn = firstRecord.locator('button:has-text("Добавить оплату")');

  // Add 1st payment (1000)
  await addBtn.click();
  await firstRecord.locator('input[name="amount"]').fill('1000');
  await firstRecord.locator('button:has-text("Сохранить")').click();
  await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(1);

  // Add 2nd payment (500)
  await addBtn.click();
  await firstRecord.locator('input[name="amount"]').fill('500');
  await firstRecord.locator('button:has-text("Сохранить")').click();
  await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(2); // NOT 1

  // Delete the 2nd (500)
  const rows = paymentList.locator('[data-testid="payment-row"]');
  await rows.nth(1).locator('button:has-text("Удалить")').click();
  await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(1);
  await expect(rows.first()).toContainText('1000');
});
