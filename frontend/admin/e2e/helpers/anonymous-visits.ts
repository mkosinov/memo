/**
 * helpers/anonymous-visits.ts — shared setup for the #257 unified-visitors
 * e2e specs (anonymous-visits.spec.ts, wave6 rewrite).
 *
 * #257: anonymous seats are REAL visits with visitor_id = null — a record's
 * tail of unfilled seats is saved as anonymous visits, converted inline
 * (D7), priced (D8), deleted with the undo window and cascaded on cancel.
 *
 * Pattern: full cycle (setup via API → UI action → verify UI → verify
 * API/DB → cleanup in finally). Helpers throw on failure via expect.
 */

import { type APIRequestContext, expect, type Page } from '@playwright/test';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from '../fixtures/factories';
import { openModal } from '../fixtures/helpers';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal structural views of the factory JSON (ids are all we anchor on). */
export interface IdRef {
  id: string;
}

export interface AnonymousRecordSetup {
  activity: IdRef;
  record: IdRef;
  /** id of the record's first (anonymous) visit — visitor_id = null. */
  visitId: string;
  /** Deletes the record (cascade visits/payments), the client and the activity. */
  cleanupAll: () => Promise<void>;
}

// ── Money text ────────────────────────────────────────────────────────────────

/**
 * ru-RU money text matcher for toContainText: the thousands separator is a
 * non-breaking space in the UI (`toLocaleString('ru-RU')`), so pin it once —
 * matches «1 500», «3 500», … with either separator.
 */
export function moneyPattern(n: number): RegExp {
  return new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\u00A0 ]'));
}

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Open the activity-details modal on the client tab of a SPECIFIC record.
 * `openModal` resolves the record's week from the DB (date-independent),
 * then we click the exact client tab (not the first one) and wait for the
 * visits table to render.
 */
export async function openRecordTab(page: Page, recordId: string): Promise<void> {
  await openModal(page, { recordId });
  const tab = page.locator(`[data-testid="tab-client-${recordId}"]`);
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({
    timeout: 10_000,
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

/**
 * client + activity (capacity) + record with ONE anonymous visit
 * (`visits: [{ price }]` — no name/visitor_id → anonymous, #257 D10).
 * Returns the ids the tests anchor on plus a cleanup bundle.
 */
export async function setupAnonymousRecord(
  request: APIRequestContext,
  opts?: { capacity?: number; price?: number },
): Promise<AnonymousRecordSetup> {
  const client = (await createTestClient(request)) as IdRef;
  const activity = (await createTestActivity(
    request,
    opts?.capacity !== undefined ? { capacity: opts.capacity } : undefined,
  )) as IdRef;
  const record = (await createTestRecord(request, activity.id, client.id, {
    visits: [{ price: opts?.price ?? 3500 }],
  })) as IdRef;

  const recordResp = await request.get(`${BACKEND}/api/v1/records/${record.id}`);
  expect(recordResp.ok()).toBeTruthy();
  const recordJson = (await recordResp.json()) as { visits: Array<{ id: string }> };
  const visitId = recordJson.visits[0].id;

  const cleanupAll = async () => {
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    // The activity is test-created too — delete it last (its records are
    // already gone; the 409-with-cascade path in `cleanup` stays safe).
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  };
  return { activity, record, visitId, cleanupAll };
}

/** Fetch a record with nested visits from the API (server truth, no cache). */
export async function fetchRecord(
  request: APIRequestContext,
  recordId: string,
): Promise<{
  status: string;
  visits: Array<{ id: string; visitor_id: string | null; status: string; tariff_id: string | null; price: number }>;
}> {
  const resp = await request.get(`${BACKEND}/api/v1/records/${recordId}`);
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}
