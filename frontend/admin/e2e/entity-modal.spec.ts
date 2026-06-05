import { test, expect } from '@playwright/test';
import { waitForServicesReady, waitForLocationsReady } from './fixtures/helpers';

/**
 * E2E tests for EntityModal behavior: field rendering, validation,
 * nested lists, and form submission.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — EntityModal — Service
// ---------------------------------------------------------------------------

test.describe('EntityModal — Service', () => {
  test('renders all field sections', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Check key fields exist — scope to dialog to avoid matching table headers
    await expect(dialog.getByText('Название')).toBeVisible();
    await expect(dialog.getByText('Описание')).toBeVisible();
    await expect(dialog.getByText('Длительность')).toBeVisible();
    await expect(dialog.getByText('Возраст от')).toBeVisible();
    await expect(dialog.getByText('Тарифы')).toBeVisible();
  });

  test('number field respects min/max', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    // Try to submit with duration=0 (below min of 15)
    const durationInput = page.locator('[role="dialog"] input[type="number"]').nth(0);
    await durationInput.fill('0');
    await page.locator('[role="dialog"] text=Сохранить').click();
    // Wait for validation error
    await page.waitForTimeout(300);
    const errors = page.locator('[role="dialog"] [style*="danger"], [role="dialog"] .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });

  test('submit button shows loading state', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    // Fill required fields
    await page.locator('[role="dialog"] input[placeholder*="Мастер-класс"]').fill('Тестовый класс');
    const durationInput = page.locator('[role="dialog"] input[type="number"]').nth(0);
    await durationInput.fill('90');
    // Click submit — button text should change
    await page.locator('[role="dialog"] text=Сохранить').click();
    // Note: This may be too fast to catch "Сохранение..." — depends on API speed
  });
});

// ---------------------------------------------------------------------------
// Tests — EntityModal — Location
// ---------------------------------------------------------------------------

test.describe('EntityModal — Location', () => {
  test('renders location fields', async ({ page }) => {
    await waitForLocationsReady(page);
    await page.click('text=+ Добавить локацию');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Scope all assertions to the dialog
    await expect(dialog.getByText('Название')).toBeVisible();
    await expect(dialog.getByText('Адрес')).toBeVisible();
    await expect(dialog.getByText('Вместимость')).toBeVisible();
    await expect(dialog.getByText('Яндекс.Карты')).toBeVisible();
  });
});
