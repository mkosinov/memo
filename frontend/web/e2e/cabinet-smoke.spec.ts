/**
 * cabinet-smoke.spec.ts — #513 Task 6: the FIRST web e2e spec (smoke).
 *
 * Scope is the infrastructure gate, not the C-scenarios (Tasks 7–10):
 *   1. anonymous /cabinet → the #523 phone-login form is visible;
 *   2. the globalSetup client session (storageState, seed client c1
 *      «Анна Иванова» logged in via the real OTP flow — the code read
 *      from the test DB) → the authenticated cabinet shell.
 *
 * Stack: scripts/e2e-stack.sh (own web+backend pair from the dynamic
 * 28000-32700 window, run-tag lease) — NEVER the playground :3101.
 */
import { test, expect } from 'playwright/test';

test.describe('#513 web cabinet smoke', () => {
  // Anonymous context: the project-level default storageState (the c1
  // client session) must NOT leak into the login-form check — the admin
  // e2e opt-out pattern (a bare `undefined` does not override a
  // project-level storageState default).
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous /cabinet shows the phone login form', async ({ page }) => {
    await page.goto('/cabinet');

    // The #523 shell: phone input + «Войти» submit, no authenticated block.
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
    await expect(page.locator('[data-testid="cabinet-logged-in"]')).toHaveCount(0);
  });
});

test.describe('#513 web cabinet smoke (client session)', () => {
  // Project default storageState = globalSetup's OTP login as seed
  // client c1 (phone +79001234567) — this spec runs WITH it.
  test('client session opens the authenticated cabinet shell', async ({ page }) => {
    await page.goto('/cabinet');

    await expect(page.locator('[data-testid="cabinet-logged-in"]')).toBeVisible();
    await expect(page.locator('[data-testid="cabinet-phone"]')).toHaveText('+79001234567');
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  });
});
