import { test, expect, type Page } from '@playwright/test';
import { waitForScheduleReady, openAddTab } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * GH #221 — User Scenario 7: "Mask as you type; silence below the threshold."
 *
 * Typing digits renders the RU grouping progressively; while fewer than 4
 * digits are typed, no dropdown appears and no clients list request with
 * `?phone=` is sent (route spy). Saving stores the phone EXACTLY as visible
 * in the field (WYSIWYG — spec decision 5).
 *
 * FULL SPEC IS fixme'd: PhoneInput is wired into NewBookingTab in Task 6
 * (pick = client id, read-only freeze) and the WYSIWYG create path lands in
 * Task 7 (save-time resolution). Until then `[data-testid="input-phone"]`
 * is a plain free-text field with no mask. Unskip in Task 6/7 — do not
 * delete this spec.
 */

/** Count typeahead-specific list requests: /clients with a `phone` param. */
async function spyPhoneListRequests(page: Page): Promise<{ count: () => number }> {
  const state = { n: 0 };
  await page.route('**/api/v1/clients**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('phone')) state.n += 1;
    return route.continue();
  });
  return { count: () => state.n };
}

test.describe('Client phone typeahead — record form (scenario 7)', () => {
  // GH #221: PhoneInput is wired into NewBookingTab in Task 6; the WYSIWYG
  // create path lands in Task 7. Until then this spec stays skipped —
  // unskip it there (scenario 7 goes live with the other form scenarios).
  test.fixme('7. Mask as you type; silence below the threshold; save stores the visible string', async ({
    page,
    request,
  }) => {
    await waitForScheduleReady(page);

    // Unique 10-digit national number (999xxx pattern → RU grouping
    // XXX XXX XX XX); uniqueness keeps DB cleanup surgical.
    const uid = `${Date.now()}`.slice(-7);
    const digits = `999${uid}`; // 10 digits
    const expectedDisplay = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
    const clientName = `E2E Mask Client ${uid}`;

    const spy = await spyPhoneListRequests(page);

    let recordId: string | null = null;
    let clientId: string | null = null;

    try {
      // ── ACTION 1: type only 3 digits — below the 4-DIGIT threshold ────
      await openAddTab(page);
      const phoneInput = page.locator('[data-testid="input-phone"]');
      await phoneInput.pressSequentially('999');

      // Outlast the 300 ms debounce: nothing may fire for 3 digits.
      await page.waitForTimeout(600);

      // Route spy: zero `?phone=` list requests.
      expect(spy.count()).toBe(0);
      // No dropdown is open.
      await expect(page.getByRole('listbox')).toHaveCount(0);

      // ── ACTION 2: continue to the full number — mask + one request ────
      const listResponse = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/clients') &&
          new URL(res.url()).searchParams.has('phone'),
      );
      await phoneInput.pressSequentially(digits.slice(3));

      // Mask display: progressive RU grouping of the typed digits.
      await expect(phoneInput).toHaveValue(expectedDisplay);

      const resp = await listResponse;
      // Search digits are the typed national digits (no decorative prefix).
      expect(new URL(resp.url()).searchParams.get('phone')).toBe(digits);
      expect(spy.count()).toBe(1); // exactly one typeahead request overall

      // ── ACTION 3: save — stored phone equals the visible string ───────
      await page
        .locator('[data-testid="input-client-name"]')
        .fill(clientName);
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({
        timeout: 10_000,
      });

      // VERIFY DB — WYSIWYG: the stored string is what was in the field.
      await expect.poll(async () => {
        const row = queryDBRow(
          `SELECT id, phone FROM clients WHERE name='${clientName}' AND is_active=1`,
        );
        if (row) clientId = row.id as string;
        return row !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(String(clientId)).toBeTruthy();

      const recordRow = queryDBRow(
        `SELECT id FROM records WHERE client_id='${clientId}' AND is_active=1`,
      );
      recordId = recordRow?.id ?? null;
      expect(String(recordId)).toBeTruthy();

      const clientRow = queryDBRow(
        `SELECT phone FROM clients WHERE id='${clientId}'`,
      );
      expect(clientRow!.phone).toBe(expectedDisplay);
    } finally {
      // ── CLEANUP — record first (FK), then client ──────────────────────
      if (recordId) {
        await request.delete(`${BACKEND}/api/v1/records/${recordId}`).catch(() => {});
      }
      if (clientId) {
        await request.delete(`${BACKEND}/api/v1/clients/${clientId}`).catch(() => {});
      }
    }
  });
});
