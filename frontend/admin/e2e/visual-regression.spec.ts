import { test, expect } from '@playwright/test';
import {
  waitForScheduleReady,
  waitForRecordsReady,
  openModal,
  openAddTab,
  cleanTestData,
} from './fixtures/helpers';

/**
 * Visual regression tests for Records page, Activity Modal, and other UI states.
 * Baseline screenshots are stored in the -snapshots/ directory next to this file.
 * Update baselines: npm run test:e2e:update
 *
 * NOTE: These tests require a running dev server (:3001) and backend (:8000).
 * First run creates baselines; subsequent runs compare against them.
 */

// ---------------------------------------------------------------------------
// Records Page — Visual Regression
// ---------------------------------------------------------------------------

test.describe('Records Page — Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    cleanTestData();
    // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START)
    // Combined with openModal/openAddTab DB lookup (Approach B+), this makes
    // visual regression baselines date-stable.
    // Must be called BEFORE page.goto() — clock.install injects an init script.
    await page.clock.install({ time: new Date('2020-01-06T10:00:00') });
  });

  test('records page default state', async ({ page }) => {
    await waitForRecordsReady(page);
    // Other tests in this shard may create records that appear here,
    // so use a generous pixel diff to tolerate extra table rows.
    await expect(page).toHaveScreenshot('records-default.png', {
      fullPage: true,
      maxDiffPixels: 5000,
    });
  });

  test('records page with filters applied', async ({ page }) => {
    await waitForRecordsReady(page);

    // Apply status filter via StatusFiltersPicker dropdown
    const trigger = page.locator('[data-testid="booking-filters-status-trigger"]');
    if ((await trigger.count()) > 0) {
      await trigger.click();
      const option = page.locator('[data-testid="booking-filters-status-option-waiting"]');
      if ((await option.count()) > 0) {
        await option.click();
        await page.waitForTimeout(500);
      }
    }

    // Other tests in this shard may create records that appear here
    await expect(page).toHaveScreenshot('records-filtered.png', {
      fullPage: true,
      maxDiffPixels: 5000,
    });
  });
});

// ---------------------------------------------------------------------------
// Activity Modal — Visual Regression
// ---------------------------------------------------------------------------

test.describe('Activity Modal — Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    cleanTestData();
    // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START)
    // Combined with openModal/openAddTab DB lookup (Approach B+), this makes
    // visual regression baselines date-stable.
    // Must be called BEFORE page.goto() — clock.install injects an init script.
    await page.clock.install({ time: new Date('2020-01-06T10:00:00') });
    await waitForScheduleReady(page);
  });

  test('activity modal — settings tab', async ({ page }) => {
    await openModal(page);

    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });

    await expect(page).toHaveScreenshot('modal-settings.png', {
      fullPage: false,
      maxDiffPixels: 2000,
    });
  });

  test('activity modal — new booking tab', async ({ page }) => {
    await openAddTab(page);

    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });

    await expect(page).toHaveScreenshot('modal-new-booking.png', {
      fullPage: false,
      maxDiffPixels: 2000,
    });
  });
});
