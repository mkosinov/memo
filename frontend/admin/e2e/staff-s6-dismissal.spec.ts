/**
 * S6 (GH #266) — «Увольнение с чекбоксами» (D6).
 *
 * The archive dialog preselects both checkboxes:
 *   • «Архивировать мастера (расписание)» — visible only with an active
 *     master section;
 *   • «Архивировать учётку (вход)» — visible only when has_user.
 *
 * Scenario A: uncheck the MASTER box → the dismissed person stays in the
 * schedule and /masters (the statutory D3 state «уволен, досиживает занятия»);
 * the account is archived (its box stays checked).
 * Scenario B: uncheck the ACCOUNT box → login stays permitted; the master is
 * archived (its box stays checked).
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  createTestStaff,
  E2E_PASSWORD,
} from './fixtures/factories';
import {
  clickRowStaffArchiveAction,
  openRowActionDropdown,
  waitForStaffReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7997${String(Date.now()).slice(-7)}${phoneCounter}`;
}

/** Open the D6 dialog on the staff row. */
async function openArchiveDialog(
  page: import('@playwright/test').Page,
  staffId: string,
): Promise<import('@playwright/test').Locator> {
  const row = page.locator(`[data-testid="master-row-${staffId}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  const dropdown = await openRowActionDropdown(row);
  await clickRowStaffArchiveAction(dropdown, 'Архивировать');
  const dialog = page.locator('[data-testid="archive-staff-dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return dialog;
}

test.describe('S6 — dismissal checkboxes (D6)', () => {
  test('unchecking «мастер» keeps the dismissed person in /masters; account archived', async ({ page, request }) => {
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Досиживает',
      last_name: `Занятиев${Date.now()}`,
      master: { specialty: 'керамика', color: '#7B68EE' },
      positions: ['master'],
      user: { phone, password: E2E_PASSWORD },
    });
    try {
      // Baseline: acting master + active account.
      expect((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id)).toContain(staff.id);
      expect(queryDBRow(`SELECT is_active FROM users WHERE phone='${phone}'`)!.is_active).toBe(1);

      await waitForStaffReady(page);
      const dialog = await openArchiveDialog(page, staff.id);

      // Both checkboxes are rendered (active master section + has_user) and
      // PRESELECTED (D6).
      const masterBox = dialog.locator('[data-testid="archive-master-checkbox"]');
      const userBox = dialog.locator('[data-testid="archive-user-checkbox"]');
      await expect(masterBox).toBeVisible();
      await expect(masterBox).toBeChecked();
      await expect(userBox).toBeVisible();
      await expect(userBox).toBeChecked();

      // Uncheck the master box → archive POST carries archive_master:false.
      await masterBox.uncheck();
      const archivePromise = page.waitForResponse((r) =>
        r.url().includes(`/api/v1/staff/${staff.id}/archive`) && r.request().method() === 'POST',
      );
      await dialog.locator('[data-testid="archive-staff-confirm-btn"]').click();
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect(JSON.parse(archive.request().postData() ?? '{}')).toEqual({
        archive_master: false,
        archive_user: true,
      });
      await waitForToast(page, 'Сотрудник архивирован');

      // VERIFY — the person is dismissed (staff.is_active=0) BUT stays an
      // acting master (D3 statutory state) and stays in /api/v1/masters.
      expect(queryDBRow(`SELECT is_active FROM staff WHERE id='${staff.id}'`)!.is_active).toBe(0);
      expect(queryDBRow(`SELECT is_active FROM masters WHERE staff_id='${staff.id}'`)!.is_active).toBe(1);
      expect((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id)).toContain(staff.id);
      // The account checkbox stayed checked → login disabled.
      expect(queryDBRow(`SELECT is_active FROM users WHERE phone='${phone}'`)!.is_active).toBe(0);

      // The archived card is reachable via the status filter; the D6 dialog on
      // an archived card is gone — the action flips to «Вернуть из архива».
      await page.getByLabel('Фильтр по статусу').selectOption('archived');
      const row = page.locator(`[data-testid="master-row-${staff.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const dropdown = await openRowActionDropdown(row);
      await expect(dropdown.getByRole('menuitem', { name: 'Вернуть из архива' })).toBeVisible();
    } finally {
      try { queryDBRow(`DELETE FROM users WHERE phone='${phone}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });

  test('unchecking «учётка» keeps login permitted; master archived', async ({ page, request }) => {
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Входжив',
      last_name: `Паролев${Date.now()}`,
      master: { specialty: 'живопись', color: '#20B2AA' },
      positions: ['master'],
      user: { phone, password: E2E_PASSWORD },
    });
    try {
      await waitForStaffReady(page);
      const dialog = await openArchiveDialog(page, staff.id);

      // Uncheck the ACCOUNT box → archive_user:false; the master box stays
      // checked (preselected, D6).
      const userBox = dialog.locator('[data-testid="archive-user-checkbox"]');
      await userBox.uncheck();
      const archivePromise = page.waitForResponse((r) =>
        r.url().includes(`/api/v1/staff/${staff.id}/archive`) && r.request().method() === 'POST',
      );
      await dialog.locator('[data-testid="archive-staff-confirm-btn"]').click();
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect(JSON.parse(archive.request().postData() ?? '{}')).toEqual({
        archive_master: true,
        archive_user: false,
      });

      // VERIFY — login remains permitted (users.is_active=1), the master
      // section is archived (out of /masters), the person is dismissed.
      expect(queryDBRow(`SELECT is_active FROM users WHERE phone='${phone}'`)!.is_active).toBe(1);
      expect(queryDBRow(`SELECT is_active FROM masters WHERE staff_id='${staff.id}'`)!.is_active).toBe(0);
      expect(queryDBRow(`SELECT is_active FROM staff WHERE id='${staff.id}'`)!.is_active).toBe(0);
      expect((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json())
        .map((m: { id: string }) => m.id)).not.toContain(staff.id);
    } finally {
      try { queryDBRow(`DELETE FROM users WHERE phone='${phone}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });

  test('master checkbox hidden without an active section; user checkbox hidden without an account', async ({ page, request }) => {
    // Card WITHOUT a master section and WITHOUT an account → both D6
    // checkboxes are hidden (nothing to apply them to).
    const staff = await createTestStaff(request, {
      first_name: 'Простой',
      last_name: `Сотрудников${Date.now()}`,
      positions: ['smm'],
    });
    // Card with an ARCHIVED master section → the master checkbox is hidden
    // (already archived), while a linked account still shows its checkbox.
    const archivedPhone = uniquePhone();
    const archivedMasterStaff = await createTestStaff(request, {
      first_name: 'Архивмастер',
      last_name: `Секциев${Date.now()}`,
      master: { specialty: 'керамика', color: '#B0C4DE' },
      user: { phone: archivedPhone, password: E2E_PASSWORD },
    });
    // Archive the master section only (archive_user:false) so the person comes
    // back active with an archived section + a live account.
    await request.post(`${BACKEND}/api/v1/staff/${archivedMasterStaff.id}/archive`, {
      data: { archive_master: true, archive_user: false },
    });
    await request.post(`${BACKEND}/api/v1/staff/${archivedMasterStaff.id}/restore`);

    try {
      await waitForStaffReady(page);

      // Plain card — dialog shows the explanatory line, no checkboxes.
      let dialog = await openArchiveDialog(page, staff.id);
      await expect(dialog.locator('[data-testid="archive-master-checkbox"]')).toHaveCount(0);
      await expect(dialog.locator('[data-testid="archive-user-checkbox"]')).toHaveCount(0);
      await dialog.locator('[data-testid="archive-staff-cancel-btn"]').click();
      await expect(dialog).toHaveCount(0);

      // Archived-section card — master checkbox hidden, account checkbox shown.
      dialog = await openArchiveDialog(page, archivedMasterStaff.id);
      await expect(dialog.locator('[data-testid="archive-master-checkbox"]')).toHaveCount(0);
      const userBox = dialog.locator('[data-testid="archive-user-checkbox"]');
      await expect(userBox).toBeVisible();
      await expect(userBox).toBeChecked();
      await dialog.locator('[data-testid="archive-staff-cancel-btn"]').click();
      expect(queryDBRow(`SELECT is_active FROM users WHERE phone='${archivedPhone}'`)!.is_active).toBe(1);
    } finally {
      try { queryDBRow(`DELETE FROM users WHERE staff_id='${archivedMasterStaff.id}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/staff/${staff.id}`);
      await cleanup(request, `/api/v1/staff/${archivedMasterStaff.id}`);
    }
  });
});
