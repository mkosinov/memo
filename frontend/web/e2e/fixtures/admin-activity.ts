/**
 * admin-activity.ts — the web-e2e activity factory (#593 Task 6).
 *
 * The booking flow needs a FUTURE activity: the home page lists
 * today+30 days only, while the seed schedule lives in the past — out
 * of the box the carousel shows just the private-booking last card.
 * Mirroring the admin donor's `createTestActivity`
 * (frontend/admin/e2e/fixtures/factories.ts), the factory logs the seed
 * ADMIN in via the API and POSTs an activity for tomorrow; the spec
 * reaches it through the «Завтра» calendar tab and books THAT card.
 *
 * IMPORT-TIME RULE (seed-ids donor): never call at module scope —
 * resolve inside test bodies only.
 */
import { request as playwrightRequest } from 'playwright/test';
import type { APIRequestContext } from 'playwright/test';
import { resolveBackendUrl } from '../lib/backend-url';
import { resolveWebPort } from '../lib/stack-port';

/** Seed admin (backend/src/seed; the admin donor globalSetup's creds). */
const ADMIN_PHONE = '+79990000001';
const ADMIN_PASSWORD = 'admin12345';

/** The created activity, as the booking spec consumes it. */
export interface TestActivity {
  id: string;
  start: string;
}

/** An admin API context: one login, cookie inside the context. */
async function adminContext(): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({
    baseURL: resolveBackendUrl(),
    extraHTTPHeaders: { Origin: `http://127.0.0.1:${resolveWebPort()}` },
  });
  const resp = await ctx.post('/api/v1/auth/login', {
    data: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
  });
  if (!resp.ok()) {
    const body = (await resp.text()).slice(0, 200);
    await ctx.dispose();
    throw new Error(
      `[admin-activity] seed admin login failed: HTTP ${resp.status()} ${body}`,
    );
  }
  return ctx;
}

/** First page of a paginated list ({items} envelope or bare array). */
async function firstItems(ctx: APIRequestContext, path: string): Promise<Array<Record<string, any>>> {
  const resp = await ctx.get(path);
  if (!resp.ok()) {
    throw new Error(`[admin-activity] GET ${path} failed: HTTP ${resp.status()}`);
  }
  const json = (await resp.json()) as any;
  return json.items || json;
}

/**
 * Create a bookable activity TOMORROW at 12:00 UTC (the first seed
 * master/service/location — the admin donor's payload), return its id.
 */
export async function createTomorrowActivity(): Promise<TestActivity> {
  const ctx = await adminContext();
  try {
    const [masters, services, locations] = await Promise.all([
      firstItems(ctx, '/api/v1/masters'),
      firstItems(ctx, '/api/v1/services'),
      firstItems(ctx, '/api/v1/locations'),
    ]);
    if (masters.length === 0 || services.length === 0 || locations.length === 0) {
      throw new Error('[admin-activity] seed masters/services/locations are empty');
    }
    // Tomorrow's UTC date (+24 h from now keeps the date part stable even
    // near midnight); noon keeps the slot safely in the future.
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const resp = await ctx.post('/api/v1/activities', {
      data: {
        master_id: masters[0].id,
        service_id: services[0].id,
        location_id: locations[0].id,
        start: `${tomorrow}T12:00:00`,
        duration: services[0].duration || 90,
        capacity: 8,
        is_private: false,
      },
    });
    if (!resp.ok()) {
      throw new Error(
        `[admin-activity] activity create failed: HTTP ${resp.status()} ` +
          (await resp.text()).slice(0, 200),
      );
    }
    const created = (await resp.json()) as TestActivity;
    return created;
  } finally {
    await ctx.dispose();
  }
}

/** Delete a factory activity — the admin donor's `cleanupActivity` drill
 * (dry-run preview → real DELETE with the `expected` dependency state;
 * bodyless DELETE is only a dry-run, GH #139 T8). The booking's records
 * were already cleaned by the callcheck fixture, so the common case is a
 * dependency-free `{expected: {}}` commit; 404 (already gone) and 409
 * (mid-cleanup drift) are swallowed like the donor's. */
export async function deleteTestActivity(activityId: string): Promise<void> {
  const ctx = await adminContext();
  try {
    const preview = await ctx.delete(`/api/v1/activities/${activityId}?dry_run=true`);
    if (preview.status() === 404) return;
    const payload: Record<string, unknown> = { expected: {} };
    if (preview.status() === 409) {
      const body = (await preview.json().catch(() => null)) as {
        dependencies?: Array<{ entity: string; items?: Array<{ id: string }> | null }>;
      } | null;
      const expected: Record<string, string[]> = {};
      for (const dep of body?.dependencies ?? []) {
        if (dep.items && dep.items.length > 0) {
          expected[dep.entity] = dep.items.map((item) => item.id);
        }
      }
      payload.expected = expected;
    } else if (preview.status() !== 204) {
      throw new Error(
        `[admin-activity] dry-run preview failed: HTTP ${preview.status()}`,
      );
    }
    const commit = await ctx.delete(`/api/v1/activities/${activityId}`, {
      data: payload,
    });
    if (commit.status() === 404 || commit.status() === 409) return;
    if (!commit.ok()) {
      throw new Error(
        `[admin-activity] activity delete failed: HTTP ${commit.status()} ` +
          (await commit.text()).slice(0, 200),
      );
    }
  } finally {
    await ctx.dispose();
  }
}
