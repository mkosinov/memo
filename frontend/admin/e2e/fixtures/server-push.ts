/**
 * server-push.ts — shared fixture + helpers for the #239 SSE channel specs
 * (server-push-invalidation.spec.ts, server-push-offline.spec.ts).
 *
 * Two browser contexts = two admins (A and B): separate contexts give
 * separate module-level tab identities (spec §2.4), so B's UI writes carry
 * B's X-Memo-Tab-Id and A must see the external toast.
 */
import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { waitForScheduleReady, openAddTab } from './helpers';

/** Spec §6 — "within seconds"; deliberately BELOW the app-wide staleTime
 *  (30s) and the dictionary staleTime (1h): a test that passes without the
 *  SSE channel would be testing staleTime, not the channel. */
export const PUSH_WINDOW = 5_000;

/** Reconnect convergence budget (spec §6 С5 — "within ~10s of back online"). */
export const RECONNECT_WINDOW = 10_000;

/** Direct backend base for bare-API cleanup (same default as factories). */
export const API_BASE = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Unique marker prefix so parallel specs never collide. */
export function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Assert that a "Данные обновлены" info toast is (or becomes) visible.
 *
 * Scoped with a text filter + `.first()`: parallel specs broadcasting their
 * own pushes land foreign toasts on every open context, so several
 * toast-info elements can be stacked at once (container shows up to 5) —
 * an unscoped getByTestId('toast-info') would trip strict mode.
 */
export function expectUpdateToast(page: Page) {
  return expect(
    page.getByTestId('toast-info').filter({ hasText: 'Данные обновлены' }).first(),
  ).toBeVisible({ timeout: PUSH_WINDOW });
}

/**
 * Frame-logger: opens a dedicated browser context + blank page that
 * subscribes DIRECTLY to the backend SSE stream (`new EventSource(eventsUrl)`)
 * and records every `invalidate` frame as `{entities, origin, ts}` into a
 * window array (getter exposed for the test process).
 *
 * Used by the attributive silence probe (expectNoOwnEchoToast) to attribute
 * a raised «Данные обновлены» toast to either the tab's own write echo or
 * foreign interference from a concurrent writer (the SSE hub broadcasts
 * every mutation to ALL connected clients — including sibling test files'
 * contexts running under fullyParallel).
 *
 * Frame attribution rule (documented per task): the test CANNOT read pageA's
 * tab id from the DOM, so own vs foreign is decided by ENTITY + TIMING —
 *   a frame is "suspect-own-echo" iff it arrived within ±300ms of pageA's
 *   POST completion AND its `entities` include `records`;
 *   every other frame in the probe window counts as FOREIGN interference.
 * A toast with only suspect-own-echo frames (or none) around it proves the
 * broken origin suppression → FAIL; foreign frames → interference, retry.
 */
export type InvalidateFrame = {
  entities: string[];
  origin?: { type?: string; id?: string } | null;
  ts: number; // Date.now() in the LOGGER page's clock (same origin/JS clock)
};

export type FrameLog = {
  /** All invalidate frames observed so far (chronological). */
  frames: InvalidateFrame[];
  /** Anchor for ±300ms attribution — the moment the own POST resolved. */
  postDoneAt: number | null;
  /** Close the logger context (stop polling, kill the SSE connection). */
  close: () => Promise<void>;
};

/** Subscribe a blank page to the raw backend SSE stream; returns the log handle. */
export async function openFrameLogger(browser: Browser): Promise<FrameLog> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const eventsUrl = `${API_BASE}/api/v1/events`;

  await page.addInitScript((url: string) => {
    const w = window as unknown as {
      __memoFrames: { entities: string[]; origin?: { type?: string; id?: string } | null; ts: number }[];
    };
    w.__memoFrames = [];
    const es = new EventSource(url);
    es.addEventListener('invalidate', (ev) => {
      let parsed: { entities?: string[]; origin?: { type?: string; id?: string } | null } = {};
      try {
        parsed = JSON.parse((ev as MessageEvent).data as string);
      } catch {
        return;
      }
      w.__memoFrames.push({
        entities: parsed.entities ?? [],
        origin: parsed.origin ?? null,
        ts: Date.now(),
      });
    });
  }, eventsUrl);
  await page.goto('about:blank');

  const log: FrameLog = { frames: [], postDoneAt: null, close: () => ctx.close() };

  // Poll the in-page array into the Node-side handle (cheap; frames are rare).
  const poll = async () => {
    try {
      log.frames = (await page.evaluate(() => (window as unknown as { __memoFrames: InvalidateFrame[] }).__memoFrames)) as InvalidateFrame[];
    } catch {
      /* page/context closed — stop polling */
    }
  };
  const interval = setInterval(poll, 250);
  page.once('close', () => clearInterval(interval));

  return log;
}

/** Mark the moment pageA's own POST resolved (anchor for ±300ms attribution). */
export function markPostDone(log: FrameLog) {
  log.postDoneAt = Date.now();
}

/**
 * Classify frames from a probe window: suspect-own-echo = arrived within
 * ±300ms of POST completion AND carries `records`; everything else =
 * foreign interference.
 */
function classifyFrames(
  frames: InvalidateFrame[],
  postDoneAt: number | null,
): { ownEcho: InvalidateFrame[]; foreign: InvalidateFrame[] } {
  const ownEcho: InvalidateFrame[] = [];
  const foreign: InvalidateFrame[] = [];
  for (const f of frames) {
    const nearPost = postDoneAt !== null && Math.abs(f.ts - postDoneAt) <= 300;
    const hasRecords = f.entities.includes('records');
    if (nearPost && hasRecords) ownEcho.push(f);
    else foreign.push(f);
  }
  return { ownEcho, foreign };
}

/**
 * Attributive silence probe (own-mutation silence, spec §6 С6 — origin
 * matches this tab).
 *
 * NON-RETRYING probe placed INSIDE the toast lifetime, called immediately
 * after the own mutation resolves: the SSE echo arrives within milliseconds,
 * the toast (if suppression is broken) lives ~4.5s — a 2s wait puts the
 * snapshot safely past echo latency and well before auto-dismiss. The
 * instant `expect(count).toBe(0)` cannot be absorbed by Playwright's retry:
 * a retrying anti-assertion (`toHaveCount(0, {timeout})`) would poll until
 * the transient toast dies on its own and pass vacuously.
 *
 * ATTRIBUTION: with fullyParallel sweeps a sibling spec's write broadcasts
 * to ALL contexts and can legitimately pop «Данные обновлены» on pageA
 * inside this window. If any toast is found:
 *   - only suspect-own-echo frames (±300ms of POST, `records`) or no frames
 *     → the toast proves broken suppression → FAIL with attribution detail;
 *   - foreign frames present → cross-test interference → wait out the toast
 *     deck (≤6s) and RETRY ONCE with a fresh write/probe cycle.
 */
export async function expectNoOwnEchoToast(page: Page, log: FrameLog, doOwnWrite: () => Promise<void>): Promise<void> {
  const toastLocator = page.getByTestId('toast-info').filter({ hasText: 'Данные обновлены' });

  // Up to 2 attempts: attempt 2 is the interference-retry (fresh write+probe).
  for (let attempt = 1; attempt <= 2; attempt++) {
    const framesStart = log.frames.length; // per-attempt window — no stale frames

    await doOwnWrite();
    markPostDone(log); // POST resolution = attribution anchor

    await page.waitForTimeout(2_000); // echo latency (ms) << 2s << toast lifetime (~4.5s)
    const count = await toastLocator.count();
    if (count === 0) return; // PASS (fast path)

    // Attribute the toast using THIS attempt's frames only.
    const windowFrames = log.frames.slice(framesStart);
    const { ownEcho, foreign } = classifyFrames(windowFrames, log.postDoneAt);
    if (foreign.length === 0) {
      // Only own-echo frames (or no frames at all) → the toast proves the
      // broken origin suppression. FAIL with attribution detail.
      expect(
        count,
        `own mutation must not raise the «Данные обновлены» toast ` +
          `(no foreign SSE frames in the probe window — suppression broken; ` +
          `frames: ${JSON.stringify(windowFrames)})`,
      ).toBe(0);
    }

    // Foreign frames present → cross-test interference. Wait out the toast
    // deck (toast life ~4.5s) so the retry's snapshot starts clean, then
    // loop into a fresh write/probe cycle.
    await toastLocator
      .first()
      .waitFor({ state: 'detached', timeout: 6_000 })
      .catch(() => {});
    await toastLocator
      .count()
      .then((c) => expect(c, 'toast deck must clear before the silence retry').toBe(0));
  }

  // Second attempt ALSO raised a toast — even if foreign frames explain it,
  // the retry budget is exhausted; fail with the full attribution evidence.
  const { ownEcho, foreign } = classifyFrames(log.frames, log.postDoneAt);
  expect(
    await toastLocator.count(),
    `silence retry still saw a «Данные обновлены» toast ` +
      `(ownEcho: ${JSON.stringify(ownEcho)}, foreign: ${JSON.stringify(foreign)})`,
  ).toBe(0);
}

/**
 * Dismiss/wait out transient toast overlays before a click.
 *
 * The toast container (fixed bottom-right, z-[250]) shares the screen corner
 * with the StampFab (fixed bottom-right, z-50); a toast overlapping the FAB
 * swallows the click and the panel never opens. Foreign pushes from parallel
 * specs can pop a toast at ANY moment, so a one-shot wait is not enough —
 * retry the click until it lands, re-waiting out overlays after each miss.
 */
export async function clickFabRobust(page: Page, timeoutMs = 15_000) {
  const fab = page.getByRole('button', { name: 'Открыть панель инструментов' });
  const toasts = page.locator('[data-testid^="toast-"]');
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await expect(fab).toBeVisible({ timeout: 5_000 });
    if ((await toasts.count()) > 0) {
      // Overlay present — let it die (toast life ~4.5s), then re-check.
      await toasts
        .first()
        .waitFor({ state: 'detached', timeout: Math.max(1, deadline - Date.now()) })
        .catch(() => {});
    }
    try {
      await fab.click({ timeout: 2_000 }); // no force — hit-target check is the guard
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('FAB click never landed (overlay retries exhausted)');
    }
  }
}

/**
 * Create a record through B's UI (schedule → quick add → new booking tab)
 * so the write carries B's real tab header. The booking lands on an
 * activity of the CURRENT week so the record is inside the records page's
 * default date range. Returns the record payload from the POST /api/v1/records
 * response (for cleanup).
 */
export async function createRecordViaUI(pageB: Page, clientName: string) {
  await waitForScheduleReady(pageB);
  const today = new Date().toISOString().slice(0, 10);
  await openAddTab(pageB, { date: today });

  const phone = `+7999${Date.now().toString().slice(-7)}`;
  await pageB.getByTestId('input-phone').fill(phone);
  await pageB.getByTestId('input-client-name').fill(clientName);

  const createResponse = pageB.waitForResponse(
    (r) => r.url().includes('/api/v1/records') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await pageB.getByTestId('btn-create-record').click();
  const resp = await createResponse;
  expect(resp.status()).toBe(201);
  return (await resp.json()) as { id: string; client_id: string };
}

/**
 * Two-context fixture: pageA (observer, context also exposed as ctxA for
 * setOffline outage emulation) and pageB (writer).
 */
export const serverPushPages = test.extend<{
  pageA: Page;
  ctxA: BrowserContext;
  pageB: Page;
}>({
  pageA: async ({ browser }, use) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await use(pageA);
    await ctxA.close();
  },
  ctxA: async ({ pageA }, use) => {
    // pageA's owning context — same object Playwright created above.
    await use(pageA.context());
  },
  pageB: async ({ browser }, use) => {
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await use(pageB);
    await ctxB.close();
  },
});
