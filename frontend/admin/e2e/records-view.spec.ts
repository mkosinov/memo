import { test, expect, type Page } from '@playwright/test';
import { waitForRecordsReady } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestRecordWithClient,
  createTestMaster,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDB } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * GH #213 — composite read endpoint GET /api/v1/records/view (US-1..US-3).
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
 *          color; an FK-dangling service renders «—».
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

test.describe('Records View Endpoint — GH #213 US-1..US-3', () => {
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

      // Dropdowns populate from the dict responses.
      for (const label of ['Фильтр по локации', 'Фильтр по услуге', 'Фильтр по мастеру']) {
        const optionCount = await page.locator(`select[aria-label="${label}"] option`).count();
        expect(optionCount).toBeGreaterThan(1);
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
      await page
        .locator('select[aria-label="Фильтр по услуге"]')
        .selectOption(activity.service_id);
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
});
