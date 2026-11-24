/**
 * booking-closed-activity.spec.ts — GH #551 (web half of US-1): a client
 * cannot book a CLOSED activity (capacity 0 = «запись закрыта»).
 *
 * The spec's US-1: «клиент на web не может записаться (409 «мест нет»)».
 * The web schedule deliberately shows NO «closed» badge (spec rev. 4 —
 * closedness is expressed by the existing booking behavior), so the
 * client walks the whole booking path and the refusal comes from the
 * booking guard at record creation: 409 ACTIVITY_AT_CAPACITY → the
 * overlay's booking-error block carries «Недостаточно мест».
 *
 * The project default storageState is the authenticated seed client c1
 * (globalSetup #513 OTP login) — with a session the «Записаться» click
 * fires POST /api/v1/my/records IMMEDIATELY (no auth step), which is
 * exactly the refusal surface under test.
 *
 * Factory: fixtures/admin-activity.ts with capacity 0 — the activity
 * lands on TOMORROW («Завтра» calendar tab), cleaned up in finally.
 */
import { test, expect } from 'playwright/test';
import { createTomorrowActivity, deleteTestActivity } from './fixtures/admin-activity';
import { queryDBRow } from './fixtures/db-query';

test.describe('#551 US-1 web — запись на закрытое занятие отклоняется', () => {
  test('клиент не может записаться на занятие с вместимостью 0 — 409 ACTIVITY_AT_CAPACITY, отказ на экране', async ({
    page,
  }) => {
    // SETUP: a CLOSED activity tomorrow (capacity 0 — legal seed-state per
    // GH #551, the public schedule lists it like any other).
    const activity = await createTomorrowActivity({ capacity: 0 });
    try {
      // ACT: open the booking form through the «Завтра» tab.
      await page.goto('/');
      await page.getByRole('button', { name: 'Завтра' }).click();
      const card = page.locator(`[data-card-id="${activity.id}"]`);
      await expect(card).toBeVisible();
      await card.click();

      // The card tap opens the activity detail; its footer button books.
      const detail = page.locator('[data-testid="overlay-panel"]');
      await expect(detail).toBeVisible();
      await detail.getByRole('button', { name: 'Участвовать' }).click();

      // Booking form: one seat + a contact name (the phone is the
      // read-only session phone — c1 from the storageState).
      const panel = page.locator('[data-testid="overlay-panel"]');
      await expect(panel).toBeVisible();
      await panel.locator('#contact-name').fill('Тест Закрыта');
      await panel.getByLabel('Increase').first().click();

      // AUTHENTICATED submit → the record POST flies right away; the
      // capacity guard must refuse it (occupied + 1 > 0).
      const refused = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/my/client/records') && r.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Записаться' }).click();
      const resp = await refused;
      expect(resp.status()).toBe(409);
      // The stable, language-independent contract: the guard's code.
      const refusal = (await resp.json()) as { detail?: { code?: string } };
      expect(refusal.detail?.code).toBe('ACTIVITY_AT_CAPACITY');

      // ASSERT UI: the refusal block shows the registry canon — the guard
      // now raises ERROR_MESSAGES[ACTIVITY_AT_CAPACITY] («мест нет»), and
      // the web renders the structured server message verbatim.
      const errorBlock = page.locator('[data-testid="booking-error"]');
      await expect(errorBlock).toBeVisible();
      await expect(errorBlock).toContainText('Недостаточно мест');
      await expect(
        errorBlock.getByRole('button', { name: 'Отправить еще раз' }),
      ).toBeVisible();

      // VERIFY DB: no record landed on the closed activity.
      const row = queryDBRow(
        `SELECT id FROM records WHERE activity_id='${activity.id}'`,
      );
      expect(row, 'no record may exist for a capacity-0 activity').toBeNull();
    } finally {
      await deleteTestActivity(activity.id);
    }
  });
});
