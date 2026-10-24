import { test, expect } from './fixtures/test';
import { gotoScheduleWeek } from './fixtures/helpers';
import { openCombobox } from './helpers/combobox';
import { pickComboboxOption } from './helpers/combobox';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #258/#259 (spec §5): the empty week (2099-01-05, far future — no seed
 * data ever lands there) renders the full grid with a status hint instead of
 * a stub, and both creation paths work on it:
 *   S2 — click an empty slot → create-activity dialog «Новое занятие» →
 *        card appears, hint disappears.
 *   S4 — stamp panel ready (master + service + location) → click an empty
 *        slot → card appears with NO dialog.
 *
 * GH #280 (spec §5 US-3): picking a service/location through the create
 * form's comboboxes autofills duration/capacity (and shows age read-only +
 * tariffs); re-picking OVERWRITES — and the autofilled values reach the
 * created activity (DB check).
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
    // Combobox picks (GH #280): trigger inside the create-* container +
    // click on the option; index 0 of the list is the pinned clear option.
    await pickComboboxOption(page, 'create-master');
    await pickComboboxOption(page, 'create-service');
    await pickComboboxOption(page, 'create-location');

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();
  });

  // Card appeared in the grid…
  await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();
  // …and the empty-week hint is gone.
  await expect(page.getByTestId('schedule-empty-hint')).toHaveCount(0);
});

test('US-3: service/location picks autofill duration/capacity; re-pick overwrites', async ({
  page,
}) => {
  // ARRANGE: empty week — the dialog opens with a slot prefill
  await navigateToEmptyWeek(page);
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await emptySlot.click();

  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();

  /** Dictionary truth for the picked service: expected «ЧЧ:ММ» + age. */
  const serviceExpectations = (id: string) => {
    const svc = queryDBRow(
      `SELECT duration, min_age, max_age FROM services WHERE id='${id}'`,
    )!;
    const hh = String(Math.floor(svc.duration / 60)).padStart(2, '0');
    const mm = String(svc.duration % 60).padStart(2, '0');
    const age = svc.max_age > 0 ? `${svc.min_age}–${svc.max_age}` : `${svc.min_age}+`;
    return { duration: `${hh}:${mm}`, durationMinutes: svc.duration, age };
  };

  // ACT/ASSERT: first service pick → duration + age read-only + tariffs.
  const svc1 = await pickComboboxOption(page, 'create-service');
  const exp1 = serviceExpectations(svc1.id);
  await expect(dialog.getByTestId('create-duration')).toHaveValue(exp1.duration);
  await expect(dialog.getByTestId('age-display')).toHaveText(exp1.age);
  await expect(dialog.getByTestId('create-service-tariffs')).toBeVisible();

  // Re-pick another service → duration/age/tariffs are OVERWRITTEN.
  const svc2 = await pickComboboxOption(page, 'create-service', 1);
  const exp2 = serviceExpectations(svc2.id);
  await expect(dialog.getByTestId('create-duration')).toHaveValue(exp2.duration);
  await expect(dialog.getByTestId('age-display')).toHaveText(exp2.age);

  // Location pick → capacity from the dictionary (locations.capacity is
  // the default); re-pick overwrites.
  const loc1 = await pickComboboxOption(page, 'create-location');
  const cap1 = queryDBRow(`SELECT capacity FROM locations WHERE id='${loc1.id}'`)!;
  await expect(dialog.getByTestId('create-capacity')).toHaveValue(
    String(cap1.capacity),
  );
  const loc2 = await pickComboboxOption(page, 'create-location', 1);
  const cap2 = queryDBRow(`SELECT capacity FROM locations WHERE id='${loc2.id}'`)!;
  await expect(dialog.getByTestId('create-capacity')).toHaveValue(
    String(cap2.capacity),
  );

  // Submit with the AUTOFILLED values → the created activity carries them.
  // (The slot prefill may be any day of the open 2099-01-04..10 week — no
  // seed data ever lands in 2099, so that week window is unambiguous.)
  await pickComboboxOption(page, 'create-master');
  await dialog.getByTestId('btn-create-activity').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible();

  const created = queryDBRow(
    `SELECT service_id, location_id, duration, capacity FROM activities
     WHERE substr(start,1,10) BETWEEN '2099-01-04' AND '2099-01-10'`,
  );
  expect(created).not.toBeNull();
  expect(created!.service_id).toBe(svc2.id);
  expect(created!.location_id).toBe(loc2.id);
  expect(created!.duration).toBe(exp2.durationMinutes);
  expect(created!.capacity).toBe(cap2.capacity);
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
