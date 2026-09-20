import { expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
  waitForRecordsReady,
  waitForScheduleReady,
  waitForTagsReady,
  waitForPhotosReady,
} from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';
import {
  serverPushPages as twoPages,
  expectUpdateToast,
  clickFabRobust,
  createRecordViaUI,
  lostToast,
  uid,
  PUSH_WINDOW,
} from './fixtures/server-push';

/**
 * E2E — server push invalidation, scenarios 1–4 (GH #239, spec §6).
 *
 * Two browser contexts = two admins (A and B) via the shared serverPushPages
 * fixture (fixtures/server-push.ts): writes made through B's UI (or a bare
 * APIRequestContext) must reach A's open views within the push window — all
 * push assertions use { timeout: PUSH_WINDOW = 5s }, deliberately BELOW the
 * app-wide staleTime (30s) and the dictionary staleTime (1h). A test that
 * passes without the SSE channel would be testing staleTime, not the channel.
 *
 * Requires: per-shard stack (backend :8021 / frontend :3021 in dev runs):
 *   SHARD_ID=9 SHARD_PORT=3021 BACKEND_URL=http://127.0.0.1:8021 \
 *     NEXT_PUBLIC_API_URL=http://127.0.0.1:8021 pnpm exec playwright test e2e/server-push-invalidation.spec.ts
 */

/**
 * Delete an activity through B's UI: enable «Режим удаления» in the right
 * panel, then click the activity card (#286 deferred delete).
 *
 * The CLICK sends the dry-run preview DELETE (`?dry_run=true`,
 * postData() === null) — waiting on THAT response would be falsely green
 * (a dry-run deletes nothing, any status). The helper therefore waits for
 * the COMMIT DELETE — the one carrying the `{expected}` body, which fires
 * ~5s after the undo toast — and asserts its 204. When the activity has
 * dependencies the dry-run 409 opens the needs-confirm DeleteDialog; pass
 * `confirm: true` (С3's setup activity always holds a record) so the
 * helper waits for it properly and confirms (entity-level checkbox →
 * enqueue).
 *
 * Opening the panel goes through clickFabRobust — the StampFab (fixed
 * bottom-right, z-50) shares the screen corner with the toast container
 * (fixed bottom-right, z-[250]) and parallel-spec toasts would otherwise
 * swallow the click.
 */
async function deleteActivityViaUI(
  pageB: Page,
  activityId: string,
  opts?: { confirm?: boolean },
) {
  // B must be watching the schedule for the delete to be a real UI action.
  await waitForScheduleReady(pageB);

  const panel = pageB.locator('[data-testid="right-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await clickFabRobust(pageB);
  }
  await pageB.getByRole('button', { name: 'Режим удаления' }).click();

  const commitDelete = pageB.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/activities/${activityId}`) &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
  // The WeekView carousel demotes overlapping cards to pointer-events:none
  // (z>0), so a real-mouse click can be permanently hit-test-blocked;
  // dispatchEvent reaches the same React handler (S5 pattern).
  const card = pageB.locator(`[data-testid="activity-${activityId}"]`);
  await card.click({ timeout: 5_000 }).catch(() => card.dispatchEvent('click'));

  // needs-confirm: when the activity has dependencies the dry-run 409
  // opens the DeleteDialog — a PROPER visibility wait (the dialog renders
  // after the dry-run roundtrip, an instant isVisible() would miss it),
  // then the entity-level checkbox → confirm enqueues the deferred delete.
  if (opts?.confirm) {
    const dialog = pageB.locator('[data-testid="delete-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const checkbox = pageB.locator('[data-testid="delete-dialog-confirm-checkbox"]');
    if (await checkbox.count()) await checkbox.check();
    await pageB.locator('[data-testid="delete-dialog-confirm-btn"]').click();
  }

  const resp = await commitDelete;
  expect(resp.status()).toBe(204);
}

twoPages.describe('Server push invalidation — external updates (GH #239 §6)', () => {
  // ── С1: record created via B's UI appears on A's open records table ─────

  twoPages('С1: B creates a record via UI → A sees the row + toast without reload', async ({
    pageA,
    pageB,
    request,
  }) => {
    const marker = `Push C1 ${uid()}`;

    // A opens /records first — the list is cached now; without the push it
    // stays stale for the app-wide staleTime (30s) > PUSH_WINDOW.
    await waitForRecordsReady(pageA);

    let created: { id: string; client_id: string } | null = null;
    try {
      created = await createRecordViaUI(pageB, marker);
      const row = pageA.locator('table tbody tr').filter({ hasText: marker });

      // PUSH ASSERTIONS — both must hold within the push window.
      await expect(row).toBeVisible({ timeout: PUSH_WINDOW });
      await expectUpdateToast(pageA);
    } finally {
      if (created) {
        await cleanupRecord(request, created.id);
        await cleanup(request, `/api/v1/clients/${created.client_id}`);
      }
    }
  });

  // ── С2: tag added via B's UI is offered by A's tag typeahead ────────────

  twoPages('С2: B adds a tag via UI → A\'s tag picker offers it within the push window', async ({
    pageA,
    pageB,
    request,
  }) => {
    const tagName = `push-c2-${uid()}`;
    let tagId: string | null = null;

    // A opens /photos — the tags dictionary (DICT_STALE_TIME = 1h) is fetched
    // and cached here; without the push the new tag stays invisible for 1h.
    await waitForPhotosReady(pageA);

    // B creates the tag through the tags page UI.
    await waitForTagsReady(pageB);
    await pageB.click('text=+ Добавить тег');
    const dialog = pageB.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').first().fill(tagName);
    const createResponse = pageB.waitForResponse(
      (r) => r.url().includes('/api/v1/tags') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    const resp = await createResponse;
    expect(resp.status()).toBe(201);
    tagId = ((await resp.json()) as { id: string }).id;

    try {
      // PUSH ASSERTION — type ≥2 chars (RemoteSearchSelect min-2 clamp +
      // 300ms debounce), the refetched dictionary must offer the new tag.
      // One cheap retry: if the push lands mid-debounce the first fill may
      // query the still-stale dictionary — re-firing re-queries the refetched one.
      const tagInput = pageA.getByPlaceholder('Добавить тег...');
      const prefix = tagName.slice(0, 8);
      const option = pageA.getByRole('option', { name: tagName });
      await tagInput.click();
      await tagInput.fill(prefix);
      if (!(await option.isVisible().catch(() => false))) {
        await tagInput.fill(prefix.slice(0, -1));
        await tagInput.fill(prefix);
      }
      await expect(option).toBeVisible({ timeout: PUSH_WINDOW });
    } finally {
      if (tagId) await cleanup(request, `/api/v1/tags/${tagId}`);
    }
  });

  // ── С3: activity deleted via B's UI → A's grid updates + records converge ─

  twoPages('С3: B deletes an activity via UI → A\'s grid refetches and records converge', async ({
    pageA,
    pageB,
    request,
  }) => {
    const marker = `Push C3 ${uid()}`;
    // SETUP via bare API: an activity NOW (current week = A's default view)
    // holding a record booked for `marker`.
    const client = await createTestClient(request, { name: marker });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // A: records table shows the record (populates ['records'] cache …)
      await waitForRecordsReady(pageA);
      const recordRow = pageA.locator('table tbody tr').filter({ hasText: marker });
      await expect(recordRow).toBeVisible({ timeout: 10_000 });

      // … then A moves on to /schedule (SPA navigation keeps the cache) and
      // sees the new activity card.
      await waitForScheduleReady(pageA);
      const card = pageA.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // B deletes the activity through the UI (dry-run + needs-confirm
      // dialog for the record it holds + commit at the window end).
      await deleteActivityViaUI(pageB, activity.id, { confirm: true });

      // DB ASSERTION (#286) — the commit DELETE executed for real: the
      // activity row is GONE from the shard DB after the window.
      await expect
        .poll(
          () => queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`),
          { timeout: PUSH_WINDOW },
        )
        .toBeNull();

      // PUSH ASSERTION 1 — A's grid loses the card within the push window.
      await expect(card).not.toBeVisible({ timeout: PUSH_WINDOW });

      // PUSH ASSERTION 2 — the records family converged: A returns to
      // /records QUICKLY (inside the 30s staleTime). The push-invalidated
      // ['records'] query must refetch despite being "fresh"; without the
      // channel the cached row would still be served.
      const viewResponse = pageA.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view') && r.request().method() === 'GET',
        { timeout: PUSH_WINDOW },
      );
      await pageA.getByRole('link', { name: 'Записи' }).click();
      const refetch = await viewResponse; // must refetch NOW, not on stale expiry
      expect(refetch.status()).toBe(200);
      await expect(recordRow).not.toBeVisible({ timeout: PUSH_WINDOW });
    } finally {
      // UI delete is the test subject, not a prerequisite — if it failed,
      // remove the setup activity via the #286 cleanup contract so parallel
      // runs don't inherit it. A re-cleanup of a succeeded delete is
      // idempotent (the dry-run 404 is swallowed).
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── С4: bare API write (origin: null) → A updates + toast ───────────────

  twoPages('С4: bare API activity POST (no tab header) → A\'s schedule updates + toast', async ({
    pageA,
    request,
  }) => {
    // A is watching the current week.
    await waitForScheduleReady(pageA);

    // Bare request-level write — NO X-Memo-Tab-Id header (future #6 client
    // flow simulation): origin is null, so A's toast must NOT be suppressed.
    const created = await createTestActivity(request);

    try {
      // PUSH ASSERTIONS — new card + external-origin toast, both in-window.
      await expect(
        pageA.locator(`[data-testid="activity-${created.id}"]`),
      ).toBeVisible({ timeout: PUSH_WINDOW });
      await expectUpdateToast(pageA);
    } finally {
      await cleanup(request, `/api/v1/activities/${created.id}`);
    }
  });

  // ── С5/S5 (#330): healthy channel with a short flap → NO loss toast ─────

  twoPages('S5 (#330): brief SSE flap (2s < 5s debounce) on a healthy run → «Нет соединения» never appears', async ({
    pageA,
    pageB,
    ctxA,
    request,
  }) => {
    // A is watching the current week on a HEALTHY channel (the whole point:
    // S5 asserts silence on a healthy run with a reconnect, not during an
    // outage — spec §2 S5 «дрожь ниже порога молчит»).
    await waitForScheduleReady(pageA);

    // SHORT FLAP — the events route is aborted for 2s only. The ES socket
    // dies and retries natively (retry: 5000 from the server; observed
    // reconnect cadence under abort ~3s), onerror fires in CONNECTING
    // state, but the 5s debounce (LOST_DEBOUNCE_MS) never elapses: the
    // channel is back before the timer fires and onopen CANCELS it. This
    // is exactly the sub-threshold jitter the indicator must stay silent
    // on (vehicle rationale: see server-push-offline.spec.ts VEHICLE).
    await ctxA.route('**/api/v1/events', (route) => route.abort('connectionreset'));
    await pageA.waitForTimeout(2_000);
    await ctxA.unroute('**/api/v1/events');

    // SILENCE WINDOW — wait out BOTH the debounce budget (5s from the last
    // onerror: had the timer survived, the toast would appear by now) and
    // the reconnect (onopen cancels any pending timer). 7s > 5s debounce,
    // so a timer that wrongly survived the reconnect is still caught; a
    // healthy implementation shows NOTHING.
    await pageA.waitForTimeout(7_000);
    await expect(lostToast(pageA)).toHaveCount(0);

    // CHANNEL-ALIVE PIN — silence alone is ambiguous (a dead channel is
    // also silent); the flap must have ENDED in a reconnect. B's real UI
    // write must still push to A within the window: convergence + the
    // standard update toast prove the channel is delivering again.
    const marker = `Push S5 ${uid()}`;
    let created: { id: string; client_id: string } | null = null;
    try {
      created = await createRecordViaUI(pageB, marker);
      await expectUpdateToast(pageA);
    } finally {
      if (created) {
        await cleanupRecord(request, created.id);
        await cleanup(request, `/api/v1/clients/${created.client_id}`);
      }
    }
  });
});
