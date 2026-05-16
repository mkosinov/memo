import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for Schedule page.
 * Baseline screenshots are committed to git in e2e/__screenshots__/
 * Update baselines: npm run test:e2e:update
 */

test.describe('Schedule Page', () => {
  test('default state visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="center-content"]', { timeout: 10000 });
    await expect(page).toHaveScreenshot('schedule-default.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  test('sidebar visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toHaveScreenshot('sidebar.png', {
      maxDiffPixels: 50,
    });
  });
});