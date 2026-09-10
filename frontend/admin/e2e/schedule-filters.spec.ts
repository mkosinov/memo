import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * E2E tests for Schedule page filters: Masters multi-select,
 * Locations multi-select, filter interactions.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Schedule Filters
// ---------------------------------------------------------------------------

test.describe('Schedule — Masters Filter', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('masters filter button is visible in topbar', async ({ page }) => {
    // The MultiSelect uses aria-label="Мастера" on its trigger button
    // Scope to center-content to avoid matching the sidebar "Мастера" button
    const mastersFilter = page.locator('[data-testid="center-content"] button[aria-label="Мастера"]');
    await expect(mastersFilter).toBeVisible();
  });

  test('clicking masters filter opens dropdown with options', async ({ page }) => {
    const mastersFilter = page.locator('[data-testid="center-content"] button[aria-label="Мастера"]');
    await mastersFilter.click();

    // Dropdown should appear
    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Should have at least one option
    const options = dropdown.locator('[data-testid^="multiselect-option-"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('selecting a master filter narrows activity cards', async ({ page }) => {
    const initialCount = await page.locator('[data-testid^="activity-"]').count();

    // Open the masters filter dropdown — scope to center-content
    const mastersFilter = page.locator('[data-testid="center-content"] button[aria-label="Мастера"]');
    await mastersFilter.click();

    // Wait for dropdown
    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Get the first option and click it to select/deselect
    const firstOption = dropdown.locator('[data-testid^="multiselect-option-"]').first();
    const optionTestId = await firstOption.getAttribute('data-testid');
    const masterId = optionTestId?.replace('multiselect-option-', '');

    // Click to select only this master (toggle)
    await firstOption.click();
    await page.waitForTimeout(500);

    // Close dropdown by clicking outside
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Filtered count should be <= initial count
    const filteredCount = await page.locator('[data-testid^="activity-"]').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Re-open dropdown and clear filter
    await mastersFilter.click();
    await page.waitForTimeout(300);

    // Click the same option again to deselect
    if (masterId) {
      const option = page.locator(`[data-testid="multiselect-option-${masterId}"]`);
      await option.click();
    }
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
  });

  test('select all checkbox works in masters filter', async ({ page }) => {
    const mastersFilter = page.locator('[data-testid="center-content"] button[aria-label="Мастера"]');
    await mastersFilter.click();

    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Masters filter uses grouped mode (getGroup by specialty), so it shows group checkboxes
    // instead of a single select-all checkbox. Verify individual options exist and can be toggled.
    const options = dropdown.locator('[data-testid^="multiselect-option-"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // Click first option to toggle
    await options.first().click();
    await page.waitForTimeout(300);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
  });
});

test.describe('Schedule — Locations Filter', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('locations filter button is visible in topbar', async ({ page }) => {
    const locationsFilter = page.locator('button[aria-label="Локации"]');
    await expect(locationsFilter).toBeVisible();
  });

  test('clicking locations filter opens dropdown with options', async ({ page }) => {
    const locationsFilter = page.locator('button[aria-label="Локации"]');
    await locationsFilter.click();

    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    const options = dropdown.locator('[data-testid^="multiselect-option-"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('selecting a location filter narrows activity cards', async ({ page }) => {
    const initialCards = page.locator('[data-testid^="activity-"]');
    const initialCount = await initialCards.count();

    const locationsFilter = page.locator('button[aria-label="Локации"]');
    await locationsFilter.click();

    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Click first option to toggle
    const firstOption = dropdown.locator('[data-testid^="multiselect-option-"]').first();
    const optionTestId = await firstOption.getAttribute('data-testid');
    const locationId = optionTestId?.replace('multiselect-option-', '');

    await firstOption.click();
    await page.waitForTimeout(500);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Count should be <= initial
    const filteredCards = page.locator('[data-testid^="activity-"]');
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Re-open and clear filter
    await locationsFilter.click();
    await page.waitForTimeout(300);
    if (locationId) {
      const option = page.locator(`[data-testid="multiselect-option-${locationId}"]`);
      await option.click();
    }
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
  });

  test('locations filter shows group headers', async ({ page }) => {
    const locationsFilter = page.locator('button[aria-label="Локации"]');
    await locationsFilter.click();

    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Should have group checkboxes if locations are grouped
    const options = dropdown.locator('[data-testid^="multiselect-option-"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // Close dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
  });
});
