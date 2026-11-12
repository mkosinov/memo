/**
 * activity-photos.spec.ts — #576 Task 6: the activity-detail photo strip
 * (User Scenarios US-1…US-4 + the spec §7 visual checks).
 *
 *   US-1 — service photos AND activity photos: strip = cover, then the
 *          two service photos, then the two activity photos (group order
 *          asserted strictly; thumb clicks swap the main; the cover
 *          thumb brings the cover back; the non-public photo never
 *          renders). The service's OTHER activity — without own photos —
 *          shows the SAME strip (the service-scoped union, §6.5).
 *   US-2 — photos only on the service: strip = cover + service photos.
 *   US-3 — photos only on the activity (service has none): strip =
 *          cover + activity photos.
 *   US-4 — no photos anywhere: no strip, the main stays on the cover.
 *
 * Fixtures live in ./fixtures/activity-photos.ts (staff API, one distinct
 * photo-clean service per scenario, activities on distinct days of the
 * visible week, static filenames from public/images — canon #513).
 *
 * §7 machine hints encoded here: activity-photo-main defaults to the
 * cover (1), activity-photo-strip holds activity-photo-thumb in API
 * order — US-1 service photos before activity photos (2), a thumb click
 * swaps the main (3), the strip scrolls horizontally on overflow —
 * overflow-x: auto + the keyboard-scroll group attrs (4), and the
 * no-photos case renders no strip with the main in place (5).
 */
import { test, expect } from 'playwright/test';
import type { Page, Response } from 'playwright/test';
import { createActivityPhotosFixtures } from './fixtures/activity-photos';
import type {
  ActivityPhotosFixtures,
  StripScenario,
} from './fixtures/activity-photos';

let fx: ActivityPhotosFixtures | null = null;

/** RU day abbreviations — CalendarLine's chip labels (browser tz = UTC). */
const RU_DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Role-name matcher for the numbered calendar chip of a UTC ISO date.
 * The chip renders the day name UPPERCASED by CSS with a line break
 * before the number (accessible name «ПТ 13») — match case-insensitively
 * on whitespace-flexible text. */
function dayChipName(isoDate: string): RegExp {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new RegExp(
    `^${RU_DAY_NAMES[date.getUTCDay()]}\\s+${date.getUTCDate()}$`,
    'i',
  );
}

/** Open a scenario's activity detail: select its calendar day, tap the
 * card, and return the service-scoped public/photos response promise —
 * the settle anchor every strip assertion builds on (ARMED before the
 * card tap: the query fires on ActivityDetail mount). */
async function openDetail(page: Page, scenario: StripScenario): Promise<Response> {
  await page.goto('/');
  const photosResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/photos') &&
      response.url().includes(`service_id=${scenario.serviceId}`),
  );
  await page.getByRole('button', { name: dayChipName(scenario.isoDate) }).click();
  const card = page.locator(`[data-card-id="${scenario.activityId}"]`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('[data-testid="overlay-panel"]')).toBeVisible();
  return photosResponse;
}

/** Pin the strip's thumb order = cover + service photos + activity photos
 * (API order, in-group newest first — the fixture controls timestamps). */
async function expectStripOrder(
  page: Page,
  scenario: StripScenario,
): Promise<void> {
  const strip = page.locator('[data-testid="activity-photo-strip"]');
  const thumbs = strip.locator('[data-testid="activity-photo-thumb"]');
  const expected = [
    scenario.cover,
    ...scenario.servicePhotos,
    ...scenario.activityPhotos,
  ];
  await expect(thumbs).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    await expect(thumbs.nth(i).locator('img')).toHaveAttribute(
      'src',
      expected[i],
    );
  }
}

test.describe.serial('#576 activity photo strip — US-1…US-4', () => {
  test.beforeAll(async () => {
    fx = await createActivityPhotosFixtures();
  });

  test.afterAll(async () => {
    await fx?.cleanup();
  });

  test('US-1: cover, then service photos, then activity photos; thumb clicks swap the main; the non-public photo never renders', async ({
    page,
  }) => {
    const scenario = fx!.us1;
    const response = await openDetail(page, scenario);
    // The UI queried the right service (Full-Cycle API verify).
    expect(((await response.json()) as { total: number }).total).toBe(4);

    const strip = page.locator('[data-testid="activity-photo-strip"]');
    await expect(strip).toBeVisible();
    // §6.5/§7-4 machine hints: the keyboard-scrollable group container.
    await expect(strip).toHaveAttribute('role', 'group');
    await expect(strip).toHaveAttribute('aria-label', 'Фотографии занятия');
    await expect(strip).toHaveAttribute('tabindex', '0');

    // §7-2: thumbs in API order — service photos strictly before the
    // activity photos (the discriminating two-group assertion).
    await expectStripOrder(page, scenario);

    const thumbs = strip.locator('[data-testid="activity-photo-thumb"]');
    const main = page.locator('[data-testid="activity-photo-main"]');

    // §7-1: the main defaults to the service cover; the cover thumb is
    // the current selection and carries the descriptive a11y label.
    await expect(main).toHaveAttribute('src', scenario.cover);
    await expect(thumbs.nth(0)).toHaveAttribute('aria-label', 'Обложка занятия');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
    // §6.5: thumbs lazy-load with explicit dimensions (anti-CLS).
    await expect(thumbs.nth(1).locator('img')).toHaveAttribute('loading', 'lazy');

    // US-1: the non-public service photo never renders in the detail.
    const overlay = page.locator('[data-testid="overlay-panel"]');
    await expect(
      overlay.locator(`img[src="${scenario.hiddenPhoto}"]`),
    ).toHaveCount(0);

    // §7-3: a service photo thumb swaps the main — and the file is
    // actually SERVED (naturalWidth poll, canon #513).
    await thumbs.nth(1).click();
    await expect(main).toHaveAttribute('src', scenario.servicePhotos[0]);
    await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(thumbs.nth(0)).not.toHaveAttribute('aria-current', 'true');
    await expect
      .poll(() =>
        main.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    // The far group works too: an activity photo thumb.
    await thumbs.nth(3).click();
    await expect(main).toHaveAttribute('src', scenario.activityPhotos[0]);

    // US-1: the cover thumb brings the cover back.
    await thumbs.nth(0).click();
    await expect(main).toHaveAttribute('src', scenario.cover);
    await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');

    // §7-4: the strip scrolls horizontally on overflow (overflow-x-auto).
    expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).toBe(
      'auto',
    );

    // ── The union pin (§6.5: «фото её занятий») ────────────────────────
    // The service's OTHER activity — own photos: none — shows the SAME
    // strip: one service-scoped query feeds every activity of the service.
    await page.getByRole('button', { name: 'Close overlay' }).click();
    await expect(page.locator('[data-testid="overlay-panel"]')).toHaveCount(0);
    await page
      .getByRole('button', { name: dayChipName(fx!.us1Companion.isoDate) })
      .click();
    const companionCard = page.locator(
      `[data-card-id="${fx!.us1Companion.activityId}"]`,
    );
    await expect(companionCard).toBeVisible();
    await companionCard.click();
    await expect(page.locator('[data-testid="overlay-panel"]')).toBeVisible();
    await expectStripOrder(page, scenario);
    await expect(main).toHaveAttribute('src', scenario.cover);
  });

  test('US-2: activity without own photos — strip = cover + service photos only', async ({
    page,
  }) => {
    const scenario = fx!.us2;
    const response = await openDetail(page, scenario);
    expect(((await response.json()) as { total: number }).total).toBe(2);

    await expect(page.locator('[data-testid="activity-photo-strip"]')).toBeVisible();
    await expectStripOrder(page, scenario);
    await expect(page.locator('[data-testid="activity-photo-main"]')).toHaveAttribute(
      'src',
      scenario.cover,
    );
  });

  test('US-3: service without direct photos — strip = cover + activity photos', async ({
    page,
  }) => {
    const scenario = fx!.us3;
    const response = await openDetail(page, scenario);
    expect(((await response.json()) as { total: number }).total).toBe(2);

    await expect(page.locator('[data-testid="activity-photo-strip"]')).toBeVisible();
    await expectStripOrder(page, scenario);
    await expect(page.locator('[data-testid="activity-photo-main"]')).toHaveAttribute(
      'src',
      scenario.cover,
    );
  });

  test('US-4: no photos on the service or its activities — no strip, the main keeps the cover', async ({
    page,
  }) => {
    const scenario = fx!.us4;
    const response = await openDetail(page, scenario);
    // Settle anchor (#478 discipline): the strip query RESOLVED empty —
    // only then is the strip's absence a real negative, not a race.
    expect(((await response.json()) as { total: number }).total).toBe(0);

    await expect(
      page.locator('[data-testid="activity-photo-strip"]'),
    ).toHaveCount(0);
    const main = page.locator('[data-testid="activity-photo-main"]');
    await expect(main).toBeVisible();
    await expect(main).toHaveAttribute('src', scenario.cover);
    await expect
      .poll(() =>
        main.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  });
});
