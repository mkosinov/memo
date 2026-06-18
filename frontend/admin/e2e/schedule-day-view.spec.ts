import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * E2E tests for Schedule Day View: switching between WeekView and DayView,
 * column mode switching (По мастерам / По локациям), zoom popup for
 * cell height and grid frequency adjustments.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — View Mode Switching
// ---------------------------------------------------------------------------

test.describe('Schedule — WeekView ↔ DayView', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('day button switches from week to day view', async ({ page }) => {
    // Default is week view — 7 day columns should be visible
    for (let i = 0; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).toBeVisible();
    }

    // Click the day button
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Day view should show only 1 day column (day-column-0)
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();

    // day-column-1 through day-column-6 should NOT be visible
    for (let i = 1; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).not.toBeVisible();
    }
  });

  test('week button switches from day back to week view', async ({ page }) => {
    // Switch to day view first
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Verify day view
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();

    // Find and click the week button
    const weekButton = page.locator('button:has-text("Неделя")');
    await expect(weekButton).toBeVisible();
    await weekButton.click();
    await page.waitForTimeout(500);

    // Week view should show 7 day columns
    for (let i = 0; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).toBeVisible();
    }
  });

  test('day button text changes based on column mode', async ({ page }) => {
    const dayButton = page.locator('[data-testid="day-button"]');

    // Default column mode is 'masters', so button shows "День по мастерам"
    await expect(dayButton).toContainText('День по мастерам');

    // Switch to locations column mode
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);

    const columnMenu = page.locator('[data-testid="column-mode-menu"]');
    await expect(columnMenu).toBeVisible();

    await columnMenu.locator('button:has-text("По локациям")').click();
    await page.waitForTimeout(500);

    // Button should now say "День по локациям"
    await expect(dayButton).toContainText('День по локациям');
  });

  test('day view shows correct date label in topbar', async ({ page }) => {
    // Switch to day view
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Date nav text should show a date (day label format)
    const dateText = page.locator('[data-testid="date-nav-text"]');
    await expect(dateText).toBeVisible();

    // Should contain some date info
    const text = await dateText.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Column Mode Switching
// ---------------------------------------------------------------------------

test.describe('Schedule — Column Mode (По мастерам / По локациям)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('column mode dropdown opens and shows two options', async ({ page }) => {
    // Switch to day view first (column mode is only relevant in day view)
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Dismiss any open menu (e.g., from previous test)
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);

    // Open column mode dropdown
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);

    const menu = page.locator('[data-testid="column-mode-menu"]');
    await expect(menu).toBeVisible();

    // Should have two menu items
    await expect(menu.locator('button:has-text("По мастерам")')).toBeVisible();
    await expect(menu.locator('button:has-text("По локациям")')).toBeVisible();
  });

  test('switching to "По локациям" changes column mode', async ({ page }) => {
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Dismiss any open menu (e.g., from previous test)
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);

    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);

    // Column mode switch is client-side only — no API call
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
    await page.waitForTimeout(500);

    // The day button text should change
    await expect(page.locator('[data-testid="day-button"]')).toContainText('День по локациям');

    // Day column should still be visible
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();
  });

  test('switching to "По мастерам" changes column mode back', async ({ page }) => {
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);

    // Dismiss any open menu (e.g., from previous test)
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);

    // Switch to locations first (client-side only — no API call)
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
    await page.waitForTimeout(500);

    // Switch back to masters
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По мастерам")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="day-button"]')).toContainText('День по мастерам');
  });

  test('selecting column mode auto-switches to day view', async ({ page }) => {
    // Start in week view (default)
    await expect(page.locator('[data-testid="day-column-6"]')).toBeVisible();

    // Open column mode dropdown and select masters (client-side only — no API call)
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По мастерам")').click();
    await page.waitForTimeout(500);

    // Should now be in day view (only day-column-0 visible)
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="day-column-6"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tests — Zoom Popup (Cell Height + Grid Frequency)
// ---------------------------------------------------------------------------

test.describe('Schedule — Zoom Popup', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('zoom button opens popup with cell height options', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // Should have cell height options (40, 50, 60)
    await expect(popup.locator('[data-testid="zoom-option-40"]')).toBeVisible();
    await expect(popup.locator('[data-testid="zoom-option-50"]')).toBeVisible();
    await expect(popup.locator('[data-testid="zoom-option-60"]')).toBeVisible();
  });

  test('zoom popup shows grid frequency options', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // Should have frequency options
    await expect(popup.locator('[data-testid="grid-freq-5"]')).toBeVisible();
    await expect(popup.locator('[data-testid="grid-freq-15"]')).toBeVisible();
    await expect(popup.locator('[data-testid="grid-freq-30"]')).toBeVisible();
  });

  test('selecting cell height changes the schedule grid', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // Click "Крупный" (60px) option
    await popup.locator('[data-testid="zoom-option-60"]').click();
    await page.waitForTimeout(300);

    // Popup should close after selection
    await expect(popup).not.toBeVisible();

    // Schedule should still be visible
    await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  });

  test('selecting grid frequency changes the schedule grid', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // Click 15 min frequency
    await popup.locator('[data-testid="grid-freq-15"]').click();
    await page.waitForTimeout(300);

    // Schedule should still be visible
    await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  });

  test('zoom popup closes on outside click', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // Click outside the popup
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Popup should close
    await expect(popup).not.toBeVisible();
  });

  test('active cell height is highlighted in zoom popup', async ({ page }) => {
    await page.locator('[data-testid="zoom-button"]').click();

    const popup = page.locator('[data-testid="zoom-popup"]');
    await expect(popup).toBeVisible();

    // One of the options should have data-active="true"
    const activeOption = popup.locator('[data-testid^="zoom-option-"][data-active="true"]');
    const count = await activeOption.count();
    expect(count).toBe(1); // Exactly one should be active
  });
});

// ---------------------------------------------------------------------------
// Tests — Date Navigation in Day View
// ---------------------------------------------------------------------------

test.describe('Schedule — Day View Date Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
    // Switch to day view
    await page.locator('[data-testid="day-button"]').click();
    await page.waitForTimeout(500);
  });

  test('prev/next period buttons navigate days', async ({ page }) => {
    const dateText = page.locator('[data-testid="date-nav-text"]');
    const initialDate = await dateText.textContent();

    // Click next
    await page.locator('[data-testid="date-nav-next"]').click();
    await page.waitForTimeout(500);

    const nextDate = await dateText.textContent();
    expect(nextDate).not.toBe(initialDate);

    // Click prev to go back
    await page.locator('[data-testid="date-nav-prev"]').click();
    await page.waitForTimeout(500);

    const restoredDate = await dateText.textContent();
    expect(restoredDate).toBe(initialDate);
  });
});
