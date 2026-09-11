/**
 * auth-session.spec.ts — GH #247 User Scenario 4 (spec §6).
 *
 * Logout deletes the session row; the protected page then redirects to
 * /login and the guarded API answers 401.
 *
 * The session here is SELF-CONTAINED (API login + explicit cookie), NOT the
 * globalSetup storageState: logout REVOKES the server-side session row, and
 * revoking the shared admin.json token would bounce every later spec in the
 * run to /login (sessions are never wiped by RESET_SQL, so the file's
 * session must outlive this spec). Anonymous start is also the honest
 * precondition: the spec proves a LIVE cookie works, then proves logout
 * kills it.
 */
import { test, expect } from './fixtures/test';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('User Scenario 4 — logout', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logout redirects protected routes to /login and the API answers 401', async ({ page, request }) => {
    // Arrange: establish a real admin session via the API and inject the
    // cookie into the browser context (SameSite=Lax holds — 127.0.0.1 page
    // origin vs 127.0.0.1 API host are the same site).
    const login = await request.post(`${BACKEND}/api/v1/auth/login`, {
      data: { phone: '+79990000001', password: 'admin12345' },
      headers: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(login.ok()).toBeTruthy();
    const setCookie = login.headers()['set-cookie'];
    expect(setCookie, 'login must set the session cookie').toBeTruthy();
    const token = /memo_session=([^;]+)/.exec(setCookie)![1];
    await page.context().addCookies([{
      name: 'memo_session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);

    // The session is live: protected route renders the app shell.
    await page.goto('/schedule');
    await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

    // Logout via the user-block control.
    await page.locator('button[aria-label="Выйти"]').click();

    // Guarded page now bounces to /login (guard keeps the returnTo).
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // The presented cookie is dead: guarded endpoint answers 401 via the
    // same browser context (page.request shares cookies + fetch metadata).
    const me = await page.request.get(`${BACKEND}/api/v1/auth/me`);
    expect(me.status()).toBe(401);
    const body = await me.json();
    // Error envelope: {detail: {code, message}} (errors.py / ErrorDetail).
    expect(body?.detail?.code).toBe('AUTH_UNAUTHORIZED');

    // A fresh navigation to a protected route stays on /login (no session).
    await page.goto('/schedule');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
