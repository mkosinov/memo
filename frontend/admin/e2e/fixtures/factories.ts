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
 *   await cleanup(request, `/api/v1/records/${record.id}`);
 */

import { type APIRequestContext, expect } from '@playwright/test';

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
  const client = await resp.json();

  // Verify the new client is queryable before returning.
  // The backend's get_db_session commits in the finally block — AFTER the
  // HTTP response is sent. Without this, page.goto('/clients') can trigger
  // a GET that arrives before the commit is visible, returning stale data.
  await expect
    .poll(
      async () => {
        const listResp = await api.get(`${BACKEND}/api/v1/clients?per_page=100`);
        const list = await listResp.json();
        const items = list.items || list; // handle both paginated and flat responses
        return items.some((c: any) => c.id === client.id);
      },
      { timeout: 5_000, intervals: [50, 100, 200, 500] },
    )
    .toBe(true);

  return client;
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
  const masters = await mastersResp.json();
  const services = await servicesResp.json();
  const locations = await locationsResp.json();

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
  const activity = await resp.json();

  // Verify the new activity is queryable before returning (commit-race fix).
  await expect
    .poll(
      async () => {
        const listResp = await api.get(`${BACKEND}/api/v1/activities`);
        const items = await listResp.json();
        return items.some((a: any) => a.id === activity.id);
      },
      { timeout: 5_000, intervals: [50, 100, 200, 500] },
    )
    .toBe(true);

  return activity;
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
  const record = await resp.json();

  // Verify the new record is queryable before returning (commit-race fix).
  await expect
    .poll(
      async () => {
        const listResp = await api.get(`${BACKEND}/api/v1/records`);
        const list = await listResp.json();
        const items = list.items || list; // handle both paginated and flat responses
        return items.some((r: any) => r.id === record.id);
      },
      { timeout: 5_000, intervals: [50, 100, 200, 500] },
    )
    .toBe(true);

  return record;
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

/**
 * Delete entity via API (ignore errors — used in cleanup).
 * Always call this in test cleanup to prevent data leaking between tests.
 */
export async function cleanup(api: APIRequestContext, path: string) {
  try {
    await api.delete(`${BACKEND}${path}`);
  } catch {
    // Ignore cleanup errors
  }
}
