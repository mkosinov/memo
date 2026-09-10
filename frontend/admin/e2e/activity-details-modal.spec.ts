import { test, expect } from './fixtures/test';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { createTestClient, createTestActivity, createTestRecord, createTestPayment, cleanup, cleanupRecord } from './fixtures/factories';
import { waitForScheduleReady, openModal, openAddTab, getFirstActivity, confirmDeleteDialog, phoneMaskDisplay } from './fixtures/helpers';
import { searchAndSelect } from './helpers/combobox';

/**
 * E2E tests for ActivityDetailsModal — full user scenarios with DB verification.
 *
 * Each test follows the Full Cycle pattern:
 *   1. SETUP:     Create test data via API (factories)
 *   2. ACTION:    User interaction in browser (click, type, navigate)
 *   3. VERIFY UI: What the user SEES (toHaveText, toHaveValue)
 *   4. VERIFY DB: What's STORED in backend (SQL via queryDB/queryDBRow)
 *   5. CLEANUP:   Delete test data via API (cleanup helper)
 *
 * Requires: dev server on :3001, backend on :8000
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
// Tests — Full User Scenarios with DB Verification
// ---------------------------------------------------------------------------

test.describe('ActivityDetailsModal — Real User Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 1: Create record — verify DB persistence ─────────────────

  test('1. Create new record — data persists in DB (records, clients, visits)', async ({ page, request }) => {
    // Use unique suffix based on timestamp + random to avoid collisions in parallel runs
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // Phone: 10 DIGITS only — the AsYouType mask strips letters, so the
    // stored value derives from the digits the field ends up holding.
    const nationalDigits = `999${String(Date.now()).slice(-7)}`;
    const testPhone = `+7${nationalDigits}`;
    // GH #221 WYSIWYG: the form saves the VISIBLE AsYouType-formatted
    // string, not the raw typed text — expect the masked form in the DB.
    const expectedStoredPhone = phoneMaskDisplay(nationalDigits, 'international');
    const testClientName = `E2E Client ${uid}`;
    const testVisitorName = `E2E Visitor ${uid}`;

    // Declare cleanup targets outside try so finally can access them
    let recordRow: any = null;
    let clientRow: any = null;

    try {
      // 1. ACTION — open add tab and fill form
      await openAddTab(page);

      await page.locator('[data-testid="input-phone"]').fill(testPhone);
      await page.locator('[data-testid="input-phone"]').blur();

      await page.locator('[data-testid="input-client-name"]').fill(testClientName);

      // Add visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      const visitorRow = page.locator('[data-testid="visitor-form-row"]').first();
      await visitorRow.locator('input').first().fill(testVisitorName);

      // Verify channel select is visible
      await expect(page.locator('[data-testid="select-channel"]')).toBeVisible();

      // Submit
      await page.locator('[data-testid="btn-create-record"]').click();

      // 2. VERIFY UI — success toast "Запись создана" appears (not just any toast)
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // 3. VERIFY DB — client was created (retry until DB commit lands).
      //    GH #221: the stored phone is the masked visible string (WYSIWYG).
      await expect.poll(async () => {
        clientRow = queryDBRow(`SELECT * FROM clients WHERE phone='${expectedStoredPhone}' AND is_active=1`);
        return clientRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(clientRow!.name).toBe(testClientName);
      expect(clientRow!.channel).toBeTruthy();

      // 4. VERIFY DB — record was created for this client
      await expect.poll(async () => {
        recordRow = queryDBRow(
          `SELECT * FROM records WHERE client_id='${clientRow!.id}'`,
        );
        return recordRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(recordRow!.status).toBeTruthy();

      // 5. VERIFY DB — visit was created for this record
      await expect.poll(async () => {
        const visits = queryDBRows(
          `SELECT * FROM visits WHERE record_id='${recordRow!.id}'`,
        );
        return visits.length > 0;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
    } finally {
      // CLEANUP — always runs, even if test fails
      if (recordRow?.id) await cleanupRecord(request, recordRow.id);
      if (clientRow?.id) await cleanup(request, `/api/v1/clients/${clientRow.id}`);
    }
  });

  // ── Scenario 2: Delete record via DeleteDialog — verify DB hard-delete ──
  // Addendum 13 (T8-FE2a): the legacy 5s undo toast is gone. Click
  // «Удалить запись» → dry-run 409 (record has visits + payments) →
  // DeleteDialog lists the deps → type-to-confirm + resolve → record and
  // its cascade are hard-deleted.

  test('2. Delete record — dialog confirm removes it (row gone from DB)', async ({
    page,
    request,
  }) => {
    // 1. SETUP — create record with a visit AND a payment (both dialog deps)
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);
    await createTestPayment(request, record.id);

    try {
      // Verify it exists before delete
      const beforeRow = queryDBRow(
        `SELECT id FROM records WHERE id='${record.id}'`,
      );
      expect(beforeRow).not.toBeNull();

      // Reload to pick up new data
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION — open modal, navigate to client tab, click delete
      await openModal(page, { recordId: record.id });

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      await expect(clientTab).toBeVisible({ timeout: 15_000 });
      await clientTab.click();
      await page.locator('[data-testid="btn-delete-record"]').click();

      // 3. VERIFY UI — DeleteDialog opens listing visits + payments
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="dep-visits"]')).toContainText('Посещения: 1 (удалён)');
      await expect(page.locator('[data-testid="dep-payments"]')).toContainText('Платежи: 1 (удалён)');

      // Confirm is gated on the single "Подтверждаю удаление зависимостей" checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();
      await confirmDeleteDialog(page);

      // Success toast + dialog closes (text= locator — scenario 1 style:
      // the generic [role="status"] also matches dnd-kit's empty live region).
      await expect(page.locator('text=Запись удалена')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // 4. VERIFY DB — row gone; cascade rows (visits/payments) gone too
      await expect.poll(async () => {
        const afterRow = queryDBRow(
          `SELECT id FROM records WHERE id='${record.id}'`,
        );
        return afterRow === null;
      }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true);
      expect(queryDBRows(`SELECT * FROM visits WHERE record_id='${record.id}'`)).toHaveLength(0);
      expect(queryDBRows(`SELECT * FROM payments WHERE record_id='${record.id}'`)).toHaveLength(0);
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 3: Add payment — verify DB persistence ────────────────────

  test('3. Add payment — payment row exists in DB with correct amount', async ({
    page,
    request,
  }) => {
    // 1. SETUP — create record via API
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // Verify no payments initially
      const beforePayments = queryDBRows(
        `SELECT * FROM payments WHERE record_id='${record.id}'`,
      );
      expect(beforePayments.length).toBe(0);

      // Reload to pick up new data
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION — open modal, go to client tab, add payment
      await openModal(page);

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      if (await clientTab.isVisible()) {
        await clientTab.click();

        // Read footer before
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // Add payment — click "Добавить" to reveal inline row, fill amount & commit via Enter
        await page.locator('[data-testid="btn-add-payment"]').click();
        const amountInput = page.locator('[data-testid="add-payment-amount"]');
        await expect(amountInput).toBeVisible();
        await amountInput.fill('1500');
        await amountInput.press('Enter');
        // Wait for save (new-row input disappears after commit)
        await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

        // Wait for UI update
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // 3. VERIFY UI — footer is still visible (summary updated)
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // 4. VERIFY DB — payment row exists with amount=1500 (retry until commit lands)
        await expect.poll(async () => {
          const payments = queryDBRows(
            `SELECT * FROM payments WHERE record_id='${record.id}'`,
          );
          return payments.length > 0 && payments[0].amount === 1500;
        }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      }
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 4: Settings update — verify DB service_id change ──────────

  test('4. Settings update — service_id changes in DB', async ({ page, request }) => {
    // 1. ACTION — open modal on Settings tab
    const activity = await openModal(page);

    // Read initial service from DB via the activity that has the modal open
    const beforeRow = queryDBRow(
      `SELECT service_id FROM activities WHERE id='${(activity as any).id}'`,
    );
    expect(beforeRow).not.toBeNull();
    const originalServiceId = beforeRow!.service_id;

    // Get a different service to switch to
    const servicesResp = await request.get(`${BACKEND}/api/v1/services`);
    const servicesJson = await servicesResp.json();
    // #182: services list is paginated ({items,total,page,per_page}) — unwrap envelope
    const services: any[] = servicesJson.items || servicesJson;
    const differentService = services.find(
      (s: any) => s.id !== originalServiceId,
    );

    if (differentService) {
      // 2. ACTION — change service via the Combobox inside the select-service
      // wrapper (onChange triggers auto-save via onUpdate). The Combobox search
      // filters by the full service title.
      const serviceTrigger = page.locator(
        '[data-testid="select-service"] [data-testid="combobox-trigger"]',
      );
      await expect(serviceTrigger).toBeVisible();
      await searchAndSelect(page, serviceTrigger, differentService.title, differentService.id);

      // 3. VERIFY DB — service_id was updated (retry until API commit lands)
      await expect.poll(async () => {
        const afterRow = queryDBRow(
          `SELECT service_id FROM activities WHERE id='${(activity as any).id}'`,
        );
        return afterRow?.service_id;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(differentService.id);

      // Restore original service — search by the original title
      const origSvc = services.find((s: any) => s.id === originalServiceId);
      await searchAndSelect(page, serviceTrigger, origSvc?.title ?? '', originalServiceId);
    }
  });

  // ── Scenario 5: Age display — verify no "++" ──────────────────────────

  test('5. Age display — correct format, no "++"', async ({ page }) => {
    // 1. ACTION — open modal
    await openModal(page);

    // 2. VERIFY UI — age display exists and has correct format
    const ageDisplay = page.locator('[data-testid="age-display"]');
    if (await ageDisplay.isVisible()) {
      const text = await ageDisplay.textContent();
      expect(text).toBeTruthy();

      // Must NOT contain "++"
      expect(text).not.toContain('++');

      // Must match either "N–M" or "N+" pattern
      const isValidRange = /^\d+[–+]\d+$/.test(text!);
      const isValidPlus = /^\d+\+$/.test(text!);
      expect(isValidRange || isValidPlus).toBeTruthy();
    }
  });

  // ── Scenario 6: Admin opens activity — sees correct settings ──────────

  test('6. Admin opens activity — sees correct settings', async ({ page }) => {
    await openModal(page);

    // Context header shows service name + date
    // The Modal renders context as a <span> sibling after the <h2> title (no testid)
    const context = page.locator('[data-testid="activity-details-modal-container"] h2 + span');
    await expect(context).toBeVisible();
    const contextText = await context.textContent();
    expect(contextText).toBeTruthy();

    // Settings tab is active by default
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

    // Date/time field has a value (not empty)
    const datetime = page.locator('[data-testid="input-datetime"]');
    await expect(datetime).not.toHaveValue('');

    // Duration field shows HH:MM format
    const duration = page.locator('[data-testid="input-duration"]');
    await expect(duration).toBeVisible();
    const durationValue = await duration.inputValue();
    expect(durationValue).toMatch(/^\d{2}:\d{2}$/);
  });

  // ── Scenario 7: Settings tab shows real values ────────────────────────

  test('7. Settings tab shows real values from activity', async ({ page }) => {
    await openModal(page);

    // Service Combobox trigger shows the selected service title (not empty)
    const serviceTrigger = page.locator(
      '[data-testid="select-service"] [data-testid="combobox-trigger"]',
    );
    await expect(serviceTrigger).toBeVisible();
    const serviceText = (await serviceTrigger.textContent())?.trim();
    expect(serviceText).toBeTruthy();
    expect(serviceText).not.toBe('Выберите');

    // Master picker (MasterPicker → Combobox trigger). Scoped to the
    // master-location row; the row renders master BEFORE location, and the
    // location trigger lives in the select-location wrapper — first() is the
    // master trigger.
    const masterPicker = page
      .locator('[data-testid="settings-row-master-location"] [data-testid="combobox-trigger"]')
      .first();
    const masterText = await masterPicker.textContent();
    // The trigger shows the selected master name (not placeholder "—")
    expect(masterText).toBeTruthy();
    expect(masterText).not.toBe('—');

    // Capacity shows a number > 0
    const capacity = page.locator('[data-testid="input-capacity"]');
    const capacityValue = await capacity.inputValue();
    expect(Number(capacityValue)).toBeGreaterThan(0);
  });

  // ── Scenario 8: Delete dialog cancel — record survives (Addendum 13) ───

  test('8. Delete record — dialog cancel preserves it in DB', async ({
    page,
    request,
  }) => {
    // 1. SETUP — the factory always creates a visit, so the seeded record
    // has dependencies and the dry-run returns 409 → dialog.
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION — open modal → client tab → «Удалить запись» → dialog
      await openModal(page, { recordId: record.id });

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      await expect(clientTab).toBeVisible({ timeout: 15_000 });
      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Verify client name is displayed in the tab content (GH #140 US-2:
      // name+phone render in the client-tab-header). Scoped to the header
      // testid — an unscoped getByText(name) strict-mode-collides with the
      // tab-strip label (ClientLabelById shows the same name).
      await expect(
        page.locator('[data-testid="client-tab-header"]'),
      ).toContainText(client.name, { timeout: 10_000 });

      await page.locator('[data-testid="btn-delete-record"]').click();

      // 3. VERIFY UI — DeleteDialog opens with the visit dependency listed
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="dep-visits"]')).toContainText('Посещения: 1 (удалён)');

      // Cancel — dialog closes, nothing deleted.
      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // 4. VERIFY DB — record (and its visit) still exist
      const row = queryDBRow(`SELECT id FROM records WHERE id='${record.id}'`);
      expect(row).not.toBeNull();
      const visits = queryDBRows(`SELECT * FROM visits WHERE record_id='${record.id}'`);
      expect(visits).toHaveLength(1);
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 9: Tab navigation — content changes ──────────────────────

  test('9. Tab navigation — each tab shows different content', async ({ page }) => {
    await openModal(page);

    // Settings tab is visible
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

    // Click "+" tab
    await page.locator('[data-testid="tab-add"]').click();
    await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-phone"]')).toBeVisible();

    // Click back to settings
    await page.locator('[data-testid="tab-settings"]').click();
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();
  });

  // ── Scenario 10: Validation — cannot submit without name ──────────────

  test('10. Can create record without name (name is optional)', async ({ page }) => {
    await openAddTab(page);

    // Leave name empty
    await page.locator('[data-testid="input-client-name"]').fill('');

    // Submit
    await page.locator('[data-testid="btn-create-record"]').click();

    // Should succeed — name is optional, verify success toast appears
    // The toast role="status" shows "Запись создана"
    await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 5000 });
  });

  // ── Scenario 11: Channel select always visible ────────────────────────

  test('11. Channel select visible without checkbox', async ({ page }) => {
    await openAddTab(page);

    // Channel select should be visible
    await expect(page.locator('[data-testid="select-channel"]')).toBeVisible();

    // Checkbox should be unchecked by default
    const checkbox = page.locator('[data-testid="checkbox-notifications"]');
    await expect(checkbox).not.toBeChecked();
  });

  // ── Scenario 12: Private toggle works ─────────────────────────────────

  test('12. Private toggle changes state', async ({ page }) => {
    await openModal(page);

    const toggle = page.locator('[data-testid="toggle-private"]');
    await expect(toggle).toBeVisible();

    const initialState = await toggle.getAttribute('aria-checked');
    await toggle.click();
    const newState = await toggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);
  });

  // ── Scenario 13: Duration displays as HH:MM ──────────────────────────

  test('13. Duration displays as HH:MM, not decimal', async ({ page }) => {
    await openModal(page);

    const duration = page.locator('[data-testid="input-duration"]');
    const value = await duration.inputValue();
    expect(value).toMatch(/^\d{2}:\d{2}$/);
    expect(value).not.toContain('.');
  });

  // ── Scenario 14 (GH #140 US-2): a record's client beyond the first 20 of
  //    the clients list still resolves to name+phone on the tab. Pre-refactor
  //    the modal looked clients up in a paged map (first 20 active only) →
  //    beyond-page-1 clients rendered «Без контакта». Now every tab mounts its
  //    own useClient(record.client_id) point observer, so the client resolves
  //    regardless of list position. Asserted in BOTH the tab-strip label
  //    (ClientLabelById) and the client-tab-header (ClientTab) — two elements
  //    legitimately carry the name, so each is scoped by its testid.

  test('14. US-2: record tab resolves a client beyond the first 20 (name+phone on tab strip + header)', async ({
    page,
    request,
  }) => {
    const ts = Date.now();
    const seeded: Awaited<ReturnType<typeof createTestClient>>[] = [];
    let activity: any = null;
    let record: any = null;
    let target: any = null;

    try {
      // Seed 22 active clients. Latin "us2-client-NN" sorts BEFORE the
      // Cyrillic seed names (c1-c5) under SQLite BINARY collation, so the 22nd
      // (the target) has ≥21 predecessors → list position ≥22 under the
      // default name/asc sort, i.e. beyond page 1 (per_page=20).
      for (let i = 1; i <= 22; i++) {
        const n = String(i).padStart(2, '0');
        const c = await createTestClient(request, {
          name: `us2-client-${n}`,
          phone: `+7900${String(ts).slice(-6)}${n}`,
        });
        seeded.push(c);
        if (i === 22) target = c;
      }

      // Premise self-check: the target must NOT be on unfiltered page 1 —
      // otherwise this test silently degrades to the page-1 path.
      const resp = await request.get(
        `${BACKEND}/api/v1/clients?sort_by=name&sort_order=asc&per_page=20`,
      );
      expect(resp.ok()).toBeTruthy();
      const page1 = await resp.json();
      expect(page1.items.some((c: { id: string }) => c.id === target.id)).toBe(false);

      // One activity + one record whose client is the LAST seeded one.
      activity = await createTestActivity(request);
      record = await createTestRecord(request, activity.id, target.id);

      // Reload /schedule so the freshly created activity is fetched into the
      // current week (beforeEach already primed a now-stale activityRange
      // cache). Mirrors scenarios 2/3/8.
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

      // Open that activity's modal, scoped to the record (navigates to the
      // record's week + selects the activity card by id).
      await openModal(page, { recordId: record.id });

      // Tab-strip label resolves name+phone (NOT «Без контакта»).
      const tabLabel = page.locator(`[data-testid="tab-client-${record.id}"]`);
      await expect(tabLabel).toBeVisible({ timeout: 15_000 });
      await expect(tabLabel).toContainText(target.name);
      await expect(tabLabel).toContainText(target.phone);
      await expect(tabLabel).not.toContainText('Без контакта');

      // Select the record tab, then assert the client-tab-header content.
      await tabLabel.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();
      const header = page.locator('[data-testid="client-tab-header"]');
      await expect(header).toContainText(target.name, { timeout: 10_000 });
      await expect(header).toContainText(target.phone);
      await expect(header).not.toContainText('Без контакта');
    } finally {
      if (record) await cleanupRecord(request, record.id);
      if (activity) await cleanup(request, `/api/v1/activities/${activity.id}`);
      for (const c of seeded) {
        await cleanup(request, `/api/v1/clients/${c.id}`);
      }
    }
  });
});
