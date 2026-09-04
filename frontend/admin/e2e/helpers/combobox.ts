import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Combobox flow helpers (GH #214) — dictionary dropdowns migrated from native
 * selects to the shared Combobox component.
 *
 * Trigger testids/ARIA (Combobox.tsx §5.5):
 *   - trigger:  [data-testid="combobox-trigger"], carries the surface's
 *     aria-label («Фильтр по …», field label) → page.getByLabel(...) works
 *   - dropdown: [data-testid="combobox-dropdown"] (single open instance)
 *   - search:   [data-testid="combobox-search"]
 *   - options:  [data-testid="combobox-option-{value}"], the pinned clear
 *     option is [data-testid="combobox-option-clear"]
 */

/** Opens a Combobox via its trigger and returns the dropdown locator. */
export async function openCombobox(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.click();
  const dropdown = page.locator('[data-testid="combobox-dropdown"]');
  await expect(dropdown).toBeVisible();
  return dropdown;
}

/**
 * Closes the OPEN dropdown by toggling its trigger. `triggerLabel` is the
 * trigger's aria-label («Фильтр по …», field label) — must be selected
 * byRole 'button': while the dropdown is open, getByLabel matches BOTH the
 * trigger button and the aria-labelled listbox → strict mode violation.
 */
export async function closeCombobox(page: Page, triggerLabel: string): Promise<void> {
  await page.getByRole('button', { name: triggerLabel }).click();
  await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
}

/** Clicks the option with the given value inside the OPEN dropdown and waits for close. */
export async function selectComboboxOption(page: Page, optionValue: string): Promise<void> {
  await page.locator(`[data-testid="combobox-option-${optionValue}"]`).click();
  await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
}

/**
 * Types a query into the open Combobox search and clicks the option with the
 * given value (open trigger → type → click option). Pass an empty query to
 * select from the unfiltered list.
 */
export async function searchAndSelect(
  page: Page,
  trigger: Locator,
  query: string,
  optionValue: string,
): Promise<void> {
  await openCombobox(page, trigger);
  if (query) {
    await page.locator('[data-testid="combobox-search"]').fill(query);
  }
  await selectComboboxOption(page, optionValue);
}
