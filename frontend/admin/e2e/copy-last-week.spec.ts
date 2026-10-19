/**
 * copy-last-week.spec.ts (GH #242) — e2e for design spec §9 scenarios S1–S8.
 *
 * Feature: POST /api/v1/activities/copy-week + Toolbar «Копировать прошлую
 * неделю» → CopyLastWeekPopover (location picker with net counters, private
 * hint, cap note; success/info/error toasts per spec §6; closes on success).
 *
 * Copy semantics under test (spec §4–§5, docs/domain-rules/activities.md):
 *   source = [viewed Monday−7 .. −1], target = viewed week; dedup key
 *   (master, service, start+7d, duration) — location/capacity OUTSIDE the key;
 *   is_private rows and archived-location rows never copy; an archived
 *   master's rows remap to the FIRST active master with an intersecting
 *   specialty in canonical board order (sort_order ASC, first_name ASC,
 *   id ASC), no replacement → skipped + reported in the toast; a repeat
 *   click → copied=0, тост «Всё уже есть».
 *
 * Seed anchors (backend/src/seed/seed.py; the per-test reset keeps them):
 *   week-before-last (W0) — 28 rows, 3 private (former aliases ev_2/12/23)
 *   last week (W1)        — 8 rows
 *   current week (W2)     — 9 rows, copy SOURCE for the empty next week
 * GH #491: seed ids are UUIDs — there is no id pattern to grep, so the
 * seed↔copy discriminator is the seed created_at batch (every seed row
 * precedes the first seeded record; copies are created by the API later),
 * and the week Mondays are resolved FROM THE DB (not Date.now()) so a
 * midnight rollover between stack boot and test run cannot shift windows.
 *
 * Test weeks: S1/S2/S3/S5/S7 copy into the empty next week (N = W2+7);
 * S4 into last week (W1); S8 views N2 = W2+14 (its source week is empty).
 *
 * S5/S6 archive a seed entity through the штатный admin API path — the same
 * call the locations/staff tables make (dedicated POST /{id}/archive routes,
 * NOT PATCH is_active; staff archive = bare POST = D6 preselected checkboxes)
 * — and RESTORE it in a finally, so no seed is_active flag leaks across
 * tests (the per-test reset does not restore is_active; same convention as
 * update-rejects-is-active.spec.ts).
 */
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { waitForScheduleReady, waitForScheduleGrid } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
import { seedId } from './fixtures/seed-ids';
import { createTestActivity } from './fixtures/factories';

const BACKEND = resolveBackendUrl();

// ─── Seed anchors by business key (GH #491 — ids are UUIDs) ─────────────────

// GH #491: resolved at test runtime (beforeAll) — the module stays DB-free
// at import: CI's `playwright --list` collects specs before the shard stack
// seeds the DB.
let ALPIKA = ''; let GRAND = ''; let P1389 = '';
let M1 = ''; let M2 = ''; let M3 = ''; let M4 = ''; let M5 = ''; let M7 = '';
let S2 = ''; let S3 = ''; let S5 = ''; let S6 = ''; let S7 = '';
let SEED_MASTER_SECTIONS: Record<string, { specialty: string; color: string }> = {};

/** All seed rows share the seed transaction's created_at, which precedes
 * every test-created row — MIN(records.created_at) is the canonical guard
 * (the seed inserts activities before records within one batch). */
const SEED_GUARD = 'created_at <= (SELECT MIN(created_at) FROM records)';
const COPY_GUARD = 'created_at > (SELECT MIN(created_at) FROM records)';

// ─── Seed anchor weeks (resolved from the DB — see header) ──────────────────

let W0 = ''; // week-before-last Monday (carries the 3 private rows)
let W1 = ''; // last-week Monday
let W2 = ''; // current-week Monday — copy SOURCE for the empty next week

/** Monday of the week containing the given ISO date (UTC arithmetic). */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

test.beforeAll(() => {
  // Seed ids by business key (GH #491 — ids are UUIDs; no DB at import).
  ALPIKA = seedId('locations', 'title', 'Альпика');
  GRAND = seedId('locations', 'title', 'Гранд Отель Поляна');
  P1389 = seedId('locations', 'title', 'Поляна 1389');
  M1 = seedId('staff', 'last_name', 'Середа');
  M2 = seedId('staff', 'last_name', 'Большакова');
  M3 = seedId('staff', 'last_name', 'П.');
  M4 = seedId('staff', 'last_name', 'Тюльпина');
  M5 = seedId('staff', 'last_name', 'В.');
  M7 = seedId('staff', 'last_name', 'Горох');
  S2 = seedId('services', 'title', 'Картина акрилом');
  S3 = seedId('services', 'title', 'Мини-картина акрилом');
  S5 = seedId('services', 'title', 'Ручная лепка');
  S6 = seedId('services', 'title', 'Роспись одежды');
  S7 = seedId('services', 'title', 'Морской пейзаж');
  SEED_MASTER_SECTIONS = {
    [M1]: { specialty: 'живопись', color: '#5B8C7A' },
    [M2]: { specialty: 'керамика', color: '#6B7E9C' },
    [M3]: { specialty: 'живопись', color: '#A07060' },
    [M4]: { specialty: 'керамика', color: '#7A6E9C' },
    [M5]: { specialty: 'живопись', color: '#8A7840' },
    [M7]: { specialty: 'керамика', color: '#9A5870' },
  };

  // Latest SEED activity day lands in the current seed week (the fixed
  // reference week ended 2026-06-21, long before any relative week).
  const row = queryDBRow(
    `SELECT MAX(substr(start,1,10)) AS d FROM activities WHERE ${SEED_GUARD}`,
  );
  if (!row || !row.d) throw new Error('copy-last-week: no seed activities found');
  W2 = mondayOf(String(row.d));
  W1 = addDays(W2, -7);
  W0 = addDays(W2, -14);
});

// ─── Date helpers (pure-date arithmetic — no TZ hazards, #142) ──────────────

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive Monday..Sunday predicate over the DATE part of `start`. */
function weekWhere(monday: string): string {
  return `substr(start,1,10) >= '${monday}' AND substr(start,1,10) <= '${addDays(monday, 6)}'`;
}

/** Rows in the window that are NOT seed rows → copies (created_at guard). */
function countCopies(monday: string): number {
  const row = queryDBRow(
    `SELECT COUNT(*) AS n FROM activities
     WHERE ${COPY_GUARD}
     AND ${weekWhere(monday)}`,
  );
  if (!row) throw new Error('copy-last-week: copies count query failed');
  return Number(row.n);
}

/**
 * Source↔copy parity: every non-private seed source row must re-appear in the
 * target window exactly 7 days later with identical master/service/duration/
 * location/time (spec §5.4 — the copy is a pure +7d shift of every field).
 */
function parityCount(srcMonday: string, tgtMonday: string): number {
  const row = queryDBRow(
    `SELECT COUNT(*) AS n
     FROM activities s
     JOIN activities t
       ON t.master_id = s.master_id
      AND t.service_id = s.service_id
      AND t.duration = s.duration
      AND t.location_id = s.location_id
      AND substr(t.start,1,10) = date(substr(s.start,1,10), '+7 days')
      AND substr(s.start,11) = substr(t.start,11)
     WHERE s.${SEED_GUARD}
       AND s.is_private = 0
       AND ${weekWhere(srcMonday).replaceAll('start', 's.start')}
       AND t.${COPY_GUARD}
       AND ${weekWhere(tgtMonday).replaceAll('start', 't.start')}`,
  );
  if (!row) throw new Error('copy-last-week: parity count query failed');
  return Number(row.n);
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/** Open the right toolbar panel (collapsed by default — topbar stamp toggle). */
async function openToolbar(page: Page): Promise<void> {
  const rightPanel = page.getByTestId('right-panel');
  if (!(await rightPanel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
  }
  await expect(rightPanel).toBeVisible();
}

/**
 * Deep-link the schedule to the week starting on `monday` (week view) and
 * wait for BOTH the grid and the target-week fetch to settle (#138:
 * /schedule?view=week&date=… — the URL is the source of truth). Tolerant
 * fetch wait: a cached week may not issue a new request.
 */
async function switchToWeek(page: Page, monday: string): Promise<void> {
  const weekFetched = page
    .waitForResponse(
      (r) => r.url().includes('/api/v1/activities') && r.url().includes(`date_from=${monday}`),
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.goto(`/schedule?view=week&date=${monday}`);
  await waitForScheduleGrid(page);
  await weekFetched;
  await page.waitForTimeout(300); // render buffer
}

/** Open the copy popover from the Toolbar button (fixture §6 entry point). */
async function openCopyPopover(page: Page): Promise<void> {
  await openToolbar(page);
  await page.getByRole('button', { name: 'Копировать прошлую неделю' }).click();
  await expect(page.getByTestId('copy-last-week-popover')).toBeVisible();
}

/** Pin the per-location net counters («к копированию») once the list renders. */
async function expectLocationCounters(
  page: Page,
  expected: Array<{ id: string; count: number }>,
): Promise<void> {
  for (const { id, count } of expected) {
    await expect(page.getByTestId(`copy-count-${id}`)).toHaveText(String(count));
  }
}

interface CopyWeekResultShape {
  copied: number;
  skipped_duplicates: number;
  skipped_filtered: number;
  skipped_no_master: number;
}

/** Click «Скопировать», await the copy-week POST and return request + result. */
async function clickCopyConfirm(page: Page): Promise<{
  request: { week_start: string; locations: string[] };
  result: CopyWeekResultShape;
}> {
  const copyResponse = page.waitForResponse(
    (r) => r.url().includes('/api/v1/activities/copy-week'),
  );
  await page.getByTestId('copy-confirm').click();
  const resp = await copyResponse;
  expect(resp.status()).toBe(200);
  return {
    request: resp.request().postDataJSON(),
    result: await resp.json(),
  };
}

/** Assert the kind-specific toast carries the text. */
async function expectToast(
  page: Page,
  kind: 'success' | 'info',
  text: string,
): Promise<void> {
  await expect(page.getByTestId(`toast-${kind}`)).toContainText(text);
}

/**
 * Hold every activities GET in flight for `ms` — used by S2 to keep the
 * popover's target-week cache stale (the reactive observer then reads the
 * pre-copy empty rows, so the second confirm reaches server-side dedup).
 */
async function delayActivitiesGETs(page: Page, ms: number): Promise<void> {
  await page.route('**/api/v1/activities**', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return route.continue();
  });
}

/** Seed master sections (specialty/color) — for the S6 restore PATCH.
 * (Built in beforeAll together with the resolved staff ids.) */

/** Restore a seed master through the штатный path: person + master section. */
async function restoreSeedMaster(request: APIRequestContext, id: string): Promise<void> {
  await request.post(`${BACKEND}/api/v1/staff/${id}/restore`);
  const section = SEED_MASTER_SECTIONS[id];
  // PATCH carries the seed section values: the section payload is an UPSERT —
  // a bare {archived:false} would blank specialty/color (D7 history).
  await request.patch(`${BACKEND}/api/v1/staff/${id}`, {
    data: { master: { specialty: section.specialty, color: section.color, archived: false } },
  });
}

/** Assert the DB has no activity of (master, service) at the given slot. */
function expectNoSlot(masterId: string, serviceId: string, slot: string): void {
  const row = queryDBRow(
    `SELECT COUNT(*) AS n FROM activities WHERE master_id='${masterId}'
     AND service_id='${serviceId}' AND substr(start,1,16)='${slot}'`,
  );
  expect(Number(row!.n)).toBe(0);
}

// ─── Scenarios (spec §9) ────────────────────────────────────────────────────

test('S1: чистая неделя ← копия прошлой — карточки на тех же слотах, числа совпадают, тост, попап закрыт', async ({ page }) => {
  const target = addDays(W2, 7);
  await waitForScheduleReady(page); // current week = source, 9 cards
  await switchToWeek(page, target); // empty target week
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(0);

  await openCopyPopover(page);
  // Net counters = source rows of the location (target empty, no private):
  // Альпика 4, Гранд 3, Поляна 1389 2.
  await expectLocationCounters(page, [
    { id: ALPIKA, count: 4 },
    { id: GRAND, count: 3 },
    { id: P1389, count: 2 },
  ]);
  // No private rows in the current week → no private hint.
  await expect(page.getByTestId('copy-private-hint')).toHaveCount(0);

  const { request: body, result } = await clickCopyConfirm(page);
  expect(body.week_start).toBe(target);
  expect([...body.locations].sort()).toEqual([ALPIKA, GRAND, P1389].sort());
  expect(result).toEqual({
    copied: 9,
    skipped_duplicates: 0,
    skipped_filtered: 0,
    skipped_no_master: 0,
  });

  await expectToast(page, 'success', 'Скопировано 9 занятий');
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0); // closed

  // The grid refetches via invalidation → the 9 copies appear on the same slots.
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(9);

  // DB: numbers agree with the toast, and every copy is a pure +7d shift.
  expect(countCopies(target)).toBe(9);
  expect(parityCount(W2, target)).toBe(9);
});

test('S2: повторное копирование не дублирует — copied=0, тост «Всё уже есть», сетка не меняется', async ({ page }) => {
  const target = addDays(W2, 7);
  await waitForScheduleReady(page);
  await switchToWeek(page, target);
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(0);

  await openCopyPopover(page);
  await expectLocationCounters(page, [
    { id: ALPIKA, count: 4 },
    { id: GRAND, count: 3 },
    { id: P1389, count: 2 },
  ]);

  // Hold the post-copy refetches so the popover's target-week cache stays
  // stale-empty on re-open (the invalidation refetch cannot land) — the
  // second confirm is then possible and must hit server-side dedup.
  await delayActivitiesGETs(page, 10_000);
  const first = await clickCopyConfirm(page);
  expect(first.result.copied).toBe(9);
  await expectToast(page, 'success', 'Скопировано 9 занятий');
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

  // Second click: counters read the stale-empty target → enabled → copy → 0.
  await openCopyPopover(page);
  await expect(page.getByTestId('copy-confirm')).toBeEnabled();
  const second = await clickCopyConfirm(page);
  expect(second.request.week_start).toBe(target);
  expect(second.result).toEqual({
    copied: 0,
    skipped_duplicates: 9,
    skipped_filtered: 0,
    skipped_no_master: 0,
  });
  await expectToast(page, 'info', 'Всё уже есть');
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

  // Grid unchanged while the refetch is held — no duplicates were inserted.
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(0);
  expect(countCopies(target)).toBe(9);
  await page.unroute('**/api/v1/activities**');
});

test('S3: merge в частично занятую неделю — несовпадающее не блокирует, совпавшее пропущено, счётчики нетто', async ({ page, request }) => {
  const target = addDays(W2, 7);
  // Pre-create in the target week: one KEY duplicate of the W2 source opener
  // (m1/s7 Mon 10:00, 180 — location Альпика + capacity 6 deliberately
  // different: outside the key, spec §5.2) and one non-matching activity
  // (Tue 09:00).
  //
  // The duplicate's start must be the SOURCE row's stored start shifted +7d —
  // the dedup key is the EXACT start (the seed week base carries boot-time
  // seconds/micros, seed.py uses datetime.now()), so a clean ':00' slot would
  // NOT be a key match.
  const srcRow = queryDBRow(
    `SELECT start FROM activities WHERE ${SEED_GUARD} AND substr(start,1,10)='${W2}'
     ORDER BY start LIMIT 1`,
  );
  if (!srcRow) throw new Error('copy-last-week: W2 source opener missing');
  const srcStartISO = String(srcRow.start).replace(' ', 'T');
  const dupStart = `${addDays(srcStartISO.slice(0, 10), 7)}T${srcStartISO.slice(11)}`;
  const dup = await createTestActivity(request, {
    master_id: M1,
    service_id: S7,
    location_id: ALPIKA,
    start: dupStart,
    duration: 180,
    capacity: 6,
  });
  await createTestActivity(request, {
    master_id: M3,
    service_id: S2,
    location_id: GRAND,
    start: `${addDays(target, 1)}T09:00:00`,
    duration: 60,
    capacity: 4,
  });

  await waitForScheduleReady(page);
  await switchToWeek(page, target);
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(2);

  await openCopyPopover(page);
  // Honest net counters: the source-opener duplicate subtracts from Гранд
  // (the SOURCE row's location), the non-matching row subtracts nothing.
  await expectLocationCounters(page, [
    { id: ALPIKA, count: 4 },
    { id: GRAND, count: 2 },
    { id: P1389, count: 2 },
  ]);

  const { result } = await clickCopyConfirm(page);
  expect(result).toEqual({
    copied: 8,
    skipped_duplicates: 1,
    skipped_filtered: 0,
    skipped_no_master: 0,
  });
  await expectToast(page, 'success', 'Скопировано 8 занятий');
  await expectToast(page, 'success', 'пропущено 1 — уже есть');
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

  // 8 copies + 2 pre-created = 10 cards.
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(10);
  expect(countCopies(target)).toBe(10);

  // The duplicate slot holds exactly ONE row (the pre-created one — no copy
  // duplicate despite the different location/capacity), and it survives.
  const slot = queryDBRow(
    `SELECT COUNT(*) AS n FROM activities WHERE master_id='${M1}' AND service_id='${S7}'
     AND substr(start,1,16)='${target} 10:00'`,
  );
  expect(Number(slot!.n)).toBe(1);
  expect(queryDBRow(`SELECT id FROM activities WHERE id='${dup.id}'`)).toBeTruthy();
});

test('S4: индивидуальные не копируются — подсказка «K индивидуальных…», приватных в целевой нет', async ({ page }) => {
  await waitForScheduleReady(page);
  await switchToWeek(page, W1); // target = last week; source = week-before-last
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(8);

  await openCopyPopover(page);
  // ev_2 / ev_12 / ev_23 aliases — the 3 private rows in the source week.
  await expect(page.getByTestId('copy-private-hint')).toHaveText(
    '3 индивидуальных занятий не копируются',
  );
  // Net counters: minus the 3 private rows, minus the 4 key duplicates already
  // in the target week (the W0 Monday/Tuesday rows matching W1 sources).
  await expectLocationCounters(page, [
    { id: ALPIKA, count: 6 },
    { id: GRAND, count: 8 },
    { id: P1389, count: 7 },
  ]);

  const { result } = await clickCopyConfirm(page);
  expect(result).toEqual({
    copied: 21,
    skipped_duplicates: 4,
    skipped_filtered: 3,
    skipped_no_master: 0,
  });
  await expectToast(page, 'success', 'Скопировано 21 занятий');
  await expectToast(page, 'success', 'пропущено 4 — уже есть');
  await expectToast(
    page,
    'success',
    'не скопировано ещё 3 — индивидуальные, архивная локация или без замены мастера',
  );
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

  // 8 seed + 21 copies.
  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(29);
  expect(countCopies(W1)).toBe(21);
  expect(parityCount(W0, W1)).toBe(21);

  // No private row ever lands in the target week…
  expect(
    Number(
      queryDBRow(`SELECT COUNT(*) AS n FROM activities WHERE is_private=1 AND ${weekWhere(W1)}`)!.n,
    ),
  ).toBe(0);
  // …and the three private slots (ПН 14:00 m4/s3 / ЧТ 18:00 m5/s5 / СБ 14:30
  // m3/s5, each +7d) stay empty.
  expectNoSlot(M4, S3, `${W1} 14:00`);
  expectNoSlot(M5, S5, `${addDays(W1, 3)} 18:00`);
  expectNoSlot(M3, S5, `${addDays(W1, 5)} 14:30`);
});

test('S5: архивная локация пропускается — занятий из неё нет, локации нет в попапе', async ({ page, request }) => {
  // ARRANGE: archive a seed location through the штатный admin path — the
  // dedicated POST /{id}/archive route (the same call the locations table's
  // «В архив» makes; locations.py has no PATCH-is_active archive path) —
  // BEFORE the page load, then restore in finally.
  const archiveResp = await request.post(`${BACKEND}/api/v1/locations/${P1389}/archive`);
  expect(archiveResp.status()).toBe(200);
  expect(await archiveResp.json()).toMatchObject({ archived: true });

  try {
    const target = addDays(W2, 7);
    await waitForScheduleReady(page);
    await switchToWeek(page, target);

    await openCopyPopover(page);
    // «Поляна 1389» is not offered in the popover at all.
    await expect(page.getByTestId(`copy-loc-${P1389}`)).toHaveCount(0);
    await expect(page.getByTestId('copy-last-week-popover')).not.toContainText('Поляна 1389');
    await expectLocationCounters(page, [
      { id: ALPIKA, count: 4 },
      { id: GRAND, count: 3 },
    ]);

    const { result } = await clickCopyConfirm(page);
    expect(result).toEqual({
      copied: 7,
      skipped_duplicates: 0,
      skipped_filtered: 2,
      skipped_no_master: 0,
    });
    await expectToast(page, 'success', 'Скопировано 7 занятий');
    await expectToast(page, 'success', 'не скопировано ещё 2');
    await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

    await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(7);
    expect(countCopies(target)).toBe(7);

    // The archived location's two source rows (ПН 14:00 m4/s3,
    // ПТ 14:00 m5/s1) never land.
    expectNoSlot(M4, S3, `${target} 14:00`);
    expectNoSlot(M5, seedId('services', 'title', 'Картина маслом'), `${addDays(target, 4)} 14:00`);
  } finally {
    await request.post(`${BACKEND}/api/v1/locations/${P1389}/restore`);
  }
});

test('S6: ремап архивного мастера — первый активный с пересекающейся speciality (канонический порядок борда); без замены → skip + тост', async ({ page, request }) => {
  // ARRANGE: archive m3 (живопись — replaced by the first active живопись
  // master in board order) and ALL керамика masters m2/m4/m7 (no active
  // керамика remains → no replacement) through the штатный staff archive
  // path — bare POST = D6 preselected checkboxes {archive_master, archive_user}.
  // None of them holds a user link (only m1 does) → no account side effects.
  for (const id of [M3, M2, M4, M7]) {
    const resp = await request.post(`${BACKEND}/api/v1/staff/${id}/archive`);
    expect(resp.status()).toBe(200);
  }
  try {
    const target = addDays(W2, 7);
    await waitForScheduleReady(page);
    await switchToWeek(page, target);

    await openCopyPopover(page);
    // D2: the «не найдут замену» hint is NOT computable client-side — the
    // counters stay gross (9 across 3 locations).
    await expectLocationCounters(page, [
      { id: ALPIKA, count: 4 },
      { id: GRAND, count: 3 },
      { id: P1389, count: 2 },
    ]);

    const { result } = await clickCopyConfirm(page);
    expect(result).toEqual({
      copied: 6,
      skipped_duplicates: 0,
      skipped_filtered: 0,
      skipped_no_master: 3,
    });
    await expectToast(page, 'success', 'Скопировано 6 занятий');
    await expectToast(
      page,
      'success',
      'не скопировано ещё 3 — индивидуальные, архивная локация или без замены мастера',
    );
    await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

    await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(6);
    expect(countCopies(target)).toBe(6);

    // m3's rows (ВТ 11:00 / СБ 14:00 «Картина акрилом») remapped under m1 —
    // the FIRST active живопись master in canonical board order
    // (Середа sort_order 0 < В. sort_order 4).
    const remapTue = queryDBRow(
      `SELECT COUNT(*) AS n FROM activities WHERE master_id='${M1}' AND service_id='${S2}'
       AND substr(start,1,16)='${addDays(target, 1)} 11:00'`,
    );
    expect(Number(remapTue!.n)).toBe(1);
    const remapSat = queryDBRow(
      `SELECT COUNT(*) AS n FROM activities WHERE master_id='${M1}' AND service_id='${S2}'
       AND substr(start,1,16)='${addDays(target, 5)} 14:00'`,
    );
    expect(Number(remapSat!.n)).toBe(1);

    // The керамика rows (m4 ПН 14:00 «Мини-картина», m2 СР 10:00 / ВС 11:00
    // «Ручная лепка») found no active керамика replacement → skipped.
    expectNoSlot(M4, S3, `${target} 14:00`);
    expectNoSlot(M2, S6, `${addDays(target, 2)} 10:00`);
    expectNoSlot(M2, S5, `${addDays(target, 6)} 11:00`);

    // No copy carries an archived master either (remap invariant, spec §5.3).
    const archivedCarriers = queryDBRow(
      `SELECT COUNT(*) AS n FROM activities t
       JOIN masters m ON m.staff_id = t.master_id
       WHERE t.${COPY_GUARD}
       AND ${weekWhere(target).replaceAll('start', 't.start')} AND NOT m.is_active`,
    );
    expect(Number(archivedCarriers!.n)).toBe(0);
  } finally {
    for (const id of [M3, M2, M4, M7]) {
      await restoreSeedMaster(request, id);
    }
  }
});

test('S7: снятая галка локации — её занятия не скопированы, запрос уходит с явным списком', async ({ page }) => {
  const target = addDays(W2, 7);
  await waitForScheduleReady(page);
  await switchToWeek(page, target);

  await openCopyPopover(page);
  await expectLocationCounters(page, [
    { id: ALPIKA, count: 4 },
    { id: GRAND, count: 3 },
    { id: P1389, count: 2 },
  ]);

  // Uncheck Альпика → 4 rows stay behind.
  await page.getByTestId(`copy-loc-${ALPIKA}`).uncheck();

  const { request: body, result } = await clickCopyConfirm(page);
  expect(body.week_start).toBe(target);
  // The request ALWAYS carries the explicit checked list (no "all" encoding).
  expect(body.locations).toEqual(expect.arrayContaining([GRAND, P1389]));
  expect(body.locations).not.toContain(ALPIKA);
  expect(body.locations).toHaveLength(2);

  expect(result).toEqual({
    copied: 5,
    skipped_duplicates: 0,
    skipped_filtered: 0,
    skipped_no_master: 0,
  });
  await expectToast(page, 'success', 'Скопировано 5 занятий');
  await expect(page.getByTestId('copy-last-week-popover')).toHaveCount(0);

  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(5);
  expect(countCopies(target)).toBe(5);

  // None of Альпика's four source rows (ВТ 11:00 / СР 10:00 / СБ 14:00 / ВС
  // 11:00) lands…
  expect(
    Number(
      queryDBRow(
        `SELECT COUNT(*) AS n FROM activities WHERE location_id='${ALPIKA}' AND ${weekWhere(target)}`,
      )!.n,
    ),
  ).toBe(0);
  // …and parity covers exactly the checked locations' rows.
  expect(parityCount(W2, target)).toBe(5);
});

test('S8: пустая прошлая неделя — пустое состояние попапа, «Скопировать» неактивна', async ({ page }) => {
  const far = addDays(W2, 14); // its source week (N..N+6) holds nothing in seed
  await waitForScheduleReady(page);
  await switchToWeek(page, far);

  await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(0);
  await openCopyPopover(page);

  await expect(page.getByTestId('copy-empty')).toHaveText(
    'На прошлой неделе занятий нет — нечего копировать.',
  );
  await expect(page.getByTestId('copy-confirm')).toBeDisabled();
  // No location picker rows render for an empty source week.
  await expect(page.getByTestId(`copy-loc-${ALPIKA}`)).toHaveCount(0);
});
