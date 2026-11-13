/**
 * master-private-visibility.spec.ts — GH #600, scenario US-4.
 *
 * US-4 — «Мастер видит свои приватные занятия в админ-сетке (ромб на
 * карточке)»: under the MASTER session (fixture master-session, seed m1 =
 * «Ольга Середа», +79990000002) a PRIVATE activity of the session master's
 * OWN renders in the schedule grid with the private diamond on its card.
 *
 * The session MUST be the master's: the guard's point is the word «свои» —
 * under an admin session every activity is visible, so the same assert
 * would pass without the own-scope contract ever being exercised
 * (master-role-schedule.spec.ts S1 pins the list scoping itself).
 *
 * Seeding (design #600 §«Web e2e»): a db-fixture INSERT via db-query —
 * NOT the API factory: the master pen has no activities:write, and the
 * row must exist exactly as stored (is_private=1) without relying on
 * admin-created state. The seed's fixed visual week is not touched in the
 * canon — the row lives only inside this test (fixtures/test.ts resets
 * the DB to seed before EVERY test, so no finally cleanup is needed;
 * raw-SQL fixture precedent: staff-delete-auto-cascade.spec.ts).
 *
 * RED note (TDD): written BEFORE the stable selector exists — the card
 * assert passes (the diamond SVG renders unattributed), the badge assert
 * fails on the missing `activity-private-badge` testid; the selector then
 * lands on the ActivityCard diamond SVG (kebab-case data-testid convention
 * of `btn-quick-add` / `compact-capacity` in the same file).
 */
import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { waitForScheduleReady } from './fixtures/helpers';
import { seedId } from './fixtures/seed-ids';
import { queryDB, queryDBRow } from './fixtures/db-query';

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import: CI's `playwright --list` collects specs before the
// shard stack seeds the DB.
test.beforeAll(() => {
  M1 = seedId('staff', 'last_name', 'Середа');
});

let M1 = '';

test.describe('GH #600 US-4 — master sees own private activity diamond', () => {
  useMasterSession();

  test('own private activity card carries the private diamond badge', async ({ page }) => {
    // SETUP — db fixture: a PRIVATE activity of the session master on the
    // seed reference week (2026-06-01..07; the week the spec opens below).
    // Storage format mirrors seeded rows byte-for-byte (`YYYY-MM-DD
    // HH:MM:SS.ffffff`) so the week-range filter treats it identically.
    const serviceId = String(
      queryDBRow(`SELECT id FROM services ORDER BY id LIMIT 1`)!.id,
    );
    const locationId = String(
      queryDBRow(`SELECT id FROM locations ORDER BY id LIMIT 1`)!.id,
    );
    const activityId = `e2e600${Date.now().toString(36)}`;
    queryDB(
      `INSERT INTO activities (id, master_id, service_id, location_id, start, duration, capacity, is_private, comment, record_info, created_at, updated_at) ` +
        `VALUES ('${activityId}', '${M1}', '${serviceId}', '${locationId}', ` +
        `'2026-06-02 12:00:00.000000', 120, 1, 1, 'US-4 #600 diamond guard', NULL, ` +
        `datetime('now'), datetime('now'))`,
    );

    // ACTION — open the seed reference week as the MASTER (own schedule).
    await waitForScheduleReady(page, SEED_WEEK_MONDAY);

    // VERIFY UI — the own private card is in the grid…
    const card = page.locator(`[data-testid="activity-${activityId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    // …and carries the private diamond (stable selector, #600 US-4).
    await expect(
      card.locator('[data-testid="activity-private-badge"]'),
    ).toBeVisible();

    // CLEANUP — none needed: fixtures/test.ts resets the DB to the seed
    // canon before every test (isolation note in the file header).
  });
});
