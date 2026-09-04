import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { waitForRecordsReady, openModal } from './fixtures/helpers';
import { closeCombobox, openCombobox, searchAndSelect } from './helpers/combobox';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestRecordWithClient,
  createTestMaster,
  createTestService,
  createTestLocation,
  createTestPayment,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDB } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * GH #213 — composite read endpoint GET /api/v1/records/view (US-1..US-6).
 *
 * Spec: docs/specs/2026-09-02-records-view-endpoint-design.md §8.
 *
 * The records table renders denormalized display fields from ONE request
 * (records + client_name/activity_start/service_title/master_name/
 * location_name/master_color/is_private/paid). The six display lookup maps
 * (activities/clients/payments + dict fetches) are gone — so display
 * correctness no longer depends on fetch caps or archive-biased lists:
 *   US-1 — a client beyond the old 100-row cap shows its real name;
 *   US-2 — page load issues exactly ONE /records/view and ZERO legacy
 *          lookup fetches; the three dict /all selection queries (owned by
 *          BookingFilters) are the only other records-page requests and the
 *          dropdowns still populate and filter;
 *   US-3 — archived client/master resolve real names + the master's OWN dot
 *          color; an FK-dangling service renders «—»;
 *   US-4 — payment column filled from the view row; adding a payment to the
 *          record updates the row badge WITHOUT a reload (Task-12 `['records']`
 *          invalidation) and the state survives client-side re-navigation;
 *   US-5 — every filter + `?q=` returns IDENTICAL results on /records/view
 *          and /records (same RecordListParams → same ids and totals);
 *   US-6 — every sort_by column × asc/desc yields the SAME row order on both
 *          endpoints (shared _sort_columns whitelist) and the table sort
 *          indicators behave unchanged.
 *
 * Server-driven rework (#191) conventions apply: response-wait predicates
 * are registered BEFORE the UI action; no waitForTimeout for server sync.
 */

/** Convert a #RRGGBB hex color to the computed-style rgb() form. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Narrow the records table to exactly one row via the «Поиск» box (server
 * ?q= on client name — GH #212). Deterministic row targeting regardless of
 * page placement or parallel-worker rows. Returns the single row locator.
 */
async function narrowToClient(page: Page, clientName: string) {
  const searchWait = page.waitForResponse(
    (r) => r.url().includes('/api/v1/records/view') && r.url().includes('q='),
    { timeout: 15_000 },
  );
  await page.locator('input[aria-label="Поиск по клиенту или услуге"]').fill(clientName);
  await searchWait;
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  return rows.first();
}

test.describe('Records View Endpoint — GH #213 US-1..US-6', () => {
  // ── US-1: beyond-cap client ────────────────────────────────────────────────

  test('US-1: record for client beyond the old 100-cap shows the real name', async ({
    page,
    request,
  }) => {
    // Seed 100 filler clients + 1 target. Filler names are ASCII («US1F …»),
    // which sort BEFORE every Cyrillic name in SQLite's binary collation, so
    // the Cyrillic-named target lands at position ≥101 of the server's
    // default name-asc order — exactly the region the old
    // /clients?per_page=100 display map silently dropped.
    const ts = Date.now();
    const targetName = `ЮС1 Целевой ${ts}`;
    const fillerIds: string[] = [];
    let targetId: string | null = null;
    let activityId: string | null = null;
    let recordId: string | null = null;

    try {
      // SETUP — 101 clients via API factories (batches of 10)
      for (let i = 0; i < 100; i += 10) {
        const batch = await Promise.all(
          Array.from({ length: 10 }, (_, k) =>
            createTestClient(request, {
              name: `US1F ${ts} ${String(i + k).padStart(3, '0')}`,
              phone: `+7999${String(ts).slice(-6)}${String(i + k).padStart(3, '0')}`,
            }),
          ),
        );
        fillerIds.push(...batch.map((c) => c.id));
      }
      const target = await createTestClient(request, {
        name: targetName,
        phone: `+7999${String(ts).slice(-6)}999`,
      });
      targetId = target.id;

      // Precondition (the old defect surface): the legacy 100-capped clients
      // fetch does NOT contain the target client — the old map could not
      // resolve its name.
      const cappedResp = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      expect(cappedResp.ok()).toBeTruthy();
      const cappedItems = (await cappedResp.json()).items;
      expect(cappedItems).toHaveLength(100);
      expect(cappedItems.some((c: { id: string }) => c.id === targetId)).toBe(false);

      const activity = await createTestActivity(request);
      activityId = activity.id;
      const record = await createTestRecord(request, activity.id, target.id);
      recordId = record.id;

      // ACTION + VERIFY UI — the table shows the beyond-cap client's name
      await waitForRecordsReady(page);
      const row = await narrowToClient(page, targetName);
      const clientCell = row.locator('td').nth(1);
      await expect(clientCell).toHaveText(targetName);
      await expect(clientCell).not.toHaveText('—');
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      if (activityId) await cleanup(request, `/api/v1/activities/${activityId}`);
      if (targetId) await cleanup(request, `/api/v1/clients/${targetId}`);
      for (let i = 0; i < fillerIds.length; i += 10) {
        await Promise.all(
          fillerIds.slice(i, i + 10).map((id) => cleanup(request, `/api/v1/clients/${id}`)),
        );
      }
    }
  });

  // ── US-2: one display request ──────────────────────────────────────────────

  test('US-2: page load issues exactly ONE /records/view and zero legacy lookup fetches', async ({
    page,
    request,
  }) => {
    // Seed a record with a known client name for the dropdown-work check.
    const clientName = `US2 Один запрос ${Date.now()}`;
    const seeded = await createTestRecordWithClient(request, clientName);

    // Request taxonomy collector — registered BEFORE navigation.
    const apiUrls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/')) apiUrls.push(req.url());
    });
    const dictsLoaded = Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/locations/all') && r.status() === 200,
        { timeout: 30_000 },
      ),
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/services/all') && r.status() === 200,
        { timeout: 30_000 },
      ),
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/masters/all') && r.status() === 200,
        { timeout: 30_000 },
      ),
    ]);

    try {
      await waitForRecordsReady(page);
      await dictsLoaded;

      const pathnames = apiUrls.map((u) => new URL(u).pathname);
      const count = (p: string) => pathnames.filter((x) => x === p).length;

      // VERIFY — display path: exactly ONE request, the composite view.
      expect(count('/api/v1/records/view')).toBe(1);
      // The lean list stays canonical for modals only — not the page load.
      expect(count('/api/v1/records')).toBe(0);
      // Legacy display-map fetches — all gone from the records page path.
      expect(count('/api/v1/activities')).toBe(0);
      expect(count('/api/v1/payments/totals')).toBe(0);
      expect(
        apiUrls.filter((u) => u.includes('/api/v1/clients') && u.includes('per_page=100')),
      ).toHaveLength(0);

      // The three dict /all selection queries (BookingFilters, canonical
      // keys) are the sanctioned remainder.
      expect(count('/api/v1/locations/all')).toBe(1);
      expect(count('/api/v1/services/all')).toBe(1);
      expect(count('/api/v1/masters/all')).toBe(1);

      // Dropdowns populate from the dict responses — Combobox flow: open each
      // trigger, count [data-testid^="combobox-option-"] minus the pinned
      // «Все …» clear option, close it again before the next trigger.
      for (const label of ['Фильтр по локации', 'Фильтр по услуге', 'Фильтр по мастеру']) {
        await openCombobox(page, page.getByLabel(label));
        const optionCount = await page.locator('[data-testid^="combobox-option-"]').count();
        expect(optionCount - 1).toBeGreaterThan(0);
        // Close via getByRole 'button' — while the dropdown is open,
        // getByLabel matches BOTH the trigger and the aria-labelled listbox
        // → strict mode violation.
        await closeCombobox(page, label);
      }

      // Dropdowns work: picking our record's service fires a filtered
      // /records/view request and the table still contains our row.
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${seeded.activityId}`);
      expect(actResp.ok()).toBeTruthy();
      const activity = await actResp.json();
      const filterWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') &&
          r.url().includes(`service_id=${activity.service_id}`),
        { timeout: 10_000 },
      );
      const svcResp = await request.get(`${BACKEND}/api/v1/services`);
      const servicesList = (await svcResp.json()).items ?? [];
      const serviceTitle = servicesList.find((s: any) => s.id === activity.service_id)?.title;
      expect(serviceTitle).toBeTruthy();
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по услуге'),
        serviceTitle,
        activity.service_id,
      );
      await filterWait;
      await expect(
        page.locator('tbody tr').filter({ hasText: clientName }).first(),
      ).toBeVisible();
    } finally {
      await cleanupRecord(request, seeded.recordId);
      await cleanup(request, `/api/v1/activities/${seeded.activityId}`);
      await cleanup(request, `/api/v1/clients/${seeded.clientId}`);
    }
  });

  // ── US-3: archived entities ────────────────────────────────────────────────

  test('US-3: archived client + archived master — real names and the master own dot color', async ({
    page,
    request,
  }) => {
    const ts = Date.now();
    const clientName = `ЮС3 Архивная ${ts}`;
    const masterColor = '#FF5733';
    const client = await createTestClient(request, { name: clientName });
    const master = await createTestMaster(request, {
      first_name: 'Архивия',
      last_name: `Мастерова${ts}`,
      color: masterColor,
    });
    const activity = await createTestActivity(request, { master_id: master.id });
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // Archive both entities — display resolution carries NO is_active
      // filter (spec §4, photos precedent).
      const archClient = await request.post(`${BACKEND}/api/v1/clients/${client.id}/archive`);
      expect(archClient.ok()).toBeTruthy();
      const archMaster = await request.post(`${BACKEND}/api/v1/masters/${master.id}/archive`);
      expect(archMaster.ok()).toBeTruthy();

      await waitForRecordsReady(page);
      const row = await narrowToClient(page, clientName);

      // Archived client resolves its REAL name (old active-only map → '—').
      await expect(row.locator('td').nth(1)).toHaveText(clientName);

      // Archived master: the dot uses the master's OWN color — not the
      // gray #999 fallback — and the «Фамилия Имя» tooltip resolves.
      const dot = row.locator('td').nth(4).locator('.rounded-full');
      await expect(dot).toHaveCSS('background-color', hexToRgb(masterColor));
      await expect(dot).toHaveAttribute('title', `${master.last_name} ${master.first_name}`);
    } finally {
      await cleanupRecord(request, record.id);
      await request.post(`${BACKEND}/api/v1/clients/${client.id}/restore`).catch(() => {});
      await request.post(`${BACKEND}/api/v1/masters/${master.id}/restore`).catch(() => {});
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/masters/${master.id}`);
    }
  });

  test('US-3: dangling service — service cell renders «—»', async ({ page, request }) => {
    const ts = Date.now();
    const clientName = `ЮС3 Дангл ${ts}`;
    const client = await createTestClient(request, { name: clientName });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // FK-dangling service (deleted row) via raw SQL — the backend-test
      // precedent (test_api_records_view.py::test_dangling_master_nulls):
      // SQLite FK enforcement is per-connection, so the CLI update succeeds
      // and API reads resolve no service row → null → '—'.
      queryDB(
        `UPDATE activities SET service_id = 'e2e-missing-${ts}' WHERE id = '${activity.id}'`,
      );

      await waitForRecordsReady(page);
      const row = await narrowToClient(page, clientName);

      // Service cell shows the '—' fallback; the client name still resolves.
      await expect(row.locator('td').nth(3)).toHaveText('—');
      await expect(row.locator('td').nth(1)).toHaveText(clientName);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-4..US-6: API-level helper ──────────────────────────────────────────

  /**
   * Fetch the SAME params from both endpoints and return the parsed
   * envelopes. US-5/US-6 parity core: one RecordListParams class feeds both,
   * so totals and id sequences must match byte-for-byte (spec §2 DRY-glue).
   */
  async function fetchParity(
    api: APIRequestContext,
    params: Record<string, string>,
  ): Promise<{
    view: { items: Array<{ id: string }>; total: number };
    list: { items: Array<{ id: string }>; total: number };
  }> {
    const qs = new URLSearchParams(params).toString();
    const [viewResp, listResp] = await Promise.all([
      api.get(`${BACKEND}/api/v1/records/view?${qs}`),
      api.get(`${BACKEND}/api/v1/records?${qs}`),
    ]);
    expect(viewResp.ok()).toBeTruthy();
    expect(listResp.ok()).toBeTruthy();
    return { view: await viewResp.json(), list: await listResp.json() };
  }

  // ── US-4: paid freshness ────────────────────────────────────────────────────

  test('US-4: payment badge fills from the row and refreshes without reload', async ({
    page,
    request,
  }) => {
    // One visit at 3500₽, no payments → badge «Не оплачено», rendered from the
    // view row's own `paid` field (spec §6.2 — no payments-map round-trip).
    // Payment entry lives in the schedule modal's client tab (the records
    // detail panel is display-only for payments); addPayment invalidates the
    // ['records'] prefix (Task-12/R4), so the badge refreshes on the next
    // CLIENT-SIDE visit to /records — no page.reload() anywhere in this test.
    const ts = Date.now();
    const clientName = `ЮС4 Оплата ${ts}`;
    const client = await createTestClient(request, { name: clientName });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForRecordsReady(page);
      let row = await narrowToClient(page, clientName);
      await expect(row.locator('td').nth(8)).toHaveText('Не оплачено');

      // Row click opens the detail panel; its Оплата block reads the record's
      // payments (none yet).
      await row.click();
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible();
      await expect(page.locator('text=Нет платежей')).toBeVisible();

      // ── Round 1: partial payment 1500₽ → «Частично (1 500₽)» ──────────────
      await page.goto('/schedule');
      await openModal(page, { recordId: record.id });
      await switchToRecordsTab(page);
      await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible();
      await page.locator('[data-testid="btn-add-payment"]').click();
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();
      await amountInput.fill('1500');
      await amountInput.press('Enter');
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      // VERIFY DB — the payment row persisted (payments are hard rows).
      expect(
        Number(queryDB(
          `SELECT COALESCE(SUM(amount),0) FROM payments WHERE record_id='${record.id}'`,
        )),
      ).toBe(1500);

      // Close the modal, then BACK to /records via the sidebar link —
      // client-side navigation; the invalidated ['records'] query refetches.
      await page.locator('[data-testid="modal-close-btn"]').click();
      const viewWait1 = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view'),
        { timeout: 15_000 },
      );
      await page.locator('a[aria-label="Записи"]').click();
      await viewWait1;

      row = await narrowToClient(page, clientName);
      await expect(row.locator('td').nth(8)).toContainText(/Частично \(1[\s\u00A0]?500₽\)/);

      // ── Round 2: top up 2000₽ → «✓ Оплачено» ───────────────────────────────
      await page.goto('/schedule');
      await openModal(page, { recordId: record.id });
      await switchToRecordsTab(page);
      await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible();
      await page.locator('[data-testid="btn-add-payment"]').click();
      const amountInput2 = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput2).toBeVisible();
      await amountInput2.fill('2000');
      await amountInput2.press('Enter');
      await expect(amountInput2).not.toBeVisible({ timeout: 5_000 });

      await page.locator('[data-testid="modal-close-btn"]').click();
      const viewWait2 = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view'),
        { timeout: 15_000 },
      );
      await page.locator('a[aria-label="Записи"]').click();
      await viewWait2;

      row = await narrowToClient(page, clientName);
      await expect(row.locator('td').nth(8)).toHaveText('✓ Оплачено');
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-5: filter + search parity ────────────────────────────────────────────

  test('US-5: every filter and q search — /records/view identical to /records', async ({
    page,
    request,
  }) => {
    // Two records on fully distinct masters/services/locations/dates in an
    // early-February window no seed or parallel-worker data shares (seed
    // weeks: relative-to-now + the fixed 2026-06-15 week; factories start
    // activities "now").
    const ts = Date.now();
    const nameA = `ЮС5 Альфа ${ts}`;
    const nameB = `ЮС5 Бета ${ts}`;
    const masterA = await createTestMaster(request, { first_name: 'ПаритетА', last_name: `МА${ts}` });
    const masterB = await createTestMaster(request, { first_name: 'ПаритетБ', last_name: `МБ${ts}` });
    const serviceA = await createTestService(request, { title: `ЮС5 Услуга А ${ts}` });
    const serviceB = await createTestService(request, { title: `ЮС5 Услуга Б ${ts}` });
    const locationA = await createTestLocation(request, { name: `ЮС5 Лок А ${ts}` });
    const locationB = await createTestLocation(request, { name: `ЮС5 Лок Б ${ts}` });
    const clientA = await createTestClient(request, { name: nameA });
    const clientB = await createTestClient(request, { name: nameB });
    const activityA = await createTestActivity(request, {
      master_id: masterA.id,
      service_id: serviceA.id,
      location_id: locationA.id,
      start: '2026-02-10T10:00:00',
    });
    const activityB = await createTestActivity(request, {
      master_id: masterB.id,
      service_id: serviceB.id,
      location_id: locationB.id,
      start: '2026-02-11T11:00:00',
    });
    const recordA = await createTestRecord(request, activityA.id, clientA.id);
    const recordB = await createTestRecord(request, activityB.id, clientB.id);

    try {
      // Record A's visit → visited (server re-derives the record status).
      const stResp = await request.put(
        `${BACKEND}/api/v1/visits/${recordA.visits[0].id}/status`,
        { data: { status: 'visited' } },
      );
      expect(stResp.ok()).toBeTruthy();

      // API parity — same params on both endpoints → same total + id
      // sequence. `expected` = the EXACT fixture result set where the filter
      // is unique to our data (null = superset — seed visited records join in).
      const cases: Array<{
        name: string;
        params: Record<string, string>;
        expected: string[] | null;
      }> = [
        { name: 'client_id', params: { client_id: clientA.id }, expected: [recordA.id] },
        { name: 'activity_id', params: { activity_id: activityB.id }, expected: [recordB.id] },
        { name: 'date range', params: { date_from: '2026-02-11', date_to: '2026-02-12' }, expected: [recordB.id] },
        { name: 'location_id', params: { location_id: locationA.id }, expected: [recordA.id] },
        { name: 'service_id', params: { service_id: serviceB.id }, expected: [recordB.id] },
        { name: 'master_id', params: { master_id: masterA.id }, expected: [recordA.id] },
        { name: 'status', params: { status: 'visited' }, expected: null },
        { name: 'q search', params: { q: nameA }, expected: [recordA.id] },
      ];
      for (const c of cases) {
        const { view, list } = await fetchParity(request, { per_page: '100', ...c.params });
        expect(view.total, `${c.name}: totals`).toBe(list.total);
        const viewIds = view.items.map((i) => i.id);
        const listIds = list.items.map((i) => i.id);
        expect(viewIds, `${c.name}: id sequence`).toEqual(listIds);
        if (c.expected) {
          expect([...viewIds].sort(), `${c.name}: fixture set`).toEqual([...c.expected].sort());
        } else {
          expect(viewIds, 'status: record A in').toContain(recordA.id);
          expect(viewIds, 'status: record B out').not.toContain(recordB.id);
        }
      }

      // UI smoke — the same controls as before #213, now fed by /records/view:
      // widen the date window to the February fixture, apply the master
      // filter, then the ?q= search box.
      await waitForRecordsReady(page);
      const dateFromWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') && r.url().includes('date_from=2026-02-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2026-02-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') && r.url().includes('date_to=2026-02-28'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2026-02-28');
      await dateToWait;

      const masterWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') && r.url().includes(`master_id=${masterA.id}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по мастеру'),
        masterA.last_name,
        masterA.id,
      );
      await masterWait;
      await expect(
        page.locator('tbody tr').filter({ hasText: nameA }).first(),
      ).toBeVisible();
      await expect(page.locator('tbody tr').filter({ hasText: nameB })).toHaveCount(0);

      // ?q= narrows to the single matching row (server search, GH #212).
      await narrowToClient(page, nameA);
    } finally {
      await cleanupRecord(request, recordA.id);
      await cleanupRecord(request, recordB.id);
      await cleanup(request, `/api/v1/activities/${activityA.id}`);
      await cleanup(request, `/api/v1/activities/${activityB.id}`);
      for (const id of [masterA.id, masterB.id]) await cleanup(request, `/api/v1/masters/${id}`);
      for (const id of [serviceA.id, serviceB.id]) await cleanup(request, `/api/v1/services/${id}`);
      for (const id of [locationA.id, locationB.id]) await cleanup(request, `/api/v1/locations/${id}`);
      await cleanup(request, `/api/v1/clients/${clientA.id}`);
      await cleanup(request, `/api/v1/clients/${clientB.id}`);
    }
  });

  // ── US-6: sort parity ────────────────────────────────────────────────────────

  test('US-6: every sort column × asc/desc — same order as GET /records (API)', async ({
    request,
  }) => {
    // Three records distinct on EVERY sort key, in a late-January window no
    // other spec seeds (records.spec uses 2026-01-05; we own 2026-01-16).
    //   A: visited, 1 visit ×1000, paid in full  → payment bucket 0, earliest
    //   B: waiting, 2 visits ×1500, partial 500  → payment bucket 1
    //   C: waiting, 3 visits ×2000, no payments  → payment bucket 2, latest
    const ts = Date.now();
    const mkFixture = async (
      n: number,
      opts: { visits: number; price: number; pay: number | null; start: string },
    ) => {
      const master = await createTestMaster(request, {
        first_name: `Сорт${n}`,
        last_name: `МС${ts}${n}`,
      });
      const service = await createTestService(request, { title: `ЮС6 Услуга ${n} ${ts}` });
      const location = await createTestLocation(request, { name: `ЮС6 Лок ${n} ${ts}` });
      const client = await createTestClient(request, { name: `ЮС6 Клиент${n} ${ts}` });
      const activity = await createTestActivity(request, {
        master_id: master.id,
        service_id: service.id,
        location_id: location.id,
        start: opts.start,
      });
      const record = await createTestRecord(request, activity.id, client.id, {
        visits: Array.from({ length: opts.visits }, (_, k) => ({
          name: `ЮС6 Гость ${n}-${k}`,
          price: opts.price,
        })),
      });
      if (opts.pay !== null) await createTestPayment(request, record.id, { amount: opts.pay });
      return { master, service, location, client, activity, record };
    };

    const A = await mkFixture(1, { visits: 1, price: 1000, pay: 1000, start: '2026-01-16T10:00:00' });
    const B = await mkFixture(2, { visits: 2, price: 1500, pay: 500, start: '2026-01-16T11:00:00' });
    const C = await mkFixture(3, { visits: 3, price: 2000, pay: null, start: '2026-01-16T12:00:00' });

    try {
      const stResp = await request.put(
        `${BACKEND}/api/v1/visits/${A.record.visits[0].id}/status`,
        { data: { status: 'visited' } },
      );
      expect(stResp.ok()).toBeTruthy();

      const WINDOW = { date_from: '2026-01-15', date_to: '2026-01-20', per_page: '100' };
      const SORT_KEYS = [
        'date', 'client', 'service', 'master', 'location',
        'guests', 'status', 'total', 'payment',
      ];

      // Full parity loop — 9 columns × 2 orders: same ids, same order, same
      // totals on both endpoints; the window isolates EXACTLY our fixture.
      for (const key of SORT_KEYS) {
        for (const order of ['asc', 'desc']) {
          const { view, list } = await fetchParity(request, {
            ...WINDOW,
            sort_by: key,
            sort_order: order,
          });
          expect(view.total, `${key}/${order}: totals`).toBe(list.total);
          expect(view.total, `${key}/${order}: fixture isolated`).toBe(3);
          const viewIds = view.items.map((i) => i.id);
          const listIds = list.items.map((i) => i.id);
          expect(viewIds, `${key}/${order}: id sequence`).toEqual(listIds);
        }
      }

      // Spot-checks that the ordering is MEANINGFUL, not merely equal:
      // payment asc = full → partial → none; date asc = earliest first.
      const payAsc = await fetchParity(request, { ...WINDOW, sort_by: 'payment', sort_order: 'asc' });
      expect(payAsc.view.items.map((i) => i.id)).toEqual([A.record.id, B.record.id, C.record.id]);
      const payDesc = await fetchParity(request, { ...WINDOW, sort_by: 'payment', sort_order: 'desc' });
      expect(payDesc.view.items.map((i) => i.id)).toEqual([C.record.id, B.record.id, A.record.id]);
      const dateAsc = await fetchParity(request, { ...WINDOW, sort_by: 'date', sort_order: 'asc' });
      expect(dateAsc.view.items.map((i) => i.id)).toEqual([A.record.id, B.record.id, C.record.id]);
    } finally {
      for (const f of [A, B, C]) {
        await cleanupRecord(request, f.record.id);
        await cleanup(request, `/api/v1/activities/${f.activity.id}`);
        await cleanup(request, `/api/v1/masters/${f.master.id}`);
        await cleanup(request, `/api/v1/services/${f.service.id}`);
        await cleanup(request, `/api/v1/locations/${f.location.id}`);
        await cleanup(request, `/api/v1/clients/${f.client.id}`);
      }
    }
  });

  test('US-6: sort indicators — every column header sorts asc/desc on /records/view', async ({
    page,
    request,
  }) => {
    // Two records in an early-March isolation window (distinct from the
    // API-parity test's January one) — enough to watch indicators move while
    // the row set stays put.
    const ts = Date.now();
    const seedOne = async (n: number) => {
      const client = await createTestClient(request, { name: `ЮС6УИ Клиент${n} ${ts}` });
      const activity = await createTestActivity(request, { start: `2026-03-05T1${n}:00:00` });
      const record = await createTestRecord(request, activity.id, client.id);
      return { client, activity, record };
    };
    const one = await seedOne(0);
    const two = await seedOne(1);

    try {
      await waitForRecordsReady(page);

      // Widen the date window to the March fixture — server requests.
      const dateFromWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') && r.url().includes('date_from=2026-03-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2026-03-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records/view') && r.url().includes('date_to=2026-03-10'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2026-03-10');
      await dateToWait;
      await expect(page.locator('tbody tr')).toHaveCount(2);

      // Initial state (unchanged from the pre-#213 table): the page loads
      // sorted by date/asc — the ascending indicator is ALREADY up before
      // any click.
      const dateHeader = page.locator('table thead th').filter({ hasText: 'Дата / Время' });
      await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');
      await expect(dateHeader).toContainText('↑');

      // [header label, sort field]. Date starts active (asc) — its single
      // click toggles to desc; every other field gets asc then desc
      // (DataTable §6.10.4 toggle). Each (field, order) key is UNIQUE in the
      // loop, so every click fires a fresh /records/view request — never a
      // cache-hit (date/asc is served from the staleTime-30s cache from the
      // page load, hence no second date click; its indicator is asserted
      // above).
      const columns: Array<[string, string]> = [
        ['Дата / Время', 'date'],
        ['Клиент', 'client'],
        ['Гостей', 'guests'],
        ['Услуга', 'service'],
        ['Мастер', 'master'],
        ['Локация', 'location'],
        ['Статус', 'status'],
        ['Сумма', 'total'],
        ['Оплата', 'payment'],
      ];
      let previousLabel: string | null = null;
      for (const [label, field] of columns) {
        const header = page.locator('table thead th').filter({ hasText: label });
        for (const order of field === 'date' ? ['desc'] : ['asc', 'desc']) {
          const wait = page.waitForResponse(
            (r) =>
              r.url().includes('/api/v1/records/view') &&
              r.url().includes(`sort_by=${field}`) &&
              r.url().includes(`sort_order=${order}`),
            { timeout: 10_000 },
          );
          await header.click();
          await wait;
          // Indicator unchanged from the pre-#213 table: aria-sort + arrow
          // glyph on the active header only.
          await expect(header).toHaveAttribute(
            'aria-sort',
            order === 'asc' ? 'ascending' : 'descending',
          );
          await expect(header).toContainText(order === 'asc' ? '↑' : '↓');
        }
        // The previously active header lost its indicator — it moved.
        if (previousLabel) {
          await expect(
            page.locator('table thead th').filter({ hasText: previousLabel }),
          ).not.toHaveAttribute('aria-sort');
        }
        previousLabel = label;
        // Sorting never changes the row set — still the two isolated records.
        await expect(page.locator('tbody tr')).toHaveCount(2);
      }
    } finally {
      for (const f of [one, two]) {
        await cleanupRecord(request, f.record.id);
        await cleanup(request, `/api/v1/activities/${f.activity.id}`);
        await cleanup(request, `/api/v1/clients/${f.client.id}`);
      }
    }
  });
});
