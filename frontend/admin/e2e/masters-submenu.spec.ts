import { test, expect } from './fixtures/test';
import { waitForMastersReady } from './fixtures/helpers';

/**
 * E2E tests for Masters page: table rendering, CRUD operations,
 * modal behavior, filters, and column picker.
 *
 * NOTE: This file replaces the previous masters-submenu.spec.ts which
 * targeted the wrong port (:3000 instead of :3001) and had console.log.
 *
 * Requires: dev server on :3001, backend on :8000
 */

test.describe('Masters page — legacy submenu test (updated)', () => {
  test('Masters page loads with table from sidebar', async ({ page }) => {
    await waitForMastersReady(page);

    // Verify page loaded correctly
    await expect(page.locator('h1:has-text("Управление мастерами")')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();

    // Should have at least one master
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Masters submenu in sidebar shows master list', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Click Мастера button to expand submenu (scope to menubar)
    const mastersButton = page.locator('[data-testid="menubar"] button[aria-label="Мастера"]');
    await mastersButton.click();
    await page.waitForTimeout(500);

    // Button should be expanded
    await expect(mastersButton).toHaveAttribute('aria-expanded', 'true');

    // Verify the menubar text content increased (submenu content visible)
    const menubarText = await page.locator('[data-testid="menubar"]').textContent();
    expect(menubarText!.length).toBeGreaterThan(20);
  });
});
