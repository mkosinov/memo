import { test, expect } from '@playwright/test';
import {
  waitForScheduleReady,
  waitForRecordsReady,
  openModal,
  openAddTab,
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
  test('records page default state', async ({ page }) => {
    await waitForRecordsReady(page);
    await expect(page).toHaveScreenshot('records-default.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  test('records page with filters applied', async ({ page }) => {
    await waitForRecordsReady(page);

    // Apply status filter — select first non-empty option
    const statusSelect = page.locator('select[aria-label="Фильтр по статусу"]');
    const statusOptions = statusSelect.locator('option');
    const optionCount = await statusOptions.count();

    if (optionCount > 1) {
      await statusSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }

    await expect(page).toHaveScreenshot('records-filtered.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });
});

// ---------------------------------------------------------------------------
// Activity Modal — Visual Regression
// ---------------------------------------------------------------------------

test.describe('Activity Modal — Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('activity modal — settings tab', async ({ page }) => {
    await openModal(page);

    await expect(page).toHaveScreenshot('modal-settings.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });

  test('activity modal — new booking tab', async ({ page }) => {
    await openAddTab(page);

    await expect(page).toHaveScreenshot('modal-new-booking.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });
});
