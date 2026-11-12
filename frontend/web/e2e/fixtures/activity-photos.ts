/**
 * activity-photos.ts — the #576 Task 6 API fixture (US-1…US-4).
 *
 * Four DISTINCT service/activity pairs cover the strip-composition matrix
 * without state bleed (the plan's determinism guidance — one pair per
 * scenario, so tests can run in any order):
 *
 *   us1 — service with 2 public + 1 non-public photos, its TARGET activity
 *         with 2 public photos (the discriminating two-group order case);
 *         plus a COMPANION activity of the same service (no own photos,
 *         a later day) pinning the service-scoped union: the companion
 *         detail shows the SAME strip.
 *   us2 — service with 2 public photos, activity with none of its own.
 *   us3 — service without direct photos, activity with 2 public photos.
 *   us4 — no photos anywhere: no strip, the cover stays.
 *
 * The seed schedule lives in the past while the home page lists today+14
 * days — GET /activities over the visible week is empty, so the plan's
 * sanctioned fallback applies: activities are created via the staff API
 * inside existing services (the admin-activity.ts factory pattern), one
 * scenario per DISTINCT day of the visible week — each target card is
 * its day's sole (top, clickable) carousel card.
 *
 * Services are picked DYNAMICALLY from GET /services/all, excluding every
 * service reachable by a pre-existing photo (direct owner or via its seed
 * activities — GET /photos + GET /activities, the variant-A union): seed
 * UUIDs are not stable across reseeds, and a dirty service would leak
 * foreign photos into the strip assertions.
 *
 * Photo files are the EXISTING static images of frontend/web/public/images/
 * (canon #513: statics serve the bytes, is_public filters only lists).
 * Same-group photos are POSTed 1.1 s apart: created_at is server-set
 * (microsecond precision) and back-to-back POSTs can tie, while the pinned
 * in-group order is `created_at desc` — the gap makes it deterministic by
 * construction. The fixture self-checks the timestamps AND the public
 * endpoint's two-group order before handing control to the UI tests.
 */
import { expect, request as playwrightRequest } from 'playwright/test';
import type { APIRequestContext } from 'playwright/test';
import { resolveBackendUrl } from '../lib/backend-url';
import { resolveWebPort } from '../lib/stack-port';

/** Seed staff admin — the canon admin-e2e credentials (admin-activity.ts,
 * backend/src/seed: `+79990000001/admin12345`). */
const STAFF_PHONE = '+79990000001';
const STAFF_PASSWORD = 'admin12345';

/** Gap between same-group photo POSTs — see the module doc. */
const CREATED_AT_GAP_MS = 1_100;

// ── Static filenames (frontend/web/public/images) ─────────────────────────
// Public pool: names no seed spec pins positionally and no service cover
// uses (covers are card-*.jpg — a photo sharing a cover's src would make
// two thumbs match the same main src and break aria-current uniqueness).
const US1_SVC_OLD = '/images/guest-3.jpg';
const US1_SVC_NEW = '/images/guest-4.jpg';
const US1_HIDDEN = '/images/cabinet-draft.jpg'; // non-public (c1's private
// seed file — reusing the NAME is safe: our copy is also non-public, so it
// never reaches any public list; different row, different owner).
const US1_ACT_OLD = '/images/guest-5.jpg';
const US1_ACT_NEW = '/images/guest-6.jpg';
const US2_SVC_OLD = '/images/guest-7.jpg';
const US2_SVC_NEW = '/images/guest-8.jpg';
const US3_ACT_OLD = '/images/hero-bg.jpg';
const US3_ACT_NEW = '/images/guest-1.jpg';

export interface StripScenario {
  /** Service whose detail strip the scenario asserts. */
  serviceId: string;
  /** The service cover (image_url) — first thumb, default main. */
  cover: string;
  /** The activity whose detail the test opens. */
  activityId: string;
  /** UTC ISO date the activity lives on (calendar day chip). */
  isoDate: string;
  /** Expected public strip order, newest first (may be empty). */
  servicePhotos: string[];
  /** Expected public strip order, newest first (may be empty). */
  activityPhotos: string[];
  /** A photo that must NEVER render in the detail (US-1 only). */
  hiddenPhoto?: string;
}

export interface ActivityPhotosFixtures {
  us1: StripScenario;
  us1Companion: { activityId: string; isoDate: string };
  us2: StripScenario;
  us3: StripScenario;
  us4: StripScenario;
  /** Deletes every created photo, then every created activity. */
  cleanup: () => Promise<void>;
}

interface ServiceRow {
  id: string;
  title: string;
  image_url: string | null;
  duration?: number | null;
}

interface PhotoRow {
  id: string;
  filename: string;
  service_id: string | null;
  activity_id: string | null;
  created_at: string;
}

interface ActivityRow {
  id: string;
  service_id: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** UTC ISO date `daysAhead` from now — noon slots keep dates stable. */
function isoDateDaysAhead(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

async function staffContext(): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({
    baseURL: resolveBackendUrl(),
    extraHTTPHeaders: { Origin: `http://127.0.0.1:${resolveWebPort()}` },
  });
  const resp = await ctx.post('/api/v1/auth/login', {
    data: { phone: STAFF_PHONE, password: STAFF_PASSWORD },
  });
  if (!resp.ok()) {
    const body = (await resp.text()).slice(0, 200);
    await ctx.dispose();
    throw new Error(
      `[activity-photos] staff login failed: HTTP ${resp.status()} ${body}`,
    );
  }
  return ctx;
}

async function api<T>(
  ctx: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const resp = await ctx.fetch(path, { method, data });
  if (!resp.ok()) {
    throw new Error(
      `[activity-photos] ${method} ${path} failed: HTTP ${resp.status()} ` +
        (await resp.text()).slice(0, 200),
    );
  }
  return (await resp.json()) as T;
}

/** Full paged list (per_page=100 — the shared MAX_LIST_IDS ceiling). */
async function listAll<T>(
  ctx: APIRequestContext,
  path: string,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const body = await api<{ items: T[]; total: number }>(
      ctx,
      'GET',
      `${path}${separator}page=${page}`,
    );
    out.push(...body.items);
    if (out.length >= body.total || body.items.length === 0) return out;
    page += 1;
  }
}

async function createActivity(
  ctx: APIRequestContext,
  serviceId: string,
  masterId: string,
  locationId: string,
  isoDate: string,
  time: string,
  duration: number,
): Promise<string> {
  const created = await api<{ id: string }>(ctx, 'POST', '/api/v1/activities', {
    master_id: masterId,
    service_id: serviceId,
    location_id: locationId,
    start: `${isoDate}T${time}`,
    duration,
    capacity: 8,
    is_private: false,
  });
  return created.id;
}

async function createPhoto(
  ctx: APIRequestContext,
  filename: string,
  owner: { service_id: string } | { activity_id: string },
  isPublic: boolean,
): Promise<PhotoRow> {
  return api<PhotoRow>(ctx, 'POST', '/api/v1/photos', {
    filename,
    is_public: isPublic,
    ...owner,
  });
}

/** The delete-family drill (canon admin-activity.ts): dry-run preview →
 * commit with the probed `expected` state; 404/409 swallowed. */
async function deleteActivity(
  ctx: APIRequestContext,
  activityId: string,
): Promise<void> {
  const preview = await ctx.delete(
    `/api/v1/activities/${activityId}?dry_run=true`,
  );
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
      `[activity-photos] activity dry-run failed: HTTP ${preview.status()}`,
    );
  }
  const commit = await ctx.delete(`/api/v1/activities/${activityId}`, {
    data: payload,
  });
  if (commit.status() === 404 || commit.status() === 409) return;
  if (!commit.ok()) {
    throw new Error(
      `[activity-photos] activity delete failed: HTTP ${commit.status()}`,
    );
  }
}

/** Pick four services no pre-existing photo can reach (variant-A union:
 * direct owner OR via any of the service's activities). */
async function pickCleanServices(ctx: APIRequestContext): Promise<ServiceRow[]> {
  const [services, photos, activities] = await Promise.all([
    api<ServiceRow[]>(ctx, 'GET', '/api/v1/services/all'),
    listAll<PhotoRow>(ctx, '/api/v1/photos?per_page=100'),
    listAll<ActivityRow>(ctx, '/api/v1/activities?per_page=100'),
  ]);
  const serviceOfActivity = new Map(
    activities.map((activity) => [activity.id, activity.service_id]),
  );
  const dirty = new Set<string>();
  for (const photo of photos) {
    if (photo.service_id) dirty.add(photo.service_id);
    const viaActivity = photo.activity_id
      ? serviceOfActivity.get(photo.activity_id)
      : undefined;
    if (viaActivity) dirty.add(viaActivity);
  }
  const clean = services.filter(
    (service) => !dirty.has(service.id) && service.image_url,
  );
  if (clean.length < 4) {
    throw new Error(
      `[activity-photos] need 4 photo-clean services with covers, ` +
        `found ${clean.length} of ${services.length}`,
    );
  }
  return clean.slice(0, 4);
}

/** Create the four scenario pairs + photos; self-checks the API contract
 * (two-group order, in-group `created_at desc`, hidden photo excluded). */
export async function createActivityPhotosFixtures(): Promise<ActivityPhotosFixtures> {
  const ctx = await staffContext();
  const photoIds: string[] = [];
  const activityIds: string[] = [];

  const cleanup = async (): Promise<void> => {
    try {
      // Photos FIRST (activity deletion would detach their owner FK).
      for (const id of photoIds) {
        await ctx
          .delete(`/api/v1/photos/${id}`, { data: { expected: {} } })
          .catch(() => {});
      }
      for (const id of activityIds) {
        await deleteActivity(ctx, id).catch(() => {});
      }
    } finally {
      await ctx.dispose();
    }
  };

  try {
    const [us1Svc, us2Svc, us3Svc, us4Svc] = await pickCleanServices(ctx);
    const [masters, locations] = await Promise.all([
      listAll<{ id: string }>(ctx, '/api/v1/masters?per_page=100'),
      listAll<{ id: string }>(ctx, '/api/v1/locations?per_page=100'),
    ]);

    // One scenario per distinct day of the visible week: the target card
    // is its day's sole carousel card (top → clickable, no stack order
    // assumptions). Days: D+1 us1, D+2 us2, D+3 us3, D+4 us4, D+5 the
    // us1 companion (the cross-activity union pin).
    const created = await Promise.all([
      createActivity(ctx, us1Svc.id, masters[0].id, locations[0].id,
        isoDateDaysAhead(1), '12:00:00', us1Svc.duration || 90),
      createActivity(ctx, us2Svc.id, masters[0].id, locations[0].id,
        isoDateDaysAhead(2), '12:00:00', us2Svc.duration || 90),
      createActivity(ctx, us3Svc.id, masters[0].id, locations[0].id,
        isoDateDaysAhead(3), '12:00:00', us3Svc.duration || 90),
      createActivity(ctx, us4Svc.id, masters[0].id, locations[0].id,
        isoDateDaysAhead(4), '12:00:00', us4Svc.duration || 90),
      createActivity(ctx, us1Svc.id, masters[0].id, locations[0].id,
        isoDateDaysAhead(5), '12:00:00', us1Svc.duration || 90),
    ]);
    activityIds.push(...created);
    const [us1Activity, us2Activity, us3Activity, us4Activity, us1Companion] =
      created;

    // US-1 photos: service group (older → newer, gapped), the non-public
    // one (order-free), then the activity group (older → newer, gapped).
    const svcOld = await createPhoto(ctx, US1_SVC_OLD, { service_id: us1Svc.id }, true);
    await sleep(CREATED_AT_GAP_MS);
    const svcNew = await createPhoto(ctx, US1_SVC_NEW, { service_id: us1Svc.id }, true);
    const svcHidden = await createPhoto(ctx, US1_HIDDEN, { service_id: us1Svc.id }, false);
    const actOld = await createPhoto(ctx, US1_ACT_OLD, { activity_id: us1Activity }, true);
    await sleep(CREATED_AT_GAP_MS);
    const actNew = await createPhoto(ctx, US1_ACT_NEW, { activity_id: us1Activity }, true);
    photoIds.push(svcOld.id, svcNew.id, svcHidden.id, actOld.id, actNew.id);

    // US-2: service-only photos.
    const us2Old = await createPhoto(ctx, US2_SVC_OLD, { service_id: us2Svc.id }, true);
    await sleep(CREATED_AT_GAP_MS);
    const us2New = await createPhoto(ctx, US2_SVC_NEW, { service_id: us2Svc.id }, true);
    photoIds.push(us2Old.id, us2New.id);

    // US-3: activity-only photos (the service keeps none of its own).
    const us3Old = await createPhoto(ctx, US3_ACT_OLD, { activity_id: us3Activity }, true);
    await sleep(CREATED_AT_GAP_MS);
    const us3New = await createPhoto(ctx, US3_ACT_NEW, { activity_id: us3Activity }, true);
    photoIds.push(us3Old.id, us3New.id);

    // ── Fixture self-checks (the API contract the UI consumes) ────────
    expect(
      new Date(svcNew.created_at).getTime(),
      'gapped POSTs must produce distinct created_at',
    ).toBeGreaterThan(new Date(svcOld.created_at).getTime());
    expect(new Date(actNew.created_at).getTime()).toBeGreaterThan(
      new Date(actOld.created_at).getTime(),
    );

    const publicFeed = async (serviceId: string): Promise<string[]> => {
      const body = await api<{ items: Array<{ filename: string }> }>(
        ctx,
        'GET',
        `/api/v1/public/photos?service_id=${serviceId}&per_page=20`,
      );
      return body.items.map((item) => item.filename);
    };
    expect(await publicFeed(us1Svc.id)).toEqual([
      US1_SVC_NEW,
      US1_SVC_OLD,
      US1_ACT_NEW,
      US1_ACT_OLD,
    ]);
    expect(await publicFeed(us2Svc.id)).toEqual([US2_SVC_NEW, US2_SVC_OLD]);
    expect(await publicFeed(us3Svc.id)).toEqual([US3_ACT_NEW, US3_ACT_OLD]);
    expect(await publicFeed(us4Svc.id)).toEqual([]);

    return {
      us1: {
        serviceId: us1Svc.id,
        cover: us1Svc.image_url!,
        activityId: us1Activity,
        isoDate: isoDateDaysAhead(1),
        servicePhotos: [US1_SVC_NEW, US1_SVC_OLD],
        activityPhotos: [US1_ACT_NEW, US1_ACT_OLD],
        hiddenPhoto: US1_HIDDEN,
      },
      us1Companion: {
        activityId: us1Companion,
        isoDate: isoDateDaysAhead(5),
      },
      us2: {
        serviceId: us2Svc.id,
        cover: us2Svc.image_url!,
        activityId: us2Activity,
        isoDate: isoDateDaysAhead(2),
        servicePhotos: [US2_SVC_NEW, US2_SVC_OLD],
        activityPhotos: [],
      },
      us3: {
        serviceId: us3Svc.id,
        cover: us3Svc.image_url!,
        activityId: us3Activity,
        isoDate: isoDateDaysAhead(3),
        servicePhotos: [],
        activityPhotos: [US3_ACT_NEW, US3_ACT_OLD],
      },
      us4: {
        serviceId: us4Svc.id,
        cover: us4Svc.image_url!,
        activityId: us4Activity,
        isoDate: isoDateDaysAhead(4),
        servicePhotos: [],
        activityPhotos: [],
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
