/**
 * account-management.spec.ts — GH #348 spec §2, S5/S6.
 *
 * S5 — the admin edits the account phone in the «Учётка» block: the save
 *      fires a SEPARATE PATCH /api/v1/users/{id} with the strict {phone}
 *      body; login works by the NEW phone (the old one is dead); saving a
 *      phone that belongs to another account renders the inline error
 *      «Этот телефон уже занят» and keeps the modal open.
 * S6 — a passwordless account: the block shows «Пароль ещё не установлен»
 *      + the «Выдать ссылку» button; after issuance the block shows the
 *      «Ссылка выдана, действует до …» STATUS (no link itself); login by
 *      such an account is refused with the ordinary invalid-credentials
 *      error (spec §4 — no passwordless-specific message).
 */
import { test, expect } from './fixtures/test';
import { request as apiRequest, type APIRequestContext } from '@playwright/test';
import { cleanup, E2E_PASSWORD } from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let phoneCounter = 0;
/**
 * GH #414: the account phone is the PhoneField widget — a 10-digit RU
 * remainder (possible for RU); the compact '+7…' reaches the wire/DB, the
 * national remainder (phone.slice(2)) is what the test types into the input.
 */
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7994${String(Date.now()).slice(-6)}${phoneCounter}`;
}

/** The grouped display of a 10-digit RU remainder in the widget input. */
function groupedRu(national: string): string {
  return national.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2-$3-$4');
}

/** A passwordless staff card + account (no link yet) — the admin corridor. */
async function createPasswordlessAccount(request: APIRequestContext): Promise<{
  staffId: string;
  userId: string;
  phone: string;
}> {
  const phone = uniquePhone();
  const createResp = await request.post(`${BACKEND}/api/v1/staff`, {
    data: {
      first_name: 'Блоков',
      last_name: `Учёткин${Date.now()}`,
      avatar_url: '',
      sort_order: 999,
      master: null,
      position_ids: [],
      create_user: { phone },
    },
  });
  expect(createResp.status()).toBe(201);
  const staff = await createResp.json();
  expect(staff.account?.id).toBeTruthy();
  return { staffId: staff.id, userId: staff.account.id, phone };
}

/** Issue a link for the account and install `password` through the PUBLIC
 *  endpoint (setup detail — the employee-side UI corridor is covered by
 *  password-setup-link.spec.ts S2). */
async function apiIssueLinkAndSetPassword(
  request: APIRequestContext,
  userId: string,
  password: string,
): Promise<void> {
  const linkResp = await request.post(`${BACKEND}/api/v1/users/${userId}/password-link`);
  expect(linkResp.status()).toBe(200);
  const { token } = await linkResp.json();
  const setup = await request.post(`${BACKEND}/api/v1/auth/password-setup`, {
    data: { token, password },
  });
  expect(setup.status()).toBe(204);
}

/** A cookie-less API context for login probes (the staff-s7 lesson: a
 *  login through the admin-cookied context would rotate the shared admin
 *  session and 401 every later spec in the worker). */
async function anonLoginContext(): Promise<APIRequestContext> {
  return apiRequest.newContext({
    baseURL: BACKEND,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
  });
}

test.describe('#348 S5 — account phone edit', () => {
  test('edit phone → PATCH /users/{id} → login by the NEW phone; taken phone → inline error', async ({ page, request }) => {
    const { staffId, userId, phone } = await createPasswordlessAccount(request);
    await apiIssueLinkAndSetPassword(request, userId, E2E_PASSWORD);
    const newPhone = uniquePhone();
    let loginCtx: APIRequestContext | null = null;
    try {
      await waitForStaffReady(page);
      await page.locator(`[data-testid="master-row-${staffId}"]`).click();

      // The «Учётка» block is present with the CURRENT phone prefilled —
      // the widget initialized from the stored compact (RU selector, the
      // grouped national remainder in the input).
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактирование сотрудника')).toBeVisible();
      const accountPhone = dialog.locator('[data-testid="staff-account-phone-input"]');
      await expect(accountPhone).toHaveValue(groupedRu(phone.slice(2)));

      // Change the phone and save — the account write is a SEPARATE request.
      await accountPhone.fill(newPhone.slice(2));
      const patchPromise = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/users/${userId}`) && r.request().method() === 'PATCH',
      );
      await dialog.locator('[data-testid="staff-modal-save-btn"]').click();
      const patch = await patchPromise;
      expect(patch.status()).toBe(200);
      // Strict body (spec §5): {phone} only — no extra keys.
      expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ phone: newPhone });

      // The block's toast + the card's own save both land; the row keeps
      // the fresh account state (a kindless showToast renders toast-info).
      await expect(page.locator('[data-testid="toast-info"]').filter({ hasText: 'Телефон учётки обновлён' }))
        .toBeVisible({ timeout: 10_000 });

      // VERIFY DB — the account row carries the new phone.
      expect(queryDBRow(`SELECT phone FROM users WHERE id='${userId}'`)!.phone).toBe(newPhone);

      // Login works by the NEW phone; the OLD one is dead (spec §2 S5).
      loginCtx = await anonLoginContext();
      const byNew = await loginCtx.post(`${BACKEND}/api/v1/auth/login`, {
        data: { phone: newPhone, password: E2E_PASSWORD },
      });
      expect(byNew.ok(), 'login by the NEW phone').toBeTruthy();
      const byOld = await loginCtx.post(`${BACKEND}/api/v1/auth/login`, {
        data: { phone, password: E2E_PASSWORD },
      });
      expect(byOld.status(), 'login by the OLD phone').toBe(401);
      await loginCtx.dispose();
      loginCtx = null;

      // ── Taken phone → inline error, modal stays open ──────────────────
      await page.locator(`[data-testid="master-row-${staffId}"]`).click();
      await expect(page.getByRole('dialog').getByText('Редактирование сотрудника')).toBeVisible();
      const dialog2 = page.getByRole('dialog');
      // The seeded admin's phone (+79990000001) is taken by construction —
      // the national remainder is typed into the widget; the PATCH carries
      // the assembled compact.
      await dialog2.locator('[data-testid="staff-account-phone-input"]').fill('9990000001');
      const patch2Promise = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/users/${userId}`) && r.request().method() === 'PATCH',
      );
      await dialog2.locator('[data-testid="staff-modal-save-btn"]').click();
      const patch2 = await patch2Promise;
      expect(patch2.status()).toBe(422);
      expect((await patch2.json())?.detail?.code).toBe('PHONE_TAKEN');

      // Inline error in the block; the modal is still open (the admin can fix
      // the field right there); the DB phone is untouched.
      await expect(dialog2.getByText('Этот телефон уже занят')).toBeVisible();
      await expect(dialog2).toBeVisible();
      expect(queryDBRow(`SELECT phone FROM users WHERE id='${userId}'`)!.phone).toBe(newPhone);
    } finally {
      if (loginCtx) await loginCtx.dispose();
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staffId}`);
    }
  });
});

test.describe('#348 S6 — passwordless account state', () => {
  test('«Пароль ещё не установлен» + «Выдать ссылку»; after issuance — the status line; login refused', async ({ page, browser, request }) => {
    const { staffId, userId, phone } = await createPasswordlessAccount(request);
    let employeeCtx: import('@playwright/test').BrowserContext | null = null;
    try {
      await waitForStaffReady(page);
      await page.locator(`[data-testid="master-row-${staffId}"]`).click();

      // The block: passwordless state — hint + the «Выдать ссылку» flavor
      // of the issuance button (label flips on password_is_set, spec §6).
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактирование сотрудника')).toBeVisible();
      await expect(dialog.getByText('Пароль ещё не установлен')).toBeVisible();
      const issueBtn = dialog.locator('[data-testid="issue-link-btn"]');
      await expect(issueBtn).toHaveText('Выдать ссылку');
      // No live-link status yet.
      await expect(dialog.locator('[data-testid="live-link-status"]')).toHaveCount(0);
      // VERIFY DB — the account is passwordless.
      expect(queryDBRow(`SELECT password_hash FROM users WHERE id='${userId}'`)!.password_hash).toBeNull();

      // Issue from the block: the one-time link dialog opens with the URL.
      const linkPromise = page.waitForResponse(
        (r) => r.url().includes('/password-link') && r.request().method() === 'POST',
      );
      await issueBtn.click();
      const linkResp = await linkPromise;
      expect(linkResp.status()).toBe(200);
      const { token } = await linkResp.json();
      const linkDialog = page.locator('[data-testid="password-link-dialog"]');
      await expect(linkDialog).toBeVisible();
      const origin = new URL(page.url()).origin;
      await expect(linkDialog.locator('[data-testid="link-url-field"]'))
        .toHaveValue(`${origin}/password-setup#token=${token}`);
      // VERIFY DB — the live token row (unused).
      expect(queryDBRow(`SELECT used_at FROM password_setup_tokens WHERE user_id='${userId}'`)!.used_at).toBeNull();

      // Close the link dialog and the modal, then REOPEN the card: the
      // block now shows the STATUS line only (the link itself is never
      // re-displayed — spec §6), the button keeps the passwordless label.
      await linkDialog.locator('[data-testid="link-dialog-close-btn"]').click();
      await dialog.locator('[data-testid="staff-modal-cancel-btn"]').click();
      await page.locator(`[data-testid="master-row-${staffId}"]`).click();
      const dialog2 = page.getByRole('dialog');
      await expect(dialog2.getByText('Редактирование сотрудника')).toBeVisible();
      await expect(dialog2.locator('[data-testid="live-link-status"]'))
        .toContainText('Ссылка выдана, действует до', { timeout: 10_000 });
      await expect(dialog2.locator('[data-testid="issue-link-btn"]')).toHaveText('Выдать ссылку');
      // The raw link is NOT shown in the block — only the expiry status.
      await expect(dialog2.locator('[data-testid="staff-account-phone-input"]'))
        .toHaveValue(groupedRu(phone.slice(2)));
      await expect(dialog2.getByTestId('link-url-field')).toHaveCount(0);

      // Login by the passwordless account is REFUSED — the ordinary
      // invalid-credentials error (spec §4), through the real /login form
      // in a fresh anonymous context (explicit empty storageState — the
      // login POST must never present the admin cookie).
      employeeCtx = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1280, height: 720 },
      });
      const empPage = await employeeCtx.newPage();
      await empPage.goto('/login');
      await empPage.locator('#login-phone').fill(phone);
      await empPage.locator('#login-password').fill('any-guess-will-fail');
      await empPage.getByRole('button', { name: 'Войти' }).click();
      await expect(empPage.getByTestId('login-error')).toContainText('Неверный телефон или пароль', {
        timeout: 15_000,
      });
    } finally {
      if (employeeCtx) await employeeCtx.close();
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staffId}`);
    }
  });
});
