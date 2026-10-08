import { test, expect } from './fixtures/test';
import { cleanup } from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #414 — User Scenario 6 (spec §User Scenarios): the staff modal's phone
 * fields on the PhoneField engine.
 *   • CREATE: the account phone is the widget; an INCOMPLETE number blocks
 *     the account creation — no POST /staff ever leaves the browser; a
 *     complete number creates the card with create_user.phone = the compact
 *     «+<код><нац.>», and the DB account row stores the compact;
 *   • EDIT: the account phone initializes from the stored compact (RU
 *     selector + grouped remainder); an incomplete CHANGED number blocks
 *     BOTH the PATCH /users/:id and the card's PUT (validate() runs before
 *     any network call — the #348 gate); a complete number PATCHes the
 *     compact and the DB account row carries it.
 *
 * Full Cycle: SETUP creates the card through the UI (Part A is the setup of
 * Part B); ACTION edits via the modal; VERIFY UI (widget init, inline error)
 * + DB (SQL compact / absence); CLEANUP sweeps tokens, the users row and the
 * staff card (users-first — the CLI sqlite runs with foreign_keys=OFF).
 */

/** The grouped display of a 10-digit RU remainder in the widget input. */
function groupedRu(national: string): string {
  return national.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2-$3-$4');
}
test.describe('Staff phone fields (GH #414 scenario 6)', () => {
  test('incomplete account phone blocks creation and the account PATCH; the compact reaches the DB', async ({
    page,
    request,
  }) => {
    // A unique 10-digit RU remainder — possible for RU, compact '+7995…'.
    const national = `995${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 9) + 1}`;
    const compact = `+7${national}`;
    const nextNational = `9957654321`;
    const nextCompact = `+7${nextNational}`;
    let createdId: string | undefined;
    let userId: string | undefined;

    // Every relevant write is counted — the blocked saves must add none.
    let staffPosts = 0;
    let userPatches = 0;
    let staffPuts = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/v1/staff')) staffPosts++;
      if (userId && req.method() === 'PATCH' && req.url().includes(`/api/v1/users/${userId}`)) userPatches++;
      if (createdId && req.method() === 'PUT' && req.url().includes(`/api/v1/staff/${createdId}`)) staffPuts++;
    });

    try {
      await waitForStaffReady(page);

      // ── Part A: CREATE — the account phone widget gates creation ───────
      await page.getByText('+ Добавить сотрудника').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog.locator('input[placeholder="Иван"]').fill('Виджетов');
      await dialog.locator('input[placeholder="Иванов"]').fill(`Телефонов${Date.now()}`);
      await dialog.locator('[data-testid="create-user-checkbox"]').check();

      // Both surfaces of the composite field: the selector + the remainder.
      const createInput = dialog.locator('[data-testid="staff-phone-input"]');
      await expect(dialog.getByTestId('phone-country-select')).toContainText('Россия');

      // An INCOMPLETE remainder blocks — no POST /staff leaves the browser.
      await createInput.fill('995123');
      await dialog.locator('[data-testid="staff-modal-save-btn"]').click();
      await expect(dialog.getByText('Проверьте номер телефона — возможно, он введён не полностью'))
        .toBeVisible();
      await page.waitForTimeout(1000);
      expect(staffPosts).toBe(0);
      expect(queryDBRow(`SELECT id FROM users WHERE phone='${compact}'`)).toBeNull();

      // Completing the remainder lifts the block — the compact rides
      // create_user (both on the wire and into the DB).
      const createPromise = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/staff') && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await createInput.fill(national);
      await dialog.locator('[data-testid="staff-modal-save-btn"]').click();
      const create = await createPromise;
      expect(create.status()).toBe(201);
      const body = await create.json();
      createdId = body.id;
      userId = body.account?.id;
      expect(userId).toBeTruthy();
      expect(JSON.parse(create.request().postData() ?? '{}').create_user).toEqual({ phone: compact });

      // VERIFY DB — the account row stores the compact.
      await expect
        .poll(() => queryDBRow(`SELECT phone FROM users WHERE id='${userId}'`)!.phone)
        .toBe(compact);

      // The S1 handover dialog opens on top — close it to reach the table.
      const linkDialog = page.locator('[data-testid="password-link-dialog"]');
      await expect(linkDialog).toBeVisible({ timeout: 15_000 });
      await linkDialog.locator('[data-testid="link-dialog-close-btn"]').click();

      // ── Part B: EDIT — the widget gates the PATCH and the card PUT ─────
      await page.locator(`[data-testid="master-row-${createdId}"]`).click();
      const editDialog = page.getByRole('dialog');
      await expect(editDialog.getByText('Редактирование сотрудника')).toBeVisible();

      // The widget initialized from the stored compact: RU selector, the
      // grouped national remainder in the input (spec §Инициализация).
      const accountInput = editDialog.locator('[data-testid="staff-account-phone-input"]');
      await expect(editDialog.getByTestId('phone-country-select')).toContainText('Россия');
      await expect(accountInput).toHaveValue(groupedRu(national));

      // An incomplete CHANGED number blocks BOTH the account PATCH and the
      // card PUT — validate() runs before any network call (the #348 gate).
      await accountInput.fill('9951234');
      await editDialog.locator('[data-testid="staff-modal-save-btn"]').click();
      await expect(
        editDialog.getByRole('alert').filter({ hasText: 'Проверьте номер телефона' }),
      ).toBeVisible();
      await page.waitForTimeout(1000);
      expect(userPatches).toBe(0);
      expect(staffPuts).toBe(0);
      expect(queryDBRow(`SELECT phone FROM users WHERE id='${userId}'`)!.phone).toBe(compact);

      // A complete CHANGED number: the compact goes to PATCH /users/:id
      // (BEFORE the card's own PUT), and the DB carries it.
      const patchPromise = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/users/${userId}`) && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      );
      const putPromise = page.waitForResponse(
        (r) => r.url().includes(`/api/v1/staff/${createdId}`) && r.request().method() === 'PUT',
        { timeout: 15_000 },
      );
      await accountInput.fill(nextNational);
      await editDialog.locator('[data-testid="staff-modal-save-btn"]').click();
      const patch = await patchPromise;
      expect(patch.status()).toBe(200);
      // Strict body (spec §5): {phone} only — the compact form.
      expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ phone: nextCompact });
      expect((await putPromise).ok()).toBeTruthy();

      // VERIFY DB — the account row carries the new compact.
      expect(queryDBRow(`SELECT phone FROM users WHERE id='${userId}'`)!.phone).toBe(nextCompact);
    } finally {
      // CLEANUP — tokens cascade with the users row in the API, but the CLI
      // sqlite runs with foreign_keys=OFF: sweep explicitly, users-first.
      if (userId) {
        try { queryDBRow(`DELETE FROM password_setup_tokens WHERE user_id='${userId}'`); } catch { /* best-effort */ }
        try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      }
      if (createdId) await cleanup(request, `/api/v1/staff/${createdId}`);
    }
  });
});
