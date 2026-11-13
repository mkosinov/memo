/**
 * activity-visibility.spec.ts — #600 Task 6: private activities are
 * invisible to clients (User Scenarios US-1/US-2).
 *
 *   US-1 «Сетка без приватного» (anonymous): the CURRENT-week seed pair
 *        (fixtures/visibility-pair.ts) — the regular card renders in the
 *        schedule grid, the private one does not: no card by id, no
 *        heading with the private service title.
 *
 *   US-2 «Бронь приватного id» (client session, the project's storageState
 *        default): a direct POST /api/v1/my/client/records (#584 §4.2 —
 *        the booking branch moved under /my/client) with the PRIVATE
 *        activity_id answers 404 BYTE-IDENTICAL to a missing id (no
 *        422-vs-404 side channel), and no record lands: the cabinet
 *        records page shows no card for the private service, no
 *        booking-success state, and the DB holds no record row.
 *
 * RED-GREEN vehicle: US-1's positive control goes red when the public
 * route hook is reverted (staff route → anonymous 401 → empty grid);
 * US-2's 404 assert goes red when the probe predicate is reverted (the
 * private row is found → 201). The RED maneuvers run once per branch
 * (checkout of the pre-#600 file), never in CI.
 */
import { test, expect } from 'playwright/test';
import {
  seedVisibilityPair,
  cleanupVisibilityPair,
  PUBLIC_TITLE,
  PRIVATE_TITLE,
} from './fixtures/visibility-pair';
import { queryDBRow } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';
import { resolveWebPort } from './lib/stack-port';

const BACKEND = resolveBackendUrl();

test.describe('#600 US-1 — анонимная сетка без приватного', () => {
  // Anonymous: opt out of the project-level storageState (the globalSetup
  // c1 session) — the booking spec's opt-out pattern.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('карточка обычного занятия есть, приватного заголовка нет', async ({ page }) => {
    const pair = seedVisibilityPair();
    try {
      await page.goto('/');
      // 30s budget: cold '/' compilation on a fresh stack, and (the RED
      // maneuver) the reverted hook's 401 retry cascade keeps the
      // calendar disabled ~15s — the click must outlive both to reach
      // the asserts.
      await page.getByRole('button', { name: pair.tab }).click({ timeout: 30_000 });

      // Positive control: the REGULAR pair card renders (heading = the
      // service title). This is the assert the reverted-hook RED breaks.
      const card = page.locator(`[data-card-id="${pair.publicActivityId}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('h3')).toHaveText(PUBLIC_TITLE);

      // The private row never reaches the grid: no card by id...
      await expect(page.locator(`[data-card-id="${pair.privateActivityId}"]`)).toHaveCount(0);
      // ...and no heading carrying the private service title.
      await expect(page.locator('h3').filter({ hasText: PRIVATE_TITLE })).toHaveCount(0);
    } finally {
      cleanupVisibilityPair(pair);
    }
  });
});

test.describe('#600 US-2 — бронь приватного activity_id', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).

  test('прямой POST даёт 404 (байт-паритет с несуществующим id), записи нет', async ({ page }) => {
    const pair = seedVisibilityPair();
    try {
      // The direct POST goes to the SAME origin the page uses, carrying
      // the client session cookie (page.request shares the context) and
      // the web Origin — exactly the browser wire.
      const post = (activityId: string) =>
        page.request.post(`${BACKEND}/api/v1/my/client/records`, {
          data: {
            activity_id: activityId,
            phone: '+79001234567',
            visits: [{ name: 'Анна Иванова' }],
          },
          headers: { Origin: `http://127.0.0.1:${resolveWebPort()}` },
        });

      // Private id → 404 ACTIVITY_NOT_FOUND. This is the assert the
      // reverted-predicate RED breaks (the probe finds the row → 201).
      const priv = await post(pair.privateActivityId);
      const privBody = await priv.text();
      expect(priv.status(), `private id POST body: ${privBody.slice(0, 120)}`).toBe(404);

      // Byte parity: a missing id answers the SAME 404 body — a private
      // id is indistinguishable from a nonexistent one.
      const missing = await post('00000000-0000-4000-8000-000000000000');
      const missingBody = await missing.text();
      expect(missing.status()).toBe(404);
      expect(privBody).toBe(missingBody);
      const body = JSON.parse(missingBody) as { detail: { code: string } };
      expect(body.detail.code).toBe('ACTIVITY_NOT_FOUND');

      // Page: no «запись создана»-style success, no record card for the
      // private service in the client's «Мои записи» (settle on the
      // session shell first — the negatives must not race the render).
      await page.goto('/cabinet/records');
      await expect(page.locator('[data-testid="cabinet-phone"]')).toBeVisible();
      await expect(page.locator('[data-testid="booking-success"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="my-record-service"]').filter({ hasText: PRIVATE_TITLE }),
      ).toHaveCount(0);

      // VERIFY DB: no record row was created for the private activity.
      const row = queryDBRow(
        `SELECT id FROM records WHERE activity_id = '${pair.privateActivityId}'`,
      );
      expect(row, 'no record for the private activity id').toBeNull();
    } finally {
      cleanupVisibilityPair(pair);
    }
  });
});
