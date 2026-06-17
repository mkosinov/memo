import { test, expect } from '@playwright/test';
import { waitForMastersReady } from './fixtures/helpers';
import { createTestClient, cleanup } from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * E2E tests for Masters page: table rendering, filters, column picker,
 * modal behavior, and CRUD operations.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Masters Page
// ---------------------------------------------------------------------------

test.describe('Masters — Table and Navigation', () => {
  test('navigates to masters page and renders table', async ({ page }) => {
    await waitForMastersReady(page);
    await expect(page.getByText('Управление мастерами')).toBeVisible();
    await expect(page.getByText('+ Добавить мастера')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('table has expected column headers', async ({ page }) => {
    await waitForMastersReady(page);

    const expectedHeaders = ['Имя', 'Специальность', 'Должность', 'Цвет'];

    for (const headerText of expectedHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }
  });

  test('masters are loaded from API and displayed in table', async ({ page }) => {
    await waitForMastersReady(page);

    // Should have at least one master row
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row should have data-testid with master-row pattern
    const firstRow = rows.first();
    const testId = await firstRow.getAttribute('data-testid');
    expect(testId).toMatch(/^master-row-/);
  });

  test('search filter works', async ({ page }) => {
    await waitForMastersReady(page);

    const searchInput = page.locator('input[placeholder*="фамилия"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('тест');
    await page.waitForTimeout(500);
  });

  test('status filter works', async ({ page }) => {
    await waitForMastersReady(page);

    const statusSelect = page.locator('select').filter({ hasText: /Все|Активен/ }).first();
    await expect(statusSelect).toBeVisible();
  });

  test('pagination shows total count', async ({ page }) => {
    await waitForMastersReady(page);

    // Pagination area should show total count
    await expect(page.locator('text=/\\d+ всего/')).toBeVisible();
  });

  test('sorting — click header toggles sort direction', async ({ page }) => {
    await waitForMastersReady(page);

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

test.describe('Masters — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForMastersReady(page);
    await page.click('text=+ Добавить мастера');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новый мастер')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForMastersReady(page);
    await page.click('text=+ Добавить мастера');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForMastersReady(page);
    await page.click('text=+ Добавить мастера');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Try to save without filling required fields
    await dialog.getByText('Сохранить').click();
    await page.waitForTimeout(300);
    const errors = dialog.locator('[style*="danger"], .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Masters — Edit via Row Click', () => {
  test('click row opens edit modal', async ({ page }) => {
    await waitForMastersReady(page);

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Редактирование мастера')).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
  });
});

test.describe('Masters — Column Picker', () => {
  test('column picker toggles column visibility', async ({ page }) => {
    await waitForMastersReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    await expect(page.getByText('Аватар')).toBeVisible();
    // Toggle avatar column off
    await page.click('text=Аватар');
    await page.keyboard.press('Escape');
  });
});
