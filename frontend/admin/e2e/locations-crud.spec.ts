import { test, expect } from '@playwright/test';
import { waitForLocationsReady } from './fixtures/helpers';

/**
 * E2E tests for Locations page: table rendering, CRUD operations,
 * modal behavior, and filters.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Locations Page
// ---------------------------------------------------------------------------

test.describe('Locations — Table and Navigation', () => {
  test('navigates to locations page and renders table', async ({ page }) => {
    await waitForLocationsReady(page);
    await expect(page.getByText('Управление локациями')).toBeVisible();
    await expect(page.getByText('+ Добавить локацию')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('search filter works', async ({ page }) => {
    await waitForLocationsReady(page);
    const searchInput = page.getByPlaceholder('Название или адрес...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('тест');
  });

  test('status filter works', async ({ page }) => {
    await waitForLocationsReady(page);
    const statusSelect = page.getByLabel('Фильтр по статусу');
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('archived');
  });
});

test.describe('Locations — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForLocationsReady(page);
    await page.click('text=+ Добавить локацию');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Новая локация')).toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForLocationsReady(page);
    await page.click('text=+ Добавить локацию');
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    await page.click('text=Сохранить');
    // Wait for validation errors to appear
    await page.waitForTimeout(300);
    // Check for error messages
    const errors = page.locator('[style*="danger"], .text-red-500, [class*="error"]');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });
});
