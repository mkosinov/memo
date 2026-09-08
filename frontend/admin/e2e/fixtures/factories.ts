/**
 * factories.ts — Data creation factories for Playwright E2E tests.
 *
 * Each factory creates test data via the backend API.
 * Always use these instead of hardcoding test data.
 *
 * Usage:
 *   const client = await createTestClient(request);
 *   const activity = await createTestActivity(request);
 *   const record = await createTestRecord(request, activity.id, client.id);
 *   await cleanupRecord(request, record.id); // records: resolutions needed (Addendum 13)
 *   await cleanup(request, `/api/v1/clients/${client.id}`);
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { type APIRequestContext, expect } from '@playwright/test';
import { sqliteExecWithRetry } from './sqlite-exec';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let testCounter = 0;
function uid(): string {
  testCounter++;
  return `e2e_${Date.now()}_${testCounter}`;
}

/**
 * Create a test client via backend API.
 * Always use this instead of hardcoding client data.
 */
export async function createTestClient(
  api: APIRequestContext,
  overrides?: { name?: string; phone?: string },
) {
  const name = overrides?.name || `Test Client ${uid()}`;
  const phone = overrides?.phone || `+7999${String(Date.now()).slice(-7)}`;
  const resp = await api.post(`${BACKEND}/api/v1/clients`, {
    data: { name, phone, channel: 'telegram' },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/**
 * Create a test activity via backend API.
 * Uses first available master, service, location from seed data.
 */
export async function createTestActivity(
  api: APIRequestContext,
  overrides?: Record<string, any>,
) {
  const [mastersResp, servicesResp, locationsResp] = await Promise.all([
    api.get(`${BACKEND}/api/v1/masters`),
    api.get(`${BACKEND}/api/v1/services`),
    api.get(`${BACKEND}/api/v1/locations`),
  ]);
  const mastersJson = await mastersResp.json();
  const servicesJson = await servicesResp.json();
  const locationsJson = await locationsResp.json();
  // #182: list endpoints are paginated ({items,total,page,per_page}) — unwrap envelopes
  const masters = mastersJson.items || mastersJson;
  const services = servicesJson.items || servicesJson;
  const locations = locationsJson.items || locationsJson;

  const resp = await api.post(`${BACKEND}/api/v1/activities`, {
    data: {
      master_id: masters[0].id,
      service_id: services[0].id,
      location_id: locations[0].id,
      start: new Date().toISOString().slice(0, 19),
      duration: services[0].duration || 90,
      capacity: 8,
      is_private: false,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/**
 * Create a test record via backend API.
 */
export async function createTestRecord(
  api: APIRequestContext,
  activityId: string,
  clientId: string,
  overrides?: Record<string, any>,
) {
  const visitorName = overrides?.visitor_name || `Test Visitor ${uid()}`;
  // Remove visitor_name from overrides so it doesn't leak into the API payload
  const { visitor_name: _unused, ...apiOverrides } = overrides || {};
  const resp = await api.post(`${BACKEND}/api/v1/records`, {
    data: {
      activity_id: activityId,
      client_id: clientId,
      visits: [{ name: visitorName, price: 3500 }],
      ...apiOverrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/**
 * Create a client + activity + record in one call.
 * Useful for tests that need records with known client names (e.g., sort tests).
 */
export async function createTestRecordWithClient(
  api: APIRequestContext,
  clientName: string,
) {
  const client = await createTestClient(api, { name: clientName });
  const activity = await createTestActivity(api);
  const record = await createTestRecord(api, activity.id, client.id);
  return { clientId: client.id, recordId: record.id, activityId: activity.id };
}

/**
 * Create a client + activity + record + payment in one call.
 * Useful for tests that need records with known payment status.
 */
export async function createTestRecordWithPayment(
  api: APIRequestContext,
  paymentStatus?: 'Оплачено' | 'Частично' | 'Не оплачено',
) {
  const client = await createTestClient(api, {
    name: `Payment Test ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  const activity = await createTestActivity(api);
  const record = await createTestRecord(api, activity.id, client.id);

  // Determine payment amount based on the status
  let amount = 3500; // full price = "Оплачено"
  if (paymentStatus === 'Частично') {
    amount = 1500;
  } else if (paymentStatus === 'Не оплачено') {
    amount = 0;
  }

  let paymentId: string | null = null;
  if (amount > 0) {
    const paymentResp = await api.post(`${BACKEND}/api/v1/payments`, {
      data: {
        record_id: record.id,
        amount,
        method: 'card',
      },
    });
    if (paymentResp.ok()) {
      const payment = await paymentResp.json();
      paymentId = payment.id;
    }
  }

  return {
    clientId: client.id,
    recordId: record.id,
    activityId: activity.id,
    paymentId,
  };
}

// ─── #207 entity factories (E2E scenarios S1–S7) ───────────────────────────
//
// `uid()` makes names globally unique across shards, so a leaked row from a
// previous run can never collide with the current test's search/seed name.

/**
 * Create a test master via backend API.
 * position/specialty are backend enum values (Специальность/Position enums).
 */
export async function createTestMaster(
  api: APIRequestContext,
  overrides?: Record<string, unknown>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/masters`, {
    data: {
      first_name: 'Тест',
      last_name: `Мастеров ${uid()}`,
      color: '#5B8C7A',
      position: 'мастер',
      specialty: 'керамика',
      avatar_url: '',
      sort_order: 999,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test location via backend API (capacity is the only required field). */
export async function createTestLocation(
  api: APIRequestContext,
  overrides?: Record<string, unknown>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/locations`, {
    data: {
      name: `Локация ${uid()}`,
      capacity: 8,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test service via backend API (no tags/tariffs → zero deps). */
export async function createTestService(
  api: APIRequestContext,
  overrides?: Record<string, unknown>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/services`, {
    data: {
      title: `Услуга ${uid()}`,
      description: 'e2e seed service',
      image_url: '',
      specialty: 'керамика',
      min_age: 5,
      max_age: null,
      duration: 90,
      record_info: 'e2e seed',
      tariffs: [],
      tag_ids: [],
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/**
 * Create a test photo via backend API (GH #211 Task 10).
 * The 4-owner model allows AT MOST ONE of client_id/service_id/activity_id/
 * location_id — sending ≥2 yields a server 422 (used by the modal error e2e).
 */
export async function createTestPhoto(
  api: APIRequestContext,
  overrides?: Record<string, unknown>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/photos`, {
    data: {
      filename: `/images/e2e-photo-${uid()}.jpg`,
      is_public: true,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test tag via backend API ({ id, tag }). */
export async function createTestTag(
  api: APIRequestContext,
  overrides?: { tag?: string },
) {
  const resp = await api.post(`${BACKEND}/api/v1/tags`, {
    data: { tag: overrides?.tag || `test-tag ${uid()}` },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test visitor linked to a client via backend API. */
export async function createTestVisitor(
  api: APIRequestContext,
  clientId: string,
  overrides?: { name?: string },
) {
  const resp = await api.post(`${BACKEND}/api/v1/visitors`, {
    data: { name: overrides?.name || `Test Visitor ${uid()}`, client_id: clientId },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test visit for a record (optionally linked to a visitor). */
export async function createTestVisit(
  api: APIRequestContext,
  recordId: string,
  visitorId?: string,
  overrides?: Record<string, unknown>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/visits`, {
    data: {
      record_id: recordId,
      visitor_id: visitorId ?? null,
      price: 3500,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test payment for a record via backend API. */
export async function createTestPayment(
  api: APIRequestContext,
  recordId: string,
  overrides?: { amount?: number },
) {
  const resp = await api.post(`${BACKEND}/api/v1/payments`, {
    data: { record_id: recordId, amount: overrides?.amount ?? 3500, method: 'card' },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** Create a test tag and link it to a master (master_tags join row). */
export async function createTestMasterTag(api: APIRequestContext, masterId: string) {
  const tag = await createTestTag(api);
  linkTag('master_tags', masterId, tag.id);
  return tag;
}

/** Create a test tag and link it to a client (client_tags join row). */
export async function createTestClientTag(api: APIRequestContext, clientId: string) {
  const tag = await createTestTag(api);
  linkTag('client_tags', clientId, tag.id);
  return tag;
}

// ─── Direct DB writes (rows with no API writer) ─────────────────────────────
//
// users / join tables have no create endpoint — backend E2E tests insert them
// the same way via raw SQL. The sqlite3 CLI is available in the image (used
// by db-query.ts / sqlite-exec.ts for DB verification).

function resolveDBPath(): string {
  const shardId = process.env.SHARD_ID;
  if (shardId) {
    return path.resolve(__dirname, `../../../../backend/test_memo_shard${shardId}.db`);
  }
  return process.env.TEST_DB_PATH
    || path.resolve(__dirname, '../../../../backend/test_memo.db');
}

function sqlValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function executeSQL(sql: string): void {
  sqliteExecWithRetry(`sqlite3 "${resolveDBPath()}" "${sql.replace(/"/g, '\\"')}"`);
}

/** Link an entity to a tag via the join table (backend tests do the same via raw SQL). */
export function linkTag(
  table: 'master_tags' | 'client_tags',
  entityId: string,
  tagId: string,
): void {
  executeSQL(
    table === 'master_tags'
      ? `INSERT INTO master_tags (master_id, tag_id) VALUES (${sqlValue(entityId)}, ${sqlValue(tagId)})`
      : `INSERT INTO client_tags (client_id, tag_id) VALUES (${sqlValue(entityId)}, ${sqlValue(tagId)})`,
  );
}

/** Link a photo to a tag via the photo_tags join table (GH #211 Task 10). */
export function linkPhotoTag(photoId: string, tagId: string): void {
  executeSQL(
    `INSERT INTO photo_tags (photo_id, tag_id) VALUES (${sqlValue(photoId)}, ${sqlValue(tagId)})`,
  );
}

/**
 * Link an already-seeded user to a master by phone (users have no create
 * endpoint; backend tests link via UPDATE users SET master_id=…).
 */
export function linkUserToMaster(phone: string, masterId: string): void {
  executeSQL(`UPDATE users SET master_id=${sqlValue(masterId)} WHERE phone=${sqlValue(phone)}`);
}

/**
 * Create a staff user row directly (no API writer exists; mirrors the raw
 * INSERT used by backend tests). Defaults: is_active=1, role='master',
 * email/password/confirmation flags NULL/false.
 */
export function seedUser(overview: {
  phone: string;
  masterId?: string;
  isActive?: number;
}): string {
  const id = crypto.randomUUID();
  executeSQL(
    `INSERT INTO users (id, phone, email, password_hash, role, master_id, email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) VALUES (${sqlValue(id)}, ${sqlValue(overview.phone)}, NULL, 'seeded', 'master', ${sqlValue(overview.masterId ?? null)}, 0, 0, ${overview.isActive ?? 1}, datetime('now'), datetime('now'))`,
  );
  return id;
}

/**
 * Delete entity via API (ignore errors — used in cleanup).
 * Always call this in test cleanup to prevent data leaking between tests.
 *
 * Addendum 13 / GH #139 T8: bodyless DELETE is a DRY-RUN. On 409
 * (entity has dependencies) the body lists them, and a second DELETE with
 * `{"resolutions": {"<entity>": "cascade"}}` executes for real. Without the
 * retry, cleanup silently 409s and test data leaks between tests (the exact
 * leak `cleanupRecord` was added for — generalized here so client/activity/
 * master/service cleanups cascade their blocking deps too; e.g. a client
 * keeps its `visitors` after its records were deleted). Only deps whose
 * allowed_actions include "cascade" are resolved (Mode-B archive-only deps
 * stay blocked, same as today's silent behavior).
 */
export async function cleanup(api: APIRequestContext, path: string) {
  try {
    const resp = await api.delete(`${BACKEND}${path}`);
    if (resp.status() === 409) {
      const body = (await resp.json().catch(() => null)) as {
        dependencies?: Array<{ entity: string; allowed_actions?: string[] }>;
      } | null;
      const resolutions: Record<string, string> = {};
      for (const dep of body?.dependencies ?? []) {
        if ((dep.allowed_actions ?? []).includes('cascade')) {
          resolutions[dep.entity] = 'cascade';
        }
      }
      if (Object.keys(resolutions).length > 0) {
        await api.delete(`${BACKEND}${path}`, { data: { resolutions } });
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Hard-delete a record in cleanup with explicit cascade resolutions
 * (Addendum 13 / GH #139 T8-FE2a): the no-body DELETE is a dry-run and
 * returns 409 when the record has visits/payments, which made bare
 * `cleanup()` calls silently leak rows. record_tags is auto=True
 * server-side and is omitted from the body (validate_resolutions
 * silently IGNORES user-sent actions for auto deps — deletion.py §16).
 * Safe for dep-free records too (204) and for
 * already-deleted rows (404 — swallowed), so it is a drop-in replacement
 * for `cleanup(api, \`/api/v1/records/{id}\`)`.
 */
export async function cleanupRecord(api: APIRequestContext, recordId: string) {
  try {
    await api.delete(`${BACKEND}/api/v1/records/${recordId}`, {
      data: { resolutions: { visits: 'cascade', payments: 'cascade' } },
    });
  } catch {
    // Ignore cleanup errors
  }
}
