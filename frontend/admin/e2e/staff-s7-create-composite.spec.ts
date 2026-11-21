/**
 * S7 (GH #266) — «Создание карточки сразу с учёткой и мастером».
 * Extended for #348 S1: the account is born PASSWORDLESS.
 * Extended for #599 §7.2: the master directions are dictionary CHECKBOXES
 * (the free-text CSV input is gone); the display string is alphabetical.
 *
 * One create-modal pass fills the person + checks «Сделать мастером»
 * (direction checkboxes + color) + checks «Создать учётку» (phone ONLY —
 * the password field is gone since #348 spec §6) and saves. The single
 * POST /api/v1/staff transaction (D8) writes the staff card, the masters
 * extension row, the position links and the passwordless users account;
 * the follow-up POST /users/{id}/password-link issues the one-time setup
 * link and the handover dialog appears (link field + «Скопировать» +
 * «действует до …» + «передайте ссылку сотруднику»); the DB row keeps NO
 * password hash and the raw token only as its SHA-256 digest.
 *
 * The §7.2 test below keeps its scenario pure (no account): directions
 * checked NOT in alphabetical order → the card and the table show the
 * alphabetical string «Живопись, Керамика».
 */
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { request as apiRequest } from '@playwright/test';
import crypto from 'node:crypto';
import { cleanup } from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { seedId } from './fixtures/seed-ids';
// The exported expiry formatter — ONE rendering of the dialog's
// «Действует до …» line, no hand-copied duplicate in this spec.
import { formatLinkExpiry } from '../app/(main)/staff/components/PasswordLinkDialog';

const BACKEND = resolveBackendUrl();

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import (CI's `playwright --list` collects specs before the
// shard stack seeds the DB). The seed dictionary carries exactly these two
// directions for staff («Декор» is the free leaf): «Живопись» and
// «Керамика» — canonical titles, capital first letter.
let ZHIVOPIS_ID = '';
let KERAMIKA_ID = '';

test.beforeAll(() => {
  ZHIVOPIS_ID = seedId('specialties', 'title', 'Живопись');
  KERAMIKA_ID = seedId('specialties', 'title', 'Керамика');
});

let phoneCounter = 0;
/**
 * GH #414: the account phone is the PhoneField widget — the test types the
 * NATIONAL remainder; the compact '+7…' (10-digit RU remainder, possible for
 * RU) is assembled by the modal and is what reaches the wire and the DB.
 */
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7996${String(Date.now()).slice(-6)}${phoneCounter}`;
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

      // «Сделать мастером» (D6/D5) — directions + color. GH #599: the
      // free-text CSV input is gone — dictionary CHECKBOXES instead; the
      // check order is the input order (deliberately NOT alphabetical:
      // «Керамика» first, then «Живопись» — the §7.2 discriminating input).
      await dialog.locator('[data-testid="master-section-checkbox"]').check();
      await dialog.locator(`[data-testid="specialty-checkbox-${KERAMIKA_ID}"]`).check();
      await dialog.locator(`[data-testid="specialty-checkbox-${ZHIVOPIS_ID}"]`).check();
      await dialog.locator('input[placeholder="#5B8C7A"]').fill('#CD5C5C');

      // «Создать учётку» (#348: phone ONLY — no password field on the form).
      await dialog.locator('[data-testid="create-user-checkbox"]').check();
      // GH #414: the widget input — national digits; the compact is asserted
      // on the wire below.
      await dialog.locator('[data-testid="staff-phone-input"]').fill(phone.slice(2));
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
      // 1. Person (staff card) with the master section reflected in the
      //    response. GH #599: the input traveled as specialty_ids in CHECK
      //    order («Керамика» first); the answer's display string is the
      //    ALPHABETICAL joined string (§4.4) with the canonical titles.
      expect(JSON.parse(create.request().postData() ?? '{}').master.specialty_ids)
        .toEqual([KERAMIKA_ID, ZHIVOPIS_ID]);
      expect(body.master).toMatchObject({
        specialty: 'Живопись, Керамика',
        color: '#CD5C5C',
        archived: false,
      });
      expect(body.master.specialty_ids.slice().sort()).toEqual(
        [ZHIVOPIS_ID, KERAMIKA_ID].sort(),
      );
      expect(body.position_ids).toEqual(['master']);
      // 2. The masters extension row exists, active (the directions live in
      //    staff_specialties now — the masters row carries color only).
      expect(queryDBRow(`SELECT color, is_active FROM masters WHERE staff_id='${createdId}'`))
        .toMatchObject({ color: '#CD5C5C', is_active: 1 });
      expect(
        queryDBRows(`SELECT specialty_id FROM staff_specialties WHERE staff_id='${createdId}'`)
          .map((r) => String(r.specialty_id))
          .sort(),
      ).toEqual([ZHIVOPIS_ID, KERAMIKA_ID].sort());
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

  // ── GH #599 §7 scenario 2 — alphabetical display string ────────────────

  test('§7.2: directions checked NOT in alphabetical order — the card and the table show «Живопись, Керамика»', async ({
    page,
    request,
  }) => {
    const lastName = `Алфавитова${Date.now()}`;
    let createdId: string | undefined;

    try {
      await waitForStaffReady(page);
      await page.getByText('+ Добавить сотрудника').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText('Новый сотрудник')).toBeVisible();

      // Person fields (the create pass of the S7 test above).
      await dialog.locator('input[placeholder="Иван"]').fill('Вера');
      await dialog.locator('input[placeholder="Иванов"]').fill(lastName);

      // Master section. INPUT ORDER deliberately NOT alphabetical:
      // «Керамика» first, THEN «Живопись» (the §7.2 discriminating input —
      // the check order is what travels to the wire).
      await dialog.locator('[data-testid="master-section-checkbox"]').check();
      const created = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/staff') && r.request().method() === 'POST',
      );
      await dialog.locator(`[data-testid="specialty-checkbox-${KERAMIKA_ID}"]`).check();
      await dialog.locator(`[data-testid="specialty-checkbox-${ZHIVOPIS_ID}"]`).check();
      // Color keeps its '#5B8C7A' default — the scenario is about directions.
      await dialog.getByRole('button', { name: 'Сохранить' }).click();

      const resp = await created;
      expect(resp.status()).toBe(201);
      const body = await resp.json();
      createdId = body.id;

      // CARD (the saved card's data) — the wire carried the CHECK order
      // (non-alphabetical input, §4.4 hard-replace), the response answers
      // with the ALPHABETICAL display string of canonical titles.
      expect(JSON.parse(resp.request().postData() ?? '{}').master.specialty_ids)
        .toEqual([KERAMIKA_ID, ZHIVOPIS_ID]);
      expect(body.master).toMatchObject({ specialty: 'Живопись, Керамика' });
      expect(body.master.specialty_ids.slice().sort()).toEqual(
        [ZHIVOPIS_ID, KERAMIKA_ID].sort(),
      );

      // TABLE — the row shows the alphabetical string.
      const row = page.locator(`[data-testid="master-row-${createdId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText('Живопись, Керамика');
      await expect(row).not.toContainText('Керамика, Живопись');

      // CARD (reopened) — the saved set renders as CHECKED checkboxes in
      // the dictionary's alphabetical list order; no input-order echo.
      await row.click();
      const edit = page.getByRole('dialog');
      await expect(edit.getByText('Редактирование сотрудника')).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        edit.locator(`[data-testid="specialty-checkbox-${ZHIVOPIS_ID}"]`),
      ).toBeChecked();
      await expect(
        edit.locator(`[data-testid="specialty-checkbox-${KERAMIKA_ID}"]`),
      ).toBeChecked();
      // View-only close (nothing dirty — no confirm dialog fires).
      await page.keyboard.press('Escape');
      await expect(edit).toHaveCount(0);

      // VERIFY DB — both link rows exist for the card.
      expect(
        queryDBRows(`SELECT specialty_id FROM staff_specialties WHERE staff_id='${createdId}'`)
          .map((r) => String(r.specialty_id))
          .sort(),
      ).toEqual([ZHIVOPIS_ID, KERAMIKA_ID].sort());

      // VERIFY SORT (§7 tail) — the staff list ordered by `specialty` sorts
      // by the DISPLAY string: this card («Живопись, Керамика», Ж…) ranks
      // BEFORE every «Керамика»-only card (К…), never after them as the
      // input-order string «Керамика, Живопись» would.
      const sortedResp = await request.get(
        `${BACKEND}/api/v1/staff?sort_by=specialty&sort_order=asc&per_page=100`,
      );
      expect(sortedResp.ok()).toBeTruthy();
      const items = ((await sortedResp.json()) as {
        items: { id: string; master?: { specialty: string } | null }[];
      }).items;
      const myIdx = items.findIndex((s) => s.id === createdId);
      expect(myIdx).toBeGreaterThanOrEqual(0);
      const kIdx = items.findIndex((s) => s.master?.specialty === 'Керамика');
      expect(kIdx, 'sorted-by-specialty: a seed «Керамика» card must be on the page')
        .toBeGreaterThanOrEqual(0);
      expect(myIdx).toBeLessThan(kIdx);
    } finally {
      if (createdId) await cleanup(request, `/api/v1/staff/${createdId}`);
    }
  });
});
