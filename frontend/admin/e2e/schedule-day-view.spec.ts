import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';
import type { Page } from '@playwright/test';

/**
 * E2E tests for Schedule Day View: switching between WeekView and DayView,
 * the single view-selector dropdown (День мастеров / День локаций / Неделя),
 * week-header date drill-down, zoom popup for cell height and grid frequency.
 *
 * Requires: dev server on :3001, backend on :8000
 */

/** Open the «Вид» dropdown and click one of its options. */
async function selectView(page: Page, option: 'view-masters' | 'view-locations' | 'view-week') {
  await page.locator('[data-testid="view-selector"]').click();
  await page.locator(`[data-testid="${option}"]`).click();
}

// ---------------------------------------------------------------------------
// Tests — View Mode Switching
// ---------------------------------------------------------------------------

test.describe('Schedule — WeekView ↔ DayView', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('day option switches from week to day view', async ({ page }) => {
    // Default is week view — 7 day columns should be visible
    for (let i = 0; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).toBeVisible();
    }

    // Select «День мастеров» in the view dropdown
    await selectView(page, 'view-masters');
    await page.waitForTimeout(500);

    // Day view should show only 1 day column (day-column-0)
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();

    // day-column-1 through day-column-6 should NOT be visible
    for (let i = 1; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).not.toBeVisible();
    }
  });

  test('week option switches from day back to week view', async ({ page }) => {
    // Switch to day view first
    await selectView(page, 'view-masters');
    await page.waitForTimeout(500);

    // Verify day view
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();

    // Select the week option
    await selectView(page, 'view-week');
    await page.waitForTimeout(500);

    // Week view should show 7 day columns
    for (let i = 0; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).toBeVisible();
    }
  });

  test('selector trigger shows the active option', async ({ page }) => {
    // Week by default → trigger reads «Неделя»
    await expect(page.locator('[data-testid="view-selector"]')).toContainText('Неделя');

    // Switch to day by locations
    await selectView(page, 'view-locations');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="view-selector"]')).toContainText('День локаций');
  });

  test('day view shows correct date label in topbar', async ({ page }) => {
    // Switch to day view
    await selectView(page, 'view-masters');
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
// Tests — View Selector dropdown (День мастеров / День локаций / Неделя)
// ---------------------------------------------------------------------------

test.describe('Schedule — View selector dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('dropdown opens with all three options, active marked', async ({ page }) => {
    await page.locator('[data-testid="view-selector"]').click();
    await expect(page.locator('[data-testid="view-mode-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-masters"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-locations"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-week"]')).toBeVisible();
    // Week is the default view → active
    await expect(page.locator('[data-testid="view-week"]')).toHaveAttribute('data-active', 'true');
  });

  test('«День локаций» click switches column mode (client-side only — no API call)', async ({ page }) => {
    await selectView(page, 'view-locations');
    await page.waitForTimeout(500);

    // The trigger now shows the locations option
    await expect(page.locator('[data-testid="view-selector"]')).toContainText('День локаций');

    // Day column should still be visible
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();
  });

  test('«День мастеров» click switches column mode back', async ({ page }) => {
    await selectView(page, 'view-locations');
    await expect(page.locator('[data-testid="view-selector"]')).toContainText('День локаций');

    await selectView(page, 'view-masters');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="view-selector"]')).toContainText('День мастеров');
  });

  test('day-option click from week view auto-switches to day view', async ({ page }) => {
    // Start in week view (default)
    await expect(page.locator('[data-testid="day-column-6"]')).toBeVisible();

    // Select a day option (client-side only — no API call)
    await selectView(page, 'view-masters');
    await page.waitForTimeout(500);

    // Should now be in day view (only day-column-0 visible)
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="day-column-6"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tests — Week header drill-down (date click → day by locations)
// ---------------------------------------------------------------------------

test.describe('Schedule — Week header date click', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('clicking a week date opens that day by locations', async ({ page }) => {
    // Monday of the current week; click its Wednesday (index 2)
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const wednesday = new Date(monday);
    wednesday.setDate(monday.getDate() + 2);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    await page.locator('[data-testid="week-day-header-2"]').click();
    await page.waitForTimeout(500);

    // Day view by locations on the clicked date
    await expect(page.locator('[data-testid="day-column-0"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="day-column-6"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="view-selector"]')).toContainText('День локаций');
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('col')).toBe('locations');
    expect(new URL(page.url()).searchParams.get('date')).toBe(iso(wednesday));
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
    await selectView(page, 'view-masters');
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
