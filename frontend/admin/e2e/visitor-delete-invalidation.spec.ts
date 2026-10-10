import { test, expect } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestClient,
  createTestRecord,
  createTestService,
  createTestVisit,
  createTestVisitor,
} from './fixtures/factories';
import {
  clickRowDelete,
  commitDeleteWait,
  confirmDeleteDialog,
  openRowActionDropdown,
  undoToast,
  waitForClientsReady,
  waitForRecordsReady,
  withUndoWindow,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { expectUpdateToast, PUSH_WINDOW, uid } from './fixtures/server-push';

/**
 * GH #375 — spec §User Scenarios US-1–US-3 (docs/specs/2026-10-10-
 * visits-event-mark-design.md): deletion in ONE page of a context, the
 * change observed in ANOTHER page of the SAME context — no reload, waits
 * only via expect/waitFor.
 *
 * Channel under test: the `visits` event mark rides the SSE invalidate
 * package of both deletion paths and lands in the records query family
 * (lib/invalidate.ts: visits → ['records'] prefix — covers the records
 * table view AND the quick card's ['records','client',id] reader).
 *
 *   · US-1 — visitor deleted from the client card (the §9.3 dialog flow:
 *     dry-run 409 → DeleteDialog «Посещения — будут удалены» → checkbox →
 *     confirm → 5s undo window → commit 204). The OTHER page's open
 *     «Записи» table converges by itself: the guests counter (max(1,
 *     visits.length)) and the record total (Σ visit.price) drop — the
 *     observation window (PUSH_WINDOW = 10s) stays below the app-wide
 *     staleTime (30s), so a pass without the SSE channel is impossible.
 *   · US-2 — same delete; the other page has the client card open ON the
 *     records tab (the records-side read-only viewer ClientQuickCard,
 *     §6.13): its «Гостей» stat and «История записей» prices are derived
 *     from record.visits via useClientRecords (['records','client',id] —
 *     inside the invalidated family) and must flip without reload.
 *   · US-3 — GUARD (green regardless of the Task 1 mark change): cascade
 *     client delete from the /clients table (S1 conveyor steps: row
 *     dropdown → Удалить → dialog → checkbox → confirm). The records
 *     table converges via the `records` mark that was always present:
 *     the nullified record row STAYS but «Клиент» flips to «—», guests
 *     and total drop (the client's visitors cascade away with visits).
 *
 * Anti-vacuity care: every observed surface is asserted in its PRE state
 * before the delete (so a stuck screen fails the flip), cells are located
 * by header-column index (not fragile nth offsets), and the observer page
 * is loaded LAST — its cache is fresh right before the delete, keeping
 * the whole observation inside the staleTime budget.
 *
 * Full Cycle per test: SETUP via factories → UI action (actor page) →
 * UI asserts (observer page) → DB asserts (SQLite) → cleanup in finally.
 */

/** Records-table column index by header text ('Гостей', 'Сумма', …) —
 *  resilient to column visibility/order changes (DataTable renders th
 *  per visible column + one trailing actions th; td order matches). */
async function columnIndex(page: Page, header: string): Promise<number> {
  const ths = page.locator('thead th');
  for (let i = 0; i < await ths.count(); i++) {
    if (((await ths.nth(i).textContent()) ?? '').includes(header)) return i;
  }
  throw new Error(`records table column "${header}" not found`);
}

/** Exact-cell price matcher: 6500 → /^6[\s\u00a0\u202f]?500₽$/ — tolerant
 *  to the ru-RU group separator (NBSP / narrow NBSP / plain space). */
function priceRe(total: number): RegExp {
  const grouped = String(total).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    '[\\s\\u00a0\\u202f]?',
  );
  return new RegExp(`^${grouped}₽$`);
}

/** One records-table row cell by column header name. */
function cell(row: Locator, idx: number): Locator {
  return row.locator('td').nth(idx);
}

test.describe('Visitor/client delete invalidates open screens (GH #375 US-1–US-3)', () => {
  // Two pages of one context + the client-card flow + push windows. On a
  // loaded box (sibling worktree stacks) the first-hit dev compilation of
  // /clients and /records alone can exceed the helpers' fixed 60s response
  // budgets — double the family's 120s headroom.
  test.setTimeout(240_000);

  // Route warmup with a GENEROUS per-route budget: globalSetup's warmup is
  // capped at 60s per route (best-effort) and on a contended box a cold
  // /clients//records compile outruns it — the first test then dies inside
  // waitForClientsReady's fixed 60s waitForResponse (observed: US-1/US-2
  // red, US-3 green once the routes were warm). Warming here decouples the
  // spec from cold-cache compile latency; it touches no data.
  test.beforeAll(async () => {
    const base = `http://127.0.0.1:${process.env.SHARD_PORT || '3002'}`;
    for (const route of ['/clients', '/records']) {
      await fetch(`${base}${route}`, { signal: AbortSignal.timeout(150_000) }).catch(
        () => {},
      );
    }
  });

  // ── US-1: visitor delete → open «Записи» table converges ────────────────

  test('US-1: visitor deleted from the client card — records table in the other page recalculates without reload', async ({
    page,
    request,
  }) => {
    // 1. SETUP — a record whose ONLY visitor is the delete target:
    // 2 visits (3000 + 3500) → guests 2, total 6 500₽ → after the delete
    // the honest recompute lands at max(1,0)=1 guests and 0₽.
    const client = await createTestClient(request, {
      name: `US-1 Клиент ${uid()}`,
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });
    const visitorName = `US-1 Посетитель ${uid()}`;
    const visitor = await createTestVisitor(request, client.id, {
      name: visitorName,
    });
    await createTestVisit(request, record.id, visitor.id, { price: 3000 });
    await createTestVisit(request, record.id, visitor.id, { price: 3500 });
    expect(
      queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
    ).toHaveLength(2);
    expect(
      queryDBRow(`SELECT seats FROM records WHERE id='${record.id}'`),
    ).toMatchObject({ seats: 2 });

    const observer = await page.context().newPage();
    try {
      // ACTOR page first (heavy navigation), observer LAST — its records
      // fetch stays young when the delete commits.
      await waitForClientsReady(page, { waitForName: client.name });
      await page
        .locator('table tbody tr')
        .filter({ hasText: client.name })
        .click();
      await expect(
        page.locator('[data-testid="client-card-modal"]'),
      ).toBeVisible({ timeout: 10_000 });
      const visitorRow = page
        .locator('[data-testid="visitor-row"]')
        .filter({ hasText: visitorName });
      await expect(visitorRow).toBeVisible({ timeout: 10_000 });

      // OBSERVER PRE-STATE — the open «Записи» table shows the seats.
      await waitForRecordsReady(observer);
      const row = observer
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      const guestsIdx = await columnIndex(observer, 'Гостей');
      const totalIdx = await columnIndex(observer, 'Сумма');
      await expect(cell(row, guestsIdx)).toHaveText('2');
      await expect(cell(row, totalIdx)).toHaveText(priceRe(6500));

      // 2. ACTION — the §9.3 dialog delete (checkbox confirm, commit at
      // the rewound window end; commitDeleteWait registered BEFORE the
      // window-creating click — helper contract).
      const commitWait = commitDeleteWait(page, '/api/v1/visitors', visitor.id);
      await withUndoWindow(page, async () => {
        await visitorRow
          .getByRole('button', { name: 'Удалить посетителя' })
          .click();
        const dialog = page.locator('[data-testid="delete-dialog"]');
        await expect(dialog).toBeVisible();
        await expect(
          page.locator('[data-testid="dep-visits"]'),
        ).toContainText('Посещения — будут удалены:');
        await expect(
          page.locator('[data-testid="dep-visits"] li'),
        ).toHaveCount(2);
        await expect(
          page.locator('[data-testid="delete-dialog-confirm-btn"]'),
        ).toBeDisabled();
        await page
          .locator('[data-testid="delete-dialog-confirm-checkbox"]')
          .check();
        await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
        await expect(dialog).toHaveCount(0);
        await expect(visitorRow).not.toBeVisible();
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
      });
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // 3. OBSERVER — NO reload: the seats recount lands within the push
      // window (10s < staleTime 30s — only the SSE channel can do this).
      await expect(cell(row, guestsIdx)).toHaveText('1', {
        timeout: PUSH_WINDOW,
      });
      await expect(cell(row, totalIdx)).toHaveText(priceRe(0), {
        timeout: PUSH_WINDOW,
      });
      await expectUpdateToast(observer);

      // 4. VERIFY DB — the deletion is real, the record recomputed.
      expect(
        queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
      ).toHaveLength(0);
      expect(
        queryDBRow(`SELECT seats, status FROM records WHERE id='${record.id}'`),
      ).toMatchObject({ seats: 0, status: 'waiting' });
    } finally {
      // 5. CLEANUP — close the observer first (cleanups emit SSE frames),
      // then record (visits died with the visitor) + the chain.
      await observer.close().catch(() => {});
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-2: visitor delete → client card on the records tab converges ─────

  test('US-2: visitor deleted in one page — client card opened on the records tab of the other page updates without reload', async ({
    page,
    request,
  }) => {
    // 1. SETUP — same shape as US-1: the client's single record holds the
    // target visitor's 2 visits.
    const client = await createTestClient(request, {
      name: `US-2 Клиент ${uid()}`,
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });
    const visitorName = `US-2 Посетитель ${uid()}`;
    const visitor = await createTestVisitor(request, client.id, {
      name: visitorName,
    });
    await createTestVisit(request, record.id, visitor.id, { price: 3000 });
    await createTestVisit(request, record.id, visitor.id, { price: 3500 });
    expect(
      queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
    ).toHaveLength(2);

    const observer = await page.context().newPage();
    try {
      // ACTOR page — the client card with the visitor row.
      await waitForClientsReady(page, { waitForName: client.name });
      await page
        .locator('table tbody tr')
        .filter({ hasText: client.name })
        .click();
      await expect(
        page.locator('[data-testid="client-card-modal"]'),
      ).toBeVisible({ timeout: 10_000 });
      const visitorRow = page
        .locator('[data-testid="visitor-row"]')
        .filter({ hasText: visitorName });
      await expect(visitorRow).toBeVisible({ timeout: 10_000 });

      // OBSERVER PRE-STATE — the client card open ON the records tab
      // (records-side ClientQuickCard): the «Гостей» stat and the record
      // price are visit-derived.
      await waitForRecordsReady(observer);
      await observer
        .locator('tbody button')
        .filter({ hasText: client.name })
        .click();
      const quickCard = observer.locator('[data-testid="client-quick-card"]');
      await expect(quickCard).toBeVisible({ timeout: 10_000 });
      const guestsNumber = quickCard
        .locator('div.text-center')
        .filter({ hasText: 'Гостей' })
        .locator('div.text-xl');
      await expect(guestsNumber).toHaveText('2');
      const historyPrice = quickCard.locator(
        'div.text-right div.text-sm.font-semibold',
      );
      await expect(historyPrice).toHaveText(priceRe(6500));

      // 2. ACTION — the §9.3 dialog delete on the actor page.
      const commitWait = commitDeleteWait(page, '/api/v1/visitors', visitor.id);
      await withUndoWindow(page, async () => {
        await visitorRow
          .getByRole('button', { name: 'Удалить посетителя' })
          .click();
        const dialog = page.locator('[data-testid="delete-dialog"]');
        await expect(dialog).toBeVisible();
        await expect(
          page.locator('[data-testid="dep-visits"] li'),
        ).toHaveCount(2);
        await page
          .locator('[data-testid="delete-dialog-confirm-checkbox"]')
          .check();
        await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
        await expect(dialog).toHaveCount(0);
        await expect(visitorRow).not.toBeVisible();
        await expect(undoToast(page)).toBeVisible();
      });
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // 3. OBSERVER — NO reload: the card's visit-derived figures flip
      // within the push window (['records','client',id] is inside the
      // invalidated family — an open card must not serve the stale list).
      await expect(guestsNumber).toHaveText('1', { timeout: PUSH_WINDOW });
      await expect(historyPrice).toHaveText(priceRe(0), {
        timeout: PUSH_WINDOW,
      });

      // 4. VERIFY DB.
      expect(
        queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
      ).toHaveLength(0);
      expect(
        queryDBRow(`SELECT seats FROM records WHERE id='${record.id}'`),
      ).toMatchObject({ seats: 0 });
    } finally {
      await observer.close().catch(() => {});
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-3 (guard): client cascade delete → records table converges ──────

  test('US-3: client cascade-deleted in one page — records table in the other page updates without reload', async ({
    page,
    request,
  }) => {
    // 1. SETUP — the record is anchored by a UNIQUE service title: the
    // cascade nullifies the record (client cell flips to «—»), so the
    // client name cannot anchor the observer's row across the delete.
    // Two visitor seats (4000 + 2500) → guests 2, total 6 500₽.
    const service = await createTestService(request, {
      title: `US-3 Услуга ${uid()}`,
    });
    const client = await createTestClient(request, {
      name: `US-3 Клиент ${uid()}`,
    });
    const activity = await createTestActivity(request, {
      service_id: service.id,
    });
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [
        { name: `US-3 Гость А ${uid()}`, price: 4000 },
        { name: `US-3 Гость Б ${uid()}`, price: 2500 },
      ],
    });
    expect(
      queryDBRows(`SELECT id FROM visits WHERE record_id='${record.id}'`),
    ).toHaveLength(2);

    const observer = await page.context().newPage();
    try {
      // ACTOR page — the /clients row.
      await waitForClientsReady(page, { waitForName: client.name });
      const clientRow = page
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });

      // OBSERVER PRE-STATE — the record row by its unique service title.
      await waitForRecordsReady(observer);
      const row = observer
        .locator('table tbody tr')
        .filter({ hasText: service.title });
      await expect(row).toBeVisible({ timeout: 10_000 });
      const clientIdx = await columnIndex(observer, 'Клиент');
      const guestsIdx = await columnIndex(observer, 'Гостей');
      const totalIdx = await columnIndex(observer, 'Сумма');
      await expect(cell(row, clientIdx)).toHaveText(client.name);
      await expect(cell(row, guestsIdx)).toHaveText('2');
      await expect(cell(row, totalIdx)).toHaveText(priceRe(6500));

      // 2. ACTION — the S1 conveyor: dropdown → Удалить → dry-run 409 →
      // dialog → checkbox → confirm (real 5s window; commit awaited via
      // the registered listener).
      const commitWait = commitDeleteWait(page, '/api/v1/clients', client.id);
      const dropdown = await openRowActionDropdown(clientRow);
      await clickRowDelete(dropdown);
      await expect(
        page.locator('[data-testid="delete-dialog"]'),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('[data-testid="dep-visitors"]'),
      ).toContainText('Посетители — будут удалены:');
      await confirmDeleteDialog(page);
      await expect(
        page.locator('[data-testid="delete-dialog"]'),
      ).toHaveCount(0);
      await expect(clientRow).not.toBeVisible();
      await expect(undoToast(page)).toBeVisible();

      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // 3. OBSERVER — NO reload: the nullified record row STAYS but the
      // client link, seats and total flip within the push window (the
      // always-present `records` mark owns this convergence — the guard
      // must stay green with or without the `visits` mark change).
      await expect(cell(row, clientIdx)).toHaveText('—', {
        timeout: PUSH_WINDOW,
      });
      await expect(cell(row, guestsIdx)).toHaveText('1', {
        timeout: PUSH_WINDOW,
      });
      await expect(cell(row, totalIdx)).toHaveText(priceRe(0), {
        timeout: PUSH_WINDOW,
      });

      // 4. VERIFY DB — the §6 S1 cascade semantics.
      expect(
        queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`),
      ).toBeNull();
      expect(
        queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!
          .client_id,
      ).toBeNull();
      expect(
        queryDBRows(`SELECT id FROM visits WHERE record_id='${record.id}'`),
      ).toHaveLength(0);
    } finally {
      // Nullified record survives the client delete — remove explicitly,
      // then the chain (client cleanup is an idempotent no-op 404 here).
      await observer.close().catch(() => {});
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/services/${service.id}`);
    }
  });
});
