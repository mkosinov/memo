/**
 * locations-web-visibility.spec.ts — #601 Task 5: a hidden (is_public =
 * false) location is invisible to site visitors (User Scenarios
 * US-2/US-3/US-4-phase), on the #600 activity-visibility donor pattern.
 *
 *   US-2 «Сайт без скрытой площадки» (anonymous): the CURRENT-week seed
 *        pair (fixtures/location-visibility-pair.ts) — the visible
 *        CONTROL location is in the filter and its activity renders in
 *        the schedule (positive control, #600 canon), the hidden
 *        location is in neither and its activity never reaches the
 *        grid. This is the RED-GREEN vehicle for the web migration to
 *        the public dictionary: with the staff-route hook an anonymous
 *        visit gets 401 → empty filter → the control assert fails.
 *
 *   US-3 «Бронь занятия скрытой площадки» (client session, the project's
 *        storageState default): a direct POST /api/v1/my/records with
 *        the hidden-location activity_id answers 404 BYTE-IDENTICAL to
 *        a missing id, and no record lands (cabinet + DB).
 *
 *   US-4 «Возврат площадки» (фаза админ-цикла Task 4): after «Видно
 *        клиентам» is switched back ON the location and its activity
 *        return to the filter and the schedule. The flag flip the admin
 *        UI performs (admin-e2e locations-web-hidden.spec.ts US-4 owns
 *        that path) is applied here at the data layer — the web stack
 *        has no staff session by design; the spec verifies the WEB
 *        consequence of the admin cycle.
 */
import { test, expect, type Page } from 'playwright/test';
import {
  seedLocationVisibilityPair,
  cleanupLocationVisibilityPair,
  HIDDEN_LOCATION_TITLE,
  VISIBLE_LOCATION_TITLE,
  HIDDEN_SERVICE_TITLE,
  VISIBLE_SERVICE_TITLE,
} from './fixtures/location-visibility-pair';
import { queryDB, queryDBRow } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';
import { resolveWebPort } from './lib/stack-port';

const BACKEND = resolveBackendUrl();

/** Open the workspace location filter (the trigger pill shows
 * «Все локации» while nothing is selected; Hero's own overlay stays
 * closed, so the pill is the only such button before the click). */
async function openLocationFilter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Все локации' }).click();
}

test.describe('#601 US-2 — сайт не видит скрытую площадку', () => {
  // Anonymous: opt out of the project-level storageState (the globalSetup
  // c1 session) — the booking spec's opt-out pattern.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('фильтр и расписание без скрытой площадки; контрольная видна', async ({ page }) => {
    const pair = seedLocationVisibilityPair();
    try {
      await page.goto('/');
      // 30s budget: cold '/' compilation on a fresh stack must not eat
      // into the click (the #600 donor's timeout).
      await page.getByRole('button', { name: pair.tab }).click({ timeout: 30_000 });

      // Schedule — positive control FIRST: the CONTROL location's card
      // renders (heading = the service title). This is the assert the
      // staff-route-hook RED breaks (anonymous 401 → empty grid).
      const controlCard = page.locator(`[data-card-id="${pair.visibleActivityId}"]`);
      await expect(controlCard).toBeVisible();
      await expect(controlCard.locator('h3')).toHaveText(VISIBLE_SERVICE_TITLE);

      // The hidden-location activity never reaches the grid: no card by
      // id and no heading carrying its service title.
      await expect(page.locator(`[data-card-id="${pair.hiddenActivityId}"]`)).toHaveCount(0);
      await expect(page.locator('h3').filter({ hasText: HIDDEN_SERVICE_TITLE })).toHaveCount(0);

      // Filter — same canon: the CONTROL location is an option…
      await openLocationFilter(page);
      await expect(page.getByRole('button', { name: VISIBLE_LOCATION_TITLE })).toBeVisible();
      // …the hidden location is not (by title, anywhere in the overlay).
      await expect(page.getByRole('button', { name: HIDDEN_LOCATION_TITLE })).toHaveCount(0);
    } finally {
      cleanupLocationVisibilityPair(pair);
    }
  });
});

test.describe('#601 US-3 — бронь занятия скрытой площадки по прямому id', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).

  test('прямой POST даёт 404 (байт-паритет с несуществующим id), записи нет', async ({ page }) => {
    const pair = seedLocationVisibilityPair();
    try {
      // The direct POST goes to the SAME origin the page uses, carrying
      // the client session cookie (page.request shares the context) and
      // the web Origin — exactly the browser wire (#600 donor).
      const post = (activityId: string) =>
        page.request.post(`${BACKEND}/api/v1/my/records`, {
          data: {
            activity_id: activityId,
            phone: '+79001234567',
            visits: [{ name: 'Анна Иванова' }],
          },
          headers: { Origin: `http://127.0.0.1:${resolveWebPort()}` },
        });

      // Hidden-location activity id → 404 ACTIVITY_NOT_FOUND.
      const hidden = await post(pair.hiddenActivityId);
      const hiddenBody = await hidden.text();
      expect(hidden.status(), `hidden-location id POST body: ${hiddenBody.slice(0, 120)}`).toBe(404);

      // Byte parity: a missing id answers the SAME 404 body — a
      // hidden-location activity is indistinguishable from a
      // nonexistent one.
      const missing = await post('00000000-0000-4000-8000-000000000000');
      const missingBody = await missing.text();
      expect(missing.status()).toBe(404);
      expect(hiddenBody).toBe(missingBody);
      const body = JSON.parse(missingBody) as { detail: { code: string } };
      expect(body.detail.code).toBe('ACTIVITY_NOT_FOUND');

      // Page: no «запись создана»-style success, no record card for the
      // hidden-location service in the client's «Мои записи».
      await page.goto('/cabinet/records');
      await expect(page.locator('[data-testid="cabinet-phone"]')).toBeVisible();
      await expect(page.locator('[data-testid="booking-success"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="my-record-service"]').filter({ hasText: HIDDEN_SERVICE_TITLE }),
      ).toHaveCount(0);

      // VERIFY DB: no record row was created for the hidden-location activity.
      const row = queryDBRow(
        `SELECT id FROM records WHERE activity_id = '${pair.hiddenActivityId}'`,
      );
      expect(row, 'no record for the hidden-location activity id').toBeNull();
    } finally {
      cleanupLocationVisibilityPair(pair);
    }
  });
});

test.describe('#601 US-4 — возврат площадки после включения «Видно клиентам»', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('локация и её занятия снова в фильтре и расписании', async ({ page }) => {
    const pair = seedLocationVisibilityPair();
    try {
      // Guard: the fixture really seeded the pair hidden (SQLite boolean 0)
      // — the return phase must not pass vacuously.
      expect(
        queryDBRow(`SELECT is_public FROM locations WHERE id='${pair.hiddenLocationId}'`)!.is_public,
      ).toBe(0);

      // ACT (фаза админ-цикла Task 4): «Видно клиентам» back ON — the
      // flag flip the admin edit modal performs; applied at the data
      // layer (the web stack has no staff session by design).
      queryDB(
        `UPDATE locations SET is_public = 1, updated_at = datetime('now') ` +
          `WHERE id = '${pair.hiddenLocationId}'`,
      );

      await page.goto('/');
      await page.getByRole('button', { name: pair.tab }).click({ timeout: 30_000 });

      // Schedule: the formerly hidden activity is back; the control
      // stayed visible throughout (positive control).
      await expect(page.locator(`[data-card-id="${pair.hiddenActivityId}"]`)).toBeVisible();
      await expect(page.locator(`[data-card-id="${pair.visibleActivityId}"]`)).toBeVisible();

      // Filter: the formerly hidden location is an option again.
      await openLocationFilter(page);
      await expect(page.getByRole('button', { name: HIDDEN_LOCATION_TITLE })).toBeVisible();
      await expect(page.getByRole('button', { name: VISIBLE_LOCATION_TITLE })).toBeVisible();
    } finally {
      cleanupLocationVisibilityPair(pair);
    }
  });
});
