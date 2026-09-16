/**
 * master-role-payments.spec.ts — GH #263 T10, scenario S3.
 *
 * S3 — «Оплаты»: мастер создал / изменил / удалил оплату СВОЕЙ записи —
 * статус оплаты записи пересчитался.
 *
 * The payment entry lives in the schedule modal's client tab (the records
 * detail panel is display-only for payments — records-view US-4 precedent):
 *   - create:  btn-add-payment → add-payment-amount → Enter (blur-to-commit)
 *   - edit:    InlineEditCell on the saved row commits via PATCH
 *   - delete:  payment-{id}-delete → deferred DELETE + toast «Удалено»
 * The recalculated badge is asserted against the /records page's Оплата
 * column (✓ Оплачено / Частично (N ₽) / Не оплачено) — derived server-side
 * from payments (T2 scoped /records/view).
 *
 * RED note (TDD): payment scoping landed in T4 (backend TDD —
 * backend/tests/test_master_scope_payments.py); the UI payment mechanics
 * are pinned by unified-rows.spec.ts. This spec is the acceptance layer:
 * a master payment CUD on an own record with recalculated payment status.
 *
 * Wait strategy: deleting a payment is DEFERRED (5 s buffer before the
 * DELETE fires — unified-rows 16b), so the delete round waits for the
 * DELETE wire response before asserting the badge.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import {
  waitForScheduleReady, waitForRecordsReady, openModal,
} from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient, createTestActivity, createTestRecord,
  cleanup, cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('GH #263 S3 — master payment CUD recalculates payment status', () => {
  useMasterSession();

  test('create → Частично; top-up → Оплачено; delete → back to Не оплачено', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    // OWN fixtures (admin pen — no activities:write on the master token):
    // one visit at 3500 ₽, no payments → the badge starts «Не оплачено».
    const client = await createTestClient(admin);
    const activity = await createTestActivity(admin, { master_id: 'm1' });
    const record = await createTestRecord(admin, activity.id, client.id);

    try {
      // ── Badge baseline: Не оплачено ────────────────────────────────────
      const readBadge = async (): Promise<string> => {
        await waitForRecordsReady(page);
        const row = page.locator('tbody tr').filter({ hasText: client.name }).first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        return (await row.locator('td').nth(8).textContent()) ?? '';
      };
      expect((await readBadge()).trim()).toBe('Не оплачено');

      // ── 1. CREATE 1500 ₽ → Частично (1 500 ₽) ──────────────────────────
      await waitForScheduleReady(page);
      await openModal(page, { recordId: record.id });
      await switchToRecordsTab(page);
      await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible();

      await page.locator('[data-testid="btn-add-payment"]').click();
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();
      await amountInput.fill('1500');
      const createdWait = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/payments') &&
          r.request().method() === 'POST' && r.status() === 201,
        { timeout: 15_000 },
      );
      await amountInput.press('Enter');
      const created = await createdWait;
      const payment = (await created.json()) as { id: string };
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      await page.locator('[data-testid="modal-close-btn"]').click();
      expect((await readBadge()).trim()).toMatch(/Частично \(1[\s\u00A0]?500/);

      // ── 2. EDIT the saved row to 3500 ₽ → ✓ Оплачено ───────────────────
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openModal(page, { recordId: record.id });
      await switchToRecordsTab(page);
      const paymentRow = page.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(paymentRow).toBeVisible({ timeout: 10_000 });

      // The saved amount cell is ALWAYS an <input type=number> (InlineEditCell)
      // — fill + Enter (blur-to-commit) PATCHes it.
      const editInput = paymentRow.locator('input[type="number"]');
      const patchedWait = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/payments/${payment.id}`) &&
          r.request().method() === 'PATCH' && r.ok(),
        { timeout: 15_000 },
      );
      await editInput.fill('3500');
      await editInput.press('Enter');
      await patchedWait;

      await page.locator('[data-testid="modal-close-btn"]').click();
      expect((await readBadge()).trim()).toBe('✓ Оплачено');

      // ── 3. DELETE the payment → Не оплачено again ──────────────────────
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openModal(page, { recordId: record.id });
      await switchToRecordsTab(page);
      const rowToDelete = page.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(rowToDelete).toBeVisible({ timeout: 10_000 });
      const deleteWait = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/payments/${payment.id}`) &&
          r.request().method() === 'DELETE',
        { timeout: 15_000 },
      );
      await rowToDelete.locator(`[data-testid="payment-${payment.id}-delete"]`).click();
      await deleteWait; // deferred — fires ≤5 s later (unified-rows 16b)

      await page.locator('[data-testid="modal-close-btn"]').click();
      expect((await readBadge()).trim()).toBe('Не оплачено');
    } finally {
      // Deferred DELETE may still be in flight — hard-delete via API too.
      await cleanupRecord(admin, record.id);
      await cleanup(admin, `/api/v1/activities/${activity.id}`);
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await admin.dispose();
    }
  });
});
