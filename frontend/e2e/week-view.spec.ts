import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for Week View page.
 * Baseline screenshots are committed to git in e2e/__screenshots__/
 * Update baselines: npm run test:e2e:update
 */

test.describe('Week View', () => {
  test('default state visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="week-view"]', { timeout: 5000 });
    await expect(page).toHaveScreenshot('week-view-default.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  test('activity card hover state', async ({ page }) => {
    await page.goto('/');
    const card = page.getByTestId('activity-card').first();
    await card.hover();
    await expect(card).toHaveScreenshot('activity-card-hover.png', {
      maxDiffPixels: 50,
    });
  });
});
