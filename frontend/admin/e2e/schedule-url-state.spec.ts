import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { waitForScheduleGrid } from './fixtures/helpers';

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
 */

/** Local YYYY-MM-DD for a Date (mirrors lib/datetime.toISODate). */
function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** MiniCalendar day-cell locator by its aria-label («13 мая»). */
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

function miniDay(page: Page, d: Date) {
  return page.getByRole('button', {
    name: `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`,
    exact: true,
  });
}

test.describe('Schedule URL state — US-1…US-5 (GH #138)', () => {

  // ── US-1: deep-link straight into day view ─────────────────────────────
  test('US-1: deep-link /schedule?view=day&date=… opens day view of that date', async ({ page }) => {
    // 2026-06-16 is the Tuesday of the seed's fixed week (activities on it).
    const date = '2026-06-16';

    await page.goto(`/schedule?view=day&date=${date}`);

    // Day grid rendered (day columns exist even without cards).
    await page.waitForSelector('[data-testid="day-column-0"]', { timeout: 15_000 });

    // The URL is preserved verbatim — the hook did not rewrite valid params.
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('date')).toBe(date);

    // The day button reflects the active mode.
    await expect(page.getByTestId('day-button')).toContainText(/День/);

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

    // Pick a day inside the DISPLAYED month (the calendar shows the current
    // month by default — no month paging needed): the 10th of the current
    // month. Its week may differ from the records default week — that is the
    // point: the click navigates to THAT day's week.
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), 15);

    // Single click → /schedule week view of the target's week. The URL
    // carries the clicked DAY (?date=<day>); the week is derived from it.
    await miniDay(page, target).click();
    await page.waitForURL(/\/schedule\?view=week&date=/, { timeout: 15_000 });

    expect(new URL(page.url()).searchParams.get('view')).toBe('week');
    expect(new URL(page.url()).searchParams.get('date')).toBe(toISO(target));
    await waitForScheduleGrid(page);

    // Back to /records for the double-click leg.
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

    // Double click → day view of the day itself.
    await miniDay(page, target).dblclick();
    await page.waitForURL(/\/schedule\?view=day&date=/, { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('date')).toBe(toISO(target));
  });

  // ── US-4: records date filters → URL + red range on the mini calendar ──
  test('US-4: records «от/до» writes ?from=&to= and tints the mini-calendar range red', async ({ page }) => {
    // Range inside the CURRENT month so both cells are visible without paging.
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 5);
    const to = new Date(now.getFullYear(), now.getMonth(), 9);

    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

    // Fill the date filters — the values are mirrored into the URL
    // (?from=&to=, replace) and drive the same API request as before.
    const viewFrom = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${toISO(from)}`),
      { timeout: 15_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате от"]').fill(toISO(from));
    await viewFrom;

    const viewTo = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_to=${toISO(to)}`),
      { timeout: 15_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате до"]').fill(toISO(to));
    await viewTo;

    // URL carries the pair.
    expect(new URL(page.url()).searchParams.get('from')).toBe(toISO(from));
    expect(new URL(page.url()).searchParams.get('to')).toBe(toISO(to));

    // Mini calendar: edges carry the full red pill, the middle the light tint.
    const startCell = miniDay(page, from).locator('span');
    const endCell = miniDay(page, to).locator('span');
    const midCell = miniDay(page, new Date(now.getFullYear(), now.getMonth(), 7)).locator('span');
    await expect(startCell).toHaveClass(/bg-red-400\/45/);
    await expect(endCell).toHaveClass(/bg-red-400\/45/);
    await expect(midCell).toHaveClass(/bg-red-400\/25/);

    // Outside the range: no red tint.
    const outCell = miniDay(page, new Date(now.getFullYear(), now.getMonth(), 12)).locator('span');
    await expect(outCell).not.toHaveClass(/bg-red-400/);
  });

  // ── US-5: share-link /records with period — same range, same highlight ──
  test('US-5: a fresh context opening the shared /records?from=&to= link sees the same period and highlight', async ({ page, browser }) => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 5);
    const to = new Date(now.getFullYear(), now.getMonth(), 9);
    const sharedUrl = `/records?from=${toISO(from)}&to=${toISO(to)}`;

    // «Sharer»: open the link, let the page load. The records/view wait is
    // registered BEFORE goto so the load-time fetch cannot slip past it.
    const sharerView = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${toISO(from)}`),
      { timeout: 15_000 },
    );
    await page.goto(sharedUrl);
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });
    await sharerView;

    // «Recipient»: a COMPLETELY fresh context (own storage — nothing shared).
    const recipientCtx = await browser.newContext();
    const recipient = await recipientCtx.newPage();
    try {
      // Auth: the recipient needs the same seeded session to pass the
      // authenticated layout — copy the storage state from the sharer.
      await recipientCtx.addCookies(await page.context().cookies());

      // The load-time records/view fetch is armed BEFORE goto (same pattern
      // as the sharer leg) — registered afterwards, it would deterministically
      // miss the response on a warm stack.
      const recipientView = recipient.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view') && r.url().includes(`date_from=${toISO(from)}`),
        { timeout: 15_000 },
      );
      await recipient.goto(sharedUrl);
      await recipient.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });

      // The URL round-trips untouched.
      expect(new URL(recipient.url()).searchParams.get('from')).toBe(toISO(from));
      expect(new URL(recipient.url()).searchParams.get('to')).toBe(toISO(to));

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
