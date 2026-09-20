import { test, expect } from './fixtures/test';
import { gotoScheduleDay } from './fixtures/helpers';

/**
 * GH #258/#259 (spec §5 S3): the day view matches the week view — click an
 * empty slot → create-activity dialog «Новое занятие» → card appears. The
 * empty hint is unified: DayView renders the same `schedule-empty-hint`
 * banner (its no-filters text is «Нет занятий на этот день») instead of the
 * old column-header label.
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

  // ACT: click the first empty slot
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await emptySlot.click();

  // ASSERT: create-activity dialog opened with slot prefill
  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();

  await test.step('fill create form and submit', async () => {
    // First real option of each select (index 0 is the «—» placeholder)
    await dialog.getByTestId('create-master').selectOption({ index: 1 });
    await dialog.getByTestId('create-service').selectOption({ index: 1 });
    await dialog.getByTestId('create-location').selectOption({ index: 1 });

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();
  });

  // Card appeared in the grid…
  await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  // …and the empty-day hint is gone.
  await expect(page.getByTestId('schedule-empty-hint')).toHaveCount(0);
});
