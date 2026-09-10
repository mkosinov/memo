import { test, expect } from './fixtures/test';
import {
  waitForRecordsReady,
  waitForScheduleReady,
  openAddTab,
} from './fixtures/helpers';
import { cleanupRecord, cleanup } from './fixtures/factories';
import {
  serverPushPages,
  expectNoOwnEchoToast,
  openFrameLogger,
  createRecordViaUI,
  uid,
  PUSH_WINDOW,
  RECONNECT_WINDOW,
} from './fixtures/server-push';

/**
 * E2E — server push invalidation, scenarios 5–6 (GH #239, spec §6).
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
 *
 * С6 (own-mutation silence): A creates a record through its OWN UI; the
 * table updates via A's own invalidation path while the «Данные обновлены»
 * toast must NOT appear (origin.id === A's tab id, spec §2.4 suppression).
 * Silence is probed NON-retrying inside the toast lifetime, immediately
 * after the POST resolves (see expectNoOwnEchoToast in fixtures/server-push).
 *
 * SERIAL: С5's reconnect blanket + any sibling file's mutations broadcast to
 * ALL open contexts under fullyParallel; С5's outage/reconnect churn also
 * disturbs a concurrently running С6. Isolation-independently green, the two
 * scenarios interfere when parallel — serialize the file (precedent:
 * visual-compliance-checks.spec.ts).
 *
 * Requires: per-shard stack (backend :8021 / frontend :3021 in dev runs):
 *   SHARD_ID=9 SHARD_PORT=3021 BACKEND_URL=http://127.0.0.1:8021 \
 *     NEXT_PUBLIC_API_URL=http://127.0.0.1:8021 pnpm test:e2e -- server-push-offline.spec.ts
 */

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
      await pageA.evaluate(() => {
        document.dispatchEvent(new CustomEvent('__memo-close-modal'));
      });
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
      await pageA.evaluate(() => {
        document.dispatchEvent(new CustomEvent('__memo-close-modal'));
      });

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
});
