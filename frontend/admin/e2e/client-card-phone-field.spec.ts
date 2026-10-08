import { test, expect } from './fixtures/test';
import { waitForClientsReady } from './fixtures/helpers';
import { createTestClient, cleanup } from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #414 — User Scenario 5 (spec §User Scenarios): the client card phone
 * field on the PhoneField engine.
 *   • a card opened on a legacy spelling («+7 999 653-18-03») saves WITHOUT
 *     touching the phone — the DB keeps the stored value byte-identical
 *     (pristine path: no compact rewrite, no completeness validation);
 *   • editing the number via the widget to an INCOMPLETE remainder blocks
 *     the save with the #221 message — no second PUT leaves the browser,
 *     the DB keeps the legacy value;
 *   • completing the remainder lifts the block — the CHANGED number lands
 *     in the DB as the compact «+<код><нац.>».
 *
 * Full Cycle: SETUP seeds a legacy-spelling client; ACTION edits via the
 * card UI; VERIFY UI (widget init, inline error) + DB (SQL byte-identical /
 * compact); CLEANUP deletes the client (it carries no records).
 */
test.describe('Client card phone field (GH #414 scenario 5)', () => {
  test('untouched legacy phone saves verbatim; an incomplete CHANGED number blocks the save', async ({
    page,
    request,
  }) => {
    const LEGACY = '+7 999 653-18-03';
    const name = `card-phone-e2e-${Date.now()}`;
    const client = await createTestClient(request, { name, phone: LEGACY });

    try {
      await waitForClientsReady(page, { waitForName: name });

      // Open the client card.
      const row = page.locator('table tbody tr').filter({ hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // The widget initialized from the legacy string: RU bound, national
      // remainder grouped (spec §Инициализация существующих значений).
      const phoneInput = page.locator('#client-phone');
      await expect(phoneInput).toHaveValue('999 653-18-03');
      await expect(page.getByTestId('phone-country-select')).toContainText('Россия');

      // Every PUT to this client is counted — the blocked save must add none.
      let puts = 0;
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes(`/api/v1/clients/${client.id}`)) puts++;
      });

      // ── Part 1: save WITHOUT touching the phone (name edit only) ──────
      const putDone = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/clients/${client.id}`),
        { timeout: 15_000 },
      );
      await page.locator('#client-name').fill(`${name} upd`);
      await page.getByRole('button', { name: 'Сохранить' }).click();
      expect((await putDone).ok()).toBeTruthy();
      await expect.poll(() => puts).toBe(1);

      // VERIFY DB — the legacy spelling survived the save byte-identical.
      expect(queryDBRow(`SELECT phone FROM clients WHERE id='${client.id}'`)!.phone).toBe(LEGACY);

      // Wait for the save pipeline to fully QUIESCE before typing Part 2:
      // `mutateAsync` resolves only after its invalidation chain, so the
      // form's setHasChanges(false) — which re-disables the Save button —
      // can land seconds after the PUT response; typing earlier lets that
      // late reset wipe the fresh digits' dirty flag (1-in-4 flake, tester
      // run 2026-10-07). The disabled button IS the quiescence signal (the
      // modal's client prop is a stale snapshot — the header never shows
      // the new name; pre-existing behavior, not this spec's concern).
      const saveBtn = page.getByRole('button', { name: 'Сохранить' });
      await expect(saveBtn).toBeDisabled({ timeout: 15_000 });

      // ── Part 2: an INCOMPLETE changed number blocks the save ──────────
      await phoneInput.clear();
      await phoneInput.pressSequentially('9991234');
      await saveBtn.click();

      // The #221 inline message under the field; no second PUT fires and
      // the DB keeps the legacy value. (Scoped by text — the Next.js route
      // announcer also carries role="alert".)
      await expect(
        page.getByRole('alert').filter({ hasText: 'Проверьте номер телефона' }),
      ).toHaveText('Проверьте номер телефона — возможно, он введён не полностью');
      await page.waitForTimeout(1000);
      expect(puts).toBe(1);
      expect(queryDBRow(`SELECT phone FROM clients WHERE id='${client.id}'`)!.phone).toBe(LEGACY);

      // ── Part 3: completing the remainder lifts the block ──────────────
      const putDone2 = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(`/api/v1/clients/${client.id}`),
        { timeout: 15_000 },
      );
      await phoneInput.clear();
      await phoneInput.pressSequentially('9991234567');
      await saveBtn.click();
      expect((await putDone2).ok()).toBeTruthy();

      // VERIFY DB — the CHANGED number is stored as the compact.
      await expect
        .poll(() => queryDBRow(`SELECT phone FROM clients WHERE id='${client.id}'`)!.phone)
        .toBe('+79991234567');
    } finally {
      // CLEANUP — the client carries no records; a plain DELETE suffices.
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
