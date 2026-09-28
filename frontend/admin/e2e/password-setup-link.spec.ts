/**
 * password-setup-link.spec.ts — GH #348 spec §2, S2/S3/S4.
 *
 * S2 — the employee opens the link: /password-setup#token=… validates the
 *      token BEFORE the form appears; «Придумайте пароль» (password +
 *      confirmation) installs it; login with the phone + the NEW password
 *      succeeds; the token row is consumed (used_at set).
 * S3 — reissue: a new link KILLS the former one (the issue sweep deletes
 *      every prior token of the account); the OLD link's validate → the
 *      dead screen lane; the NEW link still installs.
 * S4 — reuse: opening/validating an ALREADY-USED link shows the single
 *      dead screen «Ссылка недействительна или истекла», form never shows.
 *
 * Setup uses the passwordless composite create (POST /staff) + the admin
 * issue endpoint (POST /users/{id}/password-link) over the shared `request`
 * fixture (admin cookie) — the same corridor the admin UI drives.
 *
 * The PUBLIC flows (link page + employee login) run in a FRESH browser
 * context (browser.newContext, no storageState): the page must work for a
 * signed-out employee AND the login POST must never present the admin
 * cookie (session rotation would kill the shared admin session — the
 * staff-s7 lesson).
 */
import { test, expect } from './fixtures/test';
import { request as apiRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { cleanup, E2E_PASSWORD } from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7995${String(Date.now()).slice(-7)}${phoneCounter}`;
}

/** A passwordless staff card + account + a live setup link (admin corridor).
 *  Returns the card id, the account id, the phone and the RAW link token. */
async function createAccountWithLink(request: APIRequestContext): Promise<{
  staffId: string;
  userId: string;
  phone: string;
  token: string;
}> {
  const phone = uniquePhone();
  const createResp = await request.post(`${BACKEND}/api/v1/staff`, {
    data: {
      first_name: 'Ссылкин',
      last_name: `Установов${Date.now()}`,
      avatar_url: '',
      sort_order: 999,
      master: null,
      position_ids: [],
      create_user: { phone },
    },
  });
  expect(createResp.status()).toBe(201);
  const staff = await createResp.json();
  const accountId: string = staff.account?.id;
  expect(accountId).toBeTruthy();

  const linkResp = await request.post(`${BACKEND}/api/v1/users/${accountId}/password-link`);
  expect(linkResp.status()).toBe(200);
  const link = await linkResp.json();

  return { staffId: staff.id, userId: accountId, phone, token: link.token };
}

/** A cookie-less API context for login probes (never rotates the shared
 *  admin session — the staff-s7 lesson). Dispose in the caller's finally.
 *  NOTE: account-management.spec.ts carries its own copy of this helper
 *  (deliberately not extracted into shared fixtures); keep the empty
 *  storageState + Sec-Fetch-Site contract in sync if this one changes. */
async function anonLoginContext(): Promise<APIRequestContext> {
  return apiRequest.newContext({
    baseURL: BACKEND,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
  });
}

/** Fresh anonymous browser context — NO admin cookie (the explicit empty
 *  storageState OVERRIDES the project-level default that browser.newContext
 *  would otherwise inherit; the employee login must never present the
 *  admin session — rotation would delete it, the staff-s7 lesson). */
async function anonContext(browser: Browser) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Open /password-setup#token=… and install `password` through the form. */
async function installPasswordViaLink(
  page: import('@playwright/test').Page,
  token: string,
  password: string,
): Promise<void> {
  await page.goto(`/password-setup#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible({ timeout: 15_000 });
  await page.locator('#password-setup-password').fill(password);
  await page.locator('#password-setup-confirm').fill(password);
  await page.getByRole('button', { name: 'Установить пароль' }).click();
  await expect(page.getByRole('heading', { name: 'Пароль установлен' })).toBeVisible({ timeout: 15_000 });
}

test.describe('#348 S2 — install password by link, then log in', () => {
  test('validate passes → form → install → success page → login with the new password', async ({ browser, request }) => {
    const { staffId, userId, phone, token } = await createAccountWithLink(request);
    const { ctx, page } = await anonContext(browser);
    try {
      await page.goto(`/password-setup#token=${token}`);

      // The form appears only after the pre-form validate passed; the
      // fragment is STRIPPED from the address bar (spec §6).
      await expect(page.getByRole('heading', { name: 'Придумайте пароль' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('password-setup-invalid')).toBeHidden();
      await expect(page).toHaveURL(/\/password-setup$/);

      // Fill password + confirmation, submit.
      await page.locator('#password-setup-password').fill(E2E_PASSWORD);
      await page.locator('#password-setup-confirm').fill(E2E_PASSWORD);
      const setupPromise = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/auth/password-setup'),
      );
      await page.getByRole('button', { name: 'Установить пароль' }).click();
      const setup = await setupPromise;
      expect(setup.status()).toBe(204);

      // Success screen (spec §6): «Пароль установлен» + «Войти» → /login.
      await expect(page.getByRole('heading', { name: 'Пароль установлен' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Войдите с телефоном и новым паролем')).toBeVisible();
      await page.getByRole('link', { name: 'Войти' }).click();
      await expect(page).toHaveURL(/\/login/);

      // VERIFY DB — hash set, token CONSUMED (used_at NOT NULL, not just
      // the row existing: the consume claim needs the timestamp set).
      expect(queryDBRow(`SELECT password_hash FROM users WHERE id='${userId}'`)!.password_hash).not.toBeNull();
      expect(
        queryDBRow(`SELECT used_at FROM password_setup_tokens WHERE user_id='${userId}'`)!.used_at,
      ).not.toBeNull();

      // Login with the phone + the new password — the real /login form
      // (spec §2: «вход с телефоном и новым паролем»).
      await page.locator('#login-phone').fill(phone);
      await page.locator('#login-password').fill(E2E_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

      // The page's own session is the employee's (not the admin's). The
      // /auth/me wire keeps the legacy `master_id` field (== staff card id).
      const me = await page.request.get(`${BACKEND}/api/v1/auth/me`);
      expect(me.status()).toBe(200);
      expect((await me.json())?.user?.master_id).toBe(staffId);
    } finally {
      await ctx.close();
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staffId}`);
    }
  });
});

test.describe('#348 S3 — reissue kills the former link', () => {
  test('reissue → the OLD link is dead; exactly one live token; the NEW link still works', async ({ browser, request }) => {
    const { staffId, userId, phone, token: oldToken } = await createAccountWithLink(request);
    let loginCtx: APIRequestContext | null = null;
    try {
      // Set a password via the old link first (the reset corridor starts
      // from a passworded account — the «Сбросить пароль» flavor).
      const { ctx, page } = await anonContext(browser);
      await installPasswordViaLink(page, oldToken, E2E_PASSWORD);
      await ctx.close();

      // Reissue (the admin's «Сбросить пароль»): the sweep deletes every
      // former token (used ones too) and inserts the fresh live one.
      const reissue = await request.post(`${BACKEND}/api/v1/users/${userId}/password-link`);
      expect(reissue.status()).toBe(200);
      const { token: newToken } = await reissue.json();
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(oldToken);

      // VERIFY DB — exactly ONE token row for the account (the old digest
      // was deleted by the sweep, not merely marked used).
      const tokenCount = queryDBRow(`SELECT COUNT(*) AS n FROM password_setup_tokens WHERE user_id='${userId}'`);
      expect(Number(tokenCount!.n)).toBe(1);

      // The OLD link is dead: validate rejects it (S4 lane).
      const oldValidate = await request.post(`${BACKEND}/api/v1/auth/password-setup/validate`, {
        data: { token: oldToken },
      });
      expect(oldValidate.status()).toBe(422);
      expect((await oldValidate.json())?.detail?.code).toBe('PASSWORD_LINK_INVALID');

      // The NEW link still installs (the sweep did not brick the account).
      const anon2 = await anonContext(browser);
      await installPasswordViaLink(anon2.page, newToken, E2E_PASSWORD);
      await anon2.ctx.close();

      // VERIFY — login with the new password works on the account.
      loginCtx = await anonLoginContext();
      const login = await loginCtx.post(`${BACKEND}/api/v1/auth/login`, {
        data: { phone, password: E2E_PASSWORD },
      });
      expect(login.ok()).toBeTruthy();
    } finally {
      if (loginCtx) await loginCtx.dispose();
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staffId}`);
    }
  });
});

test.describe('#348 S4 — reused link shows the dead screen', () => {
  test('after a successful install, re-opening the SAME link → «Ссылка недействительна или истекла», no form', async ({ browser, request }) => {
    const { staffId, userId, token } = await createAccountWithLink(request);
    try {
      // Consume the link once.
      const first = await anonContext(browser);
      await installPasswordViaLink(first.page, token, E2E_PASSWORD);
      await first.ctx.close();

      // Re-open the SAME link in a fresh context: the pre-form validate
      // rejects the consumed token → the single dead screen, form never shows.
      const second = await anonContext(browser);
      await second.page.goto(`/password-setup#token=${token}`);
      await expect(second.page.getByTestId('password-setup-invalid')).toBeVisible({ timeout: 15_000 });
      await expect(second.page.getByText('Ссылка недействительна или истекла')).toBeVisible();
      await expect(second.page.getByRole('heading', { name: 'Придумайте пароль' })).toBeHidden();
      await second.ctx.close();

      // A garbage token lands on the same screen (S4: неверная ссылка).
      const garbage = await anonContext(browser);
      await garbage.page.goto('/password-setup#token=not-a-real-token-at-all');
      await expect(garbage.page.getByTestId('password-setup-invalid')).toBeVisible({ timeout: 15_000 });
      await garbage.ctx.close();
    } finally {
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staffId}`);
    }
  });
});
