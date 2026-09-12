/**
 * helpers.ts — UI interaction helpers for Playwright E2E tests.
 *
 * These helpers encapsulate complex UI interactions (opening modals,
 * waiting for data, navigating tabs) so test files stay readable.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { queryDBRow } from './db-query';

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
function resolveRecordDate(recordId?: string): { date: string; activityId: string } | null {
  const safeId = recordId ? recordId.replace(/'/g, "''") : null;
  const sql = safeId
    ? `SELECT substr(a.start, 1, 10) AS d, a.id AS activityId
       FROM records r
       JOIN activities a ON r.activity_id = a.id
       WHERE r.id = '${safeId}'`
    : `SELECT substr(a.start, 1, 10) AS d, a.id AS activityId
       FROM records r
       JOIN activities a ON r.activity_id = a.id
       ORDER BY r.id ASC
       LIMIT 1`;
  const row = queryDBRow(sql);
  return row ? { date: row.d, activityId: row.activityId } : null;
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
  // 10s is UI-render-sync only — data validation (#152) lives in
  // globalSetup.ts (asserts /api/v1/activities non-empty before any
  // worker starts). If cards don't appear in 10s, the bug is real, not
  // a warmup race; fast failure is preferable to 60s of silence.
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 10_000 });
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
 * Wait for the activity-details modal's records fetch — the modal loads
 * ['records','activity',id] via GET /api/v1/records?activity_id=… on mount,
 * and its booking tabs render only after that resolves (#191).
 *
 * Register BEFORE dispatching the open event. Tolerant (.catch) in case
 * React Query dedupes the request (e.g. same activity re-opened while a
 * fetch is already in flight) — helper must never introduce flakiness.
 */
function waitForModalRecords(page: Page): Promise<void> {
  return page
    .waitForResponse(
      (r) => r.url().includes('/api/v1/records') && r.url().includes('activity_id='),
      { timeout: 10_000 },
    )
    .then(() => {})
    .catch(() => {});
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
  // Step 1: ask DB which week and activity contain the target record
  const resolved = resolveRecordDate(opts?.recordId);
  if (!resolved) {
    console.warn(`[openModal] No record found${opts?.recordId ? ` for id ${opts.recordId}` : ''}`);
    return null;
  }

  // Step 2: navigate to that week
  await navigateToWeek(page, resolved.date);

  let card: ReturnType<typeof page.locator> | null = null;
  let activity: unknown = null;

  if (opts?.recordId) {
    // Targeted mode: pick the card whose testid matches the resolved activity id.
    const targeted = page.locator(`[data-testid="activity-${resolved.activityId}"]`);
    const count = await targeted.count();
    if (count > 0) {
      card = targeted.first();
      activity = await card.evaluate((el: any) => {
        const k = Object.keys(el).find((x: string) => x.startsWith('__reactFiber'));
        if (!k) return null;
        let c = (el as any)[k];
        while (c) {
          if (c.memoizedProps?.activity) return c.memoizedProps.activity;
          c = c.return;
        }
        return null;
      });
    }
  }

  if (!activity) {
    // Fallback / no recordId: scan visible cards for the first one with client tabs.
    const MAX_ACTIVITIES_PER_WEEK = 5;
    const cardCount = await page.locator('[data-testid^="activity-"]').count();
    const toTry = Math.min(cardCount, MAX_ACTIVITIES_PER_WEEK);

    for (let i = 0; i < toTry; i++) {
      const candidate = page.locator('[data-testid^="activity-"]').nth(i);
      if (!(await candidate.isVisible())) continue;

      const candidateActivity = await candidate.evaluate((el: any) => {
        const k = Object.keys(el).find((x: string) => x.startsWith('__reactFiber'));
        if (!k) return null;
        let c = (el as any)[k];
        while (c) {
          if (c.memoizedProps?.activity) return c.memoizedProps.activity;
          c = c.return;
        }
        return null;
      });
      if (!candidateActivity) continue;

      const recordsWait = waitForModalRecords(page);
      await page.evaluate((act: any) => {
        document.dispatchEvent(new CustomEvent('__memo-open-modal', {
          detail: { activity: act },
        }));
      }, candidateActivity);
      await recordsWait;

      await page.waitForSelector('[data-testid="activity-details-modal"]', {
        state: 'visible',
        timeout: 10_000,
      });

      const hasClientTabs =
        (await page.locator('[data-testid^="tab-client-"]').count()) > 0;
      if (hasClientTabs) return candidateActivity;

      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('__memo-close-modal'));
      });
      await page.waitForTimeout(300);
    }
    return null;
  }

  // Targeted mode: dispatch the activity from the matched card and verify modal.
  const recordsWait = waitForModalRecords(page);
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-open-modal', {
      detail: { activity: act },
    }));
  }, activity);
  await recordsWait;

  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10_000,
  });

  return activity;
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
  const targetDate = opts?.date ?? resolveRecordDate()?.date;
  if (!targetDate) {
    throw new Error('openAddTab: no active records found to navigate to');
  }

  await navigateToWeek(page, targetDate);

  const activity = await getFirstActivity(page);
  if (!activity) {
    throw new Error(`openAddTab: no activity found on week of ${targetDate}`);
  }

  const recordsWait = waitForModalRecords(page);
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-quick-add', { detail: { activity: act } }));
  }, activity);
  await recordsWait;

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
 * then waits for the records view API response to arrive. GH #213: the
 * records page issues ONE composite request GET /api/v1/records/view
 * (records + denormalized display fields in one shot); the separate
 * /api/v1/activities lookup maps no longer exist. The three dict
 * selection queries (/locations/all, /services/all, /masters/all) are
 * owned by BookingFilters and are not needed for table rows to render.
 */
export async function waitForRecordsReady(page: Page) {
  // Set up the response listener BEFORE navigation so we don't miss the call.
  const viewResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/records/view') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/records');
  await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  // Wait for the composite view response to arrive.
  await viewResponse;
  // Give React a moment to re-render the table with data.
  // The table needs to show either data rows or the empty state AFTER data load.
  await page
    .waitForFunction(
      () => {
        const rows = document.querySelectorAll('tbody tr');
        if (rows.length === 0) return true;
        // Either we have real data rows or the genuine empty state
        const firstCell = rows[0]?.querySelector('td');
        return firstCell !== null; // empty state is a td with «Нет записей» (Addendum 12)
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
  // #139 T6 + Addendum #12 — empty state = "Нет записей" (shared DataTable
  // default) for ALL 8 tables; Clients' pre-#139 dual empty variants were
  // dropped. Wait for either the table body or the unified empty label.
  await page.waitForFunction(
    () =>
      document.querySelector('table tbody') !== null ||
      document.body.innerText.includes('Нет записей'),
    { timeout: 60_000 },
  );
  await clientsResponse.catch(() => {});
  await page.waitForTimeout(500); // React re-render buffer

  // Hard reload to force React Query to refetch with fresh data.
  // This bypasses any stale cache that might be serving the first
  // page load's data. The reload is async; we wait for the second
  // /api/v1/clients response before checking for the row.
  // NOTE: default 'load' wait — 'networkidle' never resolves while the
  // SSE /api/v1/events stream stays open (#239).
  if (options?.waitForName) {
    const clientsResponse2 = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
      { timeout: 60_000 },
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('table tbody') !== null ||
        document.body.innerText.includes('Нет записей'),
      { timeout: 60_000 },
    );
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
 * Wait for the staff directory screen to load with table (GH #266 — the
 * pre-#266 /masters management screen is now /staff «Сотрудники»).
 *
 * Readiness anchors on the `/api/v1/staff` list response + the rendered table
 * + the stable heading. Rows keep the `master-row-*` testid (DoD: preserved
 * across the move; staff.id == master.id for sectioned cards, seed m1–m5,m7).
 */
export async function waitForStaffReady(page: Page) {
  const staffResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/staff') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/staff');
  await page.waitForSelector('h1:has-text("Управление сотрудниками")', { timeout: 60_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  await staffResponse.catch(() => {});
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
 * Wait for the materials view to load with table.
 * Navigates to /services, switches to the "Материалы" tab view (the h1
 * heading flips to "Управление материалами" — assert THAT so a stale tab
 * switch can't pass), then waits for the table.
 */
export async function waitForMaterialsReady(page: Page) {
  const materialsResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/materials') && resp.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/services');
  await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Материалы' }).click();
  await page.waitForSelector('h1:has-text("Управление материалами")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 60_000 });
  await materialsResponse.catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Open the row action dropdown (⋯ button) for a given row.
 * Row locators: [data-testid="master-row-{id}"], [data-testid="location-row-{id}"]
 * (Masters/locations carry row test IDs; clients/materials rows are looked
 * up by name text).
 */
export async function openRowActionDropdown(row: Locator) {
  await row.getByRole('button', { name: 'Действия' }).click();
  const dropdown = row.locator('[data-testid^="dropdown-"]');
  if (await dropdown.count() > 0) {
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    return dropdown;
  }
  // Services/materials: no dropdown testid — the menu items live on the row.
  await expect(
    row.getByRole('button', { name: /В архив|Восстановить/ }),
  ).toBeVisible({ timeout: 5_000 });
  return row;
}

function menuItem(dropdownOrRow: Locator, name: string | RegExp): Locator {
  return dropdownOrRow.getByRole('menuitem', { name });
}

/** Click the "Удалить" item in an open row action dropdown (or row scope). */
export async function clickRowDelete(dropdownOrRow: Locator): Promise<void> {
  await menuItem(dropdownOrRow, 'Удалить').click();
}

/** Click the "В архив" or "Восстановить" item in an open row dropdown (or row scope). */
export async function clickRowArchiveAction(
  dropdownOrRow: Locator,
  action: 'В архив' | 'Восстановить',
): Promise<void> {
  await menuItem(dropdownOrRow, action).click();
}

/**
 * Click the staff-card archive/restore item (GH #266 terminology D2/D11:
 * «Архивировать» / «Вернуть из архива» — distinct from the other entities'
 * «В архив»/«Восстановить»). NOTE: «Архивировать» opens the D6 dismissal
 * dialog (checkboxes), it does NOT fire the mutation directly.
 */
export async function clickRowStaffArchiveAction(
  dropdownOrRow: Locator,
  action: 'Архивировать' | 'Вернуть из архива',
): Promise<void> {
  await menuItem(dropdownOrRow, action).click();
}

/**
 * Confirm the DeleteDialog (Mode A): check the "Подтверждаю удаление зависимостей"
 * checkbox (rendered only when choice deps exist) and click "Удалить".
 * All-auto trees have no checkbox — the button is enabled immediately.
 */
export async function confirmDeleteDialog(page: Page) {
  await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible({ timeout: 10_000 });
  const checkbox = page.locator('[data-testid="delete-dialog-confirm-checkbox"]');
  if (await checkbox.count()) {
    await checkbox.check();
  }
  await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeEnabled();
  await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
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

/**
 * Type into the PhotosFilters «Клиент» typeahead and pick the dropdown row
 * by text. The typed value drives the server search (case-insensitive
 * substring match on client name).
 */
export async function selectClientFilterOption(
  page: Page,
  queryText: string,
  optionText: string,
): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Клиент' });
  await input.fill(queryText);
  await page.getByRole('option', { name: optionText }).click();
}

/**
 * Mask display for a 10-digit RU national number, pinned to the actual
 * AsYouType output (libphonenumber-js/min, RU default — GH #221):
 *   international fill `+79991234567` → `+7 999 123 45 67` (spaces)
 *   bare national typing `9991234567`  → `999 123-45-67` (dashes)
 * Shared by the WYSIWYG e2e expectations so the exact expected string is
 * defined once (the PhoneInput unit tests pin the same grouping).
 */
export function phoneMaskDisplay(digits: string, mode: 'international' | 'national'): string {
  const grouped = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  if (mode === 'international') return `+7 ${grouped}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
}
