import { test, expect } from './fixtures/test';
import type { Page, Response } from '@playwright/test';
import { waitForScheduleReady, openAddTab } from './fixtures/helpers';
import { createTestClient, cleanup } from './fixtures/factories';

/**
 * GH #414 — User Scenario 4 (spec §User Scenarios): the record-form phone
 * field is a country-selector composite.
 *   • switching the country mid-entry (RU → Латвия) keeps the typed digits
 *     and regroups them under the new country's template (placeholder
 *     included) — no data loss, no re-query of a different number;
 *   • pasting a copied international number («+375 29 123-45-67») selects
 *     the country from the paste and leaves the national remainder;
 *   • the typeahead then searches with the NATIONAL digits of the selected
 *     country and the picked client freezes the field «Имя · телефон»
 *     (display formatter) with the country selector inert.
 *
 * Full Cycle: SETUP seeds a BY client; ACTION types/switches/pastes/picks;
 * VERIFY UI asserts the regrouped display, the bound selector and the
 * server-matched suggestion row (the ?phone= response proves the digits
 * mode); CLEANUP removes the seeded client (no records are created).
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

test.describe('Phone field country selector — record form (GH #414 scenario 4)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('country switch mid-entry regroups; «+375 …» paste binds Belarus and finds the client', async ({
    page,
    request,
  }) => {
    // SETUP — an active BY client the pasted number must find.
    const seeded = await createTestClient(request, {
      name: 'Белорус E2E-414',
      phone: '+375291234567',
    });

    try {
      await openAddTab(page);
      const phoneInput = page.locator('[data-testid="input-phone"]');
      const selector = page.getByTestId('phone-country-select');

      // ── Part 1: switch the country mid-entry (RU → Латвия) ────────────
      // 7 digits under RU stay ungrouped (min metadata has no RU grouping
      // for this tail); the typeahead fires at the 4th national digit.
      const ruSearch = waitForPhoneSearch(page, '2312345');
      await phoneInput.pressSequentially('2312345');
      await ruSearch;
      await expect(phoneInput).toHaveValue('2312345');
      await expect(selector).toContainText('Россия');

      await selector.click();
      await page.getByTestId('phone-country-select-option-LV').click();
      await expect(selector).toContainText('Латвия');
      // The typed digits survive and regroup under the LV template on the
      // spot; the honest placeholder follows the new country.
      await expect(phoneInput).toHaveValue('23 123 45');
      await expect(phoneInput).toHaveAttribute('placeholder', '23 123 456');

      // ── Part 2: paste a copied «+375 …» — the country comes from it ───
      await phoneInput.fill('+375 29 123-45-67');
      await expect(selector).toContainText('Беларусь');
      await expect(phoneInput).toHaveValue('291234567');

      // The typeahead searched with the BY national digits (not the display
      // string, not the calling code) and the seeded client is suggested.
      const row = page.getByRole('option', { name: /Белорус E2E-414/ });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Pick → the field freezes «Имя · телефон» with the grouped phone and
      // the country selector goes inert.
      await row.click();
      await expect(phoneInput).toHaveAttribute('readonly');
      await expect(phoneInput).toHaveValue('Белорус E2E-414 · +375 29 123 45 67');
      await expect(selector).toBeDisabled();
    } finally {
      // CLEANUP — no records were created (no save clicked).
      await cleanup(request, `/api/v1/clients/${seeded.id}`);
    }
  });
});
