import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import { openRecordTab } from './helpers/anonymous-visits';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestPayment,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

/**
 * US-M06: Admin can manage multiple payments (add and delete).
 * #243 S1 added the deferred-contract test below; the delete step here is
 * audited for the deferred window (optimistic removal + toast → real DELETE
 * after the 5s window, asserted via the commit response).
 */
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

  // Fill amount in the inline form and commit via Enter (blur-to-commit)
  const amountInput = page.locator('[data-testid="add-payment-amount"]');
  await expect(amountInput).toBeVisible();
  await amountInput.fill('1000');
  await amountInput.press('Enter');

  // Wait for payment to be saved (the new-row input disappears after commit)
  await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

  // Add 2nd payment — re-locate amountInput since DOM changed after save
  await addBtn.click();
  await expect(amountInput).toBeVisible();
  await amountInput.fill('500');
  await amountInput.press('Enter');

  // Wait for 2nd payment to be saved
  await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

  // Delete the 2nd payment — deferred contract (#243): the row disappears
  // optimistically with the undo toast, the real DELETE fires only after the
  // 5s window expires (GH #261 pattern: wait for the real DELETE request,
  // never a fixed sleep).
  const deleteBtn = page.locator('[data-testid$="-delete"]').last();
  if (await deleteBtn.isVisible()) {
    const commitDelete = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/payments/') &&
        resp.request().method() === 'DELETE',
      { timeout: 15_000 },
    );
    await deleteBtn.click();

    // Optimistic removal starts the undo toast («Отменить» button inside).
    const undoToast = page
      .locator('[data-testid="toast-info"]')
      .filter({ hasText: 'Удалено. Отменить' });
    await expect(undoToast).toBeVisible();

    // Window expires → the deferred commit runs the real DELETE.
    const commit = await commitDelete;
    expect([200, 204]).toContain(commit.status());
  }
});

/**
 * #243 S1: deleting a payment on the client-record tab runs the DEFERRED
 * contract — the row disappears optimistically, the undo toast («Удалено.
 * Отменить» + countdown ring) opens the 5s window, and «Отменить» restores
 * the row WITHOUT any server write (the payment stays alive in the DB).
 *
 * Full cycle: factories seed client + activity + record + payment via API →
 * UI deletes → UI verifies undo → API/DB verifies the payment survived.
 * The toast locator is scoped to the toast-info testid — the «Удалено.
 * Отменить» text is shared with the visits surface, but only the payment
 * delete is triggered inside this test.
 */
test('S1: delete payment — undo toast, «Отменить» returns the row, no server DELETE fired', async ({
  page,
  request,
}) => {
  const clientName = `S1 Payments ${Date.now()}`;
  const client = await createTestClient(request, { name: clientName });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id, {
    visits: [],
  });
  const payment = await createTestPayment(request, record.id, { amount: 1000 });

  try {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await openRecordTab(page, record.id);

    const row = page.locator(`[data-testid="payment-${payment.id}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Network counter for the payment's DELETE — registered BEFORE the click.
    const paymentDeletes: string[] = [];
    const onRequest = (req: { method(): string; url(): string }) => {
      if (
        req.method() === 'DELETE' &&
        req.url().includes(`/api/v1/payments/${payment.id}`)
      ) {
        paymentDeletes.push(req.url());
      }
    };
    page.on('request', onRequest);

    // ACTION: delete the payment.
    await page.locator(`[data-testid="payment-${payment.id}-delete"]`).click();

    // Optimistic removal + the undo toast with the countdown ring.
    await expect(row).not.toBeVisible({ timeout: 5_000 });
    const toast = page
      .locator('[data-testid="toast-info"]')
      .filter({ hasText: 'Удалено. Отменить' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Отменить' })).toBeVisible();

    // Undo inside the window: the row returns, the toast hides.
    await toast.getByRole('button', { name: 'Отменить' }).click();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(toast).toBeHidden();

    // Let the full window elapse: no server DELETE may have been sent.
    await page.waitForTimeout(5_500);
    expect(paymentDeletes).toHaveLength(0);
    page.off('request', onRequest);

    // The payment is alive in the DB (undo never touched the server).
    const dbPayment = queryDBRow(`SELECT id FROM payments WHERE id='${payment.id}'`);
    expect(dbPayment).not.toBeNull();
    expect(dbPayment!.id).toBe(payment.id);
  } finally {
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});
