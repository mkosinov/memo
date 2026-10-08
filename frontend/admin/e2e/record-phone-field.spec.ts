import { test, expect } from './fixtures/test';
import type { Page, Response } from '@playwright/test';
import {
  waitForScheduleReady,
  openAddTab,
  phoneMaskDisplay,
  clientSearchInput,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { createTestClient, cleanup, cleanupRecord } from './fixtures/factories';

/**
 * GH #414 — User Scenarios 1–3 (spec §User Scenarios) — the record-form
 * phone field on the country-selector engine, save-path edition:
 *   1. запись с новым номером RU — RU is preselected, digits group from the
 *      first typed ones, the typeahead opens at the 4th national digit, the
 *      unpicked save creates the client with the COMPACT «+7…» in the DB and
 *      the /clients table shows the number GROUPED (display formatter);
 *   2. выбор из подсказок — picking a suggestion freezes the field read-only
 *      «Имя · телефон» (grouped phone) with the country selector inert, and
 *      × dissolves the pick, returning the form to free input;
 *   3. BY без дубля — a Belarusian number (country picked by hand, honest
 *      BY placeholder) saves with the compact «+375…»; re-entering the SAME
 *      number without picking the suggestion binds the already-created
 *      client at save time — no duplicate row appears;
 *   4. вставка вне списка — an out-of-list international paste («+1 …»)
 *      enters «без страны» and BLOCKS the save with «Выберите страну из
 *      списка» (GH #414 fix round): no toast-success, no client row — the
 *      pre-fix bug silently created a phone-less client.
 *
 * Full Cycle: SETUP seeds a client only where the scenario needs an existing
 * one (2); ACTION goes through the real quick-add form; VERIFY asserts UI
 * state AND the DB rows (compact storage, single-client invariant); CLEANUP
 * cascades records first, then the client (client-with-records cannot be
 * deleted — see cleanupClientAndRecords in client-phone-typeahead.spec.ts).
 */

/** Wait for the typeahead list request carrying the given national digits. */
function waitForPhoneSearch(page: Page, digits: string): Promise<Response> {
  return page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/clients') &&
      new URL(res.url()).searchParams.get('phone') === digits,
    { timeout: 15_000 },
  );
}

/** Unique 10-digit RU national number («999» + 7-digit unique tail). */
function ruDigits(): string {
  return `999${`${Date.now()}`.slice(-7)}`.slice(0, 10);
}

test.describe('Record-form phone — create flows (GH #414 scenarios 1–3)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 1: запись с новым номером RU — компакт в базе, группировка ──
  test('1. RU default: grouping from first digits, typeahead at 4th, compact stored, grouped in /clients', async ({
    page,
    request,
  }) => {
    const digits = ruDigits();
    const compactPhone = `+7${digits}`;
    const clientName = `E2E-414-C1 ${digits}`;
    let clientId: string | null = null;

    try {
      await openAddTab(page);
      const phoneInput = page.locator('[data-testid="input-phone"]');
      const selector = page.getByTestId('phone-country-select');

      // RU is the default country with its honest national template.
      await expect(selector).toContainText('Россия');
      await expect(phoneInput).toHaveAttribute('placeholder', '999 123-45-67');

      // 3 national digits — below the 4-digit threshold: no search, no listbox.
      await phoneInput.pressSequentially(digits.slice(0, 3));
      await page.waitForTimeout(600); // outlast the 300 ms debounce
      await expect(page.getByRole('listbox')).toHaveCount(0);

      // The 4th digit fires the typeahead with the NATIONAL digits (RU).
      const search4 = waitForPhoneSearch(page, digits.slice(0, 4));
      await phoneInput.pressSequentially(digits[3]);
      await search4;

      // Finish the number — the display groups from the first typed digits
      // (AsYouType RU: «999 xxx-xx-xx»).
      await phoneInput.pressSequentially(digits.slice(4));
      await expect(phoneInput).toHaveValue(phoneMaskDisplay(digits, 'national'));

      // Save without picking any suggestion → client created.
      await page.locator('[data-testid="input-client-name"]').fill(clientName);
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

      // VERIFY DB — the stored phone is the COMPACT «+7…», not the visible
      // grouped string and not the raw remainder.
      await expect
        .poll(
          () => {
            const row = queryDBRow(
              `SELECT id, phone FROM clients WHERE name='${clientName}'`,
            );
            clientId = row?.id ?? null;
            return row !== null && row.phone === compactPhone;
          },
          { timeout: 30_000, intervals: [200, 500, 1000] },
        )
        .toBe(true);

      // VERIFY UI — the /clients table shows the SAME number GROUPED by the
      // single display formatter («+7 999 xxx xx xx»).
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).toHaveCount(0);
      await page.locator('a[aria-label="Клиенты"]').click();
      await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });
      const search = clientSearchInput(page);
      await expect(search).toBeVisible({ timeout: 10_000 });
      await search.fill(clientName);
      await page.waitForTimeout(1500); // debounced search (300 ms) + network
      const clientRow = page.locator('table tbody tr').filter({ hasText: clientName });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toContainText(phoneMaskDisplay(digits, 'international'));
    } finally {
      // CLEANUP — records FIRST (client-with-records DELETE answers 409).
      if (clientId) {
        for (const row of queryDBRows(
          `SELECT id FROM records WHERE client_id='${clientId}'`,
        )) {
          await cleanupRecord(request, row.id as string);
        }
        await cleanup(request, `/api/v1/clients/${clientId}`);
      }
    }
  });

  // ── Scenario 2: выбор из подсказок → «Имя · телефон», × возвращает ввод ──
  test('2. Pick from suggestions freezes «Имя · телефон»; × restores free input', async ({
    page,
    request,
  }) => {
    // SETUP — an active client the typeahead must suggest.
    const seeded = await createTestClient(request, {
      name: 'Подсказка E2E-414',
      phone: '+79991234567',
    });

    try {
      await openAddTab(page);
      const phoneInput = page.locator('[data-testid="input-phone"]');
      const selector = page.getByTestId('phone-country-select');

      // 6 national digits — the seeded client is suggested.
      await phoneInput.pressSequentially('999123');
      const row = page.getByRole('option', { name: /Подсказка E2E-414/ });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Pick → the field freezes read-only «Имя · телефон» (grouped phone),
      // the country selector goes inert, the name mirrors the stored client.
      await row.click();
      await expect(phoneInput).toHaveAttribute('readonly');
      await expect(phoneInput).toHaveValue('Подсказка E2E-414 · +7 999 123 45 67');
      await expect(selector).toBeDisabled();
      const nameInput = page.locator('[data-testid="input-client-name"]');
      await expect(nameInput).toHaveValue('Подсказка E2E-414');
      await expect(nameInput).toHaveAttribute('readonly');

      // × dissolves the pick — the form returns to free input (no client
      // name, no typed number), the selector is live again.
      await page.getByLabel('clear').click();
      await expect(phoneInput).not.toHaveAttribute('readonly');
      await expect(phoneInput).toHaveValue('');
      await expect(selector).toBeEnabled();
      await expect(nameInput).toHaveValue('');
      await expect(nameInput).not.toHaveAttribute('readonly');
    } finally {
      // CLEANUP — nothing was saved (no records created).
      await cleanup(request, `/api/v1/clients/${seeded.id}`);
    }
  });

  // ── Scenario 3: BY номер без дубля ─────────────────────────────────────
  test('3. Belarusian number: BY template, compact «+375…»; re-entry binds the same client — no duplicate', async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}`.slice(-7);
    const byNational = `29${uid}`; // 9-digit BY national number
    const compactPhone = `+375${byNational}`;
    const firstName = `Белорус C3a ${uid}`;
    const secondName = `Белорус C3b ${uid}`;
    let clientId: string | null = null;

    try {
      // ── Part A: first entry — country picked by hand, save → compact ──
      await openAddTab(page);
      const phoneInput = page.locator('[data-testid="input-phone"]');
      const selector = page.getByTestId('phone-country-select');

      await selector.click();
      await page.getByTestId('phone-country-select-option-BY').click();
      await expect(selector).toContainText('Беларусь');
      // The honest BY template of the remainder input.
      await expect(phoneInput).toHaveAttribute('placeholder', '29 123 45 67');

      // Type the national remainder (min metadata keeps BY ungrouped).
      await phoneInput.pressSequentially(byNational);
      await expect(phoneInput).toHaveValue(byNational);

      await page.locator('[data-testid="input-client-name"]').fill(firstName);
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

      // VERIFY DB — the client exists with the compact «+375…».
      await expect
        .poll(
          () => {
            const row = queryDBRow(
              `SELECT id, phone FROM clients WHERE phone='${compactPhone}'`,
            );
            clientId = row?.id ?? null;
            return clientId !== null;
          },
          { timeout: 30_000, intervals: [200, 500, 1000] },
        )
        .toBe(true);

      // ── Part B: re-enter the SAME number — save-time сверка, no dup ────
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).toHaveCount(0);
      await openAddTab(page);

      // The widget mounts fresh on RU — switch to BY again, type the number.
      await selector.click();
      await page.getByTestId('phone-country-select-option-BY').click();
      await expect(selector).toContainText('Беларусь');

      // The typeahead finds the Part-A client (search by BY national digits)
      // — and the scenario deliberately IGNORES the suggestion.
      await phoneInput.pressSequentially(byNational);
      await expect(
        page.getByRole('option', { name: new RegExp(firstName) }),
      ).toBeVisible({ timeout: 10_000 });

      await page.locator('[data-testid="input-client-name"]').fill(secondName);
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

      // VERIFY DB — exactly ONE client owns the number (no duplicate was
      // created for the ignored suggestion + typed name).
      await expect
        .poll(
          () =>
            Number(
              queryDBRow(
                `SELECT COUNT(*) AS n FROM clients WHERE phone='${compactPhone}'`,
              )?.n ?? 0,
            ),
          { timeout: 30_000, intervals: [200, 500, 1000] },
        )
        .toBe(1);

      // And no client was created for the second typed name either.
      const secondRow = queryDBRow(
        `SELECT id FROM clients WHERE name='${secondName}'`,
      );
      expect(secondRow).toBeNull();

      // Both records are bound to the SAME client (the Part-A one).
      const boundRecords = queryDBRows(
        `SELECT id FROM records WHERE client_id='${clientId}'`,
      );
      expect(boundRecords.length).toBeGreaterThanOrEqual(2);
    } finally {
      // CLEANUP — records FIRST (client-with-records DELETE answers 409).
      if (clientId) {
        for (const row of queryDBRows(
          `SELECT id FROM records WHERE client_id='${clientId}'`,
        )) {
          await cleanupRecord(request, row.id as string);
        }
        await cleanup(request, `/api/v1/clients/${clientId}`);
      }
    }
  });

  // ── Scenario 4: вставка вне списка блокирует сохранение (GH #414 fix) ──
  test('4. Out-of-list paste enters «без страны» and BLOCKS the save — no client created', async ({
    page,
  }) => {
    const clientName = `E2E-414-C4 ${Date.now()}`;

    // No SETUP — the scenario must create nothing.

    await openAddTab(page);
    const phoneInput = page.locator('[data-testid="input-phone"]');

    // Paste an out-of-list international number — the widget enters the
    // «без страны» state: selector unchanged (RU), raw digits, no template.
    await phoneInput.fill('+1 650 555 1234');
    await expect(page.getByTestId('phone-country-select')).toContainText('Россия');
    await expect(phoneInput).toHaveValue('16505551234');
    await expect(phoneInput).toHaveAttribute('placeholder', '');

    // Save → blocked with the PhoneField message; nothing fetched/created.
    // (Scoped by text, not waitForToast: dnd-kit also renders a live region
    // with role="status" earlier in the DOM, which hijacks .first().)
    await page.locator('[data-testid="input-client-name"]').fill(clientName);
    await page.locator('[data-testid="btn-create-record"]').click();
    await expect(
      page.locator('[role="status"]').filter({ hasText: 'Выберите страну из списка' }),
    ).toBeVisible({ timeout: 10_000 });

    // The modal is still open — no success toast, no record created.
    await expect(page.locator('text=Запись создана')).toHaveCount(0);

    // VERIFY DB — no client row for the typed name (the pre-fix bug created
    // one with phone: '' — silent data loss). Poll: a regression would write
    // the row asynchronously within seconds.
    await expect
      .poll(
        () =>
          queryDBRow(`SELECT id FROM clients WHERE name='${clientName}'`) === null,
        { timeout: 5_000, intervals: [500, 1000] },
      )
      .toBe(true);

    // CLEANUP — nothing was saved.
  });
});
