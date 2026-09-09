import { test, expect } from './fixtures/test';
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
  // Wait for day view to be active by checking button text
  await expect(page.locator('[data-testid="day-button"]')).toContainText(/День/);

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

/**
 * Deselect all options EXCEPT the one matching the given id.
 * Useful for "show only one column" semantics — since empty filter = show all,
 * we must keep at least one option checked to have a reduced set.
 */
async function keepOnlyOption(page: import('@playwright/test').Page, keepId: string) {
  const options = page.locator('[data-testid^="multiselect-option-"]');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const testId = await option.getAttribute('data-testid');
    const optionId = testId?.replace('multiselect-option-', '');
    if (optionId === keepId) continue;
    const checkbox = option.locator('div').first();
    const classes = await checkbox.getAttribute('class');
    if (classes && classes.includes('bg-[var(--brand)]')) {
      await option.click();
      await page.waitForTimeout(100);
    }
  }
}

/**
 * Select a specific option by id (ensure it is checked).
 */
async function selectOptionById(page: import('@playwright/test').Page, id: string) {
  const option = page.locator(`[data-testid="multiselect-option-${id}"]`);
  const checkbox = option.locator('div').first();
  const classes = await checkbox.getAttribute('class');
  if (!classes || !classes.includes('bg-[var(--brand)]')) {
    await option.click();
    await page.waitForTimeout(100);
  }
}

/**
 * Close the multiselect dropdown by clicking outside it.
 * MultiSelect only supports outside-click to close (no Escape handler).
 */
async function closeDropdown(page: import('@playwright/test').Page) {
  await page.mouse.click(5, 5);
  await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
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
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

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
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

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

    // 2. Pick a master to re-add later (not the first one)
    const targetId = allIds[allIds.length - 1];
    const keepId = allIds[0];

    // 3. Open filter and keep ONLY the first master (deselect all others)
    //    Note: empty filter = show all, so we must keep at least one checked
    //    to get a reduced set of columns.
    await openMasterFilter(page);
    await keepOnlyOption(page, keepId);
    await closeDropdown(page);

    // 4. Verify only the kept master's column is visible
    const filteredIds = await getColumnHeaderIds(page);
    expect(filteredIds.length).toBe(1);
    expect(filteredIds[0]).toBe(keepId);

    // 5. Re-open master filter and add the target master
    await openMasterFilter(page);
    await selectOptionById(page, targetId);
    // Auto-wait for the target column to appear
    await expect(page.locator(`[data-testid="column-header-${targetId}"]`)).toBeVisible({ timeout: 5_000 });

    // 6. Close dropdown
    await closeDropdown(page);

    // 7. Verify that target master's column is now visible alongside the kept one
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
    await closeDropdown(page);

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
    await closeDropdown(page);

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
    await closeDropdown(page);

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
    await closeDropdown(page);

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

    // switchToDayView clicks day-button which opens the column-mode dropdown.
    // Wait for it to be visible, then select locations.
    await expect(page.locator('[data-testid="column-mode-menu"]')).toBeVisible({ timeout: 5_000 });

    // Switch to locations column mode (pure UI state change, no network call)
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();

    // Verify we're in day view with location columns. Poll (GH #239: a
    // background ['locations'] refetch can transiently render zero columns).
    await expect
      .poll(async () => (await getColumnHeaderIds(page)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    const headersBefore = page.locator('[data-testid^="column-header-"]');
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
      }
    }

    // Select only the first location
    const firstOption = page.locator(`[data-testid="multiselect-option-${firstLocationId}"]`);
    if (await firstOption.isVisible()) {
      await firstOption.click();
    }

    // Close dropdown
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

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

    // switchToDayView clicks day-button which opens the column-mode dropdown.
    // Wait for it to be visible, then select locations.
    await expect(page.locator('[data-testid="column-mode-menu"]')).toBeVisible({ timeout: 5_000 });

    // Switch to locations column mode (pure UI state change, no network call)
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();

    // GH #239 SSE race: a background refetch of ['locations'] (e.g. an
    // external invalidate frame) can transiently render zero columns; poll
    // instead of a one-shot count. Intent: locations mode shows ≥2 columns.
    // 5s timeout matches the server-push refetch window.
    await expect
      .poll(async () => (await getColumnHeaderIds(page)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2);
    const allIds = await getColumnHeaderIds(page);

    // Pick a location to re-add later (not the first one)
    const targetId = allIds[allIds.length - 1];
    const keepId = allIds[0];

    // Open location filter and keep ONLY the first location selected.
    // Note: empty filter = show all, so we must keep at least one checked
    // to get a reduced set of columns.
    await openLocationFilter(page);
    // Deselect all via the select-all checkbox
    const selectAllCheckbox = page.locator('[data-testid="select-all-checkbox"]');
    if (await selectAllCheckbox.isVisible()) {
      const isChecked = await selectAllCheckbox.isChecked();
      if (isChecked) {
        await selectAllCheckbox.click({ force: true });
      }
    }
    // Now select ONLY the keepId (all others are already deselected)
    await selectOptionById(page, keepId);

    // Close dropdown
    await closeDropdown(page);

    // Verify only the kept location's column is visible
    const filteredIds = await getColumnHeaderIds(page);
    expect(filteredIds.length).toBe(1);
    expect(filteredIds[0]).toBe(keepId);

    // Re-open location filter and add the target location
    await openLocationFilter(page);
    await selectOptionById(page, targetId);

    // Close dropdown
    await closeDropdown(page);

    // Verify that target location's column is now visible alongside the kept one
    const afterIds = await getColumnHeaderIds(page);
    expect(afterIds).toContain(targetId);
    expect(afterIds.length).toBeGreaterThan(filteredIds.length);
  });
});
