import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page, Request, Route } from '@playwright/test';
import {
  fetchRecord,
  moneyPattern,
  openRecordTab,
  setupAnonymousRecord,
} from './helpers/anonymous-visits';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * Response hold before the chosen PATCH is passed (spec §User Scenarios,
 * intro): ≥ 0.5 s — headroom against CI jitter. 1.5 s keeps the "held
 * response lands last" ordering deterministic even on a loaded box (the
 * follow-up UI action must issue its free PATCH inside the window). The
 * fixed pause lives ONLY inside the route handler; every test-side wait is
 * waitFor-based.
 */
const HOLD_MS = 1500;

/** Parsed JSON body of a request ({} when absent or not JSON). */
function jsonBody(req: Request): Record<string, unknown> {
  try {
    return (req.postDataJSON() ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Predicate: a PATCH of THE visit whose serialized body carries all `keys`. */
function isVisitPatchWith(visitId: string, keys: string[]) {
  return (req: Request): boolean => {
    if (req.method() !== 'PATCH') return false;
    if (!req.url().includes(`/api/v1/visits/${visitId}`)) return false;
    const body = jsonBody(req);
    return keys.every((k) => k in body);
  };
}

/**
 * Deterministic response ordering for visit PATCHes (#359, spec §User
 * Scenarios intro): a request chosen by `isChosen` is FORWARDED to the server
 * at once (route.fetch — the server transaction commits at issue time, so the
 * issue order pinned by the test is the commit order), while its RESPONSE is
 * held for HOLD_MS and only then replayed to the page (route.fulfill). Every
 * other matching request passes through untouched, so its response lands on
 * real network time — earlier than any held one.
 *
 * Precedents: activity-deferred-delete.spec.ts / client-phone-typeahead.spec.ts
 * (page.route with async handlers); the response-only hold here needs
 * fetch+fulfill because a pause before `continue()` would delay the REQUEST
 * (and the server commit) too, inverting the very order under test.
 */
async function holdVisitPatchResponses(
  page: Page,
  isChosen: (body: Record<string, unknown>) => boolean,
): Promise<void> {
  await page.route('**/api/v1/visits/**', async (route: Route) => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.continue();
    if (!isChosen(jsonBody(req))) return route.continue();
    const response = await route.fetch(); // server commits NOW, in issue order
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS)); // hold the response
    return route.fulfill({ response });
  });
}

/** Tariffs of the activity's service — runtime truth (anonymous-visits US4 pattern). */
async function fetchServiceTariffs(
  request: APIRequestContext,
  activityId: string,
): Promise<Array<{ id: string; title: string; price: number; audience?: string }>> {
  const actResp = await request.get(`${BACKEND}/api/v1/activities/${activityId}`);
  expect(actResp.ok()).toBeTruthy();
  const { service_id } = (await actResp.json()) as { service_id: string };
  const svcResp = await request.get(`${BACKEND}/api/v1/services/${service_id}`);
  expect(svcResp.ok()).toBeTruthy();
  const svc = (await svcResp.json()) as {
    tariffs: Array<{ id: string; title: string; price: number; audience?: string }>;
  };
  expect(svc.tariffs.length).toBeGreaterThanOrEqual(2);
  return svc.tariffs;
}

/** A tariff with a price different from the seeded visit's (kid-audience
 *  preferred — the tariff a re-pick by age would substitute, GH #284). */
function pickTariffApartFrom(
  tariffs: Array<{ id: string; price: number; audience?: string }>,
  price: number,
): { id: string; title: string; price: number; audience?: string } {
  const alt =
    tariffs.find((t) => t.price !== price && t.audience === 'kid') ??
    tariffs.find((t) => t.price !== price);
  expect(
    alt,
    'service must offer a tariff with a price different from the seeded one',
  ).toBeTruthy();
  return alt!;
}

test.describe('Visits PATCH cache consistency — controlled response order (GH #359)', () => {
  // ── US-1: anonymous row — visitor_id response held, tariff/price free ─────
  //
  // The conversion PATCH {visitor_id} is issued FIRST (issue order pinned via
  // waitForRequest before the tariff edit), so the server serializes its row
  // snapshot BEFORE the tariff commit — the held response is genuinely stale
  // when it lands last. The projection (#359) must keep the new tariff/price
  // the free response already wrote; a whole-row overwrite would revert them.
  test('US-1: anonymous row — visitor_id response held, tariff/price free — row keeps client and new tariff/price', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { price: 700 });
    const { record, activity, visitId, cleanupAll } = setup;
    const tariffs = await fetchServiceTariffs(request, activity.id);
    const newTariff = pickTariffApartFrom(tariffs, 700);

    try {
      // Route BEFORE any edit opens the record tab (openRecordTab owns the
      // navigation — no redundant /schedule preamble: the response-order
      // scenarios need the 60s test budget for the holds and the retries).
      await holdVisitPatchResponses(page, (body) => 'visitor_id' in body);

      await openRecordTab(page, record.id);
      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const nameInput = row.locator('input:not([type="number"])').first();
      const priceInput = row.locator('input[type="number"]');
      const summary = page.locator('[data-testid="record-summary"]');

      // ACTION 1 — name into the anonymous row: createVisitor + PATCH
      // {visitor_id}. The waiter is registered BEFORE the commit, so awaiting
      // it pins the issue order: the conversion PATCH leaves before the
      // tariff edit below.
      const visitorPatchSent = page.waitForRequest(isVisitPatchWith(visitId, ['visitor_id']), {
        timeout: 20_000,
      });
      const visitorName = `US1 Гость ${Date.now()}`;
      await nameInput.fill(visitorName);
      await nameInput.press('Enter');
      await visitorPatchSent;

      // ACTION 2 — tariff pick while the visitor response is held: PATCH
      // {tariff_id, price} passes freely and its response lands FIRST. BOTH
      // waiters are registered BEFORE the action (a waiter registered after
      // a response already landed can never see it — the withUndoWindow
      // helper contract): the visitor response cannot land before the pause
      // elapses, the tariff one lands on real network time.
      const visitorPatchLanded = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && isVisitPatchWith(visitId, ['visitor_id'])(res.request()),
        { timeout: 20_000 },
      );
      const tariffPatchLanded = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && isVisitPatchWith(visitId, ['tariff_id'])(res.request()),
        { timeout: 20_000 },
      );
      await row.locator(`[data-testid="visit-${visitId}-tariff"]`).selectOption(newTariff.id);
      await tariffPatchLanded;

      // The held visitor response arrives after the pause (waitFor, no sleep).
      await visitorPatchLanded;

      // VERIFY UI — CACHE truth first: the summary total is cache-derived, so
      // it shows the NEW price only under the projection (a whole-row
      // overwrite by the stale late response reverts it to the seeded 700).
      await expect(summary).toContainText(moneyPattern(newTariff.price));
      // Then the row display: client name + new tariff + new price.
      await expect(nameInput).toHaveValue(visitorName, { timeout: 10_000 });
      await expect(row.locator(`[data-testid="visit-${visitId}-tariff"]`)).toHaveValue(newTariff.id);
      await expect(priceInput).toHaveValue(String(newTariff.price));

      // VERIFY API (the spec's ONLY API cross-check, US-1): the visit carries
      // BOTH the assigned visitor and the new tariff/price — the server holds
      // both commits regardless of the response ordering played above.
      const rec = await fetchRecord(request, record.id);
      const visit = rec.visits.find((v) => v.id === visitId);
      expect(visit?.visitor_id).not.toBeNull();
      expect(visit?.tariff_id).toBe(newTariff.id);
      expect(visit?.price).toBe(newTariff.price);
    } finally {
      await cleanupAll();
    }
  });

  // ── US-2: tariff + status edits — status response released LAST ───────────
  //
  // The tariff PATCH response arrives freely; the status PATCH response is
  // held and released last — by then the server has committed BOTH edits, so
  // the status path's re-reads (its invalidation-refetch family; the badge
  // derives from the cached visits) observe the state after both commits.
  // The row's own status cell keeps its mount-frozen formState by design
  // (#284 display-sync exists only for tariff/price) — the cache truth of the
  // new status is observed through the derived record badge.
  test('US-2: tariff then status — status response held and released last — both edits stand, record badge updated', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { price: 700 });
    const { record, activity, visitId, cleanupAll } = setup;
    const tariffs = await fetchServiceTariffs(request, activity.id);
    const newTariff = pickTariffApartFrom(tariffs, 700);

    try {
      // Hold ONLY the status-carrying PATCH; the tariff PATCH passes freely.
      await holdVisitPatchResponses(page, (body) => 'status' in body);

      await openRecordTab(page, record.id);
      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // ACTION 1 — tariff pick → its PATCH response lands immediately.
      const tariffPatchLanded = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && isVisitPatchWith(visitId, ['tariff_id'])(res.request()),
        { timeout: 20_000 },
      );
      await row.locator(`[data-testid="visit-${visitId}-tariff"]`).selectOption(newTariff.id);
      await tariffPatchLanded;

      // ACTION 2 — row status «Посетил» → PATCH {status} is held and released
      // LAST.
      const statusPatchLanded = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && isVisitPatchWith(visitId, ['status'])(res.request()),
        { timeout: 20_000 },
      );
      const rowPicker = page.locator(`[data-testid="visit-${visitId}-status"]`);
      await rowPicker.locator(`[data-testid="visit-${visitId}-status-trigger"]`).click();
      await rowPicker.locator(`[data-testid="visit-${visitId}-status-option-visited"]`).click();
      await statusPatchLanded;

      // VERIFY UI — the row keeps BOTH edits: the select/input show the pick,
      // and the cache-derived visits total proves the tariff/price fields
      // survived the status response's application.
      await expect(row.locator(`[data-testid="visit-${visitId}-tariff"]`)).toHaveValue(newTariff.id);
      await expect(row.locator('input[type="number"]')).toHaveValue(String(newTariff.price));
      await expect(page.locator('[data-testid="visits-total"]')).toContainText(
        moneyPattern(newTariff.price),
      );

      // The record status badge (RecordSummary — derived from the CACHED
      // visits) flipped to «Пришли»: the status projection landed in the
      // cache, not just on the server.
      const recordPicker = page.locator('[data-testid="record-status"]');
      await recordPicker.locator('[data-testid="record-status-trigger"]').click();
      await expect(
        recordPicker.locator('[data-testid="record-status-option-visited"]'),
      ).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
    } finally {
      await cleanupAll();
    }
  });

  // ── US-3: two quick price edits — first response held, second free ────────
  //
  // Edit #1's response is held; edit #2's passes and lands first. When the
  // stale first response finally arrives, the per-field guard (last ISSUED
  // request wins) must keep the second price in the row and in the record
  // total — a whole-row overwrite would regress them to the first value.
  test('US-3: two quick price edits — first response held, second free — row and record total show the SECOND price', async ({
    page,
    request,
  }) => {
    const setup = await setupAnonymousRecord(request, { price: 1000 });
    const { record, visitId, cleanupAll } = setup;
    const firstPrice = 1500;
    const secondPrice = 2600;

    try {
      // Hold ONLY the FIRST price-cell edit (body exactly {price}); the
      // second passes freely. The tariff-select body {tariff_id, price} never
      // matches — this scenario never touches the tariff.
      let priceEdits = 0;
      await holdVisitPatchResponses(page, (body) => {
        const keys = Object.keys(body);
        if (!(keys.length === 1 && keys[0] === 'price')) return false;
        priceEdits += 1;
        return priceEdits === 1;
      });

      await openRecordTab(page, record.id);
      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const priceInput = row.locator('input[type="number"]');
      await expect(priceInput).toHaveValue('1000');

      // ACTION 1 — price edit #1: PATCH {price: 1500} issued, response held.
      // Awaiting the request pins the issue order: edit #1 leaves the door
      // before edit #2, so its late response is the overridden one.
      const firstPatchSent = page.waitForRequest(isVisitPatchWith(visitId, ['price']), {
        timeout: 20_000,
      });
      await priceInput.fill(String(firstPrice));
      await priceInput.press('Enter');
      await firstPatchSent;

      // ACTION 2 — price edit #2 right away: PATCH {price: 2600} passes
      // freely, its response lands while edit #1's is still held. BOTH
      // waiters are registered BEFORE the action — a waiter registered after
      // a response already landed can never see it (the withUndoWindow helper
      // contract), and under load edit #2 can take longer than the hold.
      const firstPatchLanded = page.waitForResponse(
        (res) =>
          res.request().method() === 'PATCH' &&
          isVisitPatchWith(visitId, ['price'])(res.request()) &&
          jsonBody(res.request()).price === firstPrice,
        { timeout: 20_000 },
      );
      const secondPatchLanded = page.waitForResponse(
        (res) =>
          res.request().method() === 'PATCH' &&
          isVisitPatchWith(visitId, ['price'])(res.request()) &&
          jsonBody(res.request()).price === secondPrice,
        { timeout: 20_000 },
      );
      await priceInput.fill(String(secondPrice));
      await priceInput.press('Enter');
      await secondPatchLanded;

      // The held first response arrives LAST (waitFor — no fixed sleep)…
      await firstPatchLanded;

      // VERIFY UI — the late old response regressed nothing: the SECOND price
      // stands in the row, in the visits total and in the summary (and the
      // first price appears nowhere).
      await expect(priceInput).toHaveValue(String(secondPrice));
      await expect(page.locator('[data-testid="visits-total"]')).toContainText(
        moneyPattern(secondPrice),
      );
      const summary = page.locator('[data-testid="record-summary"]');
      await expect(summary).toContainText(moneyPattern(secondPrice));
      await expect(summary).not.toContainText(moneyPattern(firstPrice));
    } finally {
      await cleanupAll();
    }
  });
});
