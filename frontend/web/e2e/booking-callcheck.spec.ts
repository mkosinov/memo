/**
 * booking-callcheck.spec.ts — #593 Task 6: the booking-form callcheck flow.
 *
 * Dev transport (CALLCHECK_TRANSPORT=dev): initiate hands out the fixed
 * dev number; the client's call is imitated through POST /auth/call/dev-done.
 *
 * - US-1 «Запись после входа звонком»: anonymous booking form → method
 *   picker → «Подтвердить звонком» → dev-done → poll `confirmed` → the
 *   record is sent through the AUTHORIZED path → «Вы записаны!» — and the
 *   record/client land in the test DB under the confirmed phone.
 * - US-3 «Пикер показывает только живые методы»: the picker mirrors
 *   GET /auth/methods — the call button always (dev transport on), the
 *   SMS button exactly when the registry reports it available.
 * - US-4 «Связаться»: the panel on the auth screen carries the prefilled
 *   booking-request text, «Скопировать текст», and the administrator's
 *   messenger links (contacts filled in the e2e env).
 *
 * The seed schedule lives in the past while the home page lists
 * today+30 days — each test plants a factory activity for TOMORROW
 * (fixtures/admin-activity.ts, the admin donor's createTestActivity
 * pattern) and books it through the «Завтра» tab.
 */
import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import {
  DEV_CALL_PHONE,
  DEV_CALL_PRETTY,
  E2E_CONTACT_TELEGRAM,
  E2E_CONTACT_WHATSAPP,
  initiateViaUi,
  imitateDevCall,
  cleanupCallcheckData,
  uniqueTestPhone,
} from './fixtures/callcheck';
import { createTomorrowActivity, deleteTestActivity } from './fixtures/admin-activity';
import { queryDBRow } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';

/** Anonymous flows: opt out of the project-level storageState (the
 * globalSetup c1 session) — the admin e2e opt-out pattern. */
test.use({ storageState: { cookies: [], origins: [] } });

const BACKEND = resolveBackendUrl();

/** Drive the UI up to the booking overlay's auth step: open the factory
 * activity's card (tap → ActivityDetail → «Записаться»), fill one seat
 * plus the contact form, submit as an anonymous client. */
async function openAuthStep(
  page: Page,
  activityId: string,
  phone: string,
  name: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Завтра' }).click();
  const card = page.locator(`[data-card-id="${activityId}"]`);
  await expect(card).toBeVisible();
  await card.click();

  // The card tap opens the activity detail; its footer button books the slot.
  const detail = page.locator('[data-testid="overlay-panel"]');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Участвовать' }).click();

  // Booking form: one seat + valid contacts → anonymous submit → auth step.
  const panel = page.locator('[data-testid="overlay-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('#contact-name').fill(name);
  await panel.locator('#contact-phone').fill(phone);
  await panel.getByLabel('Increase').first().click();
  await panel.getByRole('button', { name: 'Записаться' }).click();
  await expect(page.locator('[data-testid="auth-method-picker"]')).toBeVisible();
}

test.describe('#593 booking callcheck (dev transport)', () => {
  test('US-1: anonymous booking confirmed by call → record created under the session', async ({
    page,
    request,
  }) => {
    const phone = uniqueTestPhone();
    const activity = await createTomorrowActivity();
    try {
      await page.goto('/');
      await openAuthStep(page, activity.id, phone, 'Тест Звонок');

      // ── US-3: the picker offers the live methods only ─────────────────
      const callButton = page.locator('[data-testid="auth-method-call"]');
      await expect(callButton).toBeVisible();
      await expect(callButton).toHaveText('Подтвердить звонком');

      // The SMS button mirrors the honest registry (GET /auth/methods):
      // shown only when the sms_otp transport resolves.
      const methods = (await (
        await request.get(`${BACKEND}/api/v1/auth/methods`)
      ).json()) as Array<{ id: string; available: boolean }>;
      const smsAvailable = methods.some((m) => m.id === 'sms_otp' && m.available);
      await expect(page.locator('[data-testid="auth-method-sms"]')).toHaveCount(
        smsAvailable ? 1 : 0,
      );

      // ── US-1: initiate → the call screen with the dev number ──────────
      const initiation = await initiateViaUi(page);
      expect(initiation.call.phone).toBe(DEV_CALL_PHONE);

      await expect(page.locator('[data-testid="auth-call-screen"]')).toBeVisible();
      const number = page.locator('[data-testid="auth-call-number"]');
      await expect(number).toHaveAttribute('href', `tel:${DEV_CALL_PHONE}`);
      await expect(number).toHaveText(DEV_CALL_PRETTY);
      await expect(
        page.getByText('Позвоните на этот номер — звонок подтвердит ваш телефон'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="auth-call-timer"]')).toBeVisible();

      // The dev call imitation → the poll confirms → the session lands →
      // the pending record goes out through the authorized path.
      await imitateDevCall(request, initiation.handle);
      await expect(page.locator('[data-testid="booking-success"]')).toBeVisible();
      await expect(page.getByText('Вы записаны!')).toBeVisible();

      // VERIFY DB: the record + the find-or-created client + the confirmed
      // auth user, all under the test phone.
      const row = queryDBRow(
        `SELECT r.id AS record_id, r.activity_id, r.seats, u.phone_is_confirmed ` +
          `FROM records r ` +
          `JOIN clients c ON r.client_id = c.id ` +
          `LEFT JOIN users u ON u.phone = c.phone ` +
          `WHERE c.phone = '${phone}'`,
      );
      expect(row, 'the booking record exists under the test phone').not.toBeNull();
      expect(row!.activity_id).toBe(activity.id);
      expect(Number(row!.seats)).toBe(1);
      expect(Number(row!.phone_is_confirmed), 'phone_is_confirmed stamped').toBe(1);
    } finally {
      cleanupCallcheckData(phone);
      await deleteTestActivity(activity.id);
    }
  });

  test('US-4: «Связаться» — prefilled booking text + messenger links', async ({
    page,
  }) => {
    const phone = uniqueTestPhone();
    const activity = await createTomorrowActivity();
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Завтра' }).click();
      const card = page.locator(`[data-card-id="${activity.id}"]`);
      await expect(card).toBeVisible();
      const activityTitle = (await card.locator('h3').innerText()).trim();

      await openAuthStep(page, activity.id, phone, 'Тест Связь');

      // The auth screen carries «Связаться» ALWAYS (#593): open the panel.
      await page.getByRole('button', { name: 'Связаться' }).click();

      const channels = page.locator('[data-testid="auth-contact-channels"]');
      await expect(channels).toBeVisible();

      // The message is prefilled with the REQUEST details: the greeting,
      // the activity, the date/time line, the guest seats, name and phone.
      const message = (await channels.locator('p').first().innerText()).trim();
      expect(message).toContain('Здравствуйте! Хочу записаться:');
      expect(message).toContain(activityTitle);
      expect(message).toContain('Дата и время:');
      expect(message).toContain('Имя: Тест Связь');
      expect(message).toContain(`Телефон: ${phone}`);

      // «Скопировать текст» — the universal fallback.
      await expect(channels.locator('[data-testid="auth-contact-copy"]')).toBeVisible();

      // The administrator's messengers (contacts filled in the e2e env):
      // wa.me/<digits>?text=… and t.me/<user>?text=… with the SAME text.
      const waDigits = E2E_CONTACT_WHATSAPP.replace(/\D/g, '');
      const wa = channels.getByRole('link', { name: 'WhatsApp' });
      await expect(wa).toHaveAttribute(
        'href',
        new RegExp(`^https://wa\\.me/${waDigits}\\?text=`),
      );
      const waHref = (await wa.getAttribute('href'))!;
      const waText = decodeURIComponent(/text=([^&]*)/.exec(waHref)![1]);
      expect(waText).toContain(activityTitle);
      expect(waText).toContain(`Телефон: ${phone}`);

      const tgUser = E2E_CONTACT_TELEGRAM.replace(/^@/, '');
      const tg = channels.getByRole('link', { name: 'Telegram' });
      await expect(tg).toHaveAttribute(
        'href',
        new RegExp(`^https://t\\.me/${tgUser}\\?text=`),
      );
      const tgHref = (await tg.getAttribute('href'))!;
      const tgText = decodeURIComponent(/text=([^&]*)/.exec(tgHref)![1]);
      expect(tgText).toContain(activityTitle);
      expect(tgText).toContain(`Телефон: ${phone}`);
    } finally {
      cleanupCallcheckData(phone);
      await deleteTestActivity(activity.id);
    }
  });
});
