import { test, expect } from './fixtures/test';
import { gotoScheduleDay } from './fixtures/helpers';
import { clickWithFallback } from './helpers/clicks';
import { pickComboboxOption } from './helpers/combobox';
import {
  checkedLocationChecks,
  locationCheckByTitle,
  locationChecks,
  locationTitles,
  waitForLocationDirectory,
} from './helpers/location-group';
import { createTestLocation, cleanup } from './fixtures/factories';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import type { Response } from '@playwright/test';

/**
 * GH #595 (design §6) — multi-location create scenarios.
 *
 *   US-1  two halls checked → one «Создать» → 2 cards in the
 *         day-by-locations grid, each with its hall's default capacity;
 *         toast «Создано занятий: 2 (…)»; the form closed.
 *   US-3  2+ halls checked where one has no defaultCapacity → «Создать»
 *         blocked, the hint names the hall (§4.2: 0 counts as «no
 *         default»).
 *   US-4  partial failure: a route mock fails the POST whose BODY
 *         location_id is the chosen hall (§8 — with N parallel identical
 *         URLs the call order is nondeterministic; body matching keeps
 *         the test deterministic and localizable). Every route branch
 *         ends in fulfill/continue; each expected response gets its own
 *         wait. Toast «Создано 1 из 2 (…)», the form stays open, the
 *         SUCCESSFUL hall's checkbox auto-unchecks; the retry sends
 *         exactly ONE request and closes the form.
 *
 * US-2/US-5 live in dayview-slot-create.spec.ts (§8).
 *
 * Navigation deep-links to 2099-01-05 (no seed data ever lands there);
 * the day-by-locations grid (`?view=day&col=locations`) gives every hall
 * its own column — `day-view-column-<locationId>`. State purity: the
 * per-test seed reset (#252) restores canonical state; created rows
 * self-heal, the factory hall is cleaned in `finally`.
 */

/** Empty day far in the future — the only activities there are ours. */
const EMPTY_DAY = '2099-01-05';

/** Directory truth: every hall's id/title/default capacity (DB, all rows). */
function directoryFacts(): Map<string, { id: string; capacity: number }> {
  const rows = queryDBRows(
    'SELECT id, title, capacity FROM locations',
  ) as Array<{ id: string; title: string; capacity: number }>;
  return new Map(rows.map((r) => [r.title, { id: r.id, capacity: r.capacity }]));
}

/** Total directory size — one checkbox per row (§4.1, archived included). */
function directorySize(): number {
  return Number(queryDBRow('SELECT COUNT(*) AS c FROM locations')!.c);
}

/** A seed hall WITH a default capacity (US-1/US-3 need at least two). */
function seedHallWithTitle(): { title: string; id: string; capacity: number } {
  const row = queryDBRow(
    'SELECT id, title, capacity FROM locations WHERE capacity >= 1 ORDER BY sort_order LIMIT 1',
  )!;
  return { title: row.title, id: row.id, capacity: Number(row.capacity) };
}

/** Open the create dialog from a slot of the n-th day-by-locations column. */
async function openCreateFromLocationColumn(
  page: import('@playwright/test').Page,
  columnIndex: number,
): Promise<{ dialog: import('@playwright/test').Locator; columnLocationId: string }> {
  const columns = page.locator('[data-testid^="day-view-column-"]');
  const column = columns.nth(columnIndex);
  await expect(column).toBeVisible();
  const columnTestId = (await column.getAttribute('data-testid')) ?? '';
  const columnLocationId = columnTestId.replace(/^day-view-column-/, '');
  expect(columnLocationId, 'day-view column testid carries its hall id').not.toBe('');
  const slot = column.locator('[data-testid="empty-slot"]').first();
  await expect(slot).toBeVisible();
  await clickWithFallback(slot);
  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();
  return { dialog, columnLocationId };
}

/** The activities collection path — never subpaths like copy-week. */
function isActivitiesCollection(url: string): boolean {
  return new URL(url).pathname.endsWith('/api/v1/activities');
}

/** A create RESPONSE: POST to the activities collection. */
function isCreatePostResponse(r: Response): boolean {
  return isActivitiesCollection(r.url()) && r.request().method() === 'POST';
}

/** A create REQUEST (flight counter): POST to the collection. */
function isCreatePostRequest(r: { url(): string; method(): string }): boolean {
  return isActivitiesCollection(r.url()) && r.method() === 'POST';
}

test.describe('GH #595 — multi-location create', () => {
  // No beforeEach navigation: US-3 must create its factory hall BEFORE
  // the page loads (the directory fetch happens once per page — a hall
  // created after navigation would miss the render), and the tests differ
  // in column mode anyway.

  test('US-1: two halls in one action — 2 cards in their columns, each with its hall default; toast «Создано занятий: 2»', async ({
    page,
  }) => {
    // Day-by-locations grid: every hall gets its own column — the
    // card-per-column assertion lives here.
    await gotoScheduleDay(page, EMPTY_DAY, { col: 'locations' });
    const facts = directoryFacts();

    // ACT: open the create dialog from the FIRST column's slot — §4.4
    // prefill pre-checks that column's hall.
    const { dialog, columnLocationId } = await openCreateFromLocationColumn(page, 0);
    await waitForLocationDirectory(dialog, directorySize());
    await pickComboboxOption(page, 'create-master');
    const service = await pickComboboxOption(page, 'create-service');

    // The prefill checked exactly the clicked column's hall…
    const prefillHall = Array.from(facts.entries()).find(([, f]) => f.id === columnLocationId)!;
    await expect(locationCheckByTitle(dialog, prefillHall[0])).toBeChecked();
    await expect(checkedLocationChecks(dialog)).toHaveCount(1);

    // …check a SECOND hall — the first checkbox of another hall WITH a
    // default (a leaked no-default hall must not sneak in and block).
    const titles = await locationTitles(dialog);
    const secondTitle = titles.find(
      (t) => t !== prefillHall[0] && (facts.get(t)?.capacity ?? 0) >= 1,
    )!;
    await locationCheckByTitle(dialog, secondTitle).check();
    await expect(checkedLocationChecks(dialog)).toHaveCount(2);

    // §4.2 at 2+: the capacity field is hidden, the policy hint shows,
    // and «Создать» is enabled with NO manual capacity input.
    await expect(dialog.getByTestId('create-capacity')).toBeHidden();
    await expect(dialog.getByTestId('create-capacity-hint')).toHaveText(
      'Вместимость — по умолчанию каждого зала',
    );
    await expect(dialog.getByTestId('btn-create-activity')).toBeEnabled();

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();

    // ASSERT: the counted success toast (§4.3, N≥2 text).
    await expect(page.getByTestId('toast-info')).toContainText(
      `Создано занятий: 2 (${service.label} —`,
    );

    // …one card per hall, in ITS hall's column…
    const secondHall = facts.get(secondTitle)!;
    for (const hall of [
      { id: prefillHall[1].id, title: prefillHall[0] },
      { id: secondHall.id, title: secondTitle },
    ]) {
      await expect(
        page.locator(
          `[data-testid="day-view-column-${hall.id}"] [data-testid^="activity-"]`,
        ),
      ).toHaveCount(1);
    }

    // …and the DB agrees: 2 activities on the empty day, each carrying
    // ITS hall's default capacity (§4.2 — the form had no capacity input).
    const rows = queryDBRows(
      `SELECT location_id, capacity FROM activities WHERE substr(start,1,10)='${EMPTY_DAY}'`,
    ) as Array<{ location_id: string; capacity: number }>;
    expect(rows).toHaveLength(2);
    const capacityByLocation = new Map(rows.map((r) => [r.location_id, r.capacity]));
    expect(capacityByLocation.get(prefillHall[1].id)).toBe(prefillHall[1].capacity);
    expect(capacityByLocation.get(secondHall.id)).toBe(secondHall.capacity);
  });

  test('US-3: a checked hall without default capacity blocks «Создать»; the hint names the hall', async ({
    page,
    request,
  }) => {
    // SETUP: a hall with capacity 0 — §4.2 counts 0 as «no default»
    // (capacity is NOT NULL in the DB; 0 is the honest «not set»).
    // Created BEFORE navigation: the page's directory fetch must see it.
    const noDefaultHall = await createTestLocation(request, { capacity: 0 });
    try {
      const goodHall = seedHallWithTitle();
      const size = directorySize(); // incl. the factory hall

      // ACT: master-columns day (no §4.4 prefill) → the dialog from a slot.
      await gotoScheduleDay(page, EMPTY_DAY);
      const emptySlot = page.locator('[data-testid="empty-slot"]').first();
      await expect(emptySlot).toBeVisible();
      await clickWithFallback(emptySlot);
      const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
      await expect(dialog).toBeVisible();
      await waitForLocationDirectory(dialog, size); // incl. the factory hall

      await pickComboboxOption(page, 'create-master');
      await pickComboboxOption(page, 'create-service');

      // Discriminator: with ONLY the good hall checked (exactly 1 → its
      // default autofills the capacity field) «Создать» is enabled — the
      // later block can only come from the no-default hall.
      await locationCheckByTitle(dialog, goodHall.title).check();
      await expect(dialog.getByTestId('create-capacity')).toHaveValue(
        String(goodHall.capacity),
      );
      await expect(dialog.getByTestId('btn-create-activity')).toBeEnabled();

      // ACT: check the hall without a default → 2+ → blocked (§4.2), the
      // aria-live hint names the FIRST such hall by checkbox order.
      await locationCheckByTitle(dialog, noDefaultHall.title).check();
      await expect(dialog.getByTestId('btn-create-activity')).toBeDisabled();
      await expect(dialog.getByTestId('create-capacity-hint')).toHaveText(
        `У зала «${noDefaultHall.title}» не задана вместимость`,
      );

      // Localize the blocker: uncheck the bad hall → enabled again (the
      // set returns to exactly 1 → capacity re-autofills, §4.2).
      await locationCheckByTitle(dialog, noDefaultHall.title).uncheck();
      await expect(dialog.getByTestId('btn-create-activity')).toBeEnabled();
      await expect(dialog.getByTestId('create-capacity')).toHaveValue(
        String(goodHall.capacity),
      );

      // Nothing was created — the button never fired with the bad hall.
      const rows = queryDBRows(
        `SELECT id FROM activities WHERE substr(start,1,10)='${EMPTY_DAY}'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup(request, `/api/v1/locations/${noDefaultHall.id}`);
    }
  });

  test('US-4: one POST fails (body-matched route mock) → «Создано 1 из 2», successful hall unchecked; retry sends 1 request → closes', async ({
    page,
  }) => {
    // Day-by-locations grid — the dialog opens from a location column and
    // the §4.4 prefill checks that column's hall.
    await gotoScheduleDay(page, EMPTY_DAY, { col: 'locations' });
    const facts = directoryFacts();

    // ACT: dialog from the first column; the §4.4 prefill checks that
    // hall — it is the one the mock will FAIL. A second hall succeeds
    // through to the real backend.
    const { dialog, columnLocationId } = await openCreateFromLocationColumn(page, 0);
    await waitForLocationDirectory(dialog, directorySize());
    await pickComboboxOption(page, 'create-master');
    const service = await pickComboboxOption(page, 'create-service');
    const failTitle = Array.from(facts.entries()).find(([, f]) => f.id === columnLocationId)![0];
    const failHall = facts.get(failTitle)!;
    await expect(locationCheckByTitle(dialog, failTitle)).toBeChecked();

    const titles = await locationTitles(dialog);
    // The succeeding hall must have a default (its real POST carries it).
    const okTitle = titles.find(
      (t) => t !== failTitle && (facts.get(t)?.capacity ?? 0) >= 1,
    )!;
    const okHall = facts.get(okTitle)!;
    await locationCheckByTitle(dialog, okTitle).check();
    await expect(checkedLocationChecks(dialog)).toHaveCount(2);

    // §8 route mock: fail the POST whose BODY names the failing hall
    // (fulfill branch); everything else continues to the real backend.
    const ROUTE = '**/api/v1/activities';
    await page.route(ROUTE, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON() as { location_id?: string };
      if (body.location_id === failHall.id) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: { code: 'E2E_PARTIAL_FAIL', message: 'Зал закрыт (e2e)' },
          }),
        });
      }
      return route.continue();
    });

    // §8: a separate wait per expected response — the mocked 500 AND the
    // real 201 — both registered before the click.
    const failedResponse = page.waitForResponse(
      (r: Response) => isCreatePostResponse(r) && r.status() === 500,
      { timeout: 15_000 },
    );
    const createdResponse = page.waitForResponse(
      (r: Response) => isCreatePostResponse(r) && r.status() === 201,
      { timeout: 15_000 },
    );
    await dialog.getByTestId('btn-create-activity').click();
    await Promise.all([failedResponse, createdResponse]);

    // ASSERT (§4.3 partial): the counted error toast carries the parsed
    // message of the FIRST failed hall by checkbox order…
    await expect(page.getByTestId('toast-error')).toContainText(
      `Создано 1 из 2 (${service.label}): Зал закрыт (e2e)`,
    );
    // …the form stays open with the draft…
    await expect(dialog).toBeVisible();
    // …the SUCCESSFUL hall auto-unchecks (no duplicates on retry), the
    // failed one stays checked…
    await expect(locationCheckByTitle(dialog, okTitle)).not.toBeChecked();
    await expect(locationCheckByTitle(dialog, failTitle)).toBeChecked();
    // …and the set's return to exactly 1 re-exposes the capacity field
    // prefilled with the remaining hall's default (§4.2 single rule).
    await expect(dialog.getByTestId('create-capacity')).toHaveValue(
      String(failHall.capacity),
    );

    // ACT (retry): drop the mock — only the failed hall remains checked,
    // so exactly ONE create request must fly; success closes the form.
    await page.unroute(ROUTE);
    let createPosts = 0;
    page.on('request', (r) => {
      if (isCreatePostRequest(r)) createPosts++;
    });
    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();
    // The form closed only after the response — by then every request of
    // the flight has fired; exactly one POST went out.
    expect(createPosts).toBe(1);
    await expect(page.getByTestId('toast-info')).toContainText('Создано:');

    // VERIFY DB: both halls now have their activity on the empty day,
    // each with its default capacity.
    const rows = queryDBRows(
      `SELECT location_id, capacity FROM activities WHERE substr(start,1,10)='${EMPTY_DAY}'`,
    ) as Array<{ location_id: string; capacity: number }>;
    expect(rows).toHaveLength(2);
    const capacityByLocation = new Map(rows.map((r) => [r.location_id, r.capacity]));
    expect(capacityByLocation.get(okHall.id)).toBe(okHall.capacity);
    expect(capacityByLocation.get(failHall.id)).toBe(failHall.capacity);
  });
});
