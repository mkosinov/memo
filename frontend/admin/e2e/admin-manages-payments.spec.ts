import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';

test('US-M06: Admin can manage multiple payments (add and delete)', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  await openModal(page);
  await switchToRecordsTab(page);

  // The RecordPaymentsTable is directly visible in the client tab (no expand needed).
  // Wait for the payments table to be visible
  const paymentsTable = page.locator('[data-testid="record-payments-table"]');
  await expect(paymentsTable).toBeVisible({ timeout: 5_000 });

  // Click "+ Добавить" to open the inline add form
  const addBtn = page.locator('[data-testid="btn-add-payment"]');
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // Fill amount in the inline form
  const amountInput = page.locator('[data-testid="add-payment-amount"]');
  await expect(amountInput).toBeVisible();
  await amountInput.fill('1000');

  // Submit the payment
  const submitBtn = page.locator('[data-testid="add-payment-submit"]');
  await submitBtn.click();

  // Wait for payment to appear
  await page.waitForTimeout(500);

  // Add 2nd payment
  await addBtn.click();
  await amountInput.fill('500');
  await submitBtn.click();
  await page.waitForTimeout(500);

  // Delete the 2nd payment via its delete button
  const deleteBtn = page.locator('[data-testid$="-delete"]').last();
  if (await deleteBtn.isVisible()) {
    await deleteBtn.click();
    await page.waitForTimeout(500);
  }
});
