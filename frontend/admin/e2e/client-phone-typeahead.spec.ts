import { test, expect, type Page } from '@playwright/test';
import {
  waitForScheduleReady,
  openAddTab,
  openModal,
  clickModalTab,
  phoneMaskDisplay,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
import { createTestClient, createTestActivity, createTestRecord, cleanup, cleanupRecord } from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * GH #221 — record-form client typeahead by partial phone match.
 *
 * Scenarios (spec §User Scenarios) — all active:
 *   1. Find a regular by a fragment — pick binds the record by id.
 *   2. Different stored formats still match (old `8 999 123-45-67` data).
 *   3. Unknown number creates a client; incomplete does not save (Task 7).
 *   4. Ignored suggestions never duplicate (save-time resolution, Task 7).
 *   5. Archived clients stay invisible in suggestions.
 *   6. Editing an existing record keeps the client (no rebind).
 *   7. Mask as you type; silence below the threshold; WYSIWYG save (Task 7).
 */

/**
 * Mask display for a full 10-digit RU national number: shared helper
 * (`phoneMaskDisplay`) pins the actual AsYouType output — space after the
 * 3rd digit, then dashes for national typing (compliance-review finding:
 * the previous space-grouped expectation never matched the real mask).
 * The unit tests in app/components/shared/__tests__/PhoneInput.test.tsx
 * pin the same grouping.
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

/** Type a query into the record-form phone field and wait for its search. */
async function typePhoneQuery(page: Page, query: string) {
  const listResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/clients') &&
      new URL(res.url()).searchParams.has('phone'),
  );
  await page.locator('[data-testid="input-phone"]').pressSequentially(query);
  return listResponse;
}

test.describe('Client phone typeahead — record form (GH #221)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 1: pick a suggestion → record binds that client by id ────
  test('1. Fragment search → pick → record is bound to the picked client', async ({
    page,
    request,
  }) => {
    // Seed: "Иванова" with a +79991234567-family number.
    const seeded = await createTestClient(request, {
      name: 'Иванова E2E-221',
      phone: '+79991234567',
    });
    let recordId: string | null = null;

    try {
      await openAddTab(page);

      // Type a fragment (4+ digits) — the suggestion row must appear.
      await typePhoneQuery(page, '999123');
      const row = page.getByRole('option', { name: /Иванова E2E-221/ });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Pick → phone field freezes read-only with the client label.
      await row.click();
      const phoneInput = page.locator('[data-testid="input-phone"]');
      await expect(phoneInput).toHaveAttribute('readonly');
      await expect(phoneInput).toHaveValue(/Иванова E2E-221/);

      // Save.
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // VERIFY DB — the new record's client is the seeded Иванова (by id).
      await expect.poll(() => {
        const row2 = queryDBRow(
          `SELECT id FROM records WHERE client_id='${seeded.id}' ORDER BY created_at DESC LIMIT 1`,
        );
        recordId = row2?.id as string | null;
        return recordId !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

      // No duplicate client was created for the typed fragment.
      const dupRow = queryDBRow(
        `SELECT id FROM clients WHERE name LIKE 'Иванова E2E-221%' AND id != '${seeded.id}'`,
      );
      expect(dupRow).toBeNull();
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${seeded.id}`);
    }
  });

  // ── Scenario 2: old stored format still matches a typed +7… query ─────
  test('2. Client stored as "8 999 123-45-67" matches a +7999… query', async ({
    page,
    request,
  }) => {
    // Seed an old-format stored string (no normalization — raw as typed).
    const seeded = await createTestClient(request, {
      name: 'Старый формат E2E-221',
      phone: '8 999 123-45-67',
    });

    try {
      await openAddTab(page);

      // Type the international prefix form of the same number.
      const resp = await (await typePhoneQuery(page, '+79991234')).json();
      expect(
        resp.items.some((c: { id: string }) => c.id === seeded.id),
      ).toBe(true);

      // And the UI shows the row.
      const row = page.getByRole('option', { name: /Старый формат E2E-221/ });
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${seeded.id}`);
    }
  });

  // ── Scenarios 3 & 4: save-time resolution (Task 7) ────────────────────
  test('3. Unknown full number creates a client (WYSIWYG); incomplete blocks save', async ({
    page,
    request,
  }) => {
    // Unique 10-digit national number → unique DB cleanup.
    const uid = `${Date.now()}`.slice(-7);
    const digits = `999556${uid}`.slice(0, 10); // 999 556 xx xx

    await openAddTab(page);

    // ── Part A: partial number → save blocked, nothing created ────────
    await page
      .locator('[data-testid="input-phone"]')
      .pressSequentially(digits.slice(0, 6)); // 6 of 10 digits — incomplete
    await page
      .locator('[data-testid="input-client-name"]')
      .fill(`Незавершённый E2E-221 ${uid}`);
    await page.locator('[data-testid="btn-create-record"]').click();

    // The retryable-input guard message, nothing else happens.
    const infoToast = page.locator('[data-testid="toast-info"]');
    await expect(infoToast).toContainText(
      'Проверьте номер телефона — возможно, он введён не полностью',
      { timeout: 10_000 },
    );
    // The success toast never fires and no record-creation request is made.
    await expect(page.locator('text=Запись создана')).toHaveCount(0);

    // VERIFY DB — no client was created for the incomplete number.
    const notCreated = queryDBRow(
      `SELECT id FROM clients WHERE name LIKE 'Незавершённый E2E-221 ${uid}%'`,
    );
    expect(notCreated).toBeNull();

    // ── Part B: full unknown number → client created, phone EXACTLY as displayed ──
    // Clear the partial input and finish typing the full number.
    const phoneInput = page.locator('[data-testid="input-phone"]');
    await phoneInput.fill('');
    await phoneInput.pressSequentially(digits);
    // The mask keeps rendering progressively (display = WYSIWYG truth).
    const fullDisplay = await phoneInput.inputValue();
    await page
      .locator('[data-testid="input-client-name"]')
      .fill(`Новый WYSIWYG E2E-221 ${uid}`);
    await page.locator('[data-testid="btn-create-record"]').click();

    await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

    // VERIFY DB — the client exists with the phone EXACTLY as displayed.
    await expect.poll(() => {
      const row = queryDBRow(
        `SELECT id, phone FROM clients WHERE name = 'Новый WYSIWYG E2E-221 ${uid}'`,
      );
      return row !== null && row.phone === fullDisplay;
    }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

    // Cleanup: the freshly created client.
    const created = queryDBRow(
      `SELECT id FROM clients WHERE name = 'Новый WYSIWYG E2E-221 ${uid}'`,
    );
    if (created) await cleanup(request, `/api/v1/clients/${created.id}`);
  });

  test('4. Ignored suggestion never duplicates — save binds the existing client', async ({
    page,
    request,
  }) => {
    // Seed the client with the canonical stored format.
    const seeded = await createTestClient(request, {
      name: 'Дубликат-щит E2E-221',
      phone: '+79991234567',
    });
    let recordId: string | null = null;

    try {
      await openAddTab(page);

      // Type the masked form of the SAME number — the suggestion appears…
      await typePhoneQuery(page, '+79991234567');
      await expect(
        page.getByRole('option', { name: /Дубликат-щит E2E-221/ }),
      ).toBeVisible({ timeout: 10_000 });

      // …and is deliberately IGNORED (no pick).
      await page
        .locator('[data-testid="input-client-name"]')
        .fill('Дубликат-щит E2E-221');
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

      // VERIFY DB — the record is bound to the SEEDED client…
      await expect.poll(() => {
        const row = queryDBRow(
          `SELECT id FROM records WHERE client_id='${seeded.id}' ORDER BY created_at DESC LIMIT 1`,
        );
        recordId = row?.id as string | null;
        return recordId !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

      // …and NO duplicate client was created for the typed number.
      await expect.poll(() => {
        const dup = queryDBRow(
          `SELECT COUNT(*) AS n FROM clients
           WHERE name LIKE 'Дубликат-щит E2E-221%' AND id != '${seeded.id}'`,
        );
        return dup?.n === 0;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${seeded.id}`);
    }
  });

  // ── Scenario 5: archived clients are absent from suggestions ──────────
  test('5. Archived client with a matching number is not suggested', async ({
    page,
    request,
  }) => {
    // Seed active + archived clients sharing the fragment.
    const active = await createTestClient(request, {
      name: 'Активный E2E-221',
      phone: '+79995550001',
    });
    const archived = await createTestClient(request, {
      name: 'Архивный E2E-221',
      phone: '+79995550002',
    });
    const archResp = await request.post(`${BACKEND}/api/v1/clients/${archived.id}/archive`);
    expect(archResp.ok()).toBeTruthy();

    try {
      await openAddTab(page);
      await typePhoneQuery(page, '99955500');

      // Active match is suggested…
      await expect(
        page.getByRole('option', { name: /Активный E2E-221/ }),
      ).toBeVisible({ timeout: 10_000 });
      // …the archived one never is.
      await expect(
        page.getByRole('option', { name: /Архивный E2E-221/ }),
      ).toHaveCount(0);
    } finally {
      await cleanup(request, `/api/v1/clients/${active.id}`);
      await cleanup(request, `/api/v1/clients/${archived.id}`);
    }
  });

  // ── Scenario 6: editing an existing record keeps the client ───────────
  test('6. Opening an existing record for edit shows the client; save keeps it', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request, {
      name: 'Правка E2E-221',
      phone: '+79995550003',
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // Re-navigate so the fresh activity is in the current week's range.
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

      await openModal(page, { recordId: record.id });
      await clickModalTab(page, `tab-client-${record.id}`);

      // The bound client renders on the record tab (ClientTab header).
      const header = page.locator('[data-testid="client-tab-header"]');
      await expect(header).toContainText('Правка E2E-221', { timeout: 10_000 });

      // The phone field offers no re-binding in edit mode: the new-booking
      // typeahead is only on the "+" tab; the record tab shows the frozen
      // client. EXERCISE the edit-save for real: the modal's ClientTab
      // persists a comment change immediately via PATCH /records/{id}
      // (updateRecord on change — the edit path's save action).
      const comment = `Правка комментарий ${Date.now()}`;
      await page
        .locator('[data-testid="input-comment"]')
        .fill(comment);
      const patchResp = await page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/records/${record.id}`) &&
          r.request().method() === 'PATCH',
        { timeout: 10_000 },
      );
      expect(patchResp.ok()).toBeTruthy();

      // VERIFY DB — the benign change persisted AND the client was NOT
      // rebound by the save (a save-time rebind regression fails here).
      await expect.poll(() => {
        const row = queryDBRow(
          `SELECT client_id, comment FROM records WHERE id='${record.id}'`,
        );
        return row && row.client_id === client.id && row.comment === comment;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 7: mask + threshold + WYSIWYG save (Task 7) ──────────────
  // GH #221: the WYSIWYG create path (unpicked save stores the visible
  // string) is covered by the save assertion below (Task 7 unskipped it).
  test('7. Mask as you type; silence below the threshold; save stores the visible string', async ({
    page,
    request,
  }) => {
    // Unique 10-digit national number (999xxx pattern → RU grouping
    // XXX XXX XX XX); uniqueness keeps DB cleanup surgical.
    const uid = `${Date.now()}`.slice(-7);
    const digits = `999${uid}`; // 10 digits
    const expectedDisplay = phoneMaskDisplay(digits, 'national');
    const clientName = `E2E Mask Client ${uid}`;

    const spy = await spyPhoneListRequests(page);

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
    await typePhoneQuery(page, digits.slice(3));

    // Mask display: progressive RU grouping of the typed digits.
    await expect(phoneInput).toHaveValue(expectedDisplay);

    // Exactly one typeahead request fired in total (zero below threshold).
    expect(spy.count()).toBe(1);

    // ── ACTION 3: save unpicked → the visible string IS the stored phone ──
    await page.locator('[data-testid="input-client-name"]').fill(clientName);
    await page.locator('[data-testid="btn-create-record"]').click();
    await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => {
      const row = queryDBRow(`SELECT id, phone FROM clients WHERE name = '${clientName}'`);
      return row !== null && row.phone === expectedDisplay;
    }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

    const created = queryDBRow(`SELECT id FROM clients WHERE name = '${clientName}'`);
    if (created) await cleanup(request, `/api/v1/clients/${created.id}`);
  });

  // ── Task 6 nit: no onBlur exact-fetch on the phone field (REMOVED) ────
  test('blur on the phone field never calls the exact-route lookup', async ({
    page,
    request,
  }) => {
    const spy = await spyPhoneListRequests(page);
    const routeSpy = { called: false };
    await page.route('**/api/v1/clients/get**', (route) => {
      routeSpy.called = true;
      return route.continue();
    });

    await openAddTab(page);
    await page
      .locator('[data-testid="input-phone"]')
      .pressSequentially('+79991234567');
    await page.locator('[data-testid="input-phone"]').blur();

    // Give any hypothetical handler a beat, then assert silence.
    await page.waitForTimeout(600);
    expect(routeSpy.called).toBe(false);
    // The only /clients calls with phone= would be typeahead (debounced,
    // 10 digits → fires at most once) — the exact route has no phone= param.
    expect(spy.count()).toBeLessThanOrEqual(1);
    void request;
  });
});
