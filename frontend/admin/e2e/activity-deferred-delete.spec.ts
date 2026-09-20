import { test, expect } from './fixtures/test';
import type { Page, Request } from '@playwright/test';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { waitForScheduleReady } from './fixtures/helpers';
import { clickFabRobust } from './fixtures/server-push';

/**
 * GH #286 — deferred activity delete with undo (spec §6 S1–S6).
 *
 * The card/modal call sites route into the context's shared pipeline:
 * ensure-fresh → dry-run preview (?dry_run=true, NO body) → on the clean
 * path an optimistic removal + 5s undo toast → commit DELETE with the
 * `{expected}` body; on a 409 dependency tree the needs-confirm DeleteDialog
 * opens (items one-liners + refetch-note banner when the ensure-fresh
 * actually refetched) → confirm enqueues the same deferred pipeline.
 *
 * Request-level rule inherited from #285: the click's dry-run has
 * postData() === null — every "was the delete sent" assertion keys on the
 * COMMIT DELETE (non-null body), never on the click's own response.
 *
 * Full Cycle per test: SETUP via factories → UI action → UI asserts →
 * DB asserts (SQLite) → cleanup in finally (activity contract + record +
 * client). S6's mid-window visit appearance is asserted as a unit subset in
 * ScheduleDataContext/DeleteDialog unit tests — here only the 409 → honest
 * toast → «Обновить» invalidation path is exercised.
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** The undo toast that carries the deferred-delete message (#94 countdown). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** COMMIT-DELETE listener: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none —
 *  postData() === null, so the predicate cannot match the preview. */
function commitDeleteWait(page: Page, activityId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/activities/${activityId}`) &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

/** Enable «Режим удаления» in the right panel (open through the FAB if
 *  collapsed — clickFabRobust waits out corner-sharing toasts, #239). */
async function enableDeleteMode(page: Page) {
  const panel = page.locator('[data-testid="right-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await clickFabRobust(page);
  }
  await page.getByRole('button', { name: 'Режим удаления' }).click();
}

/** Click the activity card (real mouse first; the WeekView carousel may
 *  demote overlapping cards to pointer-events:none — dispatchEvent reaches
 *  the same React handler, S5 pattern). */
async function clickCard(page: Page, activityId: string) {
  const card = page.locator(`[data-testid="activity-${activityId}"]`);
  await card.click({ timeout: 5_000 }).catch(() => card.dispatchEvent('click'));
  return card;
}

/** Tracker of COMMITTING activity deletes (DELETE with a NON-EMPTY body).
 *  The dry-run preview (postData() === null) is not counted — the #285 S2
 *  pattern, panel wave 2. */
function trackBodyDeletes(page: Page, activityId: string) {
  const bodyDeletes: string[] = [];
  const onRequest = (req: Request) => {
    if (
      req.method() === 'DELETE' &&
      req.url().includes(`/api/v1/activities/${activityId}`) &&
      req.postData() !== null
    ) {
      bodyDeletes.push(req.url());
    }
  };
  page.on('request', onRequest);
  return { bodyDeletes, stop: () => page.off('request', onRequest) };
}

test.describe('Deferred activity delete with undo (GH #286)', () => {
  // ── S1: card, clean path — optimistic removal, commit at window end ──────

  test('S1: clean activity — card disappears, undo toast with countdown, commit DELETE, gone from DB', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Register BEFORE the click so the listener cannot miss the 5s-window
      // commit response.
      const commitWait = commitDeleteWait(page, activity.id);

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      // Optimistic removal + undo toast with the 5s countdown ring (#94).
      await expect(card).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByRole('button', { name: 'Отменить' })).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      // Window expires → commit fires with the expected-state body → 204.
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // Fresh load: the card is gone from the grid…
      await waitForScheduleReady(page);
      await expect(page.locator(`[data-testid="activity-${activity.id}"]`)).toHaveCount(0);
      // …and the activity is gone from the DB (hard delete).
      expect(queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`)).toBeNull();
    } finally {
      // Idempotent: a re-cleanup of a succeeded delete dry-run-404s quietly.
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── S2: undo inside the window — no committing DELETE was ever sent ──────

  test('S2: undo — card returns, no committing DELETE with body, activity survives', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, activity.id);

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      // Optimistic removal + undo toast…
      await expect(card).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();

      // …undone inside the window: card returns, toast hides.
      await toast.getByRole('button', { name: 'Отменить' }).click();
      await expect(card).toBeVisible();
      await expect(toast).toBeHidden();

      // Let the full window elapse: no committing DELETE may have been sent
      // (the dry-run — postData() === null — does not count).
      await page.waitForTimeout(5_500);
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // The activity is still alive in the DB.
      const row = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(activity.id);
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── S3: needs-confirm dialog — one-liners + stale-prime refresh banner ───

  // The ensure-fresh prime (D3 step 1) refetches the week cache when it is
  // invalidated or older than the 30s staleTime — only a REAL refetch sets
  // `refetched` and only then the dialog renders the
  // «Карточка обновлена по данным сервера» banner. In e2e the reachable
  // trigger is TIME: the page sits idle past the staleTime before the click.
  test('S3: activity with a record — dialog shows one-liners, stale prime shows the refresh banner', async ({
    page,
    request,
  }) => {
    const marker = `Deferred S3 ${Date.now()}`;
    const client = await createTestClient(request, { name: marker });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Stale prime: idle past the app-wide staleTime (30s) so the ensure-
      // fresh refetch fires on the delete click (D3 step 1 → refetched=true).
      await page.waitForTimeout(33_000);

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      // needs-confirm: the DeleteDialog renders at the view level (it
      // survives the card's optimistic unmount).
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="delete-dialog-title"]')).toHaveText(
        'Удаление занятия',
      );

      // Stale prime — the banner is the dialog's FIRST line.
      await expect(page.locator('[data-testid="delete-dialog-refetch-note"]')).toHaveText(
        'Карточка обновлена по данным сервера',
      );

      // One-liners (GH #285 D9в builders, activity tree): the records group
      // carries per-row lines «{service}, {date}, {client}», the aggregated
      // visits group the factory visit «Без тарифа, {price}».
      const recordLine = page
        .locator('[data-testid="dep-records"] li')
        .filter({ hasText: marker });
      await expect(page.locator('[data-testid="dep-records"]')).toContainText(
        'Записи — будут удалены:',
      );
      await expect(recordLine).toHaveCount(1);
      await expect(recordLine).toContainText(new Date().toISOString().slice(0, 10));
      await expect(page.locator('[data-testid="dep-visits"]')).toContainText(
        'Посещения — будут удалены:',
      );
      await expect(page.locator('[data-testid="dep-visits"]')).toContainText('Без тарифа, 3500');

      // Cancel — nothing deleted, no commit DELETE with body.
      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(dialog).toHaveCount(0);
      await expect(card).toBeVisible();

      const activityRow = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(activityRow).not.toBeNull();
      const recordRow = queryDBRow(`SELECT id FROM records WHERE id='${record.id}'`);
      expect(recordRow).not.toBeNull();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── S4: cascade delete confirmed, then undone — no server write ──────────

  test('S4: cascade path — confirm enqueues, undo in window restores the card, no commit DELETE', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, activity.id);

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      // The record makes the dry-run 409 → needs-confirm dialog; the
      // entity-level checkbox gates the confirm (no per-record choices).
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();
      await dialog.locator('[data-testid="delete-dialog-confirm-btn"]').click();

      // Optimistic removal + undo toast with the countdown ring…
      await expect(card).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      // …undone inside the window: the card returns, toast hides.
      await toast.getByRole('button', { name: 'Отменить' }).click();
      await expect(card).toBeVisible();
      await expect(toast).toBeHidden();

      // Let the full window elapse: no committing DELETE was sent.
      await page.waitForTimeout(5_500);
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // Activity + record + the factory visit are all alive in the DB.
      const activityRow = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(activityRow).not.toBeNull();
      const recordRow = queryDBRow(`SELECT id FROM records WHERE id='${record.id}'`);
      expect(recordRow).not.toBeNull();
      const visits = queryDBRows(`SELECT id FROM visits WHERE record_id='${record.id}'`);
      expect(visits.length).toBeGreaterThan(0);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── S5: commit failure (no response) — card restored + red toast ─────────

  test('S5: network lost in window — commit fails, card returns with red toast, activity survives', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Abort the committing DELETE BEFORE the click (records.spec.ts S3b
      // pattern): the request never reaches the server, so the fetch rejects
      // with a network error (non-ApiError) and the deletion outcome stays
      // UNKNOWN. context.setOffline() is NOT reliable for this — loopback
      // requests to 127.0.0.1:8000 can still land (row deleted server-side
      // while the client saw a network error), breaking the DB assertion.
      await page.route(`**/api/v1/activities/${activity.id}*`, (route) => {
        const req = route.request();
        if (req.method() === 'DELETE' && req.postData() !== null) {
          return route.abort('failed');
        }
        return route.continue();
      });
      // No waitForResponse — an aborted request never answers. waitForRequest
      // pins the attempt itself (fires even for aborted requests).
      const commitAttempt = page.waitForRequest(
        (req) =>
          req.url().includes(`/api/v1/activities/${activity.id}`) &&
          req.method() === 'DELETE' &&
          req.postData() !== null,
        { timeout: 15_000 },
      );

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      await expect(card).not.toBeVisible();
      await expect(undoToast(page)).toBeVisible();

      // Window expires → the commit DELETE attempt fires and is aborted.
      await commitAttempt;

      // The commit failure surfaces as the card returning…
      await expect(card).toBeVisible({ timeout: 15_000 });
      // …and the honest no-response toast «Не удалось подтвердить
      // удаление» (#243): a network-lost commit is a non-ApiError —
      // the outcome is unknown, so no «Изменение отменено» claim.
      const errorToast = page
        .locator('[data-testid="toast-error"]')
        .filter({ hasText: 'Не удалось подтвердить удаление' });
      await expect(errorToast).toBeVisible();

      // The activity is still alive in the DB (nothing reached the server).
      const row = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(activity.id);
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── S6: mid-window race on the NESTED level — visit added → 409 → «Обновить» ──

  // A visit is added through page.request INTO the record already confirmed
  // in the dry-run tree (the nested visits level of the two-level subtree):
  // the commit's expected set no longer covers the server state → 409
  // stale_dependencies → staleAwareOnError: card restored + honest toast
  // with the «Обновить» action that invalidates the activities family
  // (the week refetches). The visit's appearance in the dialog tree is a
  // unit subset (ScheduleDataContext / DeleteDialog unit tests).
  test('S6: visit added mid-window — commit 409, card returns with «Обновить», week invalidates', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const commitWait = commitDeleteWait(page, activity.id);

      await enableDeleteMode(page);
      await clickCard(page, activity.id);

      // Cascade path: dry-run 409 → dialog → confirm → enqueue with the
      // expected set snapshotted from the dry-run tree.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();
      await dialog.locator('[data-testid="delete-dialog-confirm-btn"]').click();

      await expect(card).not.toBeVisible();
      await expect(undoToast(page)).toBeVisible();

      // The race: a colleague adds a VISIT to the confirmed record while
      // the undo window is open (page.request — no tab header).
      const visitResp = await page.request.post(`${BACKEND}/api/v1/visits`, {
        data: { record_id: record.id, price: 2500 },
      });
      expect(visitResp.status()).toBe(201);

      // Window expires → the commit DELETE carries the confirmed expected
      // set, but the record now has a visit it never confirmed → 409.
      const commit = await commitWait;
      expect(commit.status()).toBe(409);

      // Honest error: the card returns + the red toast carries the text
      // «Не удалось удалить: данные изменились» AND the «Обновить» action
      // (toast lives 4500ms — assert and click promptly).
      await expect(card).toBeVisible();
      const errorToast = page
        .locator('[data-testid="toast-error"]')
        .filter({ hasText: 'Не удалось удалить: данные изменились' });
      await expect(errorToast).toBeVisible();
      const refreshBtn = errorToast.getByRole('button', { name: 'Обновить' });
      await expect(refreshBtn).toBeVisible();

      // «Обновить» invalidates the activities family → the week refetches.
      const weekRefetch = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/activities') &&
          r.request().method() === 'GET' &&
          r.status() === 200,
        { timeout: 10_000 },
      );
      await refreshBtn.click();
      await weekRefetch;

      // Nothing was deleted: the activity AND both visits are alive.
      const activityRow = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(activityRow).not.toBeNull();
      const visits = queryDBRows(`SELECT id FROM visits WHERE record_id='${record.id}'`);
      expect(visits).toHaveLength(2);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Modal variants (Task 5) — btn-delete-activity routes into the SAME flow ──

  test('S1m: modal delete button, clean activity — modal closes, undo toast, commit DELETE', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const commitWait = commitDeleteWait(page, activity.id);

      // Plain card click opens the details modal; its footer «Удалить
      // активность» initiates the same deferred flow and the modal closes
      // immediately (the pending action survives unmount, app-level provider).
      await card.click({ timeout: 5_000 }).catch(() => card.dispatchEvent('click'));
      await expect(page.locator('[data-testid="activity-details-modal"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator('[data-testid="btn-delete-activity"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).toHaveCount(0);

      // Undo toast immediately; the commit fires at the window end → 204.
      await expect(undoToast(page)).toBeVisible();
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      await waitForScheduleReady(page);
      await expect(page.locator(`[data-testid="activity-${activity.id}"]`)).toHaveCount(0);
      expect(queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`)).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  test('S3m: modal delete button, activity with a record — modal closes, needs-confirm dialog opens', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      await card.click({ timeout: 5_000 }).catch(() => card.dispatchEvent('click'));
      await expect(page.locator('[data-testid="activity-details-modal"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator('[data-testid="btn-delete-activity"]').click();

      // The modal closes immediately; the pending-confirm dialog renders at
      // the schedule level and survives the unmount.
      await expect(page.locator('[data-testid="activity-details-modal"]')).toHaveCount(0);
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="delete-dialog-title"]')).toHaveText(
        'Удаление занятия',
      );
      await expect(page.locator('[data-testid="dep-records"]')).toContainText(
        'Записи — будут удалены:',
      );

      // Cancel — nothing deleted.
      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(dialog).toHaveCount(0);

      const activityRow = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(activityRow).not.toBeNull();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
