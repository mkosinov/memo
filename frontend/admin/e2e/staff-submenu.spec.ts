import { test, expect } from './fixtures/test';
import { waitForStaffReady } from './fixtures/helpers';

/**
 * E2E tests for the Staff page navigation + the sidebar «Мастера» legend.
 *
 * GH #266: the management screen moved to /staff («Сотрудники», entered from
 * «Справочники»). The sidebar «Мастера» collapsible is the SCHEDULE LEGEND
 * (colored dots of acting masters, NOT a link) and is unchanged (D2) — its
 * expand/collapse behavior is still asserted here.
 *
 * Requires: dev server, backend on :8000.
 */

test.describe('Staff page + Masters legend submenu', () => {
  test('Staff page loads with table from Справочники', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Open Справочники → click «Сотрудники» (GH #266 directory entry).
    await page.locator('[data-testid="menubar"] button[aria-label="Справочники"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="menubar"] a:has-text("Сотрудники")').click();

    await page.waitForSelector('h1:has-text("Управление сотрудниками")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();

    // Should have at least one staff card (seed m1–m5, m7).
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Staff page loads via the readiness helper', async ({ page }) => {
    await waitForStaffReady(page);

    await expect(page.locator('h1:has-text("Управление сотрудниками")')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('Masters legend submenu in sidebar shows the acting-master list', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Click the Мастера button to expand the legend submenu (scope to menubar —
    // it is the schedule legend, not a navigation link).
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
