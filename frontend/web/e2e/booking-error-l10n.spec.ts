/**
 * booking-error-l10n.spec.ts — #538 Task 3: the booking-refusal block
 * renders Russian by server CODE (US-1 409 pin, US-2 404 dictionary).
 *
 *   US-1 «Мест нет» (regression pin of #551): the SEED «Индивидуальный
 *        МК» activity — capacity=1 pinned to the SEED row (relocated
 *        into the reachable slot by the seed-individual-activity
 *        fixture) — gives its only seat to the first submit (201 through
 *        the real wire), and the REOPENED form's second submit answers
 *        409 ACTIVITY_AT_CAPACITY → the booking-error block carries the
 *        server's Russian «Недостаточно мест» and no English ("seats
 *        occupied"/"Activity").
 *
 *   US-2 «Занятие исчезло» (#538's only behavioral change): between the
 *        form opening and the submit the test hard-deletes the activity
 *        row straight from the test DB (sqlite-exec — the admin DELETE's
 *        physical end-state) → 404 ACTIVITY_NOT_FOUND → the block shows
 *        the CODE_MESSAGES dictionary text «Занятие не найдено», not the
 *        English server message "Activity not found" (Task 1 pinned the
 *        leak RED on main; Task 2's dictionary fixed it — this is the
 *        E2E pin of the fix).
 *
 * Both tests run on the project-default storageState (globalSetup's OTP
 * login of the seed client c1): the booking form submits through POST
 * /api/v1/my/client/records IMMEDIATELY — no auth step (#584 §4.2 moved
 * the booking branch under /my/client; the waitForResponse filter uses
 * that exact wire).
 *
 * Born green by plan (Tasks 1-2 are already on the branch): the RED
 * maneuver is the negative control — swapping the expected texts for
 * the pre-fix English ("seats occupied" / "Activity not found") makes
 * both tests fail against the real rendered Russian.
 */
import { test, expect } from 'playwright/test';
import type { Page, Response } from 'playwright/test';
import {
  findSeedIndividualActivity,
  relocateSeedActivity,
  restoreSeedActivity,
  deleteActivityRow,
  cleanupActivityBookings,
} from './fixtures/seed-individual-activity';
import { queryDBRow } from './fixtures/db-query';

/** The booking wire — POST /api/v1/my/client/records (the exact route
 * #584 §4.2 mounted; the response-status/code contract rides on it). */
function isBookingPost(r: Response): boolean {
  return r.url().includes('/api/v1/my/client/records') && r.request().method() === 'POST';
}

/** Drive the UI up to the filled booking form: home → the slot's
 * calendar tab → the activity card → «Участвовать» → one seat + the
 * contact name (the phone is the read-only session phone — c1). */
async function openBookingForm(
  page: Page,
  activityId: string,
  tab: 'Завтра' | 'Сегодня',
  name: string,
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: tab }).click();
  const card = page.locator(`[data-card-id="${activityId}"]`);
  await expect(card).toBeVisible();
  await card.click();

  // The card tap opens the activity detail; its footer button books the slot.
  const detail = page.locator('[data-testid="overlay-panel"]');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Участвовать' }).click();

  // Booking form: one seat + the contact name (booking-closed-activity's
  // authenticated-fill pattern).
  const panel = page.locator('[data-testid="overlay-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('#contact-name').fill(name);
  await panel.getByLabel('Increase').first().click();
}

test.describe('#538 — блок ошибки брони говорит по-русски (словарь по кодам)', () => {
  test('US-1: capacity=1 из сида — повторная отправка формы даёт 409 и «Недостаточно мест», без английского', async ({
    page,
  }) => {
    const seed = findSeedIndividualActivity();
    const slot = relocateSeedActivity(seed.id);
    try {
      // ACT 1 — the first submit takes the ONLY seat (201 via the real wire).
      await openBookingForm(page, seed.id, slot.tab, 'Тест Мест');
      const firstPost = page.waitForResponse(isBookingPost);
      await page
        .locator('[data-testid="overlay-panel"]')
        .getByRole('button', { name: 'Записаться' })
        .click();
      const firstResp = await firstPost;
      expect(firstResp.status()).toBe(201);

      // The seat is taken: the success screen + the DB row.
      await expect(page.locator('[data-testid="booking-success"]')).toBeVisible();
      const record = queryDBRow(
        `SELECT id, seats FROM records WHERE activity_id = '${seed.id}'`,
      );
      expect(record, 'the first booking landed on the seed activity').not.toBeNull();
      expect(Number(record!.seats)).toBe(1);

      // ACT 2 — the REOPENED form submits again: the only seat is gone.
      await openBookingForm(page, seed.id, slot.tab, 'Тест Мест');
      const secondPost = page.waitForResponse(isBookingPost);
      await page
        .locator('[data-testid="overlay-panel"]')
        .getByRole('button', { name: 'Записаться' })
        .click();
      const refusal = await secondPost;
      expect(refusal.status()).toBe(409);
      // The stable, language-independent contract: the guard's code.
      const body = (await refusal.json()) as { detail?: { code?: string } };
      expect(body.detail?.code).toBe('ACTIVITY_AT_CAPACITY');

      // ASSERT UI — the refusal block: the server's Russian, no English.
      const errorBlock = page.locator('[data-testid="booking-error"]');
      await expect(errorBlock).toBeVisible();
      await expect(errorBlock).toContainText('Недостаточно мест');
      await expect(errorBlock).not.toContainText('seats occupied');
      await expect(errorBlock).not.toContainText('Activity');
    } finally {
      cleanupActivityBookings(seed.id);
      restoreSeedActivity(seed.id, seed.originalStart);
    }
  });

  test('US-2: занятие удалено из БД между формой и отправкой — 404 и «Занятие не найдено», не "Activity not found"', async ({
    page,
  }) => {
    const seed = findSeedIndividualActivity();
    const slot = relocateSeedActivity(seed.id);
    try {
      // The form opens on the live activity; the contact is filled.
      await openBookingForm(page, seed.id, slot.tab, 'Тест Исчез');

      // Mid-form the activity vanishes: a direct test-DB write (the
      // task's sqlite-exec seam) — the admin DELETE's physical end-state.
      deleteActivityRow(seed.id);

      // The submit now hits a missing id → 404 ACTIVITY_NOT_FOUND.
      const submitPost = page.waitForResponse(isBookingPost);
      await page
        .locator('[data-testid="overlay-panel"]')
        .getByRole('button', { name: 'Записаться' })
        .click();
      const refusal = await submitPost;
      expect(refusal.status()).toBe(404);
      const body = (await refusal.json()) as { detail?: { code?: string } };
      expect(body.detail?.code).toBe('ACTIVITY_NOT_FOUND');

      // ASSERT UI — the #538 dictionary text, not the English server message.
      const errorBlock = page.locator('[data-testid="booking-error"]');
      await expect(errorBlock).toBeVisible();
      await expect(errorBlock).toContainText('Занятие не найдено');
      await expect(errorBlock).not.toContainText('Activity not found');

      // VERIFY DB — nothing was written for the vanished activity.
      const row = queryDBRow(`SELECT id FROM records WHERE activity_id = '${seed.id}'`);
      expect(row, 'no record may exist for the deleted activity').toBeNull();
    } finally {
      cleanupActivityBookings(seed.id);
      // The row is either deleted (US-2's own maneuver) or still relocated
      // (a failure before the delete): the restore UPDATE is a no-op in
      // the first case and undoes the relocation in the second.
      restoreSeedActivity(seed.id, seed.originalStart);
    }
  });
});
