import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * Visual regression tests for Schedule page.
 * Baseline screenshots are stored in the -snapshots/ directory next to this file.
 * Update baselines: npm run test:e2e:update
 */

test.describe('Schedule Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START)
    // Combined with openModal/openAddTab DB lookup (Approach B+), this makes
    // visual regression baselines date-stable.
    // Must be called BEFORE page.goto() — clock.install injects an init script.
    await page.clock.install({ time: new Date('2026-06-15T10:00:00') });
  });

  test('default state visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="center-content"]', { timeout: 10000 });
    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });
    await expect(page).toHaveScreenshot('schedule-default.png', {
      fullPage: true,
      maxDiffPixels: 10_000,
    });
  });

  test('menubar visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10000 });
    const menubar = page.getByTestId('menubar');
    await expect(menubar).toHaveScreenshot('menubar.png', {
      maxDiffPixels: 5_000,
    });
  });

  test('schedule with activity cards', async ({ page }) => {
    await waitForScheduleReady(page);
    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });
    await expect(page).toHaveScreenshot('schedule-with-activities.png', {
      fullPage: true,
      maxDiffPixels: 10_000,
    });
  });

  test('schedule — different week', async ({ page }) => {
    await waitForScheduleReady(page);

    // Navigate to next week
    await page.locator('[data-testid="date-nav-next"]').click();
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('schedule-next-week.png', {
      fullPage: true,
      maxDiffPixels: 10_000,
    });
  });
});