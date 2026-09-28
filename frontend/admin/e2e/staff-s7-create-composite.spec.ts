/**
 * S7 (GH #266) — «Создание карточки сразу с учёткой и мастером».
 * Extended for #348 S1: the account is born PASSWORDLESS.
 *
 * One create-modal pass fills the person + checks «Сделать мастером»
 * (specialty + color) + checks «Создать учётку» (phone ONLY — the password
 * field is gone since #348 spec §6) and saves. The single POST /api/v1/staff
 * transaction (D8) writes the staff card, the masters extension row, the
 * position links and the passwordless users account; the follow-up
 * POST /users/{id}/password-link issues the one-time setup link and the
 * handover dialog appears (link field + «Скопировать» + «действует до …» +
 * «передайте ссылку сотруднику»); the DB row keeps NO password hash and
 * the raw token only as its SHA-256 digest.
 */
import { test, expect } from './fixtures/test';
import { request as apiRequest } from '@playwright/test';
import crypto from 'node:crypto';
import { cleanup } from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
// The exported expiry formatter — ONE rendering of the dialog's
// «Действует до …» line, no hand-copied duplicate in this spec.
import { formatLinkExpiry } from '../app/(main)/staff/components/PasswordLinkDialog';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7996${String(Date.now()).slice(-7)}${phoneCounter}`;
}

test.describe('S7 — create card with account + master in one scenario', () => {
  test('one modal pass creates the person, the master section and the passwordless login + link dialog', async ({ page, request }) => {
    const phone = uniquePhone();
    const lastName = `Однимсценариев${Date.now()}`;
    let createdId: string | undefined;
    try {
      await waitForStaffReady(page);
      await page.getByText('+ Добавить сотрудника').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText('Новый сотрудник')).toBeVisible();

      // Person fields.
      await dialog.locator('input[placeholder="Иван"]').fill('Ведёт');
      await dialog.locator('input[placeholder="Иванов"]').fill(lastName);

      // Position checkbox (D4).
      await dialog.locator('[data-testid="position-checkbox-master"]').check();

      // «Сделать мастером» (D6/D5) — specialty + color.
      await dialog.locator('[data-testid="master-section-checkbox"]').check();
      await dialog.locator('input[placeholder="живопись, керамика"]').fill('керамика, живопись');
      await dialog.locator('input[placeholder="#5B8C7A"]').fill('#CD5C5C');

      // «Создать учётку» (#348: phone ONLY — no password field on the form).
      await dialog.locator('[data-testid="create-user-checkbox"]').check();
      await dialog.locator('input[placeholder="+79990000000"]').fill(phone);
      // The password field is GONE (spec §6 «Парольного поля нет») — the
      // checkbox label says the owner will set the password via the link.
      await expect(dialog.getByText('Создать учётку (телефон, пароль задаст сотрудник)')).toBeVisible();
      await expect(dialog.locator('input[type="password"]')).toHaveCount(0);

      // One POST /staff carries the whole composite card; the link issuance
      // is the SEPARATE follow-up — register ALL listeners BEFORE the save
      // click so no response or toast is ever missed. The create toast is
      // registered here AND awaited before the dialog round-trip: toasts
      // auto-dismiss after 4.5s, and the issuance + dialog assertions used
      // to push the wait past that window (review: flake risk).
      const createPromise = page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/staff') && r.request().method() === 'POST',
      );
      const linkRespPromise = page.waitForResponse(
        (r) => r.url().includes('/password-link') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      const toastReady = page
        .locator('[data-testid="toast-info"]')
        .filter({ hasText: 'Сотрудник создан' })
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => {});
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const create = await createPromise;
      expect(create.status()).toBe(201);
      const body = await create.json();
      createdId = body.id;
      expect(body.has_user).toBe(true);
      await toastReady;

      // The handover dialog opens on top of the create modal.
      const linkDialog = page.locator('[data-testid="password-link-dialog"]');
      await expect(linkDialog).toBeVisible({ timeout: 15_000 });
      const linkResp = await linkRespPromise;
      expect(linkResp.status()).toBe(200);
      const linkBody = await linkResp.json();
      expect(linkBody.token).toBeTruthy();
      expect(linkBody.expires_at).toBeTruthy();

      // Dialog contents (spec §6): the full link, «Скопировать», the expiry
      // line, the handover hint. The URL is assembled from the page origin.
      const origin = new URL(page.url()).origin;
      const linkField = linkDialog.locator('[data-testid="link-url-field"]');
      await expect(linkField).toHaveValue(`${origin}/password-setup#token=${linkBody.token}`);
      await expect(linkDialog.getByRole('button', { name: 'Скопировать' })).toBeVisible();
      // The expiry line (spec §2 S1: срок действия) — rendered by the
      // dialog's own exported formatter (the exact same string).
      await expect(linkDialog.getByText('Действует до', { exact: false }))
        .toHaveText(`Действует до ${formatLinkExpiry(linkBody.expires_at)}`);
      await expect(linkDialog.getByText('Передайте ссылку сотруднику', { exact: false })).toBeVisible();

      // Close the handover; the create toast was already asserted above
      // (before the dialog round-trip), and the row visibility below pins
      // the persisted card.
      await linkDialog.locator('[data-testid="link-dialog-close-btn"]').click();
      await expect(page.locator(`[data-testid="master-row-${createdId}"]`)).toBeVisible({ timeout: 10_000 });

      // VERIFY — the composite write touched all four surfaces.
      // 1. Person (staff card) with the master section reflected in the response.
      expect(body.master).toMatchObject({ specialty: 'керамика, живопись', color: '#CD5C5C', archived: false });
      expect(body.position_ids).toEqual(['master']);
      // 2. The masters extension row exists, active.
      expect(queryDBRow(`SELECT specialty, color, is_active FROM masters WHERE staff_id='${createdId}'`))
        .toMatchObject({ specialty: 'керамика, живопись', color: '#CD5C5C', is_active: 1 });
      // 3. The position link.
      expect(queryDBRow(`SELECT position_id FROM staff_positions WHERE staff_id='${createdId}' AND position_id='master'`))
        .not.toBeNull();
      // 4. The account — linked to the card, active, role derived from the master
      //    section, and PASSWORDLESS (#348: password_hash NULL, one live token
      //    stored as its SHA-256 digest).
      const userRow = queryDBRow(`SELECT id, staff_id, is_active, role, password_hash FROM users WHERE phone='${phone}'`);
      expect(userRow).toMatchObject({ staff_id: createdId, is_active: 1, role: 'master' });
      expect(userRow!.password_hash).toBeNull();
      const digest = crypto.createHash('sha256').update(linkBody.token).digest('hex');
      const tokenRow = queryDBRow(
        `SELECT user_id, used_at FROM password_setup_tokens WHERE token='${digest}'`,
      );
      expect(tokenRow!.user_id).toBe(userRow!.id);
      expect(tokenRow!.used_at).toBeNull();

      // The person is now an acting master (in /api/v1/masters).
      expect((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id)).toContain(createdId);

      // The passwordless account CANNOT log in (#348 §4) — the ordinary
      // invalid-credentials answer, not a passwordless-specific error.
      // Isolated cookie-less context (the staff-s7 login-probe lesson:
      // never rotate the shared admin session).
      const loginCtx = await apiRequest.newContext({
        baseURL: BACKEND,
        storageState: { cookies: [], origins: [] },
        extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
      });
      try {
        const login = await loginCtx.post(`${BACKEND}/api/v1/auth/login`, {
          data: { phone, password: 'whatever-wrong-password' },
        });
        expect(login.status()).toBe(401);
        expect((await login.json())?.detail?.code).toBe('AUTH_INVALID_CREDENTIALS');
      } finally {
        await loginCtx.dispose();
      }
    } finally {
      // Tokens cascade with the users row (FK ON DELETE CASCADE), but the
      // CLI runs with foreign_keys=OFF — sweep them explicitly, users-first.
      try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id IN (SELECT id FROM users WHERE phone='${phone}')`); } catch { /* best-effort */ }
      try { queryDBRow(`DELETE FROM users WHERE phone='${phone}'`); } catch { /* best-effort */ }
      if (createdId) await cleanup(request, `/api/v1/staff/${createdId}`);
    }
  });
});
