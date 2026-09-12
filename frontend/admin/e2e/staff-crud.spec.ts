import { test, expect } from './fixtures/test';
import { waitForStaffReady } from './fixtures/helpers';
import { createTestMaster, cleanup } from './fixtures/factories';

/**
 * E2E tests for the Staff directory page (GH #266 «Сотрудники», the former
 * masters screen): table rendering, filters, column picker, modal behavior.
 * CRUD-over-API scenarios live in the staff-* sibling specs; S2/S6/S7 have
 * their own files.
 */

// ---------------------------------------------------------------------------
// Tests — Staff Page
// ---------------------------------------------------------------------------

test.describe('Staff — Table and Navigation', () => {
  test('navigates to staff page and renders table', async ({ page }) => {
    await waitForStaffReady(page);
    await expect(page.getByText('Управление сотрудниками')).toBeVisible();
    await expect(page.getByText('+ Добавить сотрудника')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('table has expected column headers', async ({ page }) => {
    await waitForStaffReady(page);

    // GH #266: имя, должности, специальность, цвет, архив (status is visible
    // by default; аватар hidden).
    const expectedHeaders = ['Имя', 'Должности', 'Специальность', 'Цвет', 'Архив'];

    for (const headerText of expectedHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }

    // The positions column is NOT sortable (M2M — excluded from the server
    // sort whitelist): no sort glyph on its header.
    const positionsHeader = page.locator('table thead th').filter({ hasText: 'Должности' });
    await expect(positionsHeader).not.toContainText('↕');
  });

  test('staff are loaded from API and rows keep the master-row-* testid', async ({ page }) => {
    await waitForStaffReady(page);

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // DoD (#266): the row testid pattern is preserved across the screen move.
    const firstRow = rows.first();
    const testId = await firstRow.getAttribute('data-testid');
    expect(testId).toMatch(/^master-row-/);
  });

  test('search filter works — server-side ?q= (cross-page match + honest total)', async ({ page, request }) => {
    // GH #212 T11 — scenario 1: the matching staff card sits BEYOND the loaded
    // first page, so only a server-side ?q= can surface it. Seed has 6 staff
    // cards (sort_order 0–5, always first in default order); the created ones
    // carry sort_order 999 and tie on first_name ASC — four "Наполнитель*"
    // fillers ('Н' < 'Т') occupy page 1 slots 7–10, pushing the two 'Тест'
    // cards (incl. the marker) onto page 2.
    const fillers = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        createTestMaster(request, { first_name: `Наполнитель ${n}`, last_name: `Филлер ${n}` }),
      ),
    );
    const other = await createTestMaster(request); // default "Тест Мастеров <uid>"
    // Unique marker string — a leaked row from a failed earlier run can never
    // collide with the searched text (q is a substring match).
    const markerSuffix = String(Date.now());
    const marker = await createTestMaster(request, { last_name: `Поискуников${markerSuffix}` });

    try {
      await waitForStaffReady(page);

      // Cross-page precondition: 6 seed + 4 fillers sort before the marker
      // (sort_order ASC, first_name ASC) → ≥12 total → marker on page 2.
      const totalText = await page.locator('text=/\\d+ всего/').textContent();
      const totalBefore = Number(totalText?.match(/\d+/)?.[0]);
      expect(totalBefore).toBeGreaterThanOrEqual(12);

      const searchInput = page.locator('input[placeholder*="фамилия"]');
      await expect(searchInput).toBeVisible();
      await searchInput.fill(`Поискуников${markerSuffix}`);

      // ONLY the matching row renders — server returned exactly one row
      await expect(page.locator(`[data-testid="master-row-${marker.id}"]`)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      // Pager reflects the HONEST filtered total (1), not the pre-search count
      await expect(page.getByText('1 всего')).toBeVisible();

      // Сбросить clears q → full unfiltered list refetches (marker back on page 2,
      // seed card m1 visible on page 1)
      await page.getByText('Сбросить').click();
      await expect(page.getByText(`${totalBefore} всего`)).toBeVisible();
      await expect(page.getByText('Середа Ольга')).toBeVisible();
      await expect(page.locator(`[data-testid="master-row-${other.id}"]`)).not.toBeVisible();
    } finally {
      for (const m of [...fillers, other, marker]) {
        await cleanup(request, `/api/v1/staff/${m.id}`);
      }
    }
  });

  test('status filter works', async ({ page }) => {
    await waitForStaffReady(page);

    const statusSelect = page.locator('select').filter({ hasText: /Все|Активные/ }).first();
    await expect(statusSelect).toBeVisible();
  });

  test('pagination shows total count', async ({ page }) => {
    await waitForStaffReady(page);

    // Pagination area should show total count
    await expect(page.locator('text=/\\d+ всего/')).toBeVisible();
  });

  test('sorting — click header toggles sort direction', async ({ page }) => {
    await waitForStaffReady(page);

    const nameHeader = page.locator('table thead th').filter({ hasText: 'Имя' });
    await expect(nameHeader).toBeVisible();

    // Click to sort ascending
    await nameHeader.click();
    await page.waitForTimeout(300);
    await expect(nameHeader).toContainText('↑');

    // Click again to sort descending
    await nameHeader.click();
    await page.waitForTimeout(300);
    await expect(nameHeader).toContainText('↓');
  });
});

test.describe('Staff — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForStaffReady(page);
    await page.click('text=+ Добавить сотрудника');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новый сотрудник')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('create modal exposes the D6 sections: positions, master, account', async ({ page }) => {
    await waitForStaffReady(page);
    await page.click('text=+ Добавить сотрудника');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Positions checkboxes from the seed dictionary (D4: master/admin/smm).
    await expect(dialog.locator('[data-testid="position-checkbox-master"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="position-checkbox-admin"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="position-checkbox-smm"]')).toBeVisible();

    // «Сделать мастером» section toggle (D6) — off by default; checking it
    // reveals specialty + color.
    const masterToggle = dialog.locator('[data-testid="master-section-checkbox"]');
    await expect(masterToggle).not.toBeChecked();
    await masterToggle.check();
    await expect(dialog.getByText('Специальность *')).toBeVisible();
    await expect(dialog.getByText('Цвет *')).toBeVisible();

    // «Создать учётку» section toggle (D6) — off by default; checking it
    // reveals phone + password.
    const userToggle = dialog.locator('[data-testid="create-user-checkbox"]');
    await expect(userToggle).not.toBeChecked();
    await userToggle.check();
    await expect(dialog.getByText('Телефон *')).toBeVisible();
    await expect(dialog.getByText('Пароль *')).toBeVisible();
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForStaffReady(page);
    await page.click('text=+ Добавить сотрудника');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForStaffReady(page);
    await page.click('text=+ Добавить сотрудника');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Try to save without filling required fields (имя + фамилия)
    await dialog.getByText('Сохранить').click();
    await page.waitForTimeout(300);
    const errors = dialog.locator('[style*="danger"], .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Staff — Edit via Row Click', () => {
  test('click row opens edit modal', async ({ page }) => {
    await waitForStaffReady(page);

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Редактирование сотрудника')).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
  });

  test('edit modal shows the master section + schedule-archive toggle for a master card', async ({ page, request }) => {
    const master = await createTestMaster(request, { specialty: 'тест-специальность', color: '#ABCDEF' });
    try {
      await waitForStaffReady(page);
      await page.locator(`[data-testid="master-row-${master.id}"]`).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      // The section exists → toggle checked, fields pre-filled from the card.
      await expect(dialog.locator('[data-testid="master-section-checkbox"]')).toBeChecked();
      await expect(dialog.locator('input[placeholder="живопись, керамика"]')).toHaveValue('тест-специальность');
      await expect(dialog.locator('input[placeholder="#5B8C7A"]')).toHaveValue('#ABCDEF');
      // Edit-only: the schedule-archive toggle (D5 «архив мастера»).
      const archivedToggle = dialog.locator('[data-testid="master-archived-checkbox"]');
      await expect(archivedToggle).toBeVisible();
      await expect(archivedToggle).not.toBeChecked();
      // The create-only account section is ABSENT in edit mode.
      await expect(dialog.locator('[data-testid="create-user-checkbox"]')).toHaveCount(0);

      await page.keyboard.press('Escape');
    } finally {
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });
});

test.describe('Staff — Column Picker', () => {
  test('column picker toggles column visibility', async ({ page }) => {
    await waitForStaffReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    await expect(page.getByText('Аватар')).toBeVisible();
    // Toggle avatar column off
    await page.click('text=Аватар');
    await page.keyboard.press('Escape');
  });
});
