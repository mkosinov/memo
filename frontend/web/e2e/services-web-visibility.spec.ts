/**
 * services-web-visibility.spec.ts — #606 Task 8: a hidden (is_public =
 * false) service is invisible to site visitors (spec §4 scenarios 8–9
 * + scenario 1's anonymous regression), on the #601
 * locations-web-visibility donor pattern.
 *
 *   US-8 «Сайт без скрытой услуги» (anonymous): the CURRENT-week seed
 *        pair (fixtures/service-visibility-pair.ts) — the visible
 *        CONTROL service's activity renders in the schedule (positive
 *        control, #600 canon), the hidden service's activity never
 *        reaches the grid. NOTE on the donor's «filter» half: the web
 *        has NO service filter (ActivityTagFilter is a static list,
 *        LocationFilter is #601's surface) — for services the schedule
 *        GRID (card by id + the service-title heading) is the whole UI
 *        surface, exactly the #600 activity-visibility shape.
 *
 *   US-9 «Бронь занятия скрытой услуги» (client session, the project's
 *        storageState default): a direct POST /api/v1/my/client/records
 *        with the hidden-service activity_id answers 404 BYTE-IDENTICAL
 *        to a missing id, and no record lands (cabinet + DB). The
 *        CONTROL activity is booked first (201) — a liveness anchor the
 *        #601 donor lacks: its US-3 still probes the pre-#584
 *        /my/records address, whose route-miss 404 is rendered with the
 *        same ACTIVITY_NOT_FOUND body by the generic 404 handler
 *        (main.py), so the donor's parity assert passes vacuously. The
 *        201 anchor pins the route + session; the hidden 404 is then
 *        provably the booking PREDICATE's answer.
 *
 *   US-8 «Возврат услуги» (фаза админ-цикла, admin-e2e Task 8.1): after
 *        «Видно клиентам» is switched back ON the service's activity
 *        returns to the schedule. The flag flip the admin UI performs
 *        (admin-e2e services-web-hidden.spec.ts owns that path) is
 *        applied here at the data layer — the web stack has no staff
 *        session by design; the spec verifies the WEB consequence of
 *        the admin cycle.
 *
 * RED vehicles (the checkout maneuvers run once per branch, never in CI
 * — the #600 donor's convention; written green against the landed
 * Tasks 2–4, the 8.1-sanctioned mirror mode):
 *   - US-8 grid asserts go red when the Service join-terms leave
 *     list_public_activities_view / the forced is_public filter leaves
 *     the public dictionary (revert of the Task 2/4 predicates): the
 *     hidden service's activity reaches the grid, or its title leaks
 *     into a heading.
 *   - US-9's 404 assert goes red when the service terms leave the
 *     booking predicate (revert of a321686a): the probe finds the row
 *     → 201.
 */
import { test, expect } from 'playwright/test';
import {
  seedServiceVisibilityPair,
  cleanupServiceVisibilityPair,
  HIDDEN_SERVICE_TITLE,
  VISIBLE_SERVICE_TITLE,
} from './fixtures/service-visibility-pair';
import { queryDB, queryDBRow } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';
import { resolveWebPort } from './lib/stack-port';

const BACKEND = resolveBackendUrl();

test.describe('#606 US-8 — сайт не видит скрытую услугу', () => {
  // Anonymous: opt out of the project-level storageState (the globalSetup
  // c1 session) — the booking spec's opt-out pattern.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('сетка без занятия скрытой услуги; контрольная видна', async ({ page }) => {
    const pair = seedServiceVisibilityPair();
    try {
      await page.goto('/');
      // 30s budget: cold '/' compilation on a fresh stack must not eat
      // into the click (the #600 donor's timeout).
      await page.getByRole('button', { name: pair.tab }).click({ timeout: 30_000 });

      // Schedule — positive control FIRST: the CONTROL service's card
      // renders (heading = the service title). This is the assert a
      // reverted public-dictionary/vitrine predicate breaks (the
      // hidden service leaks → the grid shows it too).
      const controlCard = page.locator(`[data-card-id="${pair.visibleActivityId}"]`);
      await expect(controlCard).toBeVisible();
      await expect(controlCard.locator('h3')).toHaveText(VISIBLE_SERVICE_TITLE);

      // The hidden-service activity never reaches the grid: no card by
      // id and no heading carrying its service title.
      await expect(page.locator(`[data-card-id="${pair.hiddenActivityId}"]`)).toHaveCount(0);
      await expect(page.locator('h3').filter({ hasText: HIDDEN_SERVICE_TITLE })).toHaveCount(0);
    } finally {
      cleanupServiceVisibilityPair(pair);
    }
  });
});

test.describe('#606 US-9 — бронь занятия скрытой услуги по прямому id', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).

  test('прямой POST даёт 404 (байт-паритет с несуществующим id), записи нет', async ({ page }) => {
    const pair = seedServiceVisibilityPair();
    try {
      // The direct POST goes to the SAME origin the page uses, carrying
      // the client session cookie (page.request shares the context) and
      // the web Origin — exactly the browser wire (#600 donor). The
      // route is the post-#584 booking branch.
      const post = (activityId: string) =>
        page.request.post(`${BACKEND}/api/v1/my/client/records`, {
          data: {
            activity_id: activityId,
            phone: '+79001234567',
            visits: [{ name: 'Анна Иванова' }],
          },
          headers: { Origin: `http://127.0.0.1:${resolveWebPort()}` },
        });

      // Liveness anchor (the #584 lesson): the CONTROL activity IS
      // bookable — 201 proves the route is live and the session valid,
      // so the hidden 404 below is the PREDICATE's answer, not a
      // route-miss wearing the same generic 404 body.
      const control = await post(pair.visibleActivityId);
      const controlBody = await control.text();
      expect(
        control.status(),
        `control (visible) activity must be bookable; body: ${controlBody.slice(0, 120)}`,
      ).toBe(201);

      // Hidden-service activity id → 404 ACTIVITY_NOT_FOUND. This is
      // the assert a reverted booking predicate breaks (201).
      const hidden = await post(pair.hiddenActivityId);
      const hiddenBody = await hidden.text();
      expect(hidden.status(), `hidden-service id POST body: ${hiddenBody.slice(0, 120)}`).toBe(404);

      // Byte parity: a missing id answers the SAME 404 body — a
      // hidden-service activity is indistinguishable from a
      // nonexistent one.
      const missing = await post('00000000-0000-4000-8000-000000000000');
      const missingBody = await missing.text();
      expect(missing.status()).toBe(404);
      expect(hiddenBody).toBe(missingBody);
      const body = JSON.parse(missingBody) as { detail: { code: string } };
      expect(body.detail.code).toBe('ACTIVITY_NOT_FOUND');

      // Page: no «запись создана»-style success, no record card for the
      // hidden service in the client's «Мои записи» (the control record
      // from the liveness anchor is irrelevant — the filter selects the
      // hidden title only).
      await page.goto('/cabinet/records');
      await expect(page.locator('[data-testid="cabinet-phone"]')).toBeVisible();
      await expect(page.locator('[data-testid="booking-success"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="my-record-service"]').filter({ hasText: HIDDEN_SERVICE_TITLE }),
      ).toHaveCount(0);

      // VERIFY DB: no record row was created for the hidden-service
      // activity (the control's record is purged by the fixture
      // cleanup's visits → records pass).
      const row = queryDBRow(
        `SELECT id FROM records WHERE activity_id = '${pair.hiddenActivityId}'`,
      );
      expect(row, 'no record for the hidden-service activity id').toBeNull();
    } finally {
      cleanupServiceVisibilityPair(pair);
    }
  });
});

test.describe('#606 US-8 (возврат) — занятие возвращается после включения «Видно клиентам»', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('после возврата флага занятие снова в сетке', async ({ page }) => {
    const pair = seedServiceVisibilityPair();
    try {
      // Guard: the fixture really seeded the pair hidden (SQLite
      // boolean 0) — the return phase must not pass vacuously.
      expect(
        queryDBRow(`SELECT is_public FROM services WHERE id='${pair.hiddenServiceId}'`)!.is_public,
      ).toBe(0);

      // ACT (фаза админ-цикла Task 8.1): «Видно клиентам» back ON — the
      // flag flip the admin edit modal performs; applied at the data
      // layer (the web stack has no staff session by design).
      queryDB(
        `UPDATE services SET is_public = 1, updated_at = datetime('now') ` +
          `WHERE id = '${pair.hiddenServiceId}'`,
      );

      await page.goto('/');
      await page.getByRole('button', { name: pair.tab }).click({ timeout: 30_000 });

      // Schedule: the formerly hidden activity is back; the control
      // stayed visible throughout (positive control).
      await expect(page.locator(`[data-card-id="${pair.hiddenActivityId}"]`)).toBeVisible();
      await expect(page.locator(`[data-card-id="${pair.visibleActivityId}"]`)).toBeVisible();
      await expect(
        page.locator(`[data-card-id="${pair.hiddenActivityId}"] h3`),
      ).toHaveText(HIDDEN_SERVICE_TITLE);
    } finally {
      cleanupServiceVisibilityPair(pair);
    }
  });
});
