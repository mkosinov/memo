/**
 * master-role-record-create.spec.ts — GH #263 T10, scenario S2.
 *
 * S2 — «Создание записи мастером»:
 *  a) селектор занятия — только свои активности: quick-add открывается
 *     только из КАРТОЧКИ занятия (DOM event carries the activity), and the
 *     grid itself contains only the master's own activities (S1), so the
 *     master can only ever create records on HIS activities; a direct
 *     foreign-activity attempt answers 404 (acceptance: API surface);
 *  b) typeahead по полному номеру находит клиента ВСЕЙ студии (client of
 *     a foreign master's record!) — phone rendered MASKED in the
 *     suggestion data (backend contract D3/D4: the phone lookup is
 *     scope-free, the scoped response is masked);
 *  c) несуществующий номер — клиент создан с введённым номером (WYSIWYG),
 *     запись создана.
 *
 * RED note (TDD): scope + mask landed in T2/T3 (backend TDD —
 * backend/tests/test_master_scope_read.py, test_master_scope_clients.py);
 * the #221 creation flow is pinned by client-phone-typeahead.spec.ts.
 * These e2e scenarios are the acceptance layer — assertions stay strict.
 *
 * Wait strategy: the «Запись создана» toast is replaced within the same
 * second by «Данные обновлены» (the ['records'] invalidation refetch), so
 * both flows assert on the POST /records wire response + DB truth instead
 * of the ephemeral toast. The booking target is whatever OWN card the
 * quick-add picked (seed m1 ev activity or a factory m1 activity) — the
 * DB assertion joins records → activities ON master_id='m1'.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import { waitForScheduleReady, openAddTab } from './fixtures/helpers';
import { createTestClient, createTestActivity, createTestRecord, createTestMaster, cleanup, cleanupRecord } from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

/** mask_phone backend contract (src/auth/scope.py): all digits except the
 *  LAST 4 → '•', non-digits preserved in place. */
function expectMasked(phone: string, naked: string): void {
  expect(phone).toContain('•');
  expect(phone).not.toContain(naked.slice(0, -4));
  expect(phone.endsWith(naked.slice(-4))).toBe(true);
}

/** The created record's own-activity join: records → activities (m1). */
function ownRecordRow(clientId: string): Record<string, unknown> | null {
  return queryDBRow(
    `SELECT r.id FROM records r JOIN activities a ON a.id = r.activity_id
     WHERE r.client_id='${clientId}' AND a.master_id='m1'
     ORDER BY r.created_at DESC LIMIT 1`,
  );
}

test.describe('GH #263 S2 — master creates records', () => {
  useMasterSession();

  test('S2a+b: booking only on own card; typeahead finds studio client with masked phone', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    // A client of the STUDIO whose only record hangs on a FOREIGN master's
    // activity — the master must still find him in the typeahead (D4).
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Запись ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    const studioClient = await createTestClient(admin, {
      name: `Студиец ${Date.now()}`,
      phone: '+79991234567',
    });
    const foreignRecord = await createTestRecord(
      admin, foreignActivity.id, studioClient.id,
    );

    try {
      // The grid shows only own cards → quick-add can only ever bind them.
      await waitForScheduleReady(page);
      await expect(
        page.locator(`[data-testid="activity-${foreignActivity.id}"]`),
      ).toHaveCount(0);

      // API acceptance of the same guarantee: a scoped booking onto a
      // FOREIGN activity answers 404 (indistinguishable from missing).
      const foreignAttempt = await page.request.post(`${BACKEND}/api/v1/records`, {
        data: {
          activity_id: foreignActivity.id,
          client_id: studioClient.id,
          visits: [{ name: 'Гость', price: 3500 }],
        },
      });
      expect(foreignAttempt.status()).toBe(404);

      // The creation flow opens from an OWN card (the only cards there are).
      await openAddTab(page);
      await expect(
        page.locator('[data-testid="new-record-tab"]'),
      ).toBeVisible();

      // Typeahead по ПОЛНОМУ номеру → the studio-wide client is suggested.
      const listResponse = page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/clients') &&
          new URL(res.url()).searchParams.has('phone'),
      );
      await page
        .locator('[data-testid="input-phone"]')
        .pressSequentially('+79991234567');
      const resp = await listResponse;

      // MASK in the wire data (scoped response, D3): no naked number.
      const body = await resp.json();
      const suggested = (body.items as Array<{ id: string; phone: string; name: string }>)
        .find((c) => c.id === studioClient.id);
      expect(suggested).toBeTruthy();
      expectMasked(suggested!.phone, '+79991234567');

      // …and the UI offers him as a suggestion row.
      const row = page.getByRole('option', { name: /Студиец/ });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Pick → bind by id; save. Wait for the POST to answer 201.
      await row.click();
      const createWait = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/v1/records') &&
          r.request().method() === 'POST' &&
          r.status() === 201,
        { timeout: 15_000 },
      );
      await page.locator('[data-testid="btn-create-record"]').click();
      await createWait;

      // VERIFY DB — the record landed on an OWN (m1) activity for the
      // studio-wide client.
      await expect.poll(
        () => ownRecordRow(studioClient.id) !== null,
        { timeout: 30_000, intervals: [200, 500, 1000] },
      ).toBe(true);
    } finally {
      const created = ownRecordRow(studioClient.id);
      if (created) await cleanupRecord(page.request, created.id as string);
      await cleanup(admin, `/api/v1/records/${foreignRecord.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/clients/${studioClient.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('S2c: unknown full number → client created with the typed number; record created', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    const typed = `999${`${Date.now()}`.slice(-7)}`; // unique 10-digit national
    const clientName = `Новенький ${typed}`;

    try {
      await waitForScheduleReady(page);
      await openAddTab(page);

      // Type an UNKNOWN complete number + a name, save (no suggestion pick).
      await page
        .locator('[data-testid="input-phone"]')
        .pressSequentially(`+7${typed}`);
      await page.locator('[data-testid="input-client-name"]').fill(clientName);

      const createWait = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/v1/records') &&
          r.request().method() === 'POST' &&
          r.status() === 201,
        { timeout: 15_000 },
      );
      await page.locator('[data-testid="btn-create-record"]').click();
      await createWait;

      // VERIFY DB — client created with the typed number (WYSIWYG: the
      // stored string is the VISIBLE masked value «+7 999 xxx xx xx», so
      // compare DIGITS) and the record bound to an OWN (m1) activity.
      await expect.poll(() => {
        const dbRow = queryDBRow(`SELECT id, phone FROM clients WHERE name = '${clientName}'`);
        if (!dbRow) return false;
        const storedDigits = String(dbRow.phone).replace(/\D/g, '');
        return storedDigits === `7${typed}`;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

      const newClient = queryDBRow(`SELECT id FROM clients WHERE name = '${clientName}'`);
      const newRecord = ownRecordRow(newClient!.id as string);
      expect(newRecord).not.toBeNull();
      if (newRecord) await cleanupRecord(page.request, newRecord.id as string);
      await cleanup(page.request, `/api/v1/clients/${newClient!.id}`);
    } finally {
      await admin.dispose();
    }
  });
});
