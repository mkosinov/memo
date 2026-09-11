/**
 * auth-login.spec.ts — GH #247 User Scenarios 1 + 3 (spec §6).
 *
 * S1 — Admin signs in: phone + password on /login → lands in the app and
 *      sees all sections (incl. «Материалы» on the services page and the
 *      «Платежи» payments table in the activity modal).
 * S3 — Wrong password: inline error + toast, stays on /login, no session
 *      cookie is set.
 *
 * Both specs opt OUT of the globalSetup storageState with an explicit empty
 * state (`undefined` does not override a project default — the fresh
 * context is the whole point of a login flow). The wrong-password test uses
 * a DEDICATED throwaway user (seedStaffUser) — never the shared admin
 * phone — so a failed attempt can never trip the lockout ladder for the
 * seeded admin used by every other e2e test (lockout itself is
 * unit/API-covered).
 */
import { test, expect } from './fixtures/test';
import { seedStaffUser, E2E_PASSWORD } from './fixtures/factories';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';

test.describe('User Scenario 1 — admin signs in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('admin logs in via UI and sees all sections incl. Материалы and Платежи', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#login-phone').fill('+79990000001');
    await page.locator('#login-password').fill('admin12345');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Landed in the app with the menubar (the (main) shell) rendered.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

    // Services page hosts the «Материалы» view toggle.
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Управление материалами' })).toBeHidden();
    await page.getByRole('button', { name: 'Материалы', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Управление материалами' })).toBeVisible({ timeout: 15_000 });

    // «Платежи» — the payments table inside the activity modal's client tab.
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await openModal(page);
    await switchToRecordsTab(page);
    await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('User Scenario 3 — wrong password', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('wrong password shows error, stays on /login, sets no cookie', async ({ page }) => {
    // Dedicated throwaway user: one wrong attempt against a phone no other
    // test shares (ladder itself is unit/API-covered, spec §7).
    const phone = `+7999${Date.now() % 1_000_000_000}`.slice(0, 13);
    seedStaffUser({ phone });

    let setCookieHeader: string | null = null;
    page.on('response', (resp) => {
      if (resp.url().includes('/api/v1/auth/login')) {
        setCookieHeader = resp.headers()['set-cookie'] ?? null;
      }
    });

    await page.goto('/login');
    await page.locator('#login-phone').fill(phone);
    await page.locator('#login-password').fill(`wrong-${E2E_PASSWORD}`);
    await page.getByRole('button', { name: 'Войти' }).click();

    // Inline error + standard error toast (spec §6 scenario 3).
    await expect(page.getByTestId('login-error')).toContainText('Неверный телефон или пароль', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('toast-error')).toContainText('Неверный телефон или пароль', {
      timeout: 10_000,
    });

    // Still on the login page — no redirect into the app.
    await expect(page).toHaveURL(/\/login/);

    // No session cookie was set (401, no Set-Cookie on the login response).
    expect(setCookieHeader).toBeNull();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'memo_session')).toBeUndefined();
  });
});
