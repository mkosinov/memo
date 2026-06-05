import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * Visual regression tests for Schedule page.
 * Baseline screenshots are stored in the -snapshots/ directory next to this file.
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

  test('schedule with activity cards', async ({ page }) => {
    await waitForScheduleReady(page);
    await expect(page).toHaveScreenshot('schedule-with-activities.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  test('schedule — different week', async ({ page }) => {
    await waitForScheduleReady(page);

    // Navigate to next week
    await page.locator('button[aria-label="Следующая неделя"]').click();
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('schedule-next-week.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });
});