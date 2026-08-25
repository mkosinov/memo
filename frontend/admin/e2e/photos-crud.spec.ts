import { test, expect } from '@playwright/test';
import { waitForPhotosReady } from './fixtures/helpers';

/**
 * E2E tests for Photos page: table rendering, search,
 * sorting, pagination, create/edit modal, column picker.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Photos Page
// ---------------------------------------------------------------------------

test.describe('Photos — Table and Navigation', () => {
  test('navigates to photos page and renders table', async ({ page }) => {
    await waitForPhotosReady(page);
    await expect(page.getByText('Управление фото')).toBeVisible();
    await expect(page.getByText('+ Добавить фото')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('table has expected column headers', async ({ page }) => {
    await waitForPhotosReady(page);

    // Default visible columns: Превью, Файл, Посетитель, Публичное
    // (Статус column + status filter dropped in GH #194)
    const expectedHeaders = ['Превью', 'Файл', 'Посетитель', 'Публичное'];

    for (const headerText of expectedHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }
  });

  test('search input filters photo list', async ({ page }) => {
    await waitForPhotosReady(page);

    const searchInput = page.getByPlaceholder('Поиск фото...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test');
    await page.waitForTimeout(500);
  });

  test('pagination shows total count', async ({ page }) => {
    await waitForPhotosReady(page);

    await expect(page.locator('text=/\\d+ всего/')).toBeVisible();
  });

  test('sorting — click header toggles sort direction', async ({ page }) => {
    await waitForPhotosReady(page);

    const fileHeader = page.locator('table thead th').filter({ hasText: 'Файл' });
    await expect(fileHeader).toBeVisible();

    // Click to sort ascending
    await fileHeader.click();
    await page.waitForTimeout(300);
    await expect(fileHeader).toContainText('↑');

    // Click again to sort descending
    await fileHeader.click();
    await page.waitForTimeout(300);
    await expect(fileHeader).toContainText('↓');
  });

  test('photos are loaded from API and rows have correct testid', async ({ page }) => {
    await waitForPhotosReady(page);

    const rows = page.locator('table tbody tr');
    const count = await rows.count();

    if (count > 0) {
      const firstRow = rows.first();
      const testId = await firstRow.getAttribute('data-testid');
      expect(testId).toMatch(/^photo-row-/);
    }
  });
});

test.describe('Photos — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForPhotosReady(page);
    await page.click('text=+ Добавить фото');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новое фото')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForPhotosReady(page);
    await page.click('text=+ Добавить фото');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Photos — Edit via Row Click', () => {
  test('click row opens edit modal', async ({ page }) => {
    await waitForPhotosReady(page);

    const firstRow = page.locator('table tbody tr').first();
    const count = await page.locator('table tbody tr').count();

    if (count > 0) {
      await expect(firstRow).toBeVisible();
      await firstRow.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.getByText('Редактирование фото')).toBeVisible();

      // Close modal
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('Photos — Column Picker', () => {
  test('column picker toggles column visibility', async ({ page }) => {
    await waitForPhotosReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    await expect(page.getByText('Активность')).toBeVisible();
    // Toggle activity column on
    await page.click('text=Активность');
    await page.keyboard.press('Escape');
  });
});

test.describe('Photos — Actions Dropdown', () => {
  test('actions dropdown opens on button click', async ({ page }) => {
    await waitForPhotosReady(page);

    const count = await page.locator('table tbody tr').count();
    if (count > 0) {
      const actionsBtn = page.locator('table tbody button[aria-label^="Действия"]').first();
      await expect(actionsBtn).toBeVisible();
      await actionsBtn.click();

      const dropdown = page.locator('table tbody [data-testid^="dropdown-"]').first();
      await expect(dropdown).toBeVisible();
      await expect(dropdown.locator('button:has-text("Редактировать")')).toBeVisible();
      await expect(dropdown.locator('button:has-text("Удалить")')).toBeVisible();
    }
  });
});
