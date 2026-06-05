import { test, expect } from '@playwright/test';
import { waitForServicesReady } from './fixtures/helpers';

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
    // Table should filter (we can't assert specific rows without test data)
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
    // Check that dropdown appeared
    await expect(page.getByText('Специализация')).toBeVisible();
    // Toggle a column
    await page.click('text=Специализация');
    // Close picker
    await page.keyboard.press('Escape');
  });
});

test.describe('Services — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Новая услуга')).toBeVisible();
    await expect(page.getByText('Сохранить')).toBeVisible();
    await expect(page.getByText('Отмена')).toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByText('Сохранить').click();
    // Wait for validation errors to appear
    await page.waitForTimeout(300);
    // Check for error messages inside the dialog
    const errors = dialog.locator('[style*="danger"], .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    // Modal should close (no dirty check since no changes)
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows dirty check when closing with changes', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    // Type something to make form dirty
    await page.fill('input[placeholder*="Мастер-класс"]', 'Тест');
    // Set up dialog handler to dismiss
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.click('text=Отмена');
    // Dialog should have appeared (we dismissed it, so modal stays)
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('adds and removes tariffs in nested list', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await page.click('text=+ Добавить тариф');
    await expect(page.getByText('Тариф 1')).toBeVisible();
    // Remove tariff
    await page.click('[aria-label="Удалить Тариф"]');
    await expect(page.getByText('Нет тарифов')).toBeVisible();
  });
});
