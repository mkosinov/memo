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
import { resolveBackendUrl } from './lib/backend-url';
import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import type { Locator } from '@playwright/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import {
  waitForScheduleReady, waitForRecordsReady, openModal,
  installReferenceWeekClock,
} from './fixtures/helpers';
import { seedId } from './fixtures/seed-ids';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient, createTestActivity, createTestRecord,
  cleanup, cleanupRecord,
} from './fixtures/factories';

const BACKEND = resolveBackendUrl();

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import: CI's `playwright --list` collects specs before the
// shard stack seeds the DB.
test.beforeAll(() => {
  M1 = seedId('staff', 'last_name', 'Середа');
});

/**
 * GH #422: the recalculated badge is asserted on /records, whose default
 * period is monday..sunday of the PAGE-CLOCK week — pin the clock to the
 * seed's reference week (install-before-goto) so the own-record fixture
 * row sits inside the default range.
 */
test.beforeEach(async ({ page }) => {
  await installReferenceWeekClock(page);
});


let M1 = '';

test.describe('GH #263 S3 — master payment CUD recalculates payment status', () => {
  useMasterSession();

  test('create → Частично; top-up → Оплачено; delete → back to Не оплачено', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    // OWN fixtures (admin pen — no activities:write on the master token):
    // one visit at 3500 ₽, no payments → the badge starts «Не оплачено».
    const client = await createTestClient(admin);
    const activity = await createTestActivity(admin, { master_id: M1 });
    const record = await createTestRecord(admin, activity.id, client.id);

    try {
      // ── Badge baseline: Не оплачено ────────────────────────────────────
      // #535 (relational level): the badge is ONE cell of the filtered row
      // — the isVisible-guarded one-shot textContent() reads become locator
      // auto-retry asserts (toHaveText polls through re-renders; a raw read
      // taken between the visibility check and the next React commit is the
      // #479/#515 race family).
      const badgeCell = async (): Promise<Locator> => {
        await waitForRecordsReady(page);
        return page
          .locator('tbody tr')
          .filter({ hasText: client.name })
          .first()
          .locator('td')
          .nth(8);
      };
      await expect(await badgeCell()).toHaveText('Не оплачено', { timeout: 15_000 });

      // ── 1. CREATE 1500 ₽ → Частично (1 500 ₽) ──────────────────────────
      await waitForScheduleReady(page, SEED_WEEK_MONDAY);
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
      await expect(await badgeCell()).toHaveText(/Частично \(1[\s\u00A0]?500/, { timeout: 15_000 });

      // ── 2. EDIT the saved row to 3500 ₽ → ✓ Оплачено ───────────────────
      await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
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
      await expect(await badgeCell()).toHaveText('✓ Оплачено', { timeout: 15_000 });

      // ── 3. DELETE the payment → Не оплачено again ──────────────────────
      await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
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
      await expect(await badgeCell()).toHaveText('Не оплачено', { timeout: 15_000 });
    } finally {
      // Deferred DELETE may still be in flight — hard-delete via API too.
      await cleanupRecord(admin, record.id);
      await cleanup(admin, `/api/v1/activities/${activity.id}`);
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await admin.dispose();
    }
  });
});
