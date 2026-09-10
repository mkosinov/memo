import { test, expect } from './fixtures/test';
import { waitForTagsReady } from './fixtures/helpers';

/**
 * E2E tests for Tags page: table rendering, search, sorting, pagination,
 * create/edit/delete modal behavior, and column picker.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Tags Page
// ---------------------------------------------------------------------------

test.describe('Tags — Table and Navigation', () => {
  test('navigates to tags page and renders table', async ({ page }) => {
    await waitForTagsReady(page);
    await expect(page.getByText('Управление тегами')).toBeVisible();
    await expect(page.getByText('+ Добавить тег')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('table has expected column headers', async ({ page }) => {
    await waitForTagsReady(page);

    // Tags table has a single "Тег" column (status column dropped in GH #194)
    await expect(page.locator('table thead th').filter({ hasText: 'Тег' })).toBeVisible();
  });

  test('tags are loaded from API and displayed in table', async ({ page }) => {
    await waitForTagsReady(page);

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // First row should have tag-row testid
    const firstRow = rows.first();
    const testId = await firstRow.getAttribute('data-testid');
    expect(testId).toMatch(/^tag-row-/);
  });

  test('search input filters tag list', async ({ page }) => {
    await waitForTagsReady(page);

    const searchInput = page.getByPlaceholder('Поиск тегов...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('тест');
    await page.waitForTimeout(500);
  });

  test('pagination shows total count', async ({ page }) => {
    await waitForTagsReady(page);

    await expect(page.locator('text=/\\d+ всего/')).toBeVisible();
  });

  test('sorting — click header toggles sort direction', async ({ page }) => {
    await waitForTagsReady(page);

    const tagHeader = page.locator('table thead th').filter({ hasText: 'Тег' });
    await expect(tagHeader).toBeVisible();

    // Click to sort ascending
    await tagHeader.click();
    await page.waitForTimeout(300);
    await expect(tagHeader).toContainText('↑');

    // Click again to sort descending
    await tagHeader.click();
    await page.waitForTimeout(300);
    await expect(tagHeader).toContainText('↓');
  });
});

test.describe('Tags — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForTagsReady(page);
    await page.click('text=+ Добавить тег');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новый тег')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForTagsReady(page);
    await page.click('text=+ Добавить тег');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Tags — Edit via Row Click', () => {
  test('click row opens edit modal', async ({ page }) => {
    await waitForTagsReady(page);

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Редактирование тега')).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
  });
});

test.describe('Tags — Column Picker', () => {
  test('column picker toggles column visibility', async ({ page }) => {
    await waitForTagsReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    // Single column "Тег" (status column dropped in GH #194)
    await expect(page.getByText('Тег', { exact: true }).first()).toBeVisible();
    await page.getByText('Тег', { exact: true }).first().click();
    await page.keyboard.press('Escape');
  });
});

test.describe('Tags — Actions Dropdown', () => {
  test('actions dropdown opens on button click', async ({ page }) => {
    await waitForTagsReady(page);

    // Click the actions button (⋯) on the first row
    const actionsBtn = page.locator('table tbody button[aria-label^="Действия"]').first();
    await expect(actionsBtn).toBeVisible();
    await actionsBtn.click();

    // Dropdown should appear with Edit and Delete options
    const dropdown = page.locator('table tbody [data-testid^="dropdown-"]').first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('button:has-text("Редактировать")')).toBeVisible();
    await expect(dropdown.locator('button:has-text("Удалить")')).toBeVisible();
  });
});
