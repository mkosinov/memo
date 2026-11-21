/**
 * auth-session.spec.ts — GH #247 User Scenario 4 (spec §6); retargeted to
 * the #584 /my-namespace: the session cookie is `memo_staff_session`
 * (spec §2.6 rename) and the guarded liveness wire is the whoami
 * `GET /api/v1/my` (the former `/auth/me` is deleted → 404).
 *
 * Logout deletes the session row; the protected page then redirects to
 * /login and the guarded API answers 401.
 *
 * Anonymous precondition (#584 §7 scenario 6 — «гость без редиректа»):
 * the whoami answers a plain 401 envelope for a guest — the admin
 * bootstrap treats it as «guest» (Task 8: 401 → null, no redirect; the
 * api-client's exact-path GET /api/v1/my exception is unit-pinned).
 *
 * The session here is SELF-CONTAINED (API login + explicit cookie), NOT the
 * globalSetup storageState: logout REVOKES the server-side session row, and
 * revoking the shared admin.json token would bounce every later spec in the
 * run to /login (sessions are never wiped by RESET_SQL, so the file's
 * session must outlive this spec). Anonymous start is also the honest
 * precondition: the spec proves a LIVE cookie works, then proves logout
 * kills it.
 */
import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';

const BACKEND = resolveBackendUrl();

test.describe('User Scenario 4 — logout', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logout redirects protected routes to /login and the API answers 401', async ({ page, request }) => {
    // Anonymous precondition (#584 §7 scenario 6): the whoami probe a
    // guest bootstrap makes answers the plain 401 envelope — no redirect,
    // no second cookie semantics (the SPA turns it into «гость»).
    const anonWho = await request.get(`${BACKEND}/api/v1/my`);
    expect(anonWho.status()).toBe(401);
    expect((await anonWho.json())?.detail?.code).toBe('AUTH_UNAUTHORIZED');

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
    // #584 §2.6: the staff cookie is memo_staff_session (the login must
    // issue the NEW name — the old memo_session is nobody's valid ticket).
    const token = /memo_staff_session=([^;]+)/.exec(setCookie)![1];
    await page.context().addCookies([{
      name: 'memo_staff_session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);

    // The session is live: protected route renders the app shell.
    await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
    await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

    // Logout via the UserMenu popup (GH #262 §5.1): open the user plate,
    // then click «Выйти» (a menuitem now, no longer a standalone button).
    await page.getByRole('button', { name: 'Меню пользователя' }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();

    // Guarded page now bounces to /login (guard keeps the returnTo).
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // The presented cookie is dead: the guarded whoami answers 401 via the
    // same browser context (page.request shares cookies + fetch metadata).
    // (#584: /auth/me is deleted — /api/v1/my is the guarded liveness wire.)
    const me = await page.request.get(`${BACKEND}/api/v1/my`);
    expect(me.status()).toBe(401);
    const body = await me.json();
    // Error envelope: {detail: {code, message}} (errors.py / ErrorDetail).
    expect(body?.detail?.code).toBe('AUTH_UNAUTHORIZED');

    // A fresh navigation to a protected route stays on /login (no session).
    await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
