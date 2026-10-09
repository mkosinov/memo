/**
 * unify-caches.spec.ts — E2E coverage for the 7 user scenarios (GH #127).
 *
 * Background:
 *   Tasks 1-9 unified the visit/payment caches so that mutations stay
 *   consistent across the schedule modal, records table, and clients page.
 *   These tests pin the 7 user-visible behaviors from spec §4.
 *
 * Pre-existing #124 trap:
 *   `openModal()` picks the wrong activity on multi-record weeks. We avoid it
 *   by using `openClientTabFor()` — a local helper that deep-links to the
 *   record's week via the schedule URL and clicks the exact card
 *   by data-testid="activity-{id}". This is robust against any number of
 *   activities in the same week (previous tests in the file leave their
 *   activities behind, since cleanup soft-deletes via the API).
 *
 * Toast locator:
 *   `[role="status"]` picks up the dnd-kit live region first (empty). We use
 *   `[data-testid="toast-info"]` (the testid from `ToastContainer.tsx`) so the
 *   "Удалено. Отменить" toast is matched reliably.
 *
 * #127 (this work) makes these tests pass; if a regression is introduced
 * upstream (T1-T9), the corresponding test goes RED.
 */
import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
  gotoScheduleWeek,
  clickActivityCard,
  resolveRecordDate,
  expectDeepLinkChip,
  expectClientSearchEmpty,
  withUndoWindow,
  commitDeleteWait,
} from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * Read the date of the record's activity (YYYY-MM-DD) from the DB.
 * Returns null if the record or its activity is missing.
 */
function recordActivityDate(recordId: string): string | null {
  return resolveRecordDate(recordId)?.date ?? null;
}

/**
 * Open the activity modal by the specific activity id, then switch to the
 * client tab. Robust against multiple activities in the same week — finds
 * the EXACT card by data-testid="activity-{id}" and clicks it (#138 US-7:
 * real card click; deep-link to the record's week via the schedule URL).
 */
async function openClientTabFor(page: Page, recordId: string, activityId: string) {
  // 1. Deep-link to the week of the record's activity (DB lookup).
  const targetDate = recordActivityDate(recordId);
  if (!targetDate) throw new Error(`No activity date for record ${recordId}`);

  await gotoScheduleWeek(page, targetDate);

  // 2. Click the specific activity card by its data-testid.
  const card = page.locator(`[data-testid="activity-${activityId}"]`);
  await expect(card).toBeVisible({ timeout: 5_000 });
  await clickActivityCard(page, card);

  // 3. Switch to the client tab.
  await switchToRecordsTab(page);
  await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible({ timeout: 5_000 });
}

// ── Test suite ────────────────────────────────────────────────────────────────
//
// No `beforeEach` goto on purpose: each test creates its own activity via the
// factory (today's date) and only then navigates to /schedule. If we visited
// /schedule in beforeEach, the current week (13-19 July 2026) would have no
// cards because the seed activities are all from June 8-13.

test.describe('US-1..US-7: cache unification (GH #127)', () => {

  // ── US-1: Add visitor persists (no F5) ────────────────────────────────
  test('US-1: add visitor persists across modal close/reopen', async ({ page, request }) => {
    // 1. SETUP — create a single-record activity via API
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // 2. ACTION — open modal, switch to client tab, add visitor
      await openClientTabFor(page, record.id, activity.id);
      await page.locator('[data-testid="btn-add-visitor"]').click();
      const newRow = page.locator('[data-testid="visit-row-new"]');
      await expect(newRow).toBeVisible();

      const nameInput = page.locator('[data-testid="add-visitor-name"]');
      await nameInput.fill('Тест Удачи');
      await nameInput.press('Enter');

      // After save, the new-row input disappears (row gets an id)
      await expect(nameInput).not.toBeVisible({ timeout: 5_000 });

      const savedRows = page.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])',
      );
      await expect(savedRows.first()).toBeVisible({ timeout: 5_000 });
      const savedCount = await savedRows.count();

      // 3. Close the modal (the modal's ✕ button)
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).not.toBeVisible({ timeout: 5_000 });

      // 4. Reopen the modal — the row must still be there
      await openClientTabFor(page, record.id, activity.id);
      const reopenedRows = page.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])',
      );
      await expect(reopenedRows.first()).toBeVisible({ timeout: 5_000 });
      expect(await reopenedRows.count()).toBeGreaterThanOrEqual(savedCount);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-2: Delete visitor stays deleted across modal tabs ──────────────
  test('US-2: delete visitor stays deleted across tab switch', async ({ page, request }) => {
    // 1. SETUP — seed record with 2 visits so the row is identifiable
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [
        { name: 'Держимый', price: 3500 },
        { name: 'Удаляемый', price: 2500 },
      ],
    });

    try {
      // 2. ACTION — open modal, switch to client tab
      await openClientTabFor(page, record.id, activity.id);

      // Find the "Удаляемый" visit row by its input value
      const targetRow = page
        .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
        .filter({ has: page.locator('input[value="Удаляемый"]') });
      await expect(targetRow).toBeVisible({ timeout: 5_000 });
      const targetTestId = await targetRow.getAttribute('data-testid');
      expect(targetTestId).toBeTruthy();
      const visitId = targetTestId!.replace('visit-row-', '');

      // The undo window under the paused page clock (#417): the 5s commit
      // window is expired by the wrapper's instant rewind instead of a
      // real 5.5s sleep (expiry WITHOUT undo — the cache-consistency
      // part). commitDeleteWait below is registered before the
      // window-creating click, as the helper contract requires.
      const commitWait = commitDeleteWait(page, '/api/v1/visits', visitId);
      await withUndoWindow(page, async () => {
        // Click the × delete button on that row
        await targetRow.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();

        // #417: no micro-advance needed — the record tab owns its data;
        // the enqueue churn of PendingActionsContext re-renders the tab,
        // which re-reads the query cache synchronously (the frozen
        // notifyManager flush is bypassed — same surface as the US-3
        // pilot below). LOAD-BEARING: this holds only while that context
        // value stays unmemoized; a memoization cleanup would reintroduce
        // the freeze — then add a fastForward(1) micro-advance here.

        // Toast appears
        const toast = page.locator('[data-testid="toast-info"]');
        await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

        // Row is gone from the table (optimistic remove)
        await expect(
          page.locator(`[data-testid="visit-row-${visitId}"]`),
        ).not.toBeVisible({ timeout: 3_000 });
      });

      // 3. Positive sync (#417 step 5): the rewound commit DELETE has
      //    landed server-side before the tab-switch render and the DB
      //    read below.
      await commitWait;

      // 4. Switch to the settings tab and back — the row must not reappear
      await page.locator('[data-testid="tab-settings"]').click();
      await page.locator('[data-testid^="tab-client-"]').first().click();

      // 5. ASSERT — the row is still gone
      await expect(
        page.locator(`[data-testid="visit-row-${visitId}"]`),
      ).not.toBeVisible({ timeout: 3_000 });

      // Verify against DB too
      const resp = await request.get(`${BACKEND}/api/v1/visits/${visitId}`);
      expect([404, 410]).toContain(resp.status());
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-3: Undo restores the row (no DELETE sent) ─────────────────────
  test('US-3: undo restores the row and no DELETE was sent', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: 'Восстанавливаемый', price: 3000 }],
    });

    // Track DELETE requests to /api/v1/visits
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (
        req.method() === 'DELETE' &&
        /\/api\/v1\/visits\/[^/]+$/.test(req.url())
      ) {
        deleteRequests.push(req.url());
      }
    });

    try {
      // 2. ACTION — open modal, find visit, click ×
      await openClientTabFor(page, record.id, activity.id);

      const targetRow = page
        .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
        .filter({ has: page.locator('input[value="Восстанавливаемый"]') });
      await expect(targetRow).toBeVisible({ timeout: 5_000 });
      const targetTestId = await targetRow.getAttribute('data-testid');
      const visitId = targetTestId!.replace('visit-row-', '');

      // 3. The undo window under the paused page clock (#417): the 5s
      //    commit window is expired by the wrapper's instant rewind, not by
      //    a real 5.5s sleep. The DELETE tracker above was registered
      //    before the «×» click, as the helper contract requires.
      await withUndoWindow(page, async () => {
        await targetRow.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();

        // Row disappeared (optimistic) — 1s budget (#291: fails fast on an
        // empty run instead of burning 3s)
        await expect(
          page.locator(`[data-testid="visit-row-${visitId}"]`),
        ).not.toBeVisible({ timeout: 1_000 });

        // Toast appears
        const toast = page.locator('[data-testid="toast-info"]');
        await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

        // 4. Click "Отменить" in the toast (the only button it carries)
        await page.locator('button:has-text("Отменить")').click();
      });

      // 5. ASSERT — row is back (bare expect → default 10s budget: broken
      //    undo is red under any budget, the wider one only tolerates slow
      //    re-render — #291)
      await expect(
        page.locator(`[data-testid="visit-row-${visitId}"]`),
      ).toBeVisible();

      // 6. ASSERT — no DELETE was ever sent. The window expired via the
      //    rewind and the drainMs buffer already elapsed inside the wrapper,
      //    so a commit timer that survived the undo would have surfaced by
      //    now (#417 step 5, negative-case sync).
      expect(deleteRequests).toHaveLength(0);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-4: Undo survives modal close (DELETE still fires) ─────────────
  test('US-4: closing the modal does not cancel the pending delete', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: 'Уходящий', price: 3000 }],
    });

    // Track DELETE requests
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (
        req.method() === 'DELETE' &&
        /\/api\/v1\/visits\/[^/]+$/.test(req.url())
      ) {
        deleteRequests.push(req.url());
      }
    });

    try {
      // 2. ACTION — open modal, click × on the visit
      await openClientTabFor(page, record.id, activity.id);

      const targetRow = page
        .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
        .filter({ has: page.locator('input[value="Уходящий"]') });
      await expect(targetRow).toBeVisible({ timeout: 5_000 });
      const targetTestId = await targetRow.getAttribute('data-testid');
      const visitId = targetTestId!.replace('visit-row-', '');

      // The undo window under the paused page clock (#417): the × click,
      // the toast check, AND the modal close all run inside the frozen
      // window — the close must precede the commit timer, which is exactly
      // what this test proves. The wrapper's instant rewind expires the
      // window instead of a real 5.5s sleep. commitDeleteWait below is
      // registered before the window-creating click, as the helper
      // contract requires; the page.on('request') tracker above was
      // registered before it too.
      const commitWait = commitDeleteWait(page, '/api/v1/visits', visitId);
      await withUndoWindow(page, async () => {
        await targetRow.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();

        // #417: no micro-advance — record-tab surface, same mechanism
        // and LOAD-BEARING unmemoized-context caveat as US-2 above.

        // Toast appears
        const toast = page.locator('[data-testid="toast-info"]');
        await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

        // 3. Close the modal BEFORE the 5s timer fires — race-free under
        //    the paused clock: the commit timer cannot fire mid-window
        await page.locator('[data-testid="modal-close-btn"]').click();
        await expect(
          page.locator('[data-testid="activity-details-modal"]'),
        ).not.toBeVisible({ timeout: 5_000 });
      });

      // 4. Positive sync (#417 step 5): the rewound commit DELETE fired
      //    despite the modal being closed (the provider is at app level,
      //    so it survives the close) and has landed server-side.
      await commitWait;

      // 5. ASSERT — DELETE was sent
      expect(deleteRequests.length).toBeGreaterThanOrEqual(1);
      expect(deleteRequests[0]).toContain(`/api/v1/visits/${visitId}`);

      // 6. Reopen the modal — the row is gone (no zombie)
      await openClientTabFor(page, record.id, activity.id);
      await expect(
        page.locator(`[data-testid="visit-row-${visitId}"]`),
      ).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-5: Payment totals live-update in the modal ────────────────────
  test('US-5: adding a payment updates the totals row without F5', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: 'Плательщик', price: 5000 }],
    });

    try {
      // 2. ACTION — open modal, add a payment of 1500
      await openClientTabFor(page, record.id, activity.id);

      const totalsRow = page.locator('[data-testid="payments-total"]');
      // Initial total is 0 ₽ (no payments yet)
      await expect(totalsRow).toContainText('0', { timeout: 5_000 });

      await page.locator('[data-testid="btn-add-payment"]').click();
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();
      await amountInput.fill('1500');
      await amountInput.press('Enter');

      // After save, the new-row input disappears
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      // 3. ASSERT — totals row now shows 1 500 ₽
      await expect(totalsRow).toContainText('1 500', { timeout: 3_000 });

      // 4. Add a second payment — totals should update to 1 700 ₽
      await page.locator('[data-testid="btn-add-payment"]').click();
      const amountInput2 = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput2).toBeVisible();
      // Default amount will be the "К оплате" (5000 - 1500 = 3500) — overwrite
      await amountInput2.fill('200');
      await amountInput2.press('Enter');
      await expect(amountInput2).not.toBeVisible({ timeout: 5_000 });

      // Totals: 1500 + 200 = 1700
      await expect(totalsRow).toContainText('1 700', { timeout: 3_000 });
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-6: Cross-page consistency (schedule edit ↔ /clients view) ───
  test('US-6: edits in the schedule modal are visible on /clients without F5', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: 'Кроссстраничный', price: 4000 }],
    });

    try {
      // 2. ACTION — open modal in /schedule, edit the visitor name
      await openClientTabFor(page, record.id, activity.id);

      const nameInput = page
        .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
        .locator('input')
        .first();
      await expect(nameInput).toBeVisible();
      // Clear & retype — InlineEditCell commits on blur
      await nameInput.fill('Обновлённое Имя');
      await nameInput.evaluate((el: HTMLInputElement) => el.blur());

      // 3. Wait for the visitor name to be persisted server-side
      //    Use the real API: GET /api/v1/clients/{clientId}/visitors
      //    (not /api/v1/visitors?client_id= which 500s — Method Not Allowed)
      await expect
        .poll(
          async () => {
            const resp = await request.get(
              `${BACKEND}/api/v1/clients/${client.id}/visitors`,
            );
            if (!resp.ok()) return false;
            const visitors = await resp.json();
            return Array.isArray(visitors)
              ? visitors.some((v: any) => v.name === 'Обновлённое Имя')
              : false;
          },
          { timeout: 5_000, intervals: [200, 500, 1000] },
        )
        .toBe(true);

      // 4. Navigate to /clients (modal can be closed first)
      // #232: the deep link narrows via the machine id filter (NOT the
      // search box — old-scheme «UUID in search» is gone); the card
      // auto-opens and the narrowing chip renders.
      await page.locator('[data-testid="modal-close-btn"]').click();
      await page.goto('/clients?clientId=' + client.id);
      await expect(
        page.locator('[data-testid="client-card-modal"]'),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      await expectClientSearchEmpty(page);
      await expectDeepLinkChip(page, 'Открыт по ссылке');

      // 5. Switch to the record tab (left panel) — it shows the SAME visits table
      await page
        .locator('[data-testid="client-card-left-panel"] button')
        .filter({ hasText: /\d{2}\.\d{2}\.\d{4}/ })
        .first()
        .click();

      await expect(
        page.locator('[data-testid="client-record-tab"]'),
      ).toBeVisible({ timeout: 5_000 });

      // 6. ASSERT — the visit row in /clients shows the updated name
      const updatedRow = page
        .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
        .filter({ has: page.locator('input[value="Обновлённое Имя"]') });
      await expect(updatedRow.first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── US-7: Deleted payment updates client stats ──────────────────────
  test('US-7: deleting a payment decreases client.total_paid', async ({ page, request }) => {
    // 1. SETUP — record + 2 payments (3000 + 2000 = 5000)
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: 'Плательщик US-7', price: 5000 }],
    });

    const payment1Resp = await request.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: record.id, amount: 3000, method: 'card' },
    });
    expect(payment1Resp.ok()).toBeTruthy();
    const payment1 = await payment1Resp.json();

    const payment2Resp = await request.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: record.id, amount: 2000, method: 'card' },
    });
    expect(payment2Resp.ok()).toBeTruthy();
    const payment2 = await payment2Resp.json();

    try {
      // 2. Sanity-check: client has at least 5000 ₽ total_paid
      const statsBefore = await request.get(
        `${BACKEND}/api/v1/clients?per_page=100`,
      );
      const beforeList = await statsBefore.json();
      const clientBefore = (beforeList.items || beforeList).find(
        (c: any) => c.id === client.id,
      );
      const totalPaidBefore = clientBefore?.total_paid ?? 0;
      expect(totalPaidBefore).toBeGreaterThanOrEqual(5000);

      // 3. ACTION — open modal, delete the 3000 payment via × button
      await openClientTabFor(page, record.id, activity.id);

      const targetPayment = page.locator(`[data-testid="payment-${payment1.id}"]`);
      await expect(targetPayment).toBeVisible({ timeout: 5_000 });
      // The undo window under the paused page clock (#417): expiry
      // WITHOUT undo — the wrapper's instant rewind expires the commit
      // window instead of a real 5.5s sleep. commitDeleteWait below is
      // registered before the window-creating click, as the helper
      // contract requires.
      const commitWait = commitDeleteWait(page, '/api/v1/payments', payment1.id);
      await withUndoWindow(page, async () => {
        await targetPayment
          .locator(`[data-testid="payment-${payment1.id}-delete"]`)
          .click();

        // #417: no micro-advance — record-tab surface, same mechanism
        // and LOAD-BEARING unmemoized-context caveat as US-2 above.

        // Toast appears
        const toast = page.locator('[data-testid="toast-info"]');
        await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });
      });

      // 4. Positive sync (#417 step 5): the rewound commit DELETE has
      //    landed server-side before the DB reads below.
      await commitWait;

      // 5. ASSERT — DB: payment is gone
      const getAfter = await request.get(
        `${BACKEND}/api/v1/payments/${payment1.id}`,
      );
      expect([404, 410]).toContain(getAfter.status());

      // 6. ASSERT — DB: client.total_paid dropped by 3000
      const statsAfter = await request.get(
        `${BACKEND}/api/v1/clients?per_page=100`,
      );
      const afterList = await statsAfter.json();
      const clientAfter = (afterList.items || afterList).find(
        (c: any) => c.id === client.id,
      );
      const totalPaidAfter = clientAfter?.total_paid ?? 0;
      expect(totalPaidAfter).toBe(totalPaidBefore - 3000);

      // 7. Sanity: payment2 is still there
      const getPayment2 = await request.get(
        `${BACKEND}/api/v1/payments/${payment2.id}`,
      );
      expect(getPayment2.ok()).toBeTruthy();
    } finally {
      await cleanup(request, `/api/v1/payments/${payment2.id}`);
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });
});
