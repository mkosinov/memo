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

  test('menubar visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10000 });
    const menubar = page.getByTestId('menubar');
    await expect(menubar).toHaveScreenshot('menubar.png', {
      maxDiffPixels: 50,
    });
  });
});