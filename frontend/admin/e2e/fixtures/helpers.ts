/**
 * helpers.ts — UI interaction helpers for Playwright E2E tests.
 *
 * These helpers encapsulate complex UI interactions (opening modals,
 * waiting for data, navigating tabs) so test files stay readable.
 */

import { type Page, expect } from '@playwright/test';

/**
 * Wait for schedule page to load with activity cards.
 * Navigates to /schedule and waits for at least one activity card to appear.
 */
export async function waitForScheduleReady(page: Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });
}

/**
 * Wait for services page to load with table.
 * Navigates to /services, waits for API response, then waits for heading and table.
 */
export async function waitForServicesReady(page: Page) {
  // Set up response listener BEFORE navigation
  const servicesResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/services') && resp.status() === 200,
    { timeout: 15_000 },
  );
  await page.goto('/services');
  await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
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
    { timeout: 15_000 },
  );
  await page.goto('/locations');
  await page.waitForSelector('h1:has-text("Управление локациями")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
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
 * Tries the first few visible activities on the current page before navigating
 * to previous weeks. Seed data may place records on non-first activities,
 * so checking only the first card can miss them.
 *
 * Falls back to navigating up to 3 previous weeks.
 */
export async function openModal(page: Page) {
  const MAX_WEEKS_BACK = 3;
  const MAX_ACTIVITIES_PER_WEEK = 5;

  for (let week = 0; week <= MAX_WEEKS_BACK; week++) {
    const cardCount = await page.locator('[data-testid^="activity-"]').count();
    const toTry = Math.min(cardCount, MAX_ACTIVITIES_PER_WEEK);

    for (let i = 0; i < toTry; i++) {
      const card = page.locator('[data-testid^="activity-"]').nth(i);
      if (!(await card.isVisible())) continue;

      const activity = await card.evaluate((el: any) => {
        const fiberKey = Object.keys(el).find((k: string) => k.startsWith('__reactFiber'));
        if (!fiberKey) return null;
        let current = (el as any)[fiberKey];
        while (current) {
          if (current.memoizedProps?.activity) return current.memoizedProps.activity;
          current = current.return;
        }
        return null;
      });

      if (!activity) continue;

      await page.evaluate((act: any) => {
        document.dispatchEvent(new CustomEvent('__memo-open-modal', { detail: { activity: act } }));
      }, activity);

      await page.waitForSelector('[data-testid="activity-details-modal"]', {
        state: 'visible',
        timeout: 10_000,
      });

      const hasClientTabs =
        (await page.locator('[data-testid^="tab-client-"]').count()) > 0;
      if (hasClientTabs) return;

      // No client tabs — close modal and try next activity on this page
      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('__memo-close-modal'));
      });
      await page.waitForTimeout(300);
    }

    // No activity on this page has records — navigate to previous week
    const prevBtn = page.locator('[data-testid="date-nav-prev"]');
    if (await prevBtn.isVisible()) {
      await prevBtn.click();
      await page.waitForSelector('[data-testid^="activity-"]', {
        timeout: 10_000,
      });
      await page.waitForTimeout(500);
    }
  }
  // If we get here, no activity with records was found — proceed anyway
}

/**
 * Open the modal directly on the "new booking" (+) tab.
 * Useful for testing record creation flows.
 */
export async function openAddTab(page: Page) {
  const activity = await getFirstActivity(page);
  if (!activity) throw new Error('No activity found on page');

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
    { timeout: 15_000 },
  );
  const activitiesResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/activities') && resp.status() === 200,
    { timeout: 15_000 },
  );
  await page.goto('/records');
  await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
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
 */
export async function waitForClientsReady(page: Page) {
  await page.goto('/clients');
  await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });
  // Wait for either table rows or the "no clients" empty state
  await page.waitForSelector('table tbody, p:has-text("Нет клиентов")', { timeout: 15_000 });
}

/**
 * Wait for masters page to load with table.
 * Navigates to /masters, waits for heading and table to render.
 */
export async function waitForMastersReady(page: Page) {
  const mastersResponse = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/masters') && resp.status() === 200,
    { timeout: 15_000 },
  );
  await page.goto('/masters');
  await page.waitForSelector('h1:has-text("Управление мастерами")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
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
    { timeout: 15_000 },
  );
  await page.goto('/tags');
  await page.waitForSelector('h1:has-text("Управление тегами")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
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
    { timeout: 15_000 },
  );
  await page.goto('/photos');
  await page.waitForSelector('h1:has-text("Управление фото")', { timeout: 15_000 });
  await page.waitForSelector('table', { timeout: 15_000 });
  await photosResponse.catch(() => {});
  await page.waitForTimeout(500);
}
