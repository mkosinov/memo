/**
 * auth-roles.spec.ts — GH #247 User Scenario 2, G2-revised (spec §6).
 *
 * The master sees the SAME interface as the admin (identical nav/sections —
 * display tuning per role is a recorded future task, spec §8). The user
 * block shows the master's name and the «Мастер» role label. A forbidden
 * write (creating a payment) is rejected by the API with 403 and surfaces
 * as the standard error toast — the enforcing layer in v1.
 */
import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import { queryDBRow } from './fixtures/db-query';

test.describe('User Scenario 2 — master signs in, same interface', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('master sees identical nav, own user block, and payment write is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-phone').fill('+79990000002');
    await page.locator('#login-password').fill('master12345');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Same app shell as the admin (no nav filtering in v1 — G2 decision).
    await expect(page).toHaveURL(/\/$/);
    const menubar = page.locator('[data-testid="menubar"]');
    await expect(menubar).toBeVisible({ timeout: 30_000 });

    // Identical nav as admin: top-level items + Справочники submenu (Услуги/
    // Локации/Теги render only after the submenu expands — navigation.spec's
    // pattern), + Фото.
    for (const label of ['Расписание', 'Записи', 'Клиенты', 'Фото']) {
      await expect(menubar.locator(`a[aria-label="${label}"]`)).toHaveCount(1);
    }
    const directoriesBtn = menubar.getByRole('button', { name: 'Справочники' });
    await expect(directoriesBtn).toHaveCount(1);
    await directoriesBtn.click();
    for (const label of ['Услуги', 'Локации', 'Теги']) {
      // Directory links render text only (no aria-label) — same locator
      // pattern as navigation.spec.ts.
      await expect(menubar.locator('a', { hasText: label }).first()).toBeVisible();
    }
    await directoriesBtn.click();

    // User block: linked master profile (m1) → display name «Ольга Середа»
    // (master profile name, §4.5) and the «Мастер» role label.
    const userBlock = page.locator('[data-testid="user-avatar"]').locator('..');
    await expect(userBlock).toContainText('Ольга Середа');
    await expect(userBlock).toContainText('Мастер');

    // Forbidden write: add a payment in the activity modal's client tab
    // → standard API error toast (AUTH_FORBIDDEN, 403 from the backend).
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await openModal(page);
    await switchToRecordsTab(page);
    const paymentsTable = page.locator('[data-testid="record-payments-table"]');
    await expect(paymentsTable).toBeVisible({ timeout: 15_000 });

    const seedCount = queryDBRow(
      `SELECT COUNT(*) AS n FROM payments WHERE length(id) > 3`,
    ) as unknown as { n: number };

    // Capture the write attempt itself (API contract: 403 AUTH_FORBIDDEN).
    const paymentResponses: number[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/api/v1/payments') && resp.request().method() === 'POST') {
        paymentResponses.push(resp.status());
      }
    });

    await page.locator('[data-testid="btn-add-payment"]').click();
    const amountInput = page.locator('[data-testid="add-payment-amount"]');
    await expect(amountInput).toBeVisible();
    await amountInput.fill('1000');
    await amountInput.press('Enter');

    // Standard error toast (parseApiError default for AUTH_FORBIDDEN) —
    // the toast container + error toasts carry data-testids (ToastContainer).
    await expect(page.getByTestId('toast-error')).toContainText('Недостаточно прав', {
      timeout: 10_000,
    });

    // API rejected the write with 403 and the DB is unchanged.
    expect(paymentResponses).toEqual([403]);
    const afterCount = queryDBRow(
      `SELECT COUNT(*) AS n FROM payments WHERE length(id) > 3`,
    ) as unknown as { n: number };
    expect(afterCount.n).toBe(seedCount.n);
  });
});
