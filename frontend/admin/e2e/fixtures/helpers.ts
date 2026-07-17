/**
 * helpers.ts — UI interaction helpers for Playwright E2E tests.
 *
 * These helpers encapsulate complex UI interactions (opening modals,
 * waiting for data, navigating tabs) so test files stay readable.
 */

import { type Page, expect } from '@playwright/test';
import path from 'path';
import { queryDBRow } from './db-query';
import { sqliteExecWithRetry } from './sqlite-exec';

/**
 * Resolve the DB path: per-shard (test_memo_shard{id}.db) or fallback.
 * SHARD_ID is set by test-all.sh; falls back to TEST_DB_PATH or default.
 */
function resolveDBPath(): string {
  const shardId = process.env.SHARD_ID;
  if (shardId) {
    return path.resolve(__dirname, `../../../../backend/test_memo_shard${shardId}.db`);
  }
  return process.env.TEST_DB_PATH
    || path.resolve(__dirname, '../../../../backend/test_memo.db');
}

const DB_PATH = resolveDBPath();

/**
 * Clean non-seed test data from the test DB so visual regression snapshots
 * aren't affected by records/activities created by earlier tests in the
 * same shard. Mirrors the cleanup in e2e/globalSetup.ts — seed IDs are
 * short (clients: c1..c5, records: r1..r6, visits: v1..v10, activities:
 * ev_0..ev_44, ev_fixed_0..ev_fixed_9) so we exclude known seed prefixes
 * rather than relying on length. UUID test data is never prefixed with these.
 */
export function cleanTestData() {
  try {
    sqliteExecWithRetry(`sqlite3 "${DB_PATH}" "
      DELETE FROM payments WHERE length(id) > 3;
      DELETE FROM visits WHERE length(id) > 3;
      DELETE FROM records WHERE length(id) > 3;
      DELETE FROM activities WHERE id NOT LIKE 'ev\\_%' ESCAPE '\\' AND id NOT LIKE 'ev_fixed_%';
      DELETE FROM clients WHERE length(id) > 3;
    "`);
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || '');
    if (msg.includes('no such table') || msg.includes('no such file') || msg.includes('unable to open database')) {
      return; // DB not ready yet — ok
    }
    // Real errors (including a lock that survived retries) should propagate —
    // silent no-op here would leave stale UUID data poisoning later tests.
    throw err;
  }
}

/**
 * Resolve a record's activity.start as ISO date (YYYY-MM-DD).
 * - Pass `recordId` to target a specific record (e.g., seed "r1")
 * - Omit to pick any active record (deterministic: smallest id)
 *
 * Returns null if no record found.
 *
 * This is the source of truth for "when is this record's activity" —
 * avoids fragile UI-based walk-back logic.
 */
function resolveRecordDate(recordId?: string): string | null {
  const safeId = recordId ? recordId.replace(/'/g, "''") : null;
  const sql = safeId
    ? `SELECT substr(a.start, 1, 10) AS d
       FROM records r
       JOIN activities a ON r.activity_id = a.id
       WHERE r.id = '${safeId}' AND r.is_active = 1 AND a.is_active = 1`
    : `SELECT substr(a.start, 1, 10) AS d
       FROM records r
       JOIN activities a ON r.activity_id = a.id
       WHERE r.is_active = 1 AND a.is_active = 1
       ORDER BY r.id ASC
       LIMIT 1`;
  const row = queryDBRow(sql);
  return row?.d ?? null;
}

/**
 * Navigate the schedule page to the week containing the given date.
 * Uses the existing __memo-switch-to-week-view event in ScheduleContext.
 *
 * @param page Playwright page
 * @param date ISO date (YYYY-MM-DD)
 */
async function navigateToWeek(page: Page, date: string): Promise<void> {
  await page.evaluate((d: string) => {
    document.dispatchEvent(
      new CustomEvent('__memo-switch-to-week-view', {
        detail: { date: `${d}T12:00:00` },
      }),
    );
  }, date);
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 10_000 });
  await page.waitForTimeout(300); // small buffer for activity cards to render
}

/**
 * Wait for schedule page to load with activity cards.
 * Navigates to /schedule and waits for at least one activity card to appear.
 */
export async function waitForScheduleReady(page: Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 60_000 });
}

/**
 * Wait for services page to load with table.
 * Navigates to /services, waits for API response, then waits for heading and table.
 */
export async function waitForServicesReady(page: Page) {
  // Set up response listener BEFORE navigation
  const servicesResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/services') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/services');
  await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  // Wait for API response to arrive
  await servicesResponse.catch(() => {});
  // Give React a moment to re-render with data
  await page.waitForTimeout(500);
}

/**
 * Wait for locations page to load with table.
 * Navigates to /locations, waits for API response, then waits for heading and table.
 */
export async function waitForLocationsReady(page: Page) {
  // Set up response listener BEFORE navigation
  const locationsResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/locations') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/locations');
  await page.waitForSelector('h1:has-text("Управление локациями")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  // Wait for API response to arrive
  await locationsResponse.catch(() => {});
  // Give React a moment to re-render with data
  await page.waitForTimeout(500);
}

/**
 * Get the activity data from the first visible activity card.
 * Uses React fiber tree traversal to extract the activity prop.
 */
export async function getFirstActivity(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid^="activity-"]');
    if (!card) return null;
    const fiberKey = Object.keys(card).find((k: string) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let current = (card as any)[fiberKey];
    while (current) {
      if (current.memoizedProps?.activity) return current.memoizedProps.activity;
      current = current.return;
    }
    return null;
  });
}

/**
 * Open the activity details modal for an activity that has records (client tabs).
 * Dispatches a custom event that the modal listens to.
 *
 * Uses DB lookup to find the target record's week, then navigates directly
 * to that week via __memo-switch-to-week-view — no fragile walk-back logic.
 *
 * @param opts.recordId — target a specific record (e.g., seed "r1").
 *   If omitted, picks any active record (deterministic: smallest id).
 */
export async function openModal(
  page: Page,
  opts?: { recordId?: string },
): Promise<unknown | null> {
  // Step 1: ask DB which week has the target record
  const targetDate = resolveRecordDate(opts?.recordId);
  if (!targetDate) {
    console.warn(`[openModal] No record found${opts?.recordId ? ` for id ${opts.recordId}` : ''}`);
    return null;
  }

  // Step 2: navigate to that week
  await navigateToWeek(page, targetDate);

  // Step 3: try activities on the now-visible week until one has a record
  const MAX_ACTIVITIES_PER_WEEK = 5;
  const cardCount = await page.locator('[data-testid^="activity-"]').count();
  const toTry = Math.min(cardCount, MAX_ACTIVITIES_PER_WEEK);

  for (let i = 0; i < toTry; i++) {
    const card = page.locator('[data-testid^="activity-"]').nth(i);
    if (!(await card.isVisible())) continue;

    // Read activity from React fiber (same pattern as before)
    const activity = await card.evaluate((el: any) => {
      const k = Object.keys(el).find((x: string) => x.startsWith('__reactFiber'));
      if (!k) return null;
      let c = (el as any)[k];
      while (c) {
        if (c.memoizedProps?.activity) return c.memoizedProps.activity;
        c = c.return;
      }
      return null;
    });
    if (!activity) continue;

    await page.evaluate((act: any) => {
      document.dispatchEvent(new CustomEvent('__memo-open-modal', {
        detail: { activity: act },
      }));
    }, activity);

    await page.waitForSelector('[data-testid="activity-details-modal"]', {
      state: 'visible',
      timeout: 10_000,
    });

    const hasClientTabs =
      (await page.locator('[data-testid^="tab-client-"]').count()) > 0;
    if (hasClientTabs) return activity;

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('__memo-close-modal'));
    });
    await page.waitForTimeout(300);
  }
  return null;
}

/**
 * Open the modal directly on the "new booking" (+) tab.
 * Useful for testing record creation flows.
 *
 * Navigates to the target week first (via DB lookup) so activities are visible.
 *
 * @param opts.date — ISO date (YYYY-MM-DD) to target. If omitted, picks
 *   any active record's week so we land on a week with activities.
 */
export async function openAddTab(
  page: Page,
  opts?: { date?: string },
): Promise<void> {
  const targetDate = opts?.date ?? resolveRecordDate();
  if (!targetDate) {
    throw new Error('openAddTab: no active records found to navigate to');
  }

  await navigateToWeek(page, targetDate);

  const activity = await getFirstActivity(page);
  if (!activity) {
    throw new Error(`openAddTab: no activity found on week of ${targetDate}`);
  }

  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-quick-add', { detail: { activity: act } }));
  }, activity);

  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();
}

/**
 * Wait for a toast notification to appear.
 */
export async function waitForToast(page: Page, textPattern?: string | RegExp) {
  const toast = page.locator('[role="status"]');
  await toast.first().waitFor({ state: 'visible', timeout: 5000 });
  if (textPattern) {
    await expect(toast.first()).toContainText(textPattern);
  }
}

/**
 * Click a specific tab in the modal by test ID.
 */
export async function clickModalTab(page: Page, tabTestId: string) {
  await page.locator(`[data-testid="${tabTestId}"]`).click();
}

/**
 * Wait for records page to load with table.
 * Navigates to /records, waits for the heading and table to render,
 * then waits for the records AND activities API responses to arrive —
 * both are needed for the table to render rows (records are filtered
 * by activity_id lookup). Also waits for a short time for React to
 * re-render with the fetched data.
 */
export async function waitForRecordsReady(page: Page) {
  // Set up response listeners BEFORE navigation so we don't miss API calls.
  const recordsResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/records') && resp.status() === 200,
    { timeout: 60_000 },
  );
  const activitiesResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/activities') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/records');
  await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  // Wait for both records and activities to arrive.
  await Promise.all([recordsResponse, activitiesResponse]);
  // Give React a moment to re-render the table with data.
  // The table needs to show either data rows or the empty state AFTER data load.
  await page
    .waitForFunction(
      () => {
        const rows = document.querySelectorAll('tbody tr');
        if (rows.length === 0) return true;
        // Either we have real data rows or the genuine empty state
        const firstCell = rows[0]?.querySelector('td');
        return firstCell !== null; // empty state is a td with "Записи не найдены"
      },
      { timeout: 5_000 },
    )
    .catch(() => {});
}

/**
 * Wait for clients page to load with table or empty state.
 * Navigates to /clients and waits for the heading and content.
 *
 * @param options.waitForName — if provided, waits for a specific client name
 *   to appear in the table rows. Useful after creating a client via API
 *   where React Query may serve stale cached data.
 */
export async function waitForClientsReady(
  page: Page,
  options?: { waitForName?: string },
) {
  // Set up response listener BEFORE navigation so we catch the fresh API call
  const clientsResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/clients');
  await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 60_000 });
  await page.waitForSelector('table tbody, p:has-text("Нет клиентов")', { timeout: 60_000 });
  await clientsResponse.catch(() => {});
  await page.waitForTimeout(500); // React re-render buffer

  // Hard reload to force React Query to refetch with fresh data.
  // This bypasses any stale cache that might be serving the first
  // page load's data. The reload is async; we wait for the second
  // /api/v1/clients response before checking for the row.
  if (options?.waitForName) {
    const clientsResponse2 = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
      { timeout: 60_000 },
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('table tbody, p:has-text("Нет клиентов")', { timeout: 60_000 });
    await clientsResponse2.catch(() => {});
    await page.waitForTimeout(500); // React re-render buffer
  }

  // If caller needs to wait for a specific client name to appear in the table
  if (options?.waitForName) {
    await page
      .locator('table tbody tr')
      .filter({ hasText: options.waitForName })
      .waitFor({ state: 'visible', timeout: 30_000 });
  }
}

/**
 * Wait for masters page to load with table.
 * Navigates to /masters, waits for heading and table to render.
 */
export async function waitForMastersReady(page: Page) {
  const mastersResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/masters') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/masters');
  await page.waitForSelector('h1:has-text("Управление мастерами")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  await mastersResponse.catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Wait for tags page to load with table.
 * Navigates to /tags, waits for heading and table to render.
 */
export async function waitForTagsReady(page: Page) {
  const tagsResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/tags') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/tags');
  await page.waitForSelector('h1:has-text("Управление тегами")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  await tagsResponse.catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Wait for photos page to load with table.
 * Navigates to /photos, waits for heading and table to render.
 */
export async function waitForPhotosReady(page: Page) {
  const photosResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/photos') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/photos');
  await page.waitForSelector('h1:has-text("Управление фото")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  await photosResponse.catch(() => {});
  await page.waitForTimeout(500);
}
