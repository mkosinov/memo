/**
 * seed-individual-activity.ts — #538 Task 3 seed-row fixture: the SEED
 * «Индивидуальный МК» activity (capacity=1) made reachable for booking.
 *
 * SQL surgery (queryDB/sqliteExecWithRetry — the visibility-pair write
 * pattern): the seed row is pinned to the fixed week 2026-05-18 (seed.py
 * derives all weeks from FUNC_WEEK_START — a seed run is day-independent),
 * is PRIVATE (#600: a private lesson is invisible on the public schedule
 * AND unbookable — the booking probe 404s it), and months in the past
 * (the web window is today+30). The fixture relocates the row into the
 * reachable future slot (weekSlot) and flips is_private to 0 — the
 * capacity=1 stays UNTOUCHED: the plan pins the seat count to the SEED
 * row, not a factory override.
 *
 * Target row identity (the week-1 day-0 «Индивидуальный МК» row): the
 * only capacity=1 PRIVATE activity starting 2026-05-18 14:00 (master m4,
 * location «grand», service s3 — whose DB title is «Мини-картина
 * акрилом»: «Индивидуальный МК» is the seed-alias key, activities carry
 * no title). The LIKE prefix tolerates the dialect's optional
 * microsecond suffix; a drifted seed fails LOUD (exactly one row).
 *
 * The row identity never touches the fixed visual week (2026-06-15) or
 * its records/photos — the visibility-pair no-go zone is respected.
 *
 * IMPORT-TIME RULE (seed-ids donor): never call at module scope —
 * resolve inside test bodies only.
 */
import { queryDB, queryDBRows } from './db-query';
import { weekSlot } from './visibility-pair';

/** The seed row as the specs consume it. */
export interface SeedIndividualActivity {
  id: string;
  /** Pristine `start` (verbatim DB string) for the finally-restore. */
  originalStart: string;
}

/** Week 1 Monday 14:00 — the «Индивидуальный МК» slot (seed.py WEEK_START). */
const SEED_START_PREFIX = '2026-05-18 14:%';

const esc = (value: string): string => value.replace(/'/g, "''");

/** Find the seed row; loud when the seed contract drifted. */
export function findSeedIndividualActivity(): SeedIndividualActivity {
  const rows = queryDBRows(
    'SELECT id, start FROM activities ' +
      `WHERE capacity = 1 AND is_private = 1 AND start LIKE '${SEED_START_PREFIX}'`,
  );
  if (rows.length !== 1) {
    throw new Error(
      '[seed-individual-activity] the seed selector drifted: expected exactly 1 ' +
        `capacity=1 private activity starting 2026-05-18 14:00, got ${rows.length} — ` +
        'stale or changed seed?',
    );
  }
  return { id: String(rows[0].id), originalStart: String(rows[0].start) };
}

/**
 * Relocate the seed row into the reachable future slot and make it
 * public. Returns the slot's calendar tab (the day the card lands on).
 */
export function relocateSeedActivity(
  id: string,
): { date: string; tab: 'Завтра' | 'Сегодня' } {
  const slot = weekSlot();
  queryDB(
    `UPDATE activities SET start = '${slot.date} ${slot.time}:00', is_private = 0 ` +
      `WHERE id = '${esc(id)}'`,
  );
  return { date: slot.date, tab: slot.tab };
}

/**
 * Restore the pristine row (private + original start) — the finally leg.
 * A no-op when the row is already gone (US-2's own delete).
 */
export function restoreSeedActivity(id: string, originalStart: string): void {
  queryDB(
    `UPDATE activities SET start = '${esc(originalStart)}', is_private = 1 ` +
      `WHERE id = '${esc(id)}'`,
  );
}

/**
 * Hard-delete the row — US-2's mid-form disappearance. Mirrors the admin
 * DELETE's physical end-state (usecases/activities.delete_activity
 * removes the row; a soft is_active=0 would NOT 404 — the booking probe
 * filters is_private and the location/service flags only).
 */
export function deleteActivityRow(id: string): void {
  queryDB(`DELETE FROM activities WHERE id = '${esc(id)}'`);
}

/**
 * Best-effort purge of whatever a booking left on the activity (the
 * callcheck/visibility-pair cleanup policy: a locked statement is
 * skipped with a warning — a cleanup failure must never mask the test's
 * own result).
 */
export function cleanupActivityBookings(id: string): void {
  const safe = esc(id);
  const stmts: Array<[string, string]> = [
    [
      `DELETE FROM visits WHERE record_id IN ` +
        `(SELECT id FROM records WHERE activity_id = '${safe}')`,
      'visits of the seed activity',
    ],
    [`DELETE FROM records WHERE activity_id = '${safe}'`, 'records of the seed activity'],
  ];
  for (const [sql, what] of stmts) {
    try {
      queryDB(sql);
    } catch (err) {
      console.warn(
        `[seed-individual-activity] cleanup gave up on ${what}: ${String(err).slice(0, 120)}`,
      );
    }
  }
}
