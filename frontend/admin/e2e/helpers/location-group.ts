import { expect, type Locator } from '@playwright/test';
import { queryDBRow } from '../fixtures/db-query';

/**
 * GH #595 §4.1 — create-form location CHECKBOX GROUP helpers.
 *
 * The create tab renders the location field as a `<fieldset>` group
 * (`data-testid="create-location"`, named by its `<legend>` «Локация»)
 * with one real `<label><input type="checkbox"></label>` row per
 * directory location — each input carries
 * `data-testid="create-location-check"`. Directory order = checkbox
 * order (the same list the old Combobox used, archived halls included).
 *
 * These helpers replace the old `pickComboboxOption(page,
 * 'create-location')` step: picking one option became checking one
 * checkbox. Every helper locates rows BY TITLE (read from the row's
 * label text) so specs derive expectations from the dictionaries (DB)
 * instead of hardcoding seed values; titles used for lookup must be
 * full directory titles — the filter is a substring match.
 */

/** The group container (`create-location` fieldset) inside the dialog. */
export function locationGroup(dialog: Locator): Locator {
  return dialog.getByTestId('create-location');
}

/** All location checkboxes in the group, in directory order. */
export function locationChecks(dialog: Locator): Locator {
  return locationGroup(dialog).getByTestId('create-location-check');
}

/** The checkbox of the location with the given (full, unique) title. */
export function locationCheckByTitle(dialog: Locator, title: string): Locator {
  return locationGroup(dialog)
    .locator('label')
    .filter({ hasText: title })
    .getByTestId('create-location-check');
}

/** Currently CHECKED boxes of the group (auto-retrying count asserts). */
export function checkedLocationChecks(dialog: Locator): Locator {
  return locationGroup(dialog).locator(
    'input[data-testid="create-location-check"]:checked',
  );
}

/** All location titles in checkbox (directory) order. */
export async function locationTitles(dialog: Locator): Promise<string[]> {
  const checks = locationChecks(dialog);
  const count = await checks.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    titles.push((await checks.nth(i).locator('..').innerText()).trim());
  }
  return titles;
}

/**
 * Wait until the directory has arrived: the group renders one checkbox
 * per dictionary row (§4.1 — while the list is loading the group is
 * empty). `directorySize` is the DB-derived count (all halls, archived
 * included). The settle anchor for any "no box checked" negative assert
 * that follows.
 */
export async function waitForLocationDirectory(
  dialog: Locator,
  directorySize: number,
): Promise<void> {
  await expect(locationChecks(dialog)).toHaveCount(directorySize);
}

/**
 * Directory truth (DB): the n-th hall WITH a default capacity, in
 * checkbox (directory) order — `ORDER BY sort_order, title` mirrors the
 * directory's default sort. The safe pick for "check one hall" steps: a
 * leaked capacity=0 hall (dictionaries survive the seed reset) must
 * never turn a blind index-0 pick into a blocked «Создать».
 */
export function hallTitleWithDefault(offset = 0): string {
  const row = queryDBRow(
    `SELECT title FROM locations WHERE capacity >= 1 ORDER BY sort_order, title LIMIT 1 OFFSET ${offset}`,
  );
  if (!row) throw new Error('No location with capacity >= 1 in the test DB');
  return String(row.title);
}
