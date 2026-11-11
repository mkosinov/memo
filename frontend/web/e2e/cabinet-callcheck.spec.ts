/**
 * cabinet-callcheck.spec.ts — #593 Task 6: the cabinet callcheck flow.
 *
 * Dev transport (CALLCHECK_TRANSPORT=dev): initiate hands out the fixed
 * dev number; the client's call is imitated through POST /auth/call/dev-done.
 *
 * - US-2 «Вход в кабинет звонком»: the cabinet phone form → the same
 *   method picker → «Подтвердить звонком» → dev-done → poll `confirmed`
 *   → the session flips the cabinet to «Мои записи» (redirect to
 *   /cabinet/records) with the auth user's phone confirmed in the DB.
 * - US-5 «Окно истекло»: a dev check expires ONLY through the local
 *   window (the dev provider always answers waiting), so the spec
 *   time-travels the check row's created_at past the 300-s window
 *   (inside the 360-s purge TTL) → «Время вышло» → «Позвонить ещё раз»
 *   issues a FRESH initiate (new handle + window) which confirms fine.
 */
import { test, expect } from 'playwright/test';
import {
  DEV_CALL_PHONE,
  DEV_CALL_PRETTY,
  initiateViaUi,
  captureInitiate,
  imitateDevCall,
  backdateAuthCallWindow,
  cleanupCallcheckData,
  uniqueTestPhone,
} from './fixtures/callcheck';
import { queryDBRow } from './fixtures/db-query';

/** Anonymous flows: opt out of the project-level storageState (the
 * globalSetup c1 session) — the admin e2e opt-out pattern. */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('#593 cabinet callcheck (dev transport)', () => {
  test('US-2: cabinet login confirmed by call → «Мои записи»', async ({
    page,
    request,
  }) => {
    const phone = uniqueTestPhone();
    try {
      await page.goto('/cabinet');

      // The phone form → the auth screen with the method picker.
      await page.locator('#phone').fill(phone);
      await page.getByRole('button', { name: 'Войти' }).click();

      await expect(page.locator('[data-testid="auth-method-picker"]')).toBeVisible();
      await expect(page.locator('[data-testid="auth-method-call"]')).toBeVisible();

      // The call screen on the CABINET surface (the visual-compliance
      // check: auth-call-screen appears on the cabinet login too).
      const initiation = await initiateViaUi(page);
      expect(initiation.call.phone).toBe(DEV_CALL_PHONE);
      await expect(page.locator('[data-testid="auth-call-screen"]')).toBeVisible();
      await expect(page.locator('[data-testid="auth-call-number"]')).toHaveText(
        DEV_CALL_PRETTY,
      );

      // Dev call imitation → the poll confirms → the session lands → the
      // cabinet redirects to its first section. The 30-s budget absorbs a
      // fresh dev server's first-hit compile of the target route (the
      // 10-s default proved too tight under load).
      await imitateDevCall(request, initiation.handle);
      await expect(page).toHaveURL(/\/cabinet\/records/, { timeout: 30_000 });
      await expect(page.locator('[data-testid="cabinet-nav"]')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
      await expect(page.locator('[data-testid="my-records-empty"]')).toBeVisible();

      // VERIFY DB: the finalizer find-or-created the auth user with the
      // phone confirmed (the shared client-login finalizer, #593).
      const user = queryDBRow(
        `SELECT phone_is_confirmed FROM users WHERE phone = '${phone}'`,
      );
      expect(user, 'the auth user exists under the test phone').not.toBeNull();
      expect(Number(user!.phone_is_confirmed)).toBe(1);
    } finally {
      cleanupCallcheckData(phone);
    }
  });

  test('US-5: window expiry → «Время вышло» → «Позвонить ещё раз» works', async ({
    page,
    request,
  }) => {
    const phone = uniqueTestPhone();
    try {
      await page.goto('/cabinet');
      await page.locator('#phone').fill(phone);
      await page.getByRole('button', { name: 'Войти' }).click();

      const first = await initiateViaUi(page);
      await expect(page.locator('[data-testid="auth-call-timer"]')).toBeVisible();

      // Time-travel the live check past its 300-s window (the dev check
      // expires through the local window only — see the fixture). The
      // next browser poll reports `expired` → the screen flips.
      backdateAuthCallWindow(phone);

      await expect(page.getByText('Время вышло')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Позвонить ещё раз' }),
      ).toBeVisible();

      // The retry: a FRESH initiate — new handle, new window, live screen.
      const retryPromise = captureInitiate(page);
      await page.getByRole('button', { name: 'Позвонить ещё раз' }).click();
      const second = await retryPromise;
      expect(second.handle).not.toBe(first.handle);
      expect(second.call.phone).toBe(DEV_CALL_PHONE);
      await expect(page.locator('[data-testid="auth-call-screen"]')).toBeVisible();
      await expect(page.locator('[data-testid="auth-call-timer"]')).toBeVisible();

      // The retried check is fully functional: imitate the call → the
      // session lands → the cabinet redirects to «Мои записи».
      await imitateDevCall(request, second.handle);
      await expect(page).toHaveURL(/\/cabinet\/records/, { timeout: 30_000 });
      await expect(page.locator('[data-testid="cabinet-nav"]')).toBeVisible();
    } finally {
      cleanupCallcheckData(phone);
    }
  });
});
