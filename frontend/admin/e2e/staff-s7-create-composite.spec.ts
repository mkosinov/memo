/**
 * S7 (GH #266) — «Создание карточки сразу с учёткой и мастером».
 *
 * One create-modal pass fills the person + checks «Сделать мастером»
 * (specialty + color) + checks «Создать учётку» (phone + password) and saves.
 * The single POST /api/v1/staff transaction (D8) writes the staff card, the
 * masters extension row, the position links and the users account — so the
 * person is created, can log in, and leads (appears in /masters) at once.
 */
import { test, expect } from './fixtures/test';
import { request as apiRequest } from '@playwright/test';
import { cleanup, E2E_PASSWORD } from './fixtures/factories';
import { waitForStaffReady, waitForToast } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7996${String(Date.now()).slice(-7)}${phoneCounter}`;
}

test.describe('S7 — create card with account + master in one scenario', () => {
  test('one modal pass creates the person, the master section and the login', async ({ page, request }) => {
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

      // «Создать учётку» (D6) — phone + password.
      await dialog.locator('[data-testid="create-user-checkbox"]').check();
      await dialog.locator('input[placeholder="+79990000000"]').fill(phone);
      await dialog.locator('input[type="password"]').fill(E2E_PASSWORD);

      // One POST /staff carries the whole composite card.
      const createPromise = page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/staff') && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const create = await createPromise;
      expect(create.status()).toBe(201);
      const body = await create.json();
      createdId = body.id;

      await waitForToast(page, 'Сотрудник создан');
      // The modal closed and the new row is in the active list.
      await expect(page.locator(`[data-testid="master-row-${createdId}"]`)).toBeVisible({ timeout: 10_000 });

      // VERIFY — the composite write touched all four surfaces.
      // 1. Person (staff card) with the master section reflected in the response.
      expect(body.master).toMatchObject({ specialty: 'керамика, живопись', color: '#CD5C5C', archived: false });
      expect(body.position_ids).toEqual(['master']);
      expect(body.has_user).toBe(true);
      // 2. The masters extension row exists, active.
      expect(queryDBRow(`SELECT specialty, color, is_active FROM masters WHERE staff_id='${createdId}'`))
        .toMatchObject({ specialty: 'керамика, живопись', color: '#CD5C5C', is_active: 1 });
      // 3. The position link.
      expect(queryDBRow(`SELECT position_id FROM staff_positions WHERE staff_id='${createdId}' AND position_id='master'`))
        .not.toBeNull();
      // 4. The account — linked to the card, active, role derived from the master
      //    section (a card WITH a master → 'master' role).
      const userRow = queryDBRow(`SELECT staff_id, is_active, role FROM users WHERE phone='${phone}'`);
      expect(userRow).toMatchObject({ staff_id: createdId, is_active: 1, role: 'master' });

      // The person is now an acting master (in /api/v1/masters) AND can log in.
      expect((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id)).toContain(createdId);

      // Login probe on an ISOLATED, cookie-less request context — NOT the
      // shared `request` fixture. AuthService.login performs OWASP session-id
      // rotation: any `memo_session` cookie PRESENTED on a login is DELETED
      // before the new session is created (backend/src/auth/service.py). The
      // shared fixture carries globalSetup's admin cookie, so logging the new
      // account in through it would destroy the admin session row and 401
      // every later spec in the worker (auth-login/auth-session opt out for
      // the same reason). A fresh context presents no cookie → admin session
      // survives.
      const loginCtx = await apiRequest.newContext({
        baseURL: BACKEND,
        // Explicit empty storageState — guarantees this context presents NO
        // cookie regardless of any project-level storageState inheritance, so
        // the login cannot rotate (delete) the shared admin session.
        storageState: { cookies: [], origins: [] },
        extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
      });
      let loginOk = false;
      try {
        const login = await loginCtx.post(`${BACKEND}/api/v1/auth/login`, {
          data: { phone, password: E2E_PASSWORD },
        });
        loginOk = login.ok();
      } finally {
        await loginCtx.dispose();
      }
      expect(loginOk, 'the freshly created account can log in').toBeTruthy();
    } finally {
      try { queryDBRow(`DELETE FROM users WHERE phone='${phone}'`); } catch { /* best-effort */ }
      if (createdId) await cleanup(request, `/api/v1/staff/${createdId}`);
    }
  });
});
