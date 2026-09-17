import { test, expect } from './fixtures/test';
import {
  waitForScheduleReady,
  openAddTab,
  getFirstActivity,
  phoneMaskDisplay,
} from './fixtures/helpers';
import { createTestClient, createTestVisitor, cleanup, cleanupRecord } from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';
import {
  openRecordTab,
  setupAnonymousRecord,
  fetchRecord,
  moneyPattern,
  type IdRef,
} from './helpers/anonymous-visits';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * E2E for feature #257 «Единая модель посетителей» — anonymous visits.
 *
 * Anonymous seats are REAL visits (visitor_id = null): a booking's unfilled
 * tail saves as anonymous rows (US1/US2), an «Аноним» row converts inline
 * even at full capacity (US3), its money is editable and recalculates the
 * summary (US4), deleting it runs the 5s undo window and frees the seat on
 * commit (US5), and anonymous visits fully participate in the record status
 * rule + the cancel cascade (US6).
 *
 * Scenarios: docs/specs/2026-09-16-anonymous-visits-unified-design.md
 * § User Scenarios (US1–US6).
 */
test.describe('Anonymous visits — unified visitors model (#257)', () => {
  // ── US1/US2: booking with a named visitor + «Мест» = 2 → the tail is ─────
  // saved as 2 anonymous visits with the service's default tariff.
  test('US1/US2: booking tail of unfilled seats is saved as anonymous visits with the default tariff', async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // 10 national digits — the AsYouType mask shapes what is stored (WYSIWYG).
    const nationalDigits = `999${String(Date.now()).slice(-7)}`;
    const testPhone = `+7${nationalDigits}`;
    const clientName = `E2E Клиент ${uid}`;
    const visitorName = `E2E Гость ${uid}`;

    // `any` per activity-details-modal.spec.ts precedent — the DB-poll
    // closures assign these, and TS narrowing of a null-initialized union
    // would make the finally-block access a `never`.
    let clientRow: any = null;
    let recordId = '';

    try {
      // 1. SETUP/ACTION — open the quick-add booking form.
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openAddTab(page);
      // The modal opened on the first card of the record's week — its DTO
      // carries the service id for the default-tariff check below.
      const activityDto = (await getFirstActivity(page)) as { id: string; serviceId: string };

      await page.locator('[data-testid="input-phone"]').fill(testPhone);
      await page.locator('[data-testid="input-phone"]').blur();
      await page.locator('[data-testid="input-client-name"]').fill(clientName);

      // 1 named visitor + «Мест» = 2 → 1 named visit + 2-seat anonymous tail.
      await page
        .locator('[data-testid="new-record-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      const visitorRow = page.locator('[data-testid="visitor-form-row"]').first();
      await visitorRow.locator('input').first().fill(visitorName);
      await page.locator('[data-testid="input-seats"]').fill('2');

      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // 2. Locate the created client + record (DB polls — masked phone, WYSIWYG).
      const expectedStoredPhone = phoneMaskDisplay(nationalDigits, 'international');
      await expect.poll(async () => {
        clientRow = queryDBRow(
          `SELECT id FROM clients WHERE phone='${expectedStoredPhone}' AND is_active=1`,
        );
        return clientRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      await expect.poll(async () => {
        const row = queryDBRow(
          `SELECT id FROM records WHERE client_id='${String(clientRow!.id)}'`,
        );
        recordId = row ? String(row.id) : '';
        return recordId !== '';
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

      // 3. VERIFY UI — the record card: 3 visit rows, tail rows «Аноним».
      await expect(
        page.locator(`[data-testid="tab-client-${recordId}"]`),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator(`[data-testid="tab-client-${recordId}"]`).click();
      await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({
        timeout: 10_000,
      });

      // Rows only — the row's × button shares the `visit-row-` prefix
      // (`visit-row-{id}-delete`), so exclude `-delete` suffixes too.
      const savedRows = page.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"]):not([data-testid$="-delete"])',
      );
      await expect(savedRows).toHaveCount(3, { timeout: 10_000 });

      // Name cells = the row's non-number inputs (name text, price is number).
      const nameInputs = savedRows.locator('input:not([type="number"])');
      await expect(nameInputs).toHaveCount(3);
      // The named cell renders '' until qk.visitors(clientId) resolves
      // (RecordVisitsTable renders visitor?.name ?? '') — wait for the
      // RESOLVED state with a poll: `inputValue()` is an immediate read.
      // Expected settled state: exactly 2 empty cells + the typed name present.
      await expect
        .poll(
          async () => {
            const values: string[] = [];
            for (let i = 0; i < 3; i++) {
              values.push(await nameInputs.nth(i).inputValue());
            }
            return `${values.filter((v) => v === '').length}:${values.includes(visitorName)}`;
          },
          { timeout: 10_000, intervals: [200, 500, 1000] },
        )
        .toBe('2:true');

      // Header seats: «Мест: 3» (all visits, anonymous included — #257 D3).
      await expect(page.locator('[data-testid="record-summary"]')).toContainText(
        'Мест: 3',
      );

      // 4. VERIFY API — the tail visits are anonymous with the default tariff.
      const serviceResp = await request.get(`${BACKEND}/api/v1/services/${activityDto.serviceId}`);
      expect(serviceResp.ok()).toBeTruthy();
      const service = (await serviceResp.json()) as {
        tariffs: Array<{ id: string; price: number }>;
      };
      const defaultTariff = service.tariffs[0];

      const recordJson = await fetchRecord(request, recordId);
      expect(recordJson.visits).toHaveLength(3);
      const anonymousVisits = recordJson.visits.filter((v) => v.visitor_id == null);
      const namedVisits = recordJson.visits.filter((v) => v.visitor_id != null);
      expect(anonymousVisits).toHaveLength(2);
      expect(namedVisits).toHaveLength(1);
      for (const visit of anonymousVisits) {
        expect(visit.tariff_id).toBe(defaultTariff.id);
        expect(visit.price).toBe(defaultTariff.price);
      }
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      if (clientRow?.id) await cleanup(request, `/api/v1/clients/${String(clientRow.id)}`);
    }
  });

  // ── US2: EXISTING client — pick the saved client via the phone typeahead, ─
  // enter their saved visitor's name in a row + «Мест» = 1 tail → anonymous.
  test('US2: existing client — saved visitor entered in a row + 1-seat tail saved as anonymous', async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // Unique phone — the typeahead searches by national-digit suffix.
    const testPhone = `+7999${String(Date.now()).slice(-7)}`;
    const client = (await createTestClient(request, {
      name: `US2 Клиент ${uid}`,
      phone: testPhone,
    })) as IdRef;
    const savedVisitor = (await createTestVisitor(request, client.id, {
      name: `US2 Постоянный ${uid}`,
    })) as { id: string; name: string };
    let recordId = '';

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openAddTab(page);

      // Pick the SAVED client (bind-by-id, GH #221): type the phone, the
      // typeahead suggests «Имя · телефон», click it → name freezes read-only.
      await page.locator('[data-testid="input-phone"]').fill(testPhone);
      const suggestion = page
        .getByRole('option')
        .filter({ hasText: `US2 Клиент ${uid}` });
      await expect(suggestion).toBeVisible({ timeout: 10_000 });
      await suggestion.click();
      await expect(page.locator('[data-testid="input-client-name"]')).toHaveValue(
        `US2 Клиент ${uid}`,
      );

      // One named row with the saved visitor's name + «Мест» = 1 → the tail
      // (1 unfilled seat) must be saved as an anonymous visit.
      await page
        .locator('[data-testid="new-record-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      const visitorRow = page.locator('[data-testid="visitor-form-row"]').first();
      await visitorRow.locator('input').first().fill(savedVisitor.name);
      await page.locator('[data-testid="input-seats"]').fill('1');

      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // Locate the record for the (pre-existing) client via DB poll.
      await expect.poll(async () => {
        const row = queryDBRow(
          `SELECT id FROM records WHERE client_id='${client.id}'`,
        );
        recordId = row ? String(row.id) : '';
        return recordId !== '';
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);

      // VERIFY UI — the record card: 2 rows — the saved visitor's named row
      // and one «Аноним» tail row.
      const tab = page.locator(`[data-testid="tab-client-${recordId}"]`);
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await tab.click();
      await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({
        timeout: 10_000,
      });

      const savedRows = page.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"]):not([data-testid$="-delete"])',
      );
      await expect(savedRows).toHaveCount(2, { timeout: 10_000 });
      const nameInputs = savedRows.locator('input:not([type="number"])');
      await expect(nameInputs).toHaveCount(2);
      // The named cell renders '' until qk.visitors(clientId) resolves
      // (RecordVisitsTable renders visitor?.name ?? '') — wait for the
      // RESOLVED state with a poll: `inputValue()` is an immediate read.
      // Expected settled state: 1 empty cell + the saved visitor's name.
      await expect
        .poll(
          async () => {
            const values: string[] = [];
            for (let i = 0; i < 2; i++) {
              values.push(await nameInputs.nth(i).inputValue());
            }
            return `${values.filter((v) => v === '').length}:${values.includes(savedVisitor.name)}`;
          },
          { timeout: 10_000, intervals: [200, 500, 1000] },
        )
        .toBe('1:true');
      // The anonymous tail row (empty name cell) shows the «Аноним» placeholder.
      for (let i = 0; i < 2; i++) {
        const input = nameInputs.nth(i);
        if ((await input.inputValue()) === '') {
          await expect(input).toHaveAttribute('placeholder', 'Аноним');
        }
      }

      // Header seats: «Мест: 2» (named + anonymous tail).
      await expect(page.locator('[data-testid="record-summary"]')).toContainText(
        'Мест: 2',
      );

      // VERIFY API — 1 named visit (bound to a visitor with the saved
      // visitor's name) + 1 anonymous visit (visitor_id = null).
      const recordJson = await fetchRecord(request, recordId);
      expect(recordJson.visits).toHaveLength(2);
      const namedVisits = recordJson.visits.filter((v) => v.visitor_id != null);
      const anonymousVisits = recordJson.visits.filter((v) => v.visitor_id == null);
      expect(namedVisits).toHaveLength(1);
      expect(anonymousVisits).toHaveLength(1);
      const visitorResp = await request.get(
        `${BACKEND}/api/v1/visitors/${namedVisits[0].visitor_id}`,
      );
      expect(visitorResp.ok()).toBeTruthy();
      expect(((await visitorResp.json()) as { name: string }).name).toBe(
        savedVisitor.name,
      );
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US3: conversion on a FULL activity — type a name into «Аноним» ────────
  test('US3: typing a name into an «Аноним» row converts it inline at full capacity', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { capacity: 1 });
    const { record, activity, visitId, cleanupAll } = setup;
    const name = `Конверт ${Date.now()}`;

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openRecordTab(page, record.id);

      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Anonymous state: empty name cell with the «Аноним» placeholder.
      const nameInput = row.locator('input:not([type="number"])').first();
      await expect(nameInput).toHaveValue('');
      await expect(nameInput).toHaveAttribute('placeholder', 'Аноним');

      // ACTION — type the name and commit (Enter) → one point PATCH
      // /visits/{id} {visitor_id}: no visits-array rewrite → no 409 (D7).
      await nameInput.fill(name);
      await nameInput.press('Enter');

      // VERIFY API — the visit is bound to a real visitor.
      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        return body.visits[0]?.visitor_id ?? null;
      }, { timeout: 15_000 }).not.toBeNull();

      // VERIFY UI — the row renders the name (visitors resolved from cache).
      await expect(nameInput).toHaveValue(name, { timeout: 10_000 });

      // Seats unchanged: «Мест: 1»; the capacity-1 activity keeps its 1 seat.
      const summary = page.locator('[data-testid="record-summary"]');
      await expect(summary).toContainText('Мест: 1');
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${activity.id}`);
      expect((await actResp.json()).occupied).toBe(1);

      // D7 error path never fired (no error toast on the happy conversion).
      await expect(page.locator('[data-testid="toast-error"]')).toHaveCount(0);

      // Age lives on the visitor: pick 8 → patchVisitor.
      await row.locator(`[data-testid="visit-${visitId}-age"]`).selectOption('8');
      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        const visitorId = body.visits[0].visitor_id;
        if (!visitorId) return null;
        const vResp = await request.get(`${BACKEND}/api/v1/visitors/${visitorId}`);
        return ((await vResp.json()) as { age: number | null }).age ?? null;
      }, { timeout: 15_000 }).toBe(8);

      // Conversion is not a participation change — the record stays «Ждём».
      const recordAfter = await fetchRecord(request, record.id);
      expect(recordAfter.status).toBe('waiting');
    } finally {
      await cleanupAll();
    }
  });

  // ── US4: anonymous-row money — tariff/price edits recalculate the summary ─
  test('US4: changing an anonymous row tariff/price recalculates Стоимость and К оплате', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { price: 1000 });
    const { record, activity, visitId, cleanupAll } = setup;

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openRecordTab(page, record.id);

      const summary = page.locator('[data-testid="record-summary"]');
      // Baseline: 1 anonymous visit at 1000 ₽, no payments → «К оплате» = 1000.
      await expect(summary).toContainText(moneyPattern(1000));
      await expect(summary).toContainText(new RegExp(`К оплате:\\s*${moneyPattern(1000).source}`));

      // ACTION (price): the row's price cell is the number input in the row.
      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      const priceInput = row.locator('input[type="number"]');
      await expect(priceInput).toHaveValue('1000');
      await priceInput.fill('1500');
      await priceInput.press('Enter');

      // VERIFY API — the visit price changed.
      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        return body.visits[0].price;
      }, { timeout: 15_000 }).toBe(1500);

      // VERIFY UI — «Стоимость» and «К оплате» recalculated.
      await expect(summary).toContainText(moneyPattern(1500));
      await expect(summary).toContainText(new RegExp(`К оплате:\\s*${moneyPattern(1500).source}`));

      // ACTION (tariff): pick the service's first tariff → price follows it.
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${activity.id}`);
      const act = (await actResp.json()) as { service_id: string };
      const svcResp = await request.get(`${BACKEND}/api/v1/services/${act.service_id}`);
      const service = (await svcResp.json()) as { tariffs: Array<{ id: string; price: number }> };
      const firstTariff = service.tariffs[0];

      await row.locator(`[data-testid="visit-${visitId}-tariff"]`).selectOption(firstTariff.id);

      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        return body.visits[0].tariff_id === firstTariff.id && body.visits[0].price;
      }, { timeout: 15_000 }).toBe(firstTariff.price);

      await expect(summary).toContainText(moneyPattern(firstTariff.price));
      await expect(summary).toContainText(
        new RegExp(`К оплате:\\s*${moneyPattern(firstTariff.price).source}`),
      );
    } finally {
      await cleanupAll();
    }
  });

  // ── US5: delete an anonymous row — optimistic remove, undo window, commit ─
  test('US5: deleting an anonymous row — undo restores it, auto-commit frees the seat', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { capacity: 1 });
    const { record, activity, visitId, cleanupAll } = setup;
    // A second client to claim the freed seat after the commit.
    const extraClient = (await createTestClient(request)) as IdRef;
    let extraRecordId = '';

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openRecordTab(page, record.id);

      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const summary = page.locator('[data-testid="record-summary"]');
      await expect(summary).toContainText('Мест: 1');

      // (а) Optimistic delete + undo inside the toast window.
      await row.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();
      await expect(row).not.toBeVisible({ timeout: 5_000 });
      await expect(summary).toContainText('Мест: 0');

      const toast = page.locator('[data-testid="toast-info"]');
      await expect(toast).toContainText('Удалено. Отменить');
      await toast.locator('button:has-text("Отменить")').click();

      await expect(row).toBeVisible({ timeout: 5_000 });
      await expect(summary).toContainText('Мест: 1');
      // The server never lost the visit (undo = cache rollback, no API call).
      const recordAfterUndo = await fetchRecord(request, record.id);
      expect(recordAfterUndo.visits.some((v) => v.id === visitId)).toBe(true);

      // (б) No cancel → auto-commit after the 5s window (GH #261 pattern:
      // wait for the real DELETE request, never a fixed sleep).
      const deleteCommitted = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/visits/${visitId}`) &&
          resp.request().method() === 'DELETE',
        { timeout: 15_000 },
      );
      await row.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();
      const commitResp = await deleteCommitted;
      expect([200, 204]).toContain(commitResp.status());
      // The undo window is over — the toast is gone.
      await expect(toast).toBeHidden({ timeout: 10_000 });

      // Fresh data: after a reload the row stays deleted («Мест: 0»).
      await page.reload();
      await waitForScheduleReady(page);
      await openRecordTab(page, record.id);
      await expect(page.locator(`[data-testid="visit-row-${visitId}"]`)).toHaveCount(0);
      await expect(page.locator('[data-testid="record-summary"]')).toContainText('Мест: 0');
      const recordAfterCommit = await fetchRecord(request, record.id);
      expect(recordAfterCommit.visits).toHaveLength(0);

      // The freed seat accepts a new record on the same capacity-1 activity.
      const createResp = await request.post(`${BACKEND}/api/v1/records`, {
        data: {
          activity_id: activity.id,
          client_id: extraClient.id,
          visits: [{ price: 3500 }],
        },
      });
      expect(createResp.status()).toBe(201);
      const created = (await createResp.json()) as { id: string };
      extraRecordId = created.id;
    } finally {
      await cleanupAll();
      if (extraRecordId) await cleanupRecord(request, extraRecordId);
      await cleanup(request, `/api/v1/clients/${extraClient.id}`);
    }
  });

  // ── US6: anonymous visit participates in the status rule; record cancel ───
  test('US6: anonymous «пришёл» → record «Пришли»; record cancel cascades and frees the seat', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { capacity: 2 });
    const { record, activity, visitId, cleanupAll } = setup;

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openRecordTab(page, record.id);

      // ACTION — mark the anonymous visit «Посетил» via its row status picker.
      const rowPicker = page.locator(`[data-testid="visit-${visitId}-status"]`);
      await rowPicker.locator(`[data-testid="visit-${visitId}-status-trigger"]`).click();
      await rowPicker
        .locator(`[data-testid="visit-${visitId}-status-option-visited"]`)
        .click();

      // VERIFY API — the record derived «Пришли» (D4: anonymous visits count).
      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        return body.status;
      }, { timeout: 15_000 }).toBe('visited');

      // The RecordSummary picker shows the derived status.
      const recordPicker = page.locator('[data-testid="record-status"]');
      await recordPicker.locator('[data-testid="record-status-trigger"]').click();
      await expect(
        recordPicker.locator('[data-testid="record-status-option-visited"]'),
      ).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');

      // ACTION — set the record status «Отменили» (RecordSummary picker):
      // the coarse patch rewrites ALL visits (anonymous included) — D4 cascade.
      await recordPicker.locator('[data-testid="record-status-trigger"]').click();
      await recordPicker.locator('[data-testid="record-status-option-cancelled"]').click();

      await expect.poll(async () => {
        const body = await fetchRecord(request, record.id);
        return (
          body.status === 'cancelled' &&
          body.visits.length > 0 &&
          body.visits.every((v) => v.status === 'cancelled')
        );
      }, { timeout: 15_000 }).toBe(true);

      // Rows are not deleted — they are dimmed/cancelled: the summary picker
      // shows «Отменён» and the row is still listed.
      await recordPicker.locator('[data-testid="record-status-trigger"]').click();
      await expect(
        recordPicker.locator('[data-testid="record-status-option-cancelled"]'),
      ).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      // Rows only — exclude the row's × button (`visit-row-{id}-delete`).
      const savedRows = page.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"]):not([data-testid$="-delete"])',
      );
      await expect(savedRows).toHaveCount(1);

      // The cancelled record no longer occupies a seat on the activity.
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${activity.id}`);
      expect((await actResp.json()).occupied).toBe(0);
    } finally {
      await cleanupAll();
    }
  });
});
