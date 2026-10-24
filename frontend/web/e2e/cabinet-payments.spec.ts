/**
 * cabinet-payments.spec.ts — #513 Task 9: the «Мои платежи» screen
 * (User Scenario С4).
 *
 *   С4 — the logged-in seed client (c1 «Анна Иванова», the project's
 *        storageState default) opens /cabinet/payments and sees her
 *        payments with lesson context: amount, method, payment date and
 *        the record's service title + lesson date.
 *
 * Seed facts (backend/src/seed/seed.py; sort = created_at DESC, id ASC):
 *   p1 → r1: 6000 ₽, card («Карта»), record «Морской пейзаж» 2026-06-15
 *   p4 → r4: 2000 ₽, cash («Наличные»), record «Мини-картина
 *        акрилом» 2026-06-16
 *   Both payments share the seed-time created_at, so ROW ORDER is not
 *   pinned — rows are located by amount. The payment's own date is the
 *   seed time (stack-start dependent) — asserted by its formatted shape,
 *   not an exact value.
 *
 *   The seed has NO method:null payment for c1 — the «Способ не указан»
 *   label is covered by component tests with fixtures
 *   (cabinet-payments.test.tsx / to-my-payment-vm.test.ts); this spec
 *   asserts what the seed provides.
 */
import { test, expect } from 'playwright/test';

test.describe('#513 С4 — client sees the payment history with lesson context', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).
  test('cabinet shows the seed payments with amount, method, date and service context', async ({ page }) => {
    await page.goto('/cabinet/payments');
    await expect(page).toHaveURL(/\/cabinet\/payments$/);

    // The section nav: «Мои платежи» active.
    const nav = page.locator('[data-testid="cabinet-nav"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Мои платежи' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Exactly c1's two seed payments (isolation: c2/c3/c4/c5 payments
    // ride their own records and must never appear).
    const rows = page.locator('[data-testid="my-payment-row"]');
    await expect(rows).toHaveCount(2);

    // p1 — 6 000 ₽ by card, for «Морской пейзаж» on 15 июня.
    const byCard = rows.filter({ hasText: '6 000 ₽' });
    await expect(byCard).toHaveCount(1);
    await expect(byCard.locator('[data-testid="my-payment-method"]')).toHaveText(
      'Карта',
    );
    const cardLesson = byCard.locator('[data-testid="my-payment-lesson"]');
    await expect(cardLesson).toHaveText('Морской пейзаж, 15 июня');

    // p4 — 2 000 ₽ in cash, for «Мини-картина акрилом» on 16 июня.
    const byCash = rows.filter({ hasText: '2 000 ₽' });
    await expect(byCash).toHaveCount(1);
    await expect(byCash.locator('[data-testid="my-payment-method"]')).toHaveText(
      'Наличные',
    );
    await expect(byCash.locator('[data-testid="my-payment-lesson"]')).toHaveText(
      'Мини-картина акрилом, 16 июня',
    );

    // The payment's own date renders in the cabinet's «D месяц» shape
    // (value = seed time — not pinned).
    for (const row of await rows.all()) {
      await expect(row.locator('[data-testid="my-payment-date"]')).toHaveText(
        /^\d{1,2} [а-яё]+$/,
      );
    }

    // One page — no pagination, no empty state.
    await expect(page.locator('[data-testid="list-pagination"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="my-payments-empty"]')).toHaveCount(0);
  });
});
