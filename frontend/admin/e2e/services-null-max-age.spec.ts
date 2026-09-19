/**
 * GH #203 Task 2 — E2E smoke pair for ServiceModal NULL max_age (spec §4.1–4.2).
 *
 * S1 `edit-save-null-max-age`: open the seed service with an empty «Возраст до»
 *    → named assert: input value === '' → named assert: placeholder
 *    «без ограничения» → rename → «Сохранить» → success; the PUT lands and
 *    a fresh GET returns `max_age: null`.
 * S2 `clear-max-age-saves-null`: «Акварель» (the only seed service with
 *    `max_age: 12`) → clear «Возраст до» → save → GET returns `null`; on the
 *    schedule (the buildSchedule-backed surface with a confirmed age badge
 *    render) the service card shows «6+», not the «6–12» range. The services
 *    list is NOT used for the badge assert (unconfirmed badge surface there).
 *
 * Self-contained per run: RESET_SQL does not restore edited seed rows (D3),
 * so each test reads the service's current state via the API first, and a
 * `finally` block PUTs the captured state back — a rename/clear from one run
 * never leaks into the next.
 */
import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  gotoScheduleWeek,
  waitForServicesReady,
  waitForScheduleReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRows } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Seed service with max_age: null — «Возраст до» must open empty. */
const NULL_AGE_SEED = { id: 's1' };
/** Seed service with max_age: 12 — the only non-null in the seed. */
const AGE12_SEED = { id: 's4', title: 'Акварель' };

/** Full service row as the GET endpoint returns it (fields we restore). */
interface ServiceRow {
  id: string;
  title: string;
  description: string;
  image_url: string;
  specialty: string;
  min_age: number;
  max_age: number | null;
  duration: number;
  record_info: string;
  tariffs: { title: string; description: string | null; price: number }[];
  tags: { id: string }[];
  materials: { id: string; note: string | null }[];
}

/** GET /api/v1/services/{id} — Node-side request context, bypasses the UI. */
async function getService(request: APIRequestContext, id: string): Promise<ServiceRow> {
  const resp = await request.get(`${BACKEND}/api/v1/services/${id}`);
  expect(resp.ok(), `GET /services/${id} must succeed`).toBeTruthy();
  return (await resp.json()) as ServiceRow;
}

/**
 * Capture the CURRENT state of a service as a restorable snapshot.
 * Tag ids come from the `service_tags` join read via sqlite — the GET body
 * carries no reliable `tag_ids` (s4 links to tag3, but `tags` arrives
 * empty), and a PUT with `tag_ids: []` hard-drops the seed link.
 */
async function captureService(request: APIRequestContext, id: string) {
  const row = await getService(request, id);
  const tagIds = queryDBRows(
    `SELECT tag_id FROM service_tags WHERE service_id='${id}'`,
  ).map((r) => r.tag_id as string);
  return { row, tagIds };
}

/**
 * Map a GET response onto the exact ServiceUpdate shape (PUT forbids extras).
 * Material links ride the GET as `{id, note}` — the write shape is
 * `{material_id, note}`.
 */
function toUpdatePayload(s: ServiceRow, tagIds: string[]) {
  return {
    title: s.title,
    description: s.description,
    image_url: s.image_url,
    specialty: s.specialty,
    min_age: s.min_age,
    max_age: s.max_age,
    duration: s.duration,
    record_info: s.record_info,
    tariffs: s.tariffs.map((t) => ({ title: t.title, description: t.description, price: t.price })),
    tag_ids: tagIds,
    materials: s.materials.map((m) => ({ material_id: m.id, note: m.note })),
  };
}

/** PUT the captured state back — undo every mutation the test made,
 * including the tag links the modal's PUT silently drops (no tags UI in
 * SERVICE_FIELDS → the form always submits `tag_ids: []`). */
async function restoreService(
  request: APIRequestContext,
  snapshot: { row: ServiceRow; tagIds: string[] },
  overrides?: Partial<ServiceRow>,
): Promise<void> {
  const resp = await request.put(`${BACKEND}/api/v1/services/${snapshot.row.id}`, {
    data: toUpdatePayload({ ...snapshot.row, ...overrides }, snapshot.tagIds),
  });
  expect(resp.ok(), `restore PUT /services/${snapshot.row.id} must succeed: ${await resp.text()}`)
    .toBeTruthy();
}

/** Row of the service in the services table, anchored to the row testid
 * baked into the accessible name («… — строка s4»). Text filters alone are
 * ambiguous here: s7 «Морской пейзаж» also contains «Акварель» (specialty). */
function serviceRow(page: Page, id: string) {
  return page.getByRole('row', { name: new RegExp(`строка ${id}$`) });
}

/** The top-level «Название» input inside the dialog. Tariff items carry
 * identical «Название» labels — the top-level field renders first (same
 * index-0 convention the ServiceModal unit tests pin). */
function titleInput(dialog: ReturnType<Page['getByRole']>) {
  return dialog.getByLabel('Название').first();
}

/** The top-level «Возраст до» input inside the dialog (label-bound). */
function maxAgeInput(dialog: ReturnType<Page['getByRole']>) {
  return dialog.getByLabel(/^Возраст до/).first();
}

/** Open the edit modal by clicking the service row; waits for the dialog.
 * Identity check: the top-level title input carries the service title
 * (a text probe would be ambiguous — «Акварель» also appears in the
 * description textarea and the materials picker). */
async function openServiceModal(page: Page, id: string, title: string) {
  await serviceRow(page, id).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(titleInput(dialog)).toHaveValue(title, { timeout: 10_000 });
  return dialog;
}

test.describe('Services — NULL max_age smoke pair (#203 §4.1–4.2)', () => {
  test('edit-save-null-max-age: empty «до» stays null through a rename-save', async ({
    page,
    request,
  }) => {
    // Current state read at test start (never hardcoded): the seed makes
    // s1's max_age null, but a previous run's mutation may have survived —
    // normalize first so the modal deterministically opens empty.
    const snapshot = await captureService(request, NULL_AGE_SEED.id);
    if (snapshot.row.max_age !== null) {
      await restoreService(request, snapshot, { max_age: null });
    }
    try {
      await waitForServicesReady(page);
      const dialog = await openServiceModal(page, NULL_AGE_SEED.id, snapshot.row.title);
      const ageInput = maxAgeInput(dialog);

      // NAMED ASSERT — the input value is the empty string (not 0).
      await expect
        .soft(ageInput, 'S1: «Возраст до» opens with an empty value, not 0')
        .toHaveValue('');

      // NAMED ASSERT — the empty state reads as intentional via the placeholder.
      await expect
        .soft(ageInput, 'S1: empty «Возраст до» shows the «без ограничения» placeholder')
        .toHaveAttribute('placeholder', 'без ограничения');

      // ACTION — rename the service and save (only the title changes).
      const newTitle = `${snapshot.row.title} #203`;
      await titleInput(dialog).fill(newTitle);
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY API — the edit went through and max_age is still null.
      const after = await getService(request, NULL_AGE_SEED.id);
      expect(after.title).toBe(newTitle);
      expect(after.max_age).toBeNull();
    } finally {
      await restoreService(request, snapshot);
    }
  });

  test('clear-max-age-saves-null: clearing «до» drops the age badge on the schedule', async ({
    page,
    request,
  }) => {
    // Normalize to the seed contract (max_age = 12) first: a previous run
    // leaves the field null, and this test must always exercise 12 → null.
    const snapshot = await captureService(request, AGE12_SEED.id);
    if (snapshot.row.max_age !== 12) {
      await restoreService(request, snapshot, { max_age: 12 });
    }
    try {
      await waitForServicesReady(page);
      const dialog = await openServiceModal(page, AGE12_SEED.id, snapshot.row.title);
      const ageInput = maxAgeInput(dialog);
      await expect(ageInput).toHaveValue('12');

      // ACTION — clear «Возраст до» and save.
      await ageInput.fill('');
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY API — the cleared field persisted as null (not 0, not 12).
      const after = await getService(request, AGE12_SEED.id);
      expect(after.max_age).toBeNull();

      // VERIFY SCHEDULE — buildSchedule-backed card renders «6+» (min 6, no
      // upper bound), never the «6–12» range badge.
      await waitForScheduleReady(page);

      // Find a seed week that contains an «Акварель» (s4) activity, then
      // deep-link there via the schedule URL canon (#138 gotoScheduleWeek).
      const actsResp = await request.get(`${BACKEND}/api/v1/activities?page=1&per_page=100`);
      expect(actsResp.ok()).toBeTruthy();
      const acts = (await actsResp.json()) as {
        items?: { id: string; service_id: string; start: string }[];
      };
      const items = acts.items ?? (acts as unknown as { service_id: string; start: string }[]);
      const s4Activity = items.find((a) => a.service_id === 's4');
      expect(s4Activity, 'seed schedule must contain an «Акварель» (s4) activity').toBeTruthy();
      const weekStart = s4Activity!.start.slice(0, 10);

      await gotoScheduleWeek(page, weekStart);

      // One «Акварель» activity per seed week — first() is deterministic here.
      const card = page
        .locator('[data-testid^="activity-"]')
        .filter({ hasText: AGE12_SEED.title })
        .first();
      await expect(card).toBeVisible({ timeout: 10_000 });

      // The age text lives in a span right after the title: «6+» when null.
      const ageText = card.locator('span').filter({ hasText: /^6(\+|–12)$/ });
      await expect(ageText).toHaveCount(1);
      await expect(ageText).toHaveText('6+');
      await expect(card).not.toContainText('6–12');
    } finally {
      // Restore canonical seed state (max_age = 12) even if the normalize
      // above had to repair a leaked null from an earlier run.
      await restoreService(request, snapshot, { max_age: 12 });
    }
  });
});
