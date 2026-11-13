/**
 * location-visibility-pair.ts — #601 Task 5 seed fixture: the «hidden +
 * visible» LOCATION pair, each with an activity in the displayed window.
 *
 * SQL seeding on the visibility-pair.ts (#600) donor pattern: the fixed
 * visual week 06-15 is NEVER touched, the pair lands in whatever
 * TEST_DB_PATH the run resolves, and FK columns (master_id) are copied
 * from an existing activity row. Each location of the pair gets a
 * dedicated service with an unmistakable title (activities carry no
 * title — the schedule card heading is the service title) and ONE
 * activity at the shared current-week slot (weekSlot, re-exported from
 * the #600 fixture — one slot rule, two fixtures):
 *   «601-E2E-Скрытая»    → is_public = 0 (absent from the site filter
 *                            and schedule; direct-id booking → 404)
 *   «601-E2E-Контроль»   → is_public = 1 (the positive control)
 *
 * IMPORT-TIME RULE (seed-ids donor): never call at module scope —
 * resolve inside test bodies only.
 */
import { randomUUID } from 'crypto';
import { queryDB, queryDBRow } from './db-query';
import { weekSlot } from './visibility-pair';

/** Unmistakable titles — the specs select on these substrings. */
export const HIDDEN_LOCATION_TITLE = '601-E2E-Скрытая площадка';
export const VISIBLE_LOCATION_TITLE = '601-E2E-Контрольная площадка';
export const HIDDEN_SERVICE_TITLE = '601-E2E-МК-СКРЫТАЯ';
export const VISIBLE_SERVICE_TITLE = '601-E2E-МК-КОНТРОЛЬ';

/** The seeded pair as the specs consume it. */
export interface LocationVisibilityPair {
  hiddenLocationId: string;
  visibleLocationId: string;
  hiddenServiceId: string;
  visibleServiceId: string;
  hiddenActivityId: string;
  visibleActivityId: string;
  /** CalendarLine tab label that selects the seeded day. */
  tab: 'Завтра' | 'Сегодня';
  /** The seeded day (YYYY-MM-DD, UTC). */
  date: string;
}

const esc = (value: string): string => value.replace(/'/g, "''");

/** Insert the pair into the run's test DB; loud on a missing template row. */
export function seedLocationVisibilityPair(): LocationVisibilityPair {
  const template = queryDBRow(
    'SELECT master_id FROM activities WHERE is_private = 0 LIMIT 1',
  );
  if (!template) {
    throw new Error('[location-visibility-pair] no seed activity row to copy the master from — DB unseeded?');
  }
  const masterId = esc(String(template.master_id));

  const slot = weekSlot();
  const start = `${slot.date} ${slot.time}:00`;

  const pair: LocationVisibilityPair = {
    hiddenLocationId: randomUUID(),
    visibleLocationId: randomUUID(),
    hiddenServiceId: randomUUID(),
    visibleServiceId: randomUUID(),
    hiddenActivityId: randomUUID(),
    visibleActivityId: randomUUID(),
    tab: slot.tab,
    date: slot.date,
  };

  const insertLocation = (id: string, title: string, isPublic: 0 | 1): void => {
    queryDB(
      `INSERT INTO locations (id, title, address, capacity, sort_order, ` +
        `created_at, updated_at, is_active, is_public) VALUES ` +
        `('${id}', '${esc(title)}', 'E2E #601', 12, 0, datetime('now'), ` +
        `datetime('now'), 1, ${isPublic})`,
    );
  };
  insertLocation(pair.hiddenLocationId, HIDDEN_LOCATION_TITLE, 0);
  insertLocation(pair.visibleLocationId, VISIBLE_LOCATION_TITLE, 1);

  const insertService = (id: string, title: string): void => {
    queryDB(
      `INSERT INTO services (id, title, description, image_url, specialty, ` +
        `min_age, max_age, duration, record_info, is_active, created_at, updated_at) VALUES ` +
        `('${id}', '${esc(title)}', 'E2E #601', '/images/card-watercolor.jpg', 'живопись', ` +
        `6, NULL, 90, '', 1, datetime('now'), datetime('now'))`,
    );
  };
  insertService(pair.hiddenServiceId, HIDDEN_SERVICE_TITLE);
  insertService(pair.visibleServiceId, VISIBLE_SERVICE_TITLE);

  const insertActivity = (id: string, serviceId: string, locationId: string): void => {
    queryDB(
      `INSERT INTO activities (id, master_id, service_id, location_id, start, ` +
        `duration, capacity, is_private, created_at, updated_at) VALUES ` +
        `('${id}', '${masterId}', '${serviceId}', '${locationId}', '${start}', ` +
        `90, 8, 0, datetime('now'), datetime('now'))`,
    );
  };
  insertActivity(pair.hiddenActivityId, pair.hiddenServiceId, pair.hiddenLocationId);
  insertActivity(pair.visibleActivityId, pair.visibleServiceId, pair.visibleLocationId);

  return pair;
}

/** Purge the pair and anything a stray booking created for it (Full
 * Cycle cleanup): visits → records → activities → services → locations.
 * Lock-resilient and BEST-EFFORT (the callcheck cleanup policy): a
 * locked statement is skipped with a warning — a cleanup failure must
 * never mask the test's own result. */
export function cleanupLocationVisibilityPair(pair: LocationVisibilityPair): void {
  const h = esc(pair.hiddenActivityId);
  const v = esc(pair.visibleActivityId);
  const stmts: Array<[string, string]> = [
    [
      `DELETE FROM visits WHERE record_id IN ` +
        `(SELECT id FROM records WHERE activity_id IN ('${h}', '${v}'))`,
      'visits of the pair',
    ],
    [`DELETE FROM records WHERE activity_id IN ('${h}', '${v}')`, 'records of the pair'],
    [`DELETE FROM activities WHERE id IN ('${h}', '${v}')`, 'pair activities'],
    [
      `DELETE FROM services WHERE id IN ('${esc(pair.hiddenServiceId)}', '${esc(pair.visibleServiceId)}')`,
      'pair services',
    ],
    [
      `DELETE FROM locations WHERE id IN ('${esc(pair.hiddenLocationId)}', '${esc(pair.visibleLocationId)}')`,
      'pair locations',
    ],
  ];
  for (const [sql, what] of stmts) {
    try {
      queryDB(sql);
    } catch (err) {
      console.warn(`[location-visibility-pair] cleanup gave up on ${what}: ${String(err).slice(0, 120)}`);
    }
  }
}
