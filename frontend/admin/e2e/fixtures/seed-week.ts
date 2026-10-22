/**
 * seed-week.ts — the single TS-side source of the seed's reference
 * functional week (GH #422, spec §3).
 *
 * The backend seed (backend/src/seed/seed.py) pins its functional weeks to
 * fixed dates: FUNC_WEEK_START = 2026-06-01 (Monday) is the reference week
 * (WEEK3 there); WEEK2/WEEK_START derive from it as −7/−14 days. This
 * module mirrors that reference Monday — and derives every other date from
 * it in code — so the readiness guard (globalSetup), navigation defaults
 * and factory dates can never drift apart. No second date literals in e2e:
 * SEED_WEEK_MONDAY changes together with seed.py's FUNC_WEEK_START (the
 * Python side is watched by backend/tests/test_seed.py with literal
 * expectations, canon of guards #341).
 *
 * Import-time rule: dependency-free plain TS, no side effects — safe to
 * import from globalSetup, playwright.config and spec fixtures alike.
 */

/** Monday of the seed's reference functional week (2026-06-01…07). */
export const SEED_WEEK_MONDAY = '2026-06-01';

/**
 * Day arithmetic on 'YYYY-MM-DD' strings, evaluated in UTC so the runner's
 * local timezone can never shift the result. Crosses month/year boundaries
 * correctly; never reads the real clock (accepts out-of-week offsets —
 * e.g. «neighbor day» = reference date ± 1).
 */
export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sunday of the reference week (derived: Monday + 6 days → 2026-06-07). */
export const SEED_WEEK_SUNDAY = addDaysIso(SEED_WEEK_MONDAY, 6);

/** Mon..Sun of the reference week as 'YYYY-MM-DD' strings (index 0 = Mon). */
export const SEED_WEEK_DAYS: readonly string[] = Object.freeze(
  Array.from({ length: 7 }, (_, i) => addDaysIso(SEED_WEEK_MONDAY, i)),
);
