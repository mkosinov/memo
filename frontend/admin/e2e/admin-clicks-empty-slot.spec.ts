import { SEED_WEEK_MONDAY, addDaysIso } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import { waitForScheduleReady, gotoScheduleWeek } from './fixtures/helpers';
import { clickEmptySlot } from './helpers/clicks';
import { pickComboboxOption } from './helpers/combobox';
import { queryDBRows } from './fixtures/db-query';

/**
 * GH #280 (spec §5): the create-activity dialog «Новое занятие» is the
 * shared ActivityForm (create mode) — same blocks, same order as the edit
 * эталон:
 *
 *   US-1 — click an empty slot → dialog opens with the row composition
 *          «Дата и время + Длительность + Приватное» → «Услуга + возраст +
 *          Вместимость (+ тарифы)» → «Мастер + Локация» → «Создать»;
 *          create-заполнение через комбобоксы → card count grows by 1.
 *   US-2 — slot prefill (calendar date of the clicked slot, minutes snapped
 *          to the grid); changing the datetime to a date in ANOTHER week
 *          creates the activity on the CHOSEN date: no card appears in the
 *          open week, the success toast names the chosen date, and the
 *          activity lives in its own week (navigated to via the week URL
 *          param — #138: the URL is the source of truth).
 */

/** Tuesday of the seed reference week (2026-06-01 + 1). */
const TUESDAY = addDaysIso(SEED_WEEK_MONDAY, 1);
/**
 * Chosen «other week» datetime: Wednesday of the week AFTER the seed
 * reference week (2026-06-08..14 — no seed data ever lands there), 14:00.
 */
const OTHER_WEEK = addDaysIso(SEED_WEEK_MONDAY, 9); // 2026-06-10 (Wednesday)
const OTHER_WEEK_DT = `${OTHER_WEEK}T14:00`;

/**
 * SQLite `start` storage is 'YYYY-MM-DD HH:MM:SS.ffffff' (space separator,
 * microseconds — ORM datetime). The datetime-local value 'YYYY-MM-DDTHH:MM'
 * maps to the 16-char prefix comparison (copy-last-week's substr idiom).
 */
const startPrefix = (datetimeLocal: string) => datetimeLocal.replace('T', ' ');

test('US-1: create form matches the edit form — blocks, order, creation', async ({
  page,
}) => {
  // ARRANGE: on /schedule with the seeded week rendered
  await waitForScheduleReady(page, SEED_WEEK_MONDAY);

  const cardsBefore = await page.locator('[data-testid^="activity-"]').count();

  // ACT: click an empty time slot → the create-activity dialog opens.
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await test.step('click empty slot', async () => {
    await clickEmptySlot(page, emptySlot);
  });

  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();
  // The slot prefill — the created activity must land exactly on it
  // (duration/capacity autofill don't touch the datetime).
  const prefill = await dialog.getByTestId('create-datetime').inputValue();
  expect(prefill).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  // ASSERT (US-1): block composition and DOM order mirror the edit эталон
  // (ActivityForm rows 1–3 + the submit button). The tariffs block renders
  // only after a service is chosen — pick one first.
  const service = await pickComboboxOption(page, 'create-service');

  const anchors = [
    'create-datetime', // row 1: Дата и время
    'create-duration', // row 1: Длительность
    'create-private', // row 1: тумблер «Приватное»
    'create-service', // row 2: Услуга
    'age-display', // row 2: возраст (read-only)
    'create-capacity', // row 2: Вместимость
    'create-service-tariffs', // tariffs block under row 2
    'create-master', // row 3: Мастер
    'create-location', // row 3: Локация
    'btn-create-activity', // submit
  ];
  const order = await dialog.evaluate((root: Element, ids: string[]) => {
    const position = new Map<Element, number>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let i = 0;
    while (walker.nextNode()) position.set(walker.currentNode as Element, i++);
    return ids.map((id) => {
      const el = root.querySelector(`[data-testid="${id}"]`);
      return el ? position.get(el)! : -1;
    });
  }, anchors);
  // Every anchor present (> 0) and strictly increasing — the form's block
  // order equals the эталон's.
  expect(order.every((v) => v > 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));

  // Private is a switch (role="switch"), not a checkbox (spec §43).
  await expect(dialog.getByTestId('create-private')).toHaveAttribute(
    'role',
    'switch',
  );

  // ACT: fill master/location via comboboxes (duration/capacity autofill)
  // and submit.
  // A seed activity may legitimately share the same datetime (a different
  // master's column) — the created row is identified by a before/after
  // count on the exact prefill start, not by uniqueness.
  const sameStartBefore = queryDBRows(
    `SELECT id FROM activities WHERE substr(start,1,16)='${startPrefix(prefill)}'`,
  ).length;
  await test.step('fill create form and submit', async () => {
    await pickComboboxOption(page, 'create-master');
    await pickComboboxOption(page, 'create-location');

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();
  });

  // ASSERT: card appeared in the grid (+1).
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(
    cardsBefore + 1,
  );
  // DB: exactly one more activity on the slot prefill datetime
  // (composeLocalISO appends canonical ':00' seconds), carrying the picked
  // service.
  const created = queryDBRows(
    `SELECT service_id FROM activities WHERE substr(start,1,16)='${startPrefix(prefill)}'`,
  );
  expect(created).toHaveLength(sameStartBefore + 1);
  expect(created.some((r) => r.service_id === service.id)).toBe(true);
});

test('US-2: slot prefill; datetime changed to another week → activity in ITS week, toast names the date', async ({
  page,
}) => {
  // ARRANGE: seed reference week with cards
  await waitForScheduleReady(page, SEED_WEEK_MONDAY);
  const cardsBefore = await page.locator('[data-testid^="activity-"]').count();

  // ACT: click an empty slot in the TUESDAY column.
  const tuesdaySlot = page
    .locator('[data-testid="day-column-1"] [data-testid="empty-slot"]')
    .first();
  await expect(tuesdaySlot).toBeVisible();
  await clickEmptySlot(page, tuesdaySlot);

  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();

  // ASSERT (prefill): the datetime field holds the slot's calendar date and
  // a grid-snapped time (default grid 30 min → :00/:30).
  const prefill = await dialog.getByTestId('create-datetime').inputValue();
  expect(prefill).toMatch(new RegExp(`^${TUESDAY}T\\d{2}:(00|30)$`));

  // ACT: change the datetime to a date in ANOTHER week and fill the form.
  const service = await pickComboboxOption(page, 'create-service');
  await pickComboboxOption(page, 'create-master');
  await pickComboboxOption(page, 'create-location');
  await dialog.getByTestId('create-datetime').fill(OTHER_WEEK_DT);

  await dialog.getByTestId('btn-create-activity').click();
  await expect(dialog).toBeHidden();

  // ASSERT: the success toast names the CHOSEN date (spec §50) —
  // «Создано: {услуга} — среда, 10 июня, 14:00».
  await expect(page.getByTestId('toast-info')).toContainText(
    `Создано: ${service.label} — среда, 10 июня, 14:00`,
  );

  // The open week did NOT grow — the activity is not in it (spec §50).
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(
    cardsBefore,
  );

  // DB: exactly one activity on the chosen datetime — the created one.
  const created = queryDBRows(
    `SELECT id, start FROM activities WHERE substr(start,1,16)='${startPrefix(OTHER_WEEK_DT)}'`,
  );
  expect(created).toHaveLength(1);
  // seconds are server-normalized; the minute-precision prefix is the claim
  expect(created[0]!.start.startsWith(`${startPrefix(OTHER_WEEK_DT)}:00`)).toBe(true);

  // Navigate to the target week via the URL param (#138) — the activity
  // appears in ITS week.
  await gotoScheduleWeek(page, OTHER_WEEK);
  await expect(
    page.locator(`[data-testid="activity-${created[0]!.id}"]`),
  ).toBeVisible();
});
