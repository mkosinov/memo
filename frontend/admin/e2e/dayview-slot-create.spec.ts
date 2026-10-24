import { test, expect } from './fixtures/test';
import { gotoScheduleDay, closeModal } from './fixtures/helpers';
import { openCreateDialog, clickWithFallback } from './helpers/clicks';
import { pickComboboxOption } from './helpers/combobox';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #258/#259 (spec §5 S3): the day view matches the week view — click an
 * empty slot → create-activity dialog «Новое занятие» (GH #280: the shared
 * ActivityForm with create-* comboboxes) → card appears. The empty hint is
 * unified: DayView renders the same `schedule-empty-hint` banner (its
 * no-filters text is «Нет занятий на этот день») instead of the old
 * column-header label.
 *
 * GH #280 spec §5 on top:
 *   US-5 — cancel: closing the form without «Создать» creates nothing —
 *          the day stays empty (hint visible, no cards, no DB row).
 *   US-4 — private: the «Приватное» switch (role="switch") creates a
 *          private activity (DB is_private=1 + the card's edit form shows
 *          the private state).
 *
 * Navigation deep-links to the far-future date 2099-01-05 where no seed
 * activity ever exists (#138: /schedule?view=day&date=… — the URL is the
 * source of truth).
 *
 * State purity: the per-test seed reset (#252, auto fixture in
 * fixtures/test) restores canonical state — created activities self-heal.
 */

/** Empty day far in the future — no seed data ever lands there. */
const EMPTY_DAY = '2099-01-05';
const TOPBAR = '[data-testid="center-content"]';

/**
 * The schedule initializes master/location filters to "all selected"
 * (ScheduleDataContext init-once effect), so a fresh empty day shows the
 * FILTERS variant of the hint. Deselect everything through the Topbar
 * MultiSelects (pattern from schedule-empty-week.spec.ts) to reach the
 * "no filters" state — only then does the hint read
 * «Нет занятий на этот день» (spec §2.2).
 */
async function deselectAllFilters(page: import('@playwright/test').Page) {
  for (const label of ['Мастера', 'Локации']) {
    await page.locator(`${TOPBAR} button[aria-label="${label}"]`).click();
    const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
    await dropdown.waitFor({ state: 'visible', timeout: 5_000 });
    const options = dropdown.locator('[data-testid^="multiselect-option-"]');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const checkbox = option.locator('div').first();
      const classes = await checkbox.getAttribute('class');
      if (classes && classes.includes('bg-[var(--brand)]')) {
        await option.click();
        await page.waitForTimeout(100);
      }
    }
    // MultiSelect closes on outside click only — click the logo corner (safe neutral area).
    await page.mouse.click(5, 5);
    await dropdown.waitFor({ state: 'hidden', timeout: 5_000 });
  }
}

async function navigateToEmptyDay(page: import('@playwright/test').Page) {
  await gotoScheduleDay(page, EMPTY_DAY);
  await expect(page.getByTestId('schedule-empty-hint')).toBeVisible();
}

test('S3: day view — hint, click-create via dialog, card appears', async ({ page }) => {
  // ARRANGE: empty day of 2099-01-05 in day view with grid + hint
  await navigateToEmptyDay(page);
  await deselectAllFilters(page);

  // Hint text distinguishes "no filters" emptiness (spec §2.2)
  await expect(page.getByTestId('schedule-empty-hint')).toHaveText(
    'Нет занятий на этот день',
  );

  // ACT: click the first empty slot → fill via comboboxes → submit
  const dialog = await openCreateDialog(page);

  await test.step('fill create form and submit', async () => {
    await pickComboboxOption(page, 'create-master');
    await pickComboboxOption(page, 'create-service');
    await pickComboboxOption(page, 'create-location');

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();
  });

  // Card appeared in the grid…
  await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  // …and the empty-day hint is gone.
  await expect(page.getByTestId('schedule-empty-hint')).toHaveCount(0);
});

test('US-5: closing the form without «Создать» — no side effects', async ({ page }) => {
  // ARRANGE: empty day — nothing can exist here
  await navigateToEmptyDay(page);

  // ACT: open the create dialog from a slot, dirty the form (service
  // picked → duration/tariffs filled), then close WITHOUT «Создать»
  // (backdrop click — the user's close gesture, #138).
  const dialog = await openCreateDialog(page);
  await pickComboboxOption(page, 'create-service');
  await pickComboboxOption(page, 'create-master');
  await closeModal(page);

  // ASSERT: the dialog is gone…
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // …no success toast fired…
  await expect(page.getByTestId('toast-info')).toHaveCount(0);
  // …the slot stays empty (hint still up, no cards)…
  await expect(page.getByTestId('schedule-empty-hint')).toBeVisible();
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(0);
  // …and nothing reached the DB on the empty day.
  const rows = queryDBRows(
    `SELECT id FROM activities WHERE substr(start,1,10)='${EMPTY_DAY}'`,
  );
  expect(rows).toHaveLength(0);
});

test('US-4: «Приватное» switch creates a private activity', async ({ page }) => {
  // ARRANGE: empty day of the far future — the created activity is the
  // only row on that date, identified without factories.
  await navigateToEmptyDay(page);

  // ACT: open the create dialog and flip the «Приватное» switch
  // (role="switch", aria-checked — GH #280 spec §43) before submitting.
  const dialog = await openCreateDialog(page);
  const toggle = dialog.getByTestId('create-private');
  await expect(toggle).toHaveAttribute('role', 'switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await pickComboboxOption(page, 'create-master');
  await pickComboboxOption(page, 'create-service');
  await pickComboboxOption(page, 'create-location');
  await dialog.getByTestId('btn-create-activity').click();
  await expect(dialog).toBeHidden();

  // ASSERT: the card appeared…
  const card = page.locator('[data-testid^="activity-"]').first();
  await expect(card).toBeVisible();

  // …DB says the created activity IS private (copy-last-week pattern)…
  const row = queryDBRow(
    `SELECT id, is_private FROM activities WHERE substr(start,1,10)='${EMPTY_DAY}'`,
  );
  expect(row).not.toBeNull();
  expect(row!.is_private).toBe(1);

  // …and the UI agrees: reopen the card → the edit form's private switch
  // is on (activity-details-modal.spec.ts pattern).
  await clickWithFallback(card);
  const editDialog = page.locator('[data-testid="activity-details-modal"]');
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByTestId('toggle-private')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
