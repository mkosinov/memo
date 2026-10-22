import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { waitForScheduleGrid, installReferenceWeekClock } from './fixtures/helpers';
import { SEED_WEEK_MONDAY, addDaysIso } from './fixtures/seed-week';

/**
 * schedule-url-state.spec.ts — URL-as-source-of-truth user scenarios
 * (GH #138, spec §6 US-1…US-5).
 *
 * US-1  Deep-link /schedule?view=day&date=… → day view of that date.
 * US-2  Period stepping writes ONE history entry per interaction; browser
 *       back returns to the previous period.
 * US-3  MiniCalendar day click from /records → /schedule week view of that
 *       date's week; double-click → day view of the day.
 * US-4  /records date filters (от/до) are mirrored into ?from=&to= and the
 *       mini calendar tints the range red (edges read, middle tinted).
 * US-5  A shared /records?from=&to= link reproduces the same period and the
 *       same red highlight in a FRESH context (no shared state).
 *
 * Discriminating assertions: URL contents, history steps, calendar cell
 * classes — not just «page renders».
 *
 * GH #422: the mini-calendar displays the PAGE-CLOCK month and the records
 * default period is the page-clock week — both must be the seed's reference
 * June for the US-3…US-5 date math (SEED_WEEK_MONDAY derivatives) to be
 * visible without month paging. The beforeEach clock install
 * (install-before-goto) pins «today» to the reference Monday 10:00.
 */

/** MiniCalendar day-cell locator by its aria-label («13 мая») — ISO input. */
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

function miniDay(page: Page, dateIso: string) {
  const [, month, day] = dateIso.split('-').map(Number);
  return page.getByRole('button', {
    name: `${day} ${MONTHS_GENITIVE[month - 1]}`,
    exact: true,
  });
}

test.describe('Schedule URL state — US-1…US-5 (GH #138)', () => {
  test.beforeEach(async ({ page }) => {
    // GH #422: pin the page to the reference week BEFORE any navigation —
    // the mini-calendar month / records default week below are its clock's.
    await installReferenceWeekClock(page);
  });

  // ── US-1: deep-link straight into day view ─────────────────────────────
  test('US-1: deep-link /schedule?view=day&date=… opens day view of that date', async ({ page }) => {
    // 2026-06-16 is the Tuesday of the seed's fixed week (activities on it).
    const date = '2026-06-16';

    await page.goto(`/schedule?view=day&date=${date}`);

    // Day grid rendered (day columns exist even without cards); GH #361:
    // day-view columns carry unique `day-view-column-<id>` testids.
    await page.waitForSelector('[data-testid^="day-view-column-"]', { timeout: 15_000 });

    // The URL is preserved verbatim — the hook did not rewrite valid params.
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('date')).toBe(date);

    // The view selector trigger reflects the active mode.
    await expect(page.getByTestId('view-selector')).toContainText('День мастеров');

    // Activity cards render on the seeded June dates — day view of the date.
    await expect(page.locator('[data-testid^="activity-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // ── US-2: stepping = URL change + exactly one history entry per step ──
  test('US-2: next-period updates URL; browser-back returns; one interaction = one history entry', async ({ page }) => {
    // The seed's fixed week (2026-06-15 Monday) — cards render on it.
    const date = '2026-06-15';
    await page.goto(`/schedule?view=week&date=${date}`);
    await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

    const nextMonday = '2026-06-22';

    // ACT: one interaction — «Следующий период».
    await page.getByTestId('date-nav-next').click();

    // URL moved exactly one week forward (push).
    await expect(page).toHaveURL(new RegExp(`date=${nextMonday}`), { timeout: 10_000 });
    await page.waitForSelector('[data-testid="day-column-0"]', { timeout: 15_000 });

    // ONE interaction = ONE history entry: a single goBack lands on the
    // ORIGINAL URL (a double push would need two backs / land elsewhere).
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`date=${date}`), { timeout: 10_000 });

    // And the grid really re-rendered the original week (cards visible).
    await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });
  });

  // ── US-3: calendar navigates /records → /schedule (week; dblclick → day) ──
  test('US-3: mini-calendar day click from /records opens schedule week; double-click opens day', async ({ page }) => {
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

    // Pick a day inside the DISPLAYED month (the calendar shows the
    // page-clock month — June of the reference week under the frozen
    // clock): the reference Wednesday. Its week may differ from the
    // records default week — that is the point: the click navigates to
    // THAT day's week.
    const target = addDaysIso(SEED_WEEK_MONDAY, 2);

    // Single click → /schedule week view of the target's week. The URL
    // carries the clicked DAY (?date=<day>); the week is derived from it.
    await miniDay(page, target).click();
    await page.waitForURL(/\/schedule\?view=week&date=/, { timeout: 15_000 });

    expect(new URL(page.url()).searchParams.get('view')).toBe('week');
    expect(new URL(page.url()).searchParams.get('date')).toBe(target);
    await waitForScheduleGrid(page);

    // Back to /records for the double-click leg.
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

    // Double click → day view of the day itself.
    await miniDay(page, target).dblclick();
    await page.waitForURL(/\/schedule\?view=day&date=/, { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('date')).toBe(target);
  });

  // ── US-4: records date filters → URL + red range on the mini calendar ──
  test('US-4: records «от/до» writes ?from=&to= and tints the mini-calendar range red', async ({ page }) => {
    // The records default period is the CURRENT week (Mon..Sun, the
    // defaultRecordsPeriod of useRecordsUrlState) — under the frozen clock
    // that is the reference week itself. A range EQUAL to it would collide:
    // the «от» fill then equals the default — the query key does not change
    // (no request → waitForResponse timeout) and the default-equal `from`
    // is stripped by the hook's canonical serialization. Pick the
    // NEIGHBORING (next) week instead — never the default one, and always
    // inside the displayed June (the reference Monday is the 1st, so the
    // next week's Friday is the 12th — in-month by construction).
    const monday = SEED_WEEK_MONDAY;
    const from = addDaysIso(monday, 7); // the chosen week's Monday…
    const to = addDaysIso(from, 4); // …through its Friday
    // A day strictly OUTSIDE the range, still in the displayed month.
    const out = addDaysIso(monday, 6);

    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

    // Fill the date filters — the values are mirrored into the URL
    // (?from=&to=, push — a period change is a history step) and drive the
    // same API request as before.
    const viewFrom = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${from}`),
      { timeout: 15_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате от"]').fill(from);
    await viewFrom;

    const viewTo = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_to=${to}`),
      { timeout: 15_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате до"]').fill(to);
    await viewTo;

    // URL carries the pair. #349 (RecordsProvider optimistic mirror): the
    // list fetch fires from the mirror BEFORE the router.push commits, so
    // the awaited response does NOT imply the address has moved yet — poll
    // for the navigation (the a8545599 read-after-response precedent).
    await expect
      .poll(() => new URL(page.url()).searchParams.get('from'), { timeout: 10_000 })
      .toBe(from);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('to'), { timeout: 10_000 })
      .toBe(to);

    // Mini calendar: edges carry the full red pill, the middle the light tint.
    const startCell = miniDay(page, from).locator('span');
    const endCell = miniDay(page, to).locator('span');
    const midCell = miniDay(page, addDaysIso(from, 2)).locator('span');
    await expect(startCell).toHaveClass(/bg-red-400\/45/);
    await expect(endCell).toHaveClass(/bg-red-400\/45/);
    await expect(midCell).toHaveClass(/bg-red-400\/25/);

    // Outside the range: no red tint.
    const outCell = miniDay(page, out).locator('span');
    await expect(outCell).not.toHaveClass(/bg-red-400/);
  });

  // ── US-5: share-link /records with period — same range, same highlight ──
  test('US-5: a fresh context opening the shared /records?from=&to= link sees the same period and highlight', async ({ page, browser }) => {
    // The 5th..9th of the displayed (reference-clock) June — GH #422
    // derivatives of SEED_WEEK_MONDAY.
    const from = addDaysIso(SEED_WEEK_MONDAY, 4);
    const to = addDaysIso(SEED_WEEK_MONDAY, 8);
    const sharedUrl = `/records?from=${from}&to=${to}`;

    // «Sharer»: open the link, let the page load. The records/view wait is
    // registered BEFORE goto so the load-time fetch cannot slip past it.
    const sharerView = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${from}`),
      { timeout: 15_000 },
    );
    await page.goto(sharedUrl);
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });
    await sharerView;

    // «Recipient»: a COMPLETELY fresh context (own storage — nothing shared).
    // GH #422: same reference-week clock as the sharer (install-before-goto)
    // — the mini-calendar must display June for the shared range's cells.
    const recipientCtx = await browser.newContext();
    const recipient = await recipientCtx.newPage();
    await installReferenceWeekClock(recipient);
    try {
      // Auth: the recipient needs the same seeded session to pass the
      // authenticated layout — copy the storage state from the sharer.
      await recipientCtx.addCookies(await page.context().cookies());

      // The load-time records/view fetch is armed BEFORE goto (same pattern
      // as the sharer leg) — registered afterwards, it would deterministically
      // miss the response on a warm stack.
      const recipientView = recipient.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${from}`),
        { timeout: 15_000 },
      );
      await recipient.goto(sharedUrl);
      await recipient.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

      // The URL round-trips untouched.
      expect(new URL(recipient.url()).searchParams.get('from')).toBe(from);
      expect(new URL(recipient.url()).searchParams.get('to')).toBe(to);

      // The same API request fired with the shared period.
      await recipientView;

      // The same red range on the mini calendar.
      await expect(miniDay(recipient, from).locator('span')).toHaveClass(/bg-red-400\/45/);
      await expect(miniDay(recipient, to).locator('span')).toHaveClass(/bg-red-400\/45/);
    } finally {
      await recipientCtx.close();
    }
  });
});
