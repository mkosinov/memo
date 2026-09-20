import { test, expect } from './fixtures/test';
import {
  waitForRecordsReady,
  waitForScheduleReady,
  openAddTab,
  closeModal,
} from './fixtures/helpers';
import { cleanupRecord, cleanup, createTestActivity } from './fixtures/factories';
import {
  serverPushPages,
  expectNoOwnEchoToast,
  openFrameLogger,
  createRecordViaUI,
  lostToast,
  uid,
  PUSH_WINDOW,
  RECONNECT_WINDOW,
} from './fixtures/server-push';

/**
 * E2E — server push invalidation, scenarios 5–6 (GH #239, spec §6) plus
 * the connection-loss indicator scenarios S1/S2/S3/S6 (GH #330, spec §2).
 *
 * С5 (offline convergence): while A's context emulates offline, B (still
 * online) creates a record — a REAL mid-outage write; back online, A must
 * converge WITHOUT reload via the provider's reconnect blanket invalidate.
 * Outage = context-level setOffline (NOT route.abort — it does not reliably
 * intercept EventSource, spec §6). App-ambient fallbacks are disabled so
 * the assertion really measures the channel:
 *   - refetchOnReconnect: false (providers.tsx) — otherwise TanStack's
 *     onlineManager alone would refetch after setOffline(false), passing С5
 *     even with a dead SSE channel;
 *   - convergence budget (RECONNECT_WINDOW ≈ 10s) stays BELOW the records
 *     staleTime (30s) — without the blanket invalidate the marker row stays
 *     invisible for the whole window.
 * NOTE (#330 probe): setOffline leaves A's ESTABLISHED EventSource socket
 * alive (27s offline → zero onerror events; see VEHICLE below), so С5's
 * outage raises NO loss toast — the #330 S-scenarios therefore use the
 * route.abort vehicle instead. С5 itself is preserved exactly as in #239.
 *
 * С6 (own-mutation silence): A creates a record through its OWN UI; the
 * table updates via A's own invalidation path while the «Данные обновлены»
 * toast must NOT appear (origin.id === A's tab id, spec §2.4 suppression).
 * Silence is probed NON-retrying inside the toast lifetime, immediately
 * after the POST resolves (see expectNoOwnEchoToast in fixtures/server-push).
 *
 * S1 (#330): the SSE channel dies → the provider arms a 5s debounce → the
 * persistent toast «Нет соединения с сервером. Обновления приостановлены.»
 * must be visible — the CEILING is 8s (5s debounce + ES error/retry
 * latency). The toast has NO close button (persistent kind — the ×
 * aria-label="Закрыть" button is only rendered for non-persistent toasts)
 * and survives past the regular 4.5s toast lifetime (no auto-dismiss).
 *
 * VEHICLE — route.abort, NOT setOffline (probe-verified, dev Chromium):
 * `context.setOffline(true)` does NOT kill an ESTABLISHED EventSource
 * socket — new requests are blocked, but the open SSE connection lives on
 * (the #330 spec §6 R1 «тихая смерть» residual, empirically confirmed:
 * 27s offline → zero onerror events). The 5s debounce therefore never arms
 * and С5's convergence keeps working through the zombie channel. A
 * cold-start abort — an events-route abort registered BEFORE page.goto —
 * kills the channel deterministically: ES connect fails, onerror fires
 * with readyState 0 (CONNECTING loop), the debounce arms. navigator.onLine
 * stays TRUE, so SPA navigation still works and React Query fetches
 * normally (they fail with TypeError via the aborted routes — exactly the
 * transport-class the §5.4 gate suppresses).
 *
 * S3 (#330): channel down + several SECTION NAVIGATIONS (SPA link clicks)
 * — every newly mounted page fires fresh query families (/clients,
 * /records) that fail with TypeError («Ошибка сети»). The Task-5 gate
 * (QueryCache.onError → isNetworkError && isChannelDown) suppresses them
 * while the channel is down, so the count ceiling is ONE toast (not zero —
 * the first failure can race ahead of the channel flag flip, residual R3).
 * The count is taken AFTER a full React Query retry cycle (~4s: 2 retries
 * with ~1s exponential backoff + jitter) so a late pre-gate firing would
 * be caught — an early snapshot would pass vacuously. Non-vacuous by
 * probe evidence: the aborted families DO fail (3 card-click records
 * fetches → 3 requestfailed events → 0 toasts with the gate; without the
 * gate every failed family would toast).
 *
 * S6 (#330): channel down + mutations stay audible. After the navigation
 * phase observes ZERO transport toasts (gate active), a UI action that
 * fails (quick-add record create → the raw fetch chain in
 * useRecordMutations is a plain promise, NOT a query — the gate only sits
 * in QueryCache.onError) must produce EXACTLY +1 action error toast
 * («Ошибка сети»). This is the spec §2 S6 sequencing: navigation silence
 * and action errors are told apart by ORDER (0 → +1), not by text.
 *
 * S2 (#330): channel restored (unroute) → the ES reconnect (open event)
 * cancels the debounce/hides the persistent toast AND blanket-invalidates
 * — an entity created DURING the outage via bare API converges on the
 * open schedule without reload. Both assertions share the RECONNECT
 * budget.
 *
 * SERIAL: С5's reconnect blanket + any sibling file's mutations broadcast to
 * ALL open contexts under fullyParallel; С5's outage/reconnect churn also
 * disturbs a concurrently running С6. Isolation-independently green, the two
 * scenarios interfere when parallel — serialize the file (precedent:
 * visual-compliance-checks.spec.ts). The #330 S-scenarios extend the same
 * outage machinery and inherit the serialization.
 *
 * Requires: per-shard stack (backend :8021 / frontend :3021 in dev runs):
 *   SHARD_ID=9 SHARD_PORT=3021 BACKEND_URL=http://127.0.0.1:8021 \
 *     NEXT_PUBLIC_API_URL=http://127.0.0.1:8021 pnpm test:e2e -- server-push-offline.spec.ts
 */

/** #330 S1 ceiling: 5s debounce (LOST_DEBOUNCE_MS) + SSE socket teardown
 *  latency. The toBeVisible timeout is a CEILING — the assert fails if the
 *  toast is late, not early. */
const LOSS_TOAST_WINDOW = 8_000;

/** #330: full React Query retry cycle for TypeError (failureCount < 2 with
 *  ~1s exponential backoff + jitter) — toast counts are taken only after
 *  this budget, so pre-gate firings that surface via a retried failure are
 *  inside the snapshot (an early snapshot could pass vacuously). */
const RETRY_CYCLE = 4_000;

/** #330 S6: transient toasts live 4.5s (UIContext); the count snapshots
 *  happen while such a toast would still be on screen. */
const TOAST_LIFE = 4_500;

test.describe.configure({ mode: 'serial' });

serverPushPages.describe('Server push invalidation — offline & own mutations (GH #239 §6)', () => {
  // ── С5: mid-outage write → reconnect → blanket invalidate converges A ────

  serverPushPages('С5: write while A is offline → A converges within ~10s of back online', async ({
    pageA,
    ctxA,
    pageB,
    request,
  }) => {
    const marker = `Push C5 ${uid()}`;

    // A opens /records first — the list is cached now; without the push it
    // stays stale for the app-wide staleTime (30s) > RECONNECT_WINDOW.
    await waitForRecordsReady(pageA);

    // A goes OFFLINE (context-level network emulation; EventSource errors,
    // provider marks hadError — EventSource retries natively per retry: 5000).
    await ctxA.setOffline(true);

    // REAL mid-outage write: B (still online) creates the record NOW, while
    // A cannot possibly receive it live.
    let created: { id: string; client_id: string } | null = null;
    try {
      created = await createRecordViaUI(pageB, marker);

      // A back online — the SSE reconnect must fire the blanket invalidate;
      // the refetched records list carries the marker row.
      await ctxA.setOffline(false);

      // CONVERGENCE ASSERTION — no reload, no navigation: the row must
      // appear within ~10s of going back online (RECONNECT_WINDOW < 30s
      // staleTime, so only the reconnect blanket can produce it).
      const row = pageA.locator('table tbody tr').filter({ hasText: marker });
      await expect(row).toBeVisible({ timeout: RECONNECT_WINDOW });

      // Reconnect convergence raises NO toast (spec §4.2) — the external
      // invalidate frame never reached A while offline, and the blanket is
      // deliberately silent. (Foreign toasts from parallel specs are not
      // asserted here — the scenario's subject is convergence, not toast.)
    } finally {
      if (created) {
        await cleanupRecord(request, created.id);
        await cleanup(request, `/api/v1/clients/${created.client_id}`);
      }
    }
  });

  // ── С6: own mutation updates the table but stays toast-silent ────────────

  serverPushPages('С6: A creates a record via own UI → table updates, NO update toast', async ({
    pageA,
    browser,
    request,
  }) => {
    // Frame logger: a dedicated context subscribed to the raw SSE stream —
    // lets the silence probe attribute any toast to own-echo vs foreign
    // interference (the hub broadcasts every mutation to ALL contexts).
    // Every probe attempt performs a REAL own write with a UNIQUE marker
    // (attempt suffix — never reuse a marker across attempts: after an
    // interference-retry two rows would match and the final row assertion
    // would trip Playwright strict mode). The LAST attempt's marker is the
    // asserted row; all writes are tracked for cleanup.
    const frameLog = await openFrameLogger(browser);
    const created: { id: string; client_id: string }[] = [];
    const baseMarker = `Push C6 ${uid()}`;

    const doOwnWrite = async (markerSuffix: string) => {
      // OWN write through A's UI — carries A's real tab header, the backend
      // echoes it as origin {type:'tab', id:<A's tab id>}.
      const marker = `${baseMarker}${markerSuffix}`;
      const today = new Date().toISOString().slice(0, 10);
      await openAddTab(pageA, { date: today });

      const phone = `+7999${Date.now().toString().slice(-7)}`;
      await pageA.getByTestId('input-phone').fill(phone);
      await pageA.getByTestId('input-client-name').fill(marker);

      const createResponse = pageA.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await pageA.getByTestId('btn-create-record').click();
      const resp = await createResponse;
      expect(resp.status()).toBe(201);
      created.push((await resp.json()) as { id: string; client_id: string });
    };

    // Between probe attempts: close the modal left open by the previous
    // attempt's write (it switches to the settings tab after creation) so
    // the retry write starts from a clean surface.
    const resetSurface = async () => {
      await closeModal(pageA);
    };

    try {
      // A populates the records cache, then SPA-navigates to the schedule
      // (in-app link click — a full reload would wipe the React Query cache
      // and let a fresh mount-fetch masquerade as own invalidation).
      await waitForRecordsReady(pageA);
      const scheduleCards = pageA.waitForSelector('[data-testid^="activity-"]', {
        timeout: 15_000,
      });
      await pageA.getByRole('link', { name: 'Расписание' }).click();
      await scheduleCards;

      // SILENCE ASSERTION — probed IMMEDIATELY after the own mutation
      // resolves, while the modal is still open: the SSE echo of A's own
      // write arrives within milliseconds; if origin suppression were broken
      // the «Данные обновлены» toast would be mid-life (~4.5s) on screen and
      // the non-retrying probe (2s wait → instant count check) fails it —
      // UNLESS foreign frames (sibling spec's broadcast) attribute the toast
      // to cross-test interference, in which case the probe retries once.
      // In GREEN the probe observes zero «Данные обновлены» toasts.
      await expectNoOwnEchoToast(pageA, frameLog, doOwnWrite, resetSurface);

      // The modal stays open after creation (switches to the settings tab) —
      // close it so the sidebar link is clickable.
      await closeModal(pageA);

      // Back to /records via the sidebar LINK (SPA navigation — cache
      // survives). Own invalidation must have marked ['records'] stale, so
      // the cached list refetches on mount and shows the LAST attempt's
      // marker row even inside the 30s staleTime. (Unique per-attempt
      // markers: the last attempt's write is the one this row asserts.)
      const lastMarker = `${baseMarker}#a${created.length}`;
      const viewResponse = pageA.waitForResponse(
        (r) => r.url().includes('/api/v1/records/view') && r.request().method() === 'GET',
        { timeout: PUSH_WINDOW },
      );
      await pageA.getByRole('link', { name: 'Записи' }).click();
      const refetch = await viewResponse; // own invalidation refetches NOW
      expect(refetch.status()).toBe(200);

      const row = pageA.locator('table tbody tr').filter({ hasText: lastMarker });
      await expect(row).toBeVisible({ timeout: PUSH_WINDOW });
    } finally {
      // Frame logger SSE connection + interval must not leak into the
      // next test; frames were already consumed by the probe.
      await frameLog.close().catch(() => {});
      // UI-create is the test subject; clear leftovers via API so parallel
      // runs don't inherit them (already-deleted → swallowed 404).
      for (const rec of created) {
        await cleanupRecord(request, rec.id);
        await cleanup(request, `/api/v1/clients/${rec.client_id}`);
      }
    }
  });

  // ── #330 S1+S2: channel dead → persistent toast; restored → hidden + converged

  serverPushPages('S1+S2 (#330): dead channel → persistent loss toast ≤8s, no ×, survives 4.5s; restored → hidden + blanket converge', async ({
    pageA,
    ctxA,
    request,
  }) => {
    // The route is registered on A's CONTEXT before any page load — the ES
    // constructor itself fails (cold start), onerror fires in CONNECTING
    // state and the 5s debounce arms deterministically (see VEHICLE).
    await ctxA.route('**/api/v1/events', (route) => route.abort('connectionreset'));

    // Schedule load: activity GETs pass (only /events is aborted), the page
    // is interactive while the channel is dead.
    await waitForScheduleReady(pageA);

    // S1 — the persistent toast appears within the 8s CEILING (5s debounce
    // + ES error latency; probe: ~4.4s from ready). Scoped by text: the
    // toast-error testid is shared with transient «Ошибка сети» toasts.
    const toast = lostToast(pageA);
    await expect(toast).toBeVisible({ timeout: LOSS_TOAST_WINDOW });

    // S1 — persistent toasts render NO close button: the × (aria-label
    // «Закрыть») is only rendered for non-persistent toasts.
    expect(await toast.getByLabel('Закрыть').count()).toBe(0);

    // S1 — persistence: a regular error toast auto-dismisses at 4.5s; the
    // loss toast must still be on screen past that mark.
    await pageA.waitForTimeout(TOAST_LIFE + 1_000);
    await expect(toast).toBeVisible();

    // MID-OUTAGE WRITE via bare API (the `request` context is NOT routed —
    // only A's browser context is): an activity created while A's channel
    // is dead. Converging on it after the restore needs the reconnect
    // blanket (staleTime 30s > RECONNECT_WINDOW).
    const created = await createTestActivity(request);

    try {
      // S2 — channel restored: ES retry (~3s cadence) connects, onopen
      // hides the toast AND blanket-invalidates. Both must land within the
      // reconnect budget; the toast hide is probed FIRST so a hide that
      // only happened after convergence cannot pass vacuously.
      await ctxA.unroute('**/api/v1/events');
      await expect(toast).toBeHidden({ timeout: RECONNECT_WINDOW });
      await expect(
        pageA.locator(`[data-testid="activity-${created.id}"]`),
      ).toBeVisible({ timeout: RECONNECT_WINDOW });
    } finally {
      await cleanup(request, `/api/v1/activities/${created.id}`);
    }
  });

  // ── #330 S3+S6: gate silence across navigations; action errors stay audible

  serverPushPages('S3+S6 (#330): channel down + section navigation → ≤1 «Ошибка сети»; failing action → exactly +1 toast', async ({
    pageA,
    ctxA,
  }) => {
    // Channel dead (cold-start abort) + transport failures for the two
    // families the section walk touches: ['clients'] (/clients page) and
    // ['records'] (records table + card queries). navigator.onLine stays
    // true → SPA navigation works and the queries RUN (they fail — probe:
    // 3 aborted records fetches produced 3 requestfailed events and ZERO
    // toasts under the gate; a paused query would produce no failures and
    // the ceiling assert would pass vacuously).
    await ctxA.route('**/api/v1/events', (route) => route.abort('connectionreset'));
    await ctxA.route('**/api/v1/clients**', (route) => route.abort('connectionreset'));
    await ctxA.route('**/api/v1/records**', (route) => route.abort('connectionreset'));

    try {
      await waitForScheduleReady(pageA);
      // Let the debounce-armed flag settle (isChannelDown flips on the FIRST
      // onerror — near-instant — but the loss toast itself is not needed here).
      await pageA.waitForTimeout(1_000);

      const netToasts = pageA.getByTestId('toast-error').filter({ hasText: 'Ошибка сети' });

      // S3 — several section transitions: two cold families fail under the
      // gate. Route dev RSC fetches pass (only /api/v1/* data is aborted).
      await pageA.getByRole('link', { name: 'Клиенты' }).click();
      await pageA.waitForURL('**/clients', { timeout: 15_000 });
      await pageA.getByRole('link', { name: 'Записи' }).click();
      await pageA.waitForURL('**/records', { timeout: 15_000 });
      await pageA.getByRole('link', { name: 'Расписание' }).click();
      await pageA.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

      // Count AFTER the full retry cycle (plan Task 6: ≥4s) — a pre-gate
      // firing that only surfaces through a retried failure lands inside
      // the snapshot. CEILING, not zero: the very first failure can race
      // the channel flag flip (residual R3).
      await pageA.waitForTimeout(RETRY_CYCLE);
      expect(await netToasts.count()).toBeLessThanOrEqual(1);

      // Wait out any leaked pre-gate toast (4.5s life) so the S6 +1 count
      // starts from a clean, observed-zero deck.
      await netToasts.first().waitFor({ state: 'detached', timeout: TOAST_LIFE + 1_000 }).catch(() => {});
      expect(await netToasts.count()).toBe(0);

      // S6 — a UI ACTION that fails: quick-add record create (plain fetch
      // chain in useRecordMutations — NOT a query, so the §5.4 gate cannot
      // swallow it). After the navigation phase's observed ZERO, exactly
      // ONE action-error toast must appear.
      const today = new Date().toISOString().slice(0, 10);
      await openAddTab(pageA, { date: today });
      await pageA.getByTestId('input-phone').fill(`+7999${Date.now().toString().slice(-7)}`);
      await pageA.getByTestId('input-client-name').fill(`Push S6 ${uid()}`);

      await pageA.getByTestId('btn-create-record').click();
      // The action toast is transient (4.5s) — snapshot inside its lifetime,
      // non-retrying count (a retrying toHaveCount(1) could poll past the
      // death of a SECOND toast and pass vacuously; an instant count of 0
      // plus the visible first toast pins exactly-one).
      await expect(netToasts.first()).toBeVisible({ timeout: 10_000 });
      await pageA.waitForTimeout(1_000);
      expect(await netToasts.count()).toBe(1);

      // Cleanup: no server-side leftovers exist (the create never landed —
      // its fetch chain was aborted); the modal is closed for hygiene.
      await closeModal(pageA);
    } finally {
      // Route hygiene (С5/С6/S1+S2 pattern): an assertion failure mid-test
      // must not leave the abort routes armed on ctxA.
      await ctxA.unroute('**/api/v1/clients**');
      await ctxA.unroute('**/api/v1/records**');
      await ctxA.unroute('**/api/v1/events');
    }
  });
});
