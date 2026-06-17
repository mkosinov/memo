import { test, expect } from '@playwright/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * E2E tests for DayView column visibility controlled by filters.
 *
 * Verifies:
 * 1. Empty filter shows all master columns
 * 2. Filter selection shows only selected columns
 * 3. Pin buttons are removed (not present in DOM)
 * 4. Column headers show master names
 * 5. Location filter controls location columns
 */

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';
const DEV_USER_ID = 'dev-user-001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clear memo-user-settings from localStorage before page load.
 * Uses addInitScript so it runs before any page JS, preventing
 * stale column orders from being loaded by UserSettingsContext.
 */
async function clearUserSettingsStorage(page: import('@playwright/test').Page) {
  await page.context().addInitScript(() => {
    localStorage.removeItem('memo-user-settings');
  });
}

/**
 * Reset user settings via the API to ensure column orders include all masters/locations.
 * Previous test runs may have saved partial column orders (e.g. only ["m2"]),
 * which causes DayView to render only that one column.
 */
async function resetUserSettings(request: import('@playwright/test').APIRequestContext) {
  await request.put(`${BACKEND}/api/v1/user-settings?user_id=${DEV_USER_ID}`, {
    data: {
      column_order_masters: [],
      column_order_locations: [],
    },
  });
}

/**
 * Switch to DayView by clicking the day button and optionally navigating
 * to a specific date via the __memo-switch-to-day-view custom event.
 *
 * @param page   Playwright page instance
 * @param date   Optional ISO date string (e.g. '2026-06-05'). When provided,
 *               dispatches a custom event to navigate to that day so tests land
 *               on a date with known seed data.
 */
async function switchToDayView(page: import('@playwright/test').Page, date?: string) {
  await page.locator('[data-testid="day-button"]').click();
  await page.waitForTimeout(500);

  if (date) {
    // Navigate to the specific date via custom event
    await page.evaluate((d: string) => {
      document.dispatchEvent(
        new CustomEvent('__memo-switch-to-day-view', { detail: { date: d } }),
      );
    }, `${date}T12:00:00`);

    // Wait for DayView column headers to appear (master columns start with 'column-header-m')
    await page.waitForSelector('[data-testid^="column-header-m"]', { timeout: 5000 });
  }
}

/**
 * Scope to the Topbar area (inside center-content), avoiding the menubar's
 * duplicate "Мастера" / "Локации" buttons.
 */
const TOPBAR = '[data-testid="center-content"]';

/**
 * Open the master MultiSelect filter dropdown in the Topbar.
 */
async function openMasterFilter(page: import('@playwright/test').Page) {
  await page.locator(`${TOPBAR} button[aria-label="Мастера"]`).click();
  await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'visible', timeout: 3000 });
}

/**
 * Open the location MultiSelect filter dropdown in the Topbar.
 */
async function openLocationFilter(page: import('@playwright/test').Page) {
  await page.locator(`${TOPBAR} button[aria-label="Локации"]`).click();
  await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'visible', timeout: 3000 });
}

/**
 * Get all visible column header test IDs (the col.id part).
 */
async function getColumnHeaderIds(page: import('@playwright/test').Page): Promise<string[]> {
  const headers = page.locator('[data-testid^="column-header-"]');
  const count = await headers.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await headers.nth(i).getAttribute('data-testid');
    if (testId) {
      ids.push(testId.replace('column-header-', ''));
    }
  }
  return ids;
}

/**
 * Deselect all individual options in the currently open dropdown.
 * Works for both grouped and flat MultiSelect modes.
 */
async function deselectAllOptions(page: import('@playwright/test').Page) {
  const options = page.locator('[data-testid^="multiselect-option-"]');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    // Check if this option has the "checked" visual indicator (brand-colored checkbox)
    const checkbox = option.locator('div').first();
    const classes = await checkbox.getAttribute('class');
    if (classes && classes.includes('bg-[var(--brand)]')) {
      await option.click();
      await page.waitForTimeout(100);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests — Empty Filter Shows All Columns
// ---------------------------------------------------------------------------

test.describe('DayView Column Visibility', () => {
  test.beforeEach(async ({ page, request }) => {
    // Clear localStorage before any page load so UserSettingsContext starts fresh
    await clearUserSettingsStorage(page);
    // Reset backend user settings to include all masters
    await resetUserSettings(request);
    // Now navigate — localStorage is clean, backend is clean
    await waitForScheduleReady(page);
    await switchToDayView(page, '2026-06-05');
  });

  test('empty filter shows all master columns', async ({ page }) => {
    // No filter selected — all master columns should be visible
    const headers = page.locator('[data-testid^="column-header-"]');
    await expect(headers.first()).toBeVisible({ timeout: 5000 });
    const count = await headers.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('pin buttons are removed', async ({ page }) => {
    // Pin feature was removed — verify no pin buttons exist in the DOM
    const pinButtons = page.locator('[data-testid^="pin-"]');
    const count = await pinButtons.count();
    expect(count).toBe(0);
  });

  test('column headers show master names', async ({ page }) => {
    const headers = page.locator('[data-testid^="column-header-"]');
    const firstHeader = headers.first();
    await expect(firstHeader).toBeVisible({ timeout: 5000 });
    const text = await firstHeader.textContent();
    expect(text).toBeTruthy();
    expect(text!.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Filter-Based Column Visibility (Master Filter)
// ---------------------------------------------------------------------------

test.describe('DayView Column Visibility — Master Filter', () => {
  test.beforeEach(async ({ page, request }) => {
    // Clear localStorage before any page load so UserSettingsContext starts fresh
    await clearUserSettingsStorage(page);
    // Reset backend user settings to include all masters
    await resetUserSettings(request);
    // Now navigate — localStorage is clean, backend is clean
    await waitForScheduleReady(page);
    await switchToDayView(page, '2026-06-05');
  });

  test('deselecting all masters except one shows only that column', async ({ page }) => {
    // Get initial column count (should be all masters)
    const headersBefore = page.locator('[data-testid^="column-header-"]');
    await expect(headersBefore.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await headersBefore.count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Get the first column's master ID
    const firstTestId = await headersBefore.first().getAttribute('data-testid');
    expect(firstTestId).toBeTruthy();
    const firstMasterId = firstTestId!.replace('column-header-', '');

    // Open master filter
    await openMasterFilter(page);

    // Master filter uses grouped mode (getGroup by specialty).
    // Deselect all options that are currently checked, except our target.
    const options = page.locator('[data-testid^="multiselect-option-"]');
    const optionCount = await options.count();

    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const testId = await option.getAttribute('data-testid');
      if (!testId) continue;
      const optionId = testId.replace('multiselect-option-', '');

      // Skip the one we want to keep selected
      if (optionId === firstMasterId) continue;

      // Check if it looks selected (has brand-colored checkbox background)
      const checkboxDiv = option.locator('div').first();
      const cls = await checkboxDiv.getAttribute('class');
      if (cls && cls.includes('bg-[var(--brand)]')) {
        await option.click();
        await page.waitForTimeout(100);
      }
    }

    // Close the dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Verify only one column header remains
    const headersAfter = page.locator('[data-testid^="column-header-"]');
    const countAfter = await headersAfter.count();
    expect(countAfter).toBe(1);

    // Verify it's the correct master
    const remainingTestId = await headersAfter.first().getAttribute('data-testid');
    expect(remainingTestId).toBe(`column-header-${firstMasterId}`);
  });

  test('selecting multiple masters shows their columns', async ({ page }) => {
    // Get initial column IDs
    const idsBefore = await getColumnHeaderIds(page);
    expect(idsBefore.length).toBeGreaterThanOrEqual(2);

    // Open master filter
    await openMasterFilter(page);

    // Deselect all options except first two
    const options = page.locator('[data-testid^="multiselect-option-"]');
    const optionCount = await options.count();
    const keepIds = new Set([idsBefore[0], idsBefore[1]]);

    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const testId = await option.getAttribute('data-testid');
      if (!testId) continue;
      const optionId = testId.replace('multiselect-option-', '');

      if (keepIds.has(optionId)) continue;

      const checkboxDiv = option.locator('div').first();
      const cls = await checkboxDiv.getAttribute('class');
      if (cls && cls.includes('bg-[var(--brand)]')) {
        await option.click();
        await page.waitForTimeout(100);
      }
    }

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Verify exactly 2 columns
    const headersAfter = page.locator('[data-testid^="column-header-"]');
    const countAfter = await headersAfter.count();
    expect(countAfter).toBe(2);

    // Verify the correct masters are shown
    const idsAfter = await getColumnHeaderIds(page);
    expect(idsAfter).toContain(idsBefore[0]);
    expect(idsAfter).toContain(idsBefore[1]);
  });

  test('adding a master to filter makes its column appear', async ({ page }) => {
    // 1. Get all initial column IDs
    const allIds = await getColumnHeaderIds(page);
    expect(allIds.length).toBeGreaterThanOrEqual(2);

    // 2. Pick the LAST master to re-add later
    const targetId = allIds[allIds.length - 1];

    // 3. Open filter and deselect ALL masters
    await openMasterFilter(page);
    await deselectAllOptions(page);
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // 4. Verify columns are filtered (fewer than initial)
    const filteredIds = await getColumnHeaderIds(page);
    expect(filteredIds.length).toBeLessThan(allIds.length);

    // 5. Re-open master filter
    await openMasterFilter(page);

    // 6. Select the target master
    const targetOption = page.locator(`[data-testid="multiselect-option-${targetId}"]`);
    await targetOption.click();
    await page.waitForTimeout(200);

    // 7. Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // 8. Verify that master's column is now visible
    const afterIds = await getColumnHeaderIds(page);
    expect(afterIds).toContain(targetId);
    expect(afterIds.length).toBeGreaterThan(filteredIds.length);
  });

  test('removing and re-adding master preserves column position', async ({ page }) => {
    // 1. Get initial column order
    const initialIds = await getColumnHeaderIds(page);
    expect(initialIds.length).toBeGreaterThanOrEqual(3);

    // Pick the second master to remove and re-add
    const targetId = initialIds[1];

    // 2. Open master filter, deselect the second master
    await openMasterFilter(page);
    const option = page.locator(`[data-testid="multiselect-option-${targetId}"]`);
    const checkboxDiv = option.locator('div').first();
    const cls = await checkboxDiv.getAttribute('class');
    if (cls && cls.includes('bg-[var(--brand)]')) {
      await option.click();
      await page.waitForTimeout(100);
    }

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // 3. Verify the column is gone
    const afterRemoveIds = await getColumnHeaderIds(page);
    expect(afterRemoveIds).not.toContain(targetId);
    expect(afterRemoveIds.length).toBe(initialIds.length - 1);

    // 4. Re-open filter and select the target again
    await openMasterFilter(page);
    const reOption = page.locator(`[data-testid="multiselect-option-${targetId}"]`);
    await reOption.click();
    await page.waitForTimeout(200);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // 5. Verify the column is back
    const afterAddIds = await getColumnHeaderIds(page);
    expect(afterAddIds).toContain(targetId);

    // 6. Verify column order is preserved (target is NOT at the end)
    const targetIndex = afterAddIds.indexOf(targetId);
    expect(targetIndex).toBe(1); // Should be back in its original position (index 1)
    expect(afterAddIds).toEqual(initialIds);
  });

  test('re-selecting all masters restores all columns', async ({ page }) => {
    // Get initial column count
    const headersBefore = page.locator('[data-testid^="column-header-"]');
    await expect(headersBefore.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await headersBefore.count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Deselect all via filter — open and click each checked option
    await openMasterFilter(page);
    await deselectAllOptions(page);
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Re-select all — open and click each unchecked option
    await openMasterFilter(page);
    const options = page.locator('[data-testid^="multiselect-option-"]');
    const optionCount = await options.count();
    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const checkboxDiv = option.locator('div').first();
      const cls = await checkboxDiv.getAttribute('class');
      // If NOT selected (no brand bg), click to select
      if (!cls || !cls.includes('bg-[var(--brand)]')) {
        await option.click();
        await page.waitForTimeout(100);
      }
    }
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // All columns should be back
    const headersAfter = page.locator('[data-testid^="column-header-"]');
    const countAfter = await headersAfter.count();
    expect(countAfter).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Tests — Location Filter
// ---------------------------------------------------------------------------

test.describe('DayView Column Visibility — Location Filter', () => {
  test('switching to locations mode and filtering shows only selected locations', async ({ page, request }) => {
    await clearUserSettingsStorage(page);
    await resetUserSettings(request);
    await waitForScheduleReady(page);
    await switchToDayView(page, '2026-06-05');

    // Switch to locations column mode
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
    await page.waitForTimeout(500);

    // Verify we're in day view with location columns
    const headersBefore = page.locator('[data-testid^="column-header-"]');
    await expect(headersBefore.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await headersBefore.count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Get the first column's location ID
    const firstTestId = await headersBefore.first().getAttribute('data-testid');
    expect(firstTestId).toBeTruthy();
    const firstLocationId = firstTestId!.replace('column-header-', '');

    // Open location filter — locations use flat mode (no getGroup)
    await openLocationFilter(page);

    // Locations use flat mode → has select-all-checkbox
    const selectAllCheckbox = page.locator('[data-testid="select-all-checkbox"]');
    if (await selectAllCheckbox.isVisible()) {
      const isChecked = await selectAllCheckbox.isChecked();
      if (isChecked) {
        await selectAllCheckbox.click({ force: true });
        await page.waitForTimeout(200);
      }
    }

    // Select only the first location
    const firstOption = page.locator(`[data-testid="multiselect-option-${firstLocationId}"]`);
    if (await firstOption.isVisible()) {
      await firstOption.click();
      await page.waitForTimeout(200);
    }

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Verify only one column visible
    const headersAfter = page.locator('[data-testid^="column-header-"]');
    const countAfter = await headersAfter.count();
    expect(countAfter).toBe(1);

    // Verify it's the correct location
    const remainingTestId = await headersAfter.first().getAttribute('data-testid');
    expect(remainingTestId).toBe(`column-header-${firstLocationId}`);
  });

  test('location filter: adding location makes its column appear', async ({ page, request }) => {
    await clearUserSettingsStorage(page);
    await resetUserSettings(request);
    await waitForScheduleReady(page);
    await switchToDayView(page, '2026-06-05');

    // Switch to locations column mode
    await page.locator('[data-testid="day-button"]  ').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
    await page.waitForTimeout(500);

    // Get initial location column IDs
    const allIds = await getColumnHeaderIds(page);
    expect(allIds.length).toBeGreaterThanOrEqual(2);

    // Pick the last location to re-add later
    const targetId = allIds[allIds.length - 1];

    // Open location filter and deselect all
    await openLocationFilter(page);
    const selectAllCheckbox = page.locator('[data-testid="select-all-checkbox"]');
    if (await selectAllCheckbox.isVisible()) {
      const isChecked = await selectAllCheckbox.isChecked();
      if (isChecked) {
        await selectAllCheckbox.click({ force: true });
        await page.waitForTimeout(200);
      }
    }
    // Also click any remaining checked options
    await deselectAllOptions(page);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Verify fewer columns
    const filteredIds = await getColumnHeaderIds(page);
    expect(filteredIds.length).toBeLessThan(allIds.length);

    // Re-open location filter
    await openLocationFilter(page);

    // Select the target location
    const targetOption = page.locator(`[data-testid="multiselect-option-${targetId}"]`);
    await targetOption.click();
    await page.waitForTimeout(200);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Verify that location's column is now visible
    const afterIds = await getColumnHeaderIds(page);
    expect(afterIds).toContain(targetId);
    expect(afterIds.length).toBeGreaterThan(filteredIds.length);
  });
});
