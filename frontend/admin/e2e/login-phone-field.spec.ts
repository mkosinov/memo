import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { seedStaffUser, E2E_PASSWORD } from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #414 — User Scenario 7 (spec §User Scenarios): the login screen runs
 * the PhoneField widget WITHOUT the completeness validator — every account
 * that could sign in before still can.
 *   • an account stored under a legacy spelling («+7 999 111-22-33»)
 *     signs in by typing the RU remainder: the submitted compact misses the
 *     exact lookup, the backend's unique to_national_digits reduction finds
 *     the account;
 *   • an account of an out-of-list country («+1 555 123-45-67») is pasted
 *     into the widget → «без страны» state — and signs in with DIGITS only;
 *   • an unknown number gets the unified «Неверный телефон или пароль»
 *     refusal and stays on /login.
 *
 * Full Cycle: SETUP seeds throwaway users (never the shared admin — one
 * failed attempt must never trip the lockout ladder for it); ACTION drives
 * the real /login form; VERIFY UI (menubar / login-error) plus the login
 * request payload (compact vs digits — the frontend contract); CLEANUP
 * hard-deletes the seeded users.
 */

/** Cold-stack safety (cabinet.spec.ts pattern): /login compiles on first
 *  hit in a dev server — wait for the form with generous headroom. */
async function waitForLoginForm(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 60_000 });
}

/** Best-effort hard delete of a seeded user (cabinet.spec.ts pattern). */
function deleteUser(id: string): void {
  try {
    queryDBRow(`DELETE FROM users WHERE id='${id}'`);
  } catch {
    /* best-effort */
  }
}

test.describe('Login phone field (GH #414 scenario 7)', () => {
  // Login flows need a fresh anonymous context — the project default
  // storageState carries the admin session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('legacy «+7 999 …» spelling signs in via the widget (compact on the wire, reduction match)', async ({
    page,
  }) => {
    const userId = seedStaffUser({ phone: '+7 999 111-22-33' });
    try {
      await page.goto('/login');
      await waitForLoginForm(page);

      // The widget with the RU selector default; the #login-phone anchor now
      // addresses the remainder input.
      await expect(page.getByTestId('phone-country-select')).toContainText('Россия');

      const loginReq = page.waitForRequest((req) => req.url().includes('/api/v1/auth/login'));
      await page.locator('#login-phone').pressSequentially('9991112233');
      await page.locator('#login-password').fill(E2E_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();

      // VERIFY — the bound country lifts the compact «+79991112233».
      expect((await loginReq).postDataJSON().phone).toBe('+79991112233');
      // Exact string misses, the unique reduction matches → the app shell.
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });
    } finally {
      deleteUser(userId);
    }
  });

  test('out-of-list «+1 …» account pastes into «без страны» and signs in with digits only', async ({
    page,
  }) => {
    const userId = seedStaffUser({ phone: '+1 555 123-45-67' });
    try {
      await page.goto('/login');
      await waitForLoginForm(page);

      // A typed «+» never enters the widget — the out-of-list number must
      // arrive by paste (the only path into the «no country» state).
      const input = page.locator('#login-phone');
      await input.click();
      await page.evaluate(
        (text) => {
          const el = document.getElementById('login-phone')!;
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          el.dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
          );
        },
        '+1 555 123-45-67',
      );

      // «Без страны»: raw digits stay, no template grouping.
      await expect(input).toHaveValue('15551234567');

      const loginReq = page.waitForRequest((req) => req.url().includes('/api/v1/auth/login'));
      await page.locator('#login-password').fill(E2E_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();

      // VERIFY — unbound field sends the typed digits, no compact exists.
      expect((await loginReq).postDataJSON().phone).toBe('15551234567');
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });
    } finally {
      deleteUser(userId);
    }
  });

  test('unknown number → unified refusal, stays on /login', async ({ page }) => {
    // Nothing is seeded: random digits match no ACTIVE user.
    const digits = `999${String(Date.now() % 1_000_000_000).padStart(9, '0').slice(0, 7)}`;
    await page.goto('/login');
    await waitForLoginForm(page);
    await page.locator('#login-phone').pressSequentially(digits);
    await page.locator('#login-password').fill(`wrong-${E2E_PASSWORD}`);
    await page.getByRole('button', { name: 'Войти' }).click();

    // One unified message for every refusal cause (zero reduction matches
    // here; wrong password shares the same text by design).
    await expect(page.getByTestId('login-error')).toContainText('Неверный телефон или пароль', {
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });
});
