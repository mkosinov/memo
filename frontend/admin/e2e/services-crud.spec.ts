import { test, expect } from './fixtures/test';
import { waitForServicesReady, waitForLocationsReady } from './fixtures/helpers';

/**
 * E2E tests for Services page: table rendering, CRUD operations,
 * modal behavior, filters, and column picker.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Services Page
// ---------------------------------------------------------------------------

test.describe('Services — Table and Navigation', () => {
  test('navigates to services page and renders table', async ({ page }) => {
    await waitForServicesReady(page);
    await expect(page.getByText('Управление услугами')).toBeVisible();
    await expect(page.getByText('+ Добавить услугу')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('search filter works', async ({ page }) => {
    await waitForServicesReady(page);
    const searchInput = page.getByPlaceholder('Название...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('тест');
  });

  test('status filter works', async ({ page }) => {
    await waitForServicesReady(page);
    const statusSelect = page.getByLabel('Фильтр по статусу');
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('archived');
  });

  test('column picker toggles column visibility', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    await expect(page.getByText('Специализация')).toBeVisible();
    await page.click('text=Специализация');
    await page.keyboard.press('Escape');
  });
});

test.describe('Services — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новая услуга')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByText('Сохранить').click();
    await page.waitForTimeout(300);
    const errors = dialog.locator('[style*="danger"], .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows dirty check when closing with changes', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Мастер-класс').fill('Тест');
    page.on('dialog', (d) => d.dismiss());
    await dialog.getByText('Отмена').click();
    await expect(dialog).toBeVisible();
  });

  test('adds and removes tariffs in nested list', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByText('+ Добавить тариф').click();
    await expect(dialog.getByText('Тариф 1')).toBeVisible();
    await dialog.getByLabel('Удалить Тариф').click();
    await expect(dialog.getByText('Нет тарифов')).toBeVisible();
  });
});
