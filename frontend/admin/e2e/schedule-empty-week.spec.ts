import { test, expect } from './fixtures/test';
import { gotoScheduleWeek } from './fixtures/helpers';
import { openCombobox } from './helpers/combobox';

/**
 * GH #258/#259 (spec §5): the empty week (2099-01-05, far future — no seed
 * data ever lands there) renders the full grid with a status hint instead of
 * a stub, and both creation paths work on it:
 *   S2 — click an empty slot → create-activity dialog «Новое занятие» →
 *        card appears, hint disappears.
 *   S4 — stamp panel ready (master + service + location) → click an empty
 *        slot → card appears with NO dialog.
 *
 * State purity: the per-test seed reset (#252, auto fixture in
 * fixtures/test) restores canonical state before every test — activities
 * created here self-heal on the next reset, no manual cleanup.
 */

/** Deep-link to the empty week of 2099-01-05 (#138: /schedule?view=week&date=…). */
const EMPTY_WEEK_DATE = '2099-01-05';
const TOPBAR = '[data-testid="center-content"]';

/**
 * The schedule initializes master/location filters to "all selected"
 * (ScheduleDataContext init-once effect), so a fresh empty week shows the
 * FILTERS variant of the hint. Deselect everything through the Topbar
 * MultiSelects (pattern from schedule-column-visibility.spec.ts) to reach
 * the "no filters" state — only then does the hint read
 * «Нет занятий на эту неделю» (spec §2.2).
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

async function navigateToEmptyWeek(page: import('@playwright/test').Page) {
  await gotoScheduleWeek(page, EMPTY_WEEK_DATE);
  // No cards can exist on this week — the hint must be there too.
  await expect(page.getByTestId('schedule-empty-hint')).toBeVisible();
}

test('S2: empty week — hint, click-create via dialog, card appears, hint disappears', async ({
  page,
}) => {
  // ARRANGE: empty week of 2099-01-05 with grid + hint
  await navigateToEmptyWeek(page);
  await deselectAllFilters(page);

  // Hint text distinguishes "no filters" emptiness (spec §2.2)
  await expect(page.getByTestId('schedule-empty-hint')).toHaveText(
    'Нет занятий на эту неделю',
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
  // …and the empty-week hint is gone.
  await expect(page.getByTestId('schedule-empty-hint')).toHaveCount(0);
});

test('S4: empty week — ready stamp, click-create without dialog', async ({ page }) => {
  // ARRANGE: empty week of 2099-01-05 with grid + hint
  await navigateToEmptyWeek(page);

  // Open the toolbar (stamp panel) if it starts collapsed.
  const rightPanel = page.locator('[data-testid="right-panel"]');
  if (!(await rightPanel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
  }

  // Master: Combobox inside the stamp master picker (open + first real
  // option; index 0 is the pinned clear option «Не выбран»).
  const masterTrigger = page
    .getByTestId('stamp-master-picker')
    .getByTestId('combobox-trigger');
  await expect(masterTrigger).toBeVisible();
  await openCombobox(page, masterTrigger);
  await page
    .locator('[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])')
    .first()
    .click();

  // Service: Combobox labelled «Услуга» (open + first real option).
  const serviceTrigger = page.getByRole('button', { name: 'Услуга' });
  await expect(serviceTrigger).toBeVisible();
  await openCombobox(page, serviceTrigger);
  await page
    .locator('[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])')
    .first()
    .click();

  // Location: check the first checkbox in the stamp panel locations block.
  await rightPanel.locator('input[type="checkbox"]').first().check();

  // Stamp is ready → summary shows; grid slots now create directly.
  await expect(page.getByTestId('stamp-summary')).toBeVisible();

  // ACT: click an empty slot — creation must happen WITHOUT the dialog.
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await emptySlot.click();

  // ASSERT: card appeared…
  await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  // …and no dialog opened (stamp path, not the create modal).
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
