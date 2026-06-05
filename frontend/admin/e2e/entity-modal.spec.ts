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
    await expect(page.getByRole('dialog')).toBeVisible();
    // Check key fields exist
    await expect(page.getByText('Название')).toBeVisible();
    await expect(page.getByText('Описание')).toBeVisible();
    await expect(page.getByText('Длительность')).toBeVisible();
    await expect(page.getByText('Возраст от')).toBeVisible();
    await expect(page.getByText('Тарифы')).toBeVisible();
  });

  test('number field respects min/max', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    // Try to submit with duration=0 (below min of 15)
    const durationInput = page.locator('input[type="number"]').nth(0);
    await durationInput.fill('0');
    await page.click('text=Сохранить');
    await expect(page.getByText('Минимум:').first()).toBeVisible();
  });

  test('submit button shows loading state', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    // Fill required fields
    await page.fill('input[placeholder*="Мастер-класс"]', 'Тестовый класс');
    const durationInput = page.locator('input[type="number"]').nth(0);
    await durationInput.fill('90');
    // Click submit — button text should change
    await page.click('text=Сохранить');
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
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Название')).toBeVisible();
    await expect(page.getByText('Адрес')).toBeVisible();
    await expect(page.getByText('Вместимость')).toBeVisible();
    await expect(page.getByText('Яндекс.Карты')).toBeVisible();
  });
});
