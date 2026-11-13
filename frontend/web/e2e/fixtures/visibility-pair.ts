/**
 * visibility-pair.ts — #600 Task 6 seed fixture: the «private + regular»
 * activity pair on the CURRENT week.
 *
 * SQL seeding (queryDB/sqliteExecWithRetry — the callcheck.ts write
 * pattern): the fixed visual week 06-15 is NEVER touched (adding a row
 * there breaks the admin visual baselines), and the admin e2e DB is out
 * of scope by construction — the pair lands in whatever TEST_DB_PATH the
 * run resolves (the web-e2e DB; the US-2 RED variant points it at the
 * dev memo.db, where the same fixture works verbatim).
 *
 * Titles live on SERVICES (activities carry no title — the schedule card
 * heading is the service title, buildSchedule.ts), so the pair is TWO
 * dedicated services with unmistakable titles plus ONE activity each:
 *   «600-E2E-PUBLIC»  → is_private = 0 (must render in the grid)
 *   «600-E2E-PRIVATE» → is_private = 1 (must be invisible + unbookable)
 * FK columns (master_id/location_id) are copied from an existing activity
 * row — the admin factory's «first seed entity» discipline, minus the
 * API round-trip (the private half has no admin-API factory here).
 *
 * Slot: tomorrow 12:00 UTC when it still lies inside THIS ISO week
 * (Mon..Sun), else today 23:30 — always future-or-today and inside the
 * current week, so the default window (date_from = today, whole-day
 * bound) shows the pair. The CalendarLine tab label to reach the day
 * rides on the result («Завтра»/«Сегодня»).
 *
 * IMPORT-TIME RULE (seed-ids donor): never call at module scope —
 * resolve inside test bodies only.
 */
import { randomUUID } from 'crypto';
import { queryDB, queryDBRow } from './db-query';

/** Unmistakable service titles — the specs select on these substrings. */
export const PUBLIC_TITLE = '600-E2E-PUBLIC';
export const PRIVATE_TITLE = '600-E2E-PRIVATE';

/** The seeded pair as the specs consume it. */
export interface VisibilityPair {
  publicServiceId: string;
  privateServiceId: string;
  publicActivityId: string;
  privateActivityId: string;
  /** CalendarLine tab label that selects the seeded day. */
  tab: 'Завтра' | 'Сегодня';
  /** The seeded day (YYYY-MM-DD, UTC). */
  date: string;
}

const esc = (value: string): string => value.replace(/'/g, "''");

/**
 * The current-week future slot: tomorrow at 12:00 UTC while tomorrow is
 * still within this week, else today at 23:30 (the week's last day).
 * #601: exported for location-visibility-pair.ts (the location edition
 * of this fixture) — one slot rule, two fixtures.
 */
export function weekSlot(): { date: string; time: string; tab: 'Завтра' | 'Сегодня' } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  // ISO weekday (Mon=1..Sun=7): Sunday of THIS week = today + (7 - iso).
  const iso = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const sunday = new Date(now.getTime() + (7 - iso) * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  // ISO dates compare lexicographically — tomorrow inside the week wins.
  if (tomorrow <= sunday) return { date: tomorrow, time: '12:00', tab: 'Завтра' };
  return { date: today, time: '23:30', tab: 'Сегодня' };
}

/** Insert the pair into the run's test DB; loud on a missing template row. */
export function seedVisibilityPair(): VisibilityPair {
  const template = queryDBRow(
    'SELECT master_id, location_id FROM activities WHERE is_private = 0 LIMIT 1',
  );
  if (!template) {
    throw new Error('[visibility-pair] no seed activity row to copy FKs from — DB unseeded?');
  }
  const masterId = esc(String(template.master_id));
  const locationId = esc(String(template.location_id));

  const slot = weekSlot();
  const start = `${slot.date} ${slot.time}:00`;

  const pair: VisibilityPair = {
    publicServiceId: randomUUID(),
    privateServiceId: randomUUID(),
    publicActivityId: randomUUID(),
    privateActivityId: randomUUID(),
    tab: slot.tab,
    date: slot.date,
  };

  const insertService = (id: string, title: string): void => {
    queryDB(
      `INSERT INTO services (id, title, description, image_url, specialty, ` +
        `min_age, max_age, duration, record_info, is_active, created_at, updated_at) VALUES ` +
        `('${id}', '${title}', 'E2E #600', '/images/card-watercolor.jpg', 'живопись', ` +
        `6, NULL, 90, '', 1, datetime('now'), datetime('now'))`,
    );
  };
  insertService(pair.publicServiceId, PUBLIC_TITLE);
  insertService(pair.privateServiceId, PRIVATE_TITLE);

  const insertActivity = (id: string, serviceId: string, isPrivate: 0 | 1): void => {
    queryDB(
      `INSERT INTO activities (id, master_id, service_id, location_id, start, ` +
        `duration, capacity, is_private, created_at, updated_at) VALUES ` +
        `('${id}', '${masterId}', '${serviceId}', '${locationId}', '${start}', ` +
        `90, 8, ${isPrivate}, datetime('now'), datetime('now'))`,
    );
  };
  insertActivity(pair.publicActivityId, pair.publicServiceId, 0);
  insertActivity(pair.privateActivityId, pair.privateServiceId, 1);

  return pair;
}

/** Purge the pair and anything a stray booking created for it (Full
 * Cycle cleanup): visits → records → activities → services. Lock-resilient
 * and BEST-EFFORT (the callcheck cleanup policy): a locked statement is
 * skipped with a warning — a cleanup failure must never mask the test's
 * own result. */
export function cleanupVisibilityPair(pair: VisibilityPair): void {
  const p = esc(pair.publicActivityId);
  const v = esc(pair.privateActivityId);
  const stmts: Array<[string, string]> = [
    [
      `DELETE FROM visits WHERE record_id IN ` +
        `(SELECT id FROM records WHERE activity_id IN ('${p}', '${v}'))`,
      'visits of the pair',
    ],
    [`DELETE FROM records WHERE activity_id IN ('${p}', '${v}')`, 'records of the pair'],
    [`DELETE FROM activities WHERE id IN ('${p}', '${v}')`, 'pair activities'],
    [
      `DELETE FROM services WHERE id IN ('${esc(pair.publicServiceId)}', '${esc(pair.privateServiceId)}')`,
      'pair services',
    ],
  ];
  for (const [sql, what] of stmts) {
    try {
      queryDB(sql);
    } catch (err) {
      console.warn(`[visibility-pair] cleanup gave up on ${what}: ${String(err).slice(0, 120)}`);
    }
  }
}
