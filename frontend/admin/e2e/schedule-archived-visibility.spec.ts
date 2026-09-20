import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  cleanup,
  createTestActivity,
  createTestLocation,
  createTestMaster,
  createTestService,
} from './fixtures/factories';
import { waitForScheduleReady, gotoScheduleDay } from './fixtures/helpers';

/**
 * GH #267 — Schedule archived visibility, e2e scenarios S1–S7.
 *
 * Setup per test: create a fresh master + location + service via API, fix an
 * activity on the CURRENT week (the grid opens on the current week — factory
 * default `start` is UTC-now), archive the reference entities via their
 * archive endpoints, then assert what the schedule grid shows.
 *
 * Gate rules under test (spec D5):
 * - archived SERVICE  → card always visible (no toggle exists);
 * - archived MASTER   → card visible by default (`show_archived_masters=true`),
 *   badge + opacity-70 mute; filter bypass: archived cards survive filtering;
 * - archived LOCATION → card hidden by default, visible when
 *   `show_archived_locations` is on; DayView «по локациям» gains the
 *   archived column; persistence via user.settings across reloads.
 *
 * Toggles live in the footers of the Topbar MultiSelect dropdowns:
 * `show-archived-masters-toggle` / `show-archived-locations-toggle`.
 *
 * Per-test determinism: seed-reset wipes `user_settings` server-side (Task 11)
 * and the beforeEach init-script clears the `memo-user-settings` localStorage
 * mirror (precedent: schedule-column-visibility.spec.ts), so every test starts
 * from the defaults: masters ON, locations OFF.
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const TOPBAR = '[data-testid="center-content"]';

/**
 * Format a Date as a local-timezone ISO date (YYYY-MM-DD). Activities are
 * stored TZ-naive and rendered as local time (precedent: photos-crud.spec.ts
 * parses `activity.start` and reads local date parts), so navigation targets
 * must be derived through local getters — never `toISOString()`.
 */
function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Archive a master (staff card with a master section) via the API. */
async function archiveStaff(request: APIRequestContext, id: string): Promise<void> {
  const resp = await request.post(`${BACKEND}/api/v1/staff/${id}/archive`);
  expect(resp.ok()).toBeTruthy();
}

/** Archive a location via the API. */
async function archiveLocation(request: APIRequestContext, id: string): Promise<void> {
  const resp = await request.post(`${BACKEND}/api/v1/locations/${id}/archive`);
  expect(resp.ok()).toBeTruthy();
}

/** Archive a service via the API. */
async function archiveService(request: APIRequestContext, id: string): Promise<void> {
  const resp = await request.post(`${BACKEND}/api/v1/services/${id}/archive`);
  expect(resp.ok()).toBeTruthy();
}

/**
 * Open a Topbar filter dropdown (masters / locations) and return the page.
 * The dropdown closes only via outside click (MultiSelect has no Escape
 * handler in the schedule Topbar context — closing keeps the test isolated).
 */
async function openFilterDropdown(page: Page, label: 'Мастера' | 'Локации') {
  await page.locator(`${TOPBAR} button[aria-label="${label}"]`).click();
  await page.locator('[data-testid="multiselect-dropdown"]').waitFor({ state: 'visible', timeout: 5_000 });
}

async function closeFilterDropdown(page: Page) {
  await page.mouse.click(5, 5);
  await page.locator('[data-testid="multiselect-dropdown"]')
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {});
}

/**
 * Set an archived-visibility checkbox inside the currently-open dropdown.
 * Idempotent: skips the click (and the persist wait) when the toggle is
 * already in the target state — a no-op toggle fires no settings PATCH.
 *
 * With `waitForPersist`, also waits for the settings PATCH to reach the
 * backend (updateSettings persists fire-and-forget via a dynamic import —
 * UserSettingsContext). The response listener is registered BEFORE the
 * click: the PATCH can complete in tens of milliseconds, and a listener
 * registered afterwards would miss it entirely.
 */
async function setArchivedToggle(
  page: Page,
  testId: string,
  checked: boolean,
  opts: { waitForPersist?: boolean } = {},
): Promise<void> {
  const toggle = page.locator(`[data-testid="${testId}"]`);
  // Idempotency gate BEFORE the persist listener: a no-op toggle fires no
  // PATCH, and a discarded waitForResponse would reject (timeout) unhandled.
  if ((await toggle.isChecked()) === checked) return;
  const patchPromise = opts.waitForPersist
    ? page.waitForResponse(
        (r) => r.url().includes('/api/v1/user-settings') && r.request().method() === 'PATCH',
        { timeout: 10_000 },
      )
    : null;
  if (checked) {
    await toggle.check();
  } else {
    await toggle.uncheck();
  }
  if (patchPromise) {
    const resp = await patchPromise;
    expect(resp.ok()).toBeTruthy();
  }
  expect(await toggle.isChecked()).toBe(checked);
}

/**
 * Deep-link the schedule into DayView on the given ISO date (YYYY-MM-DD).
 * `col` pins the column mode explicitly — a full page load resets the URL
 * to exactly the given params (#138), so locations-mode tests must pass
 * `col: 'locations'` or the reload lands back on masters.
 */
async function switchToDay(page: Page, date: string, col?: 'masters' | 'locations') {
  await gotoScheduleDay(page, date, { col });
  await page.waitForSelector('[data-testid^="column-header-"]', { timeout: 10_000 });
}

/**
 * Deselect every option in the currently-open dropdown EXCEPT the one with
 * the given id — empty filter = show all, so one option must stay checked.
 * Mirrors the `keepOnlyOption` pattern from schedule-column-visibility.spec.ts.
 */
async function keepOnlyOption(page: Page, keepId: string): Promise<void> {
  const options = page.locator('[data-testid^="multiselect-option-"]');
  const optionCount = await options.count();
  for (let i = 0; i < optionCount; i++) {
    const option = options.nth(i);
    const testId = await option.getAttribute('data-testid');
    const optionId = testId?.replace('multiselect-option-', '');
    if (optionId === keepId) continue;
    const checkboxDiv = option.locator('div').first();
    const classes = await checkboxDiv.getAttribute('class');
    if (classes && classes.includes('bg-[var(--brand)]')) {
      await option.click();
      await page.waitForTimeout(100);
    }
  }
}

/**
 * Clean localStorage mirror before each page load so the settings load always
 * starts from the freshly-reset server state (defaults) — the seed-reset
 * already wiped `user_settings` server-side.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.removeItem('memo-user-settings');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S1. Archived master → card visible by default (badge + mute)
// ────────────────────────────────────────────────────────────────────────────
test('S1: archived master — card visible with badge and muted on current week', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const activity = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
  });
  try {
    await archiveStaff(request, master.id);

    // Grid opens on the current week — the activity start (factory default,
    // fixed inside this week by the factory contract) must be there.
    await waitForScheduleReady(page);

    const card = page.locator(`[data-testid="activity-${activity.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    // Badge pill on the card...
    await expect(card.locator('[data-testid="archived-badge"]')).toBeVisible();
    await expect(card.locator('[data-testid="archived-badge"]')).toHaveAttribute(
      'aria-label',
      'Архив: мастер',
    );
    // ...and the mute (opacity-70, spec D7).
    await expect(card).toHaveClass(/opacity-70/);
  } finally {
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S2. Archived location → hidden by default; toggle reveals cards + DayView column
// ────────────────────────────────────────────────────────────────────────────
test('S2: archived location — hidden by default, toggle reveals card and day-view column', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const activity = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
  });
  try {
    await archiveLocation(request, location.id);
    await waitForScheduleReady(page);

    // Default `show_archived_locations=false` → the card is hidden...
    await expect(page.locator(`[data-testid="activity-${activity.id}"]`)).toHaveCount(0, { timeout: 10_000 });

    // ...open the locations dropdown and enable the archived-locations toggle.
    await openFilterDropdown(page, 'Локации');
    await setArchivedToggle(page, 'show-archived-locations-toggle', true);
    await closeFilterDropdown(page);

    // Card appears immediately (gate re-evaluates synchronously).
    const card = page.locator(`[data-testid="activity-${activity.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('[data-testid="archived-badge"]')).toBeVisible();
    await expect(card.locator('[data-testid="archived-badge"]')).toHaveAttribute(
      'aria-label',
      'Архив: локация',
    );

    // DayView «по локациям»: the archived location gains its column.
    await page.locator('[data-testid="day-button"]').click();
    await expect(page.locator('[data-testid="column-mode-menu"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
    // DayView shows the selected day — navigate explicitly to the activity's
    // own day. The factory `start` is UTC; convert to the LOCAL date first
    // (same as S6), so the opened week always contains the card's grid day.
    await switchToDay(page, localIsoDate(new Date(activity.start)), 'locations');
    await expect(
      page.locator(`[data-testid="archived-column-header-${location.id}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(`[data-testid="archived-day-column-${location.id}"]`),
    ).toBeVisible();
  } finally {
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S3. Archived service → always visible; both toggles have no effect
// ────────────────────────────────────────────────────────────────────────────
test('S3: archived service — card always visible, toggles do not affect it', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const activity = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
  });
  try {
    await archiveService(request, service.id);
    await waitForScheduleReady(page);

    const card = page.locator(`[data-testid="activity-${activity.id}"]`);
    // Visible right away — no toggle needed.
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('[data-testid="archived-badge"]')).toBeVisible();
    await expect(card.locator('[data-testid="archived-badge"]')).toHaveAttribute(
      'aria-label',
      'Архив: услуга',
    );

    // Turn BOTH toggles OFF — the archived-service card must stay visible.
    await openFilterDropdown(page, 'Мастера');
    await setArchivedToggle(page, 'show-archived-masters-toggle', false);
    await closeFilterDropdown(page);
    await openFilterDropdown(page, 'Локации');
    await setArchivedToggle(page, 'show-archived-locations-toggle', false);
    await closeFilterDropdown(page);

    await expect(card).toBeVisible({ timeout: 10_000 });
  } finally {
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S4. Master filter is active + archived master gate ON → archived cards survive
// ────────────────────────────────────────────────────────────────────────────
test('S4: filtering by one active master keeps archived cards visible', async ({ page, request }) => {
  const archivedMaster = await createTestMaster(request);
  const activeMaster = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const archivedActivity = await createTestActivity(request, {
    master_id: archivedMaster.id,
    service_id: service.id,
    location_id: location.id,
  });
  try {
    await archiveStaff(request, archivedMaster.id);
    await waitForScheduleReady(page);

    // Card visible before filtering (default masters gate is ON).
    const card = page.locator(`[data-testid="activity-${archivedActivity.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Filter down to ONLY the active master through the masters dropdown
    // (archived entities are not part of the filter choice — spec D5).
    await openFilterDropdown(page, 'Мастера');
    await keepOnlyOption(page, activeMaster.id);
    await closeFilterDropdown(page);

    // The archived card SURVIVES the filter — archived cards bypass the id
    // filter (spec D5: «Фильтр по id применяется только к занятиям активных
    // сущностей»).
    await expect(card).toBeVisible({ timeout: 10_000 });
  } finally {
    await cleanup(request, `/api/v1/activities/${archivedActivity.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${archivedMaster.id}`);
    await cleanup(request, `/api/v1/staff/${activeMaster.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S5. Toggles persist in user.settings across a page reload
// ────────────────────────────────────────────────────────────────────────────
test('S5: toggle states persist across page reload (user.settings)', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const locationActivity = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
  });
  // Declared outside `try` so the finally-cleanup can always reach it.
  let masterActivity: { id: string } | null = null;
  try {
    await archiveLocation(request, location.id);

    // 1. Enable the locations checkbox, then reload.
    await waitForScheduleReady(page);
    await openFilterDropdown(page, 'Локации');
    await setArchivedToggle(page, 'show-archived-locations-toggle', true, { waitForPersist: true });
    await closeFilterDropdown(page);

    await page.reload();
    await waitForScheduleReady(page);

    // Checkbox state restored from user.settings...
    await openFilterDropdown(page, 'Локации');
    await expect(page.locator('[data-testid="show-archived-locations-toggle"]')).toBeChecked({ timeout: 10_000 });
    await closeFilterDropdown(page);
    // ...and the archived-location card is visible again.
    await expect(page.locator(`[data-testid="activity-${locationActivity.id}"]`)).toBeVisible({ timeout: 10_000 });

    // 2. Turn the MASTERS checkbox off, reload — masters stay hidden.
    masterActivity = await createTestActivity(request, {
      master_id: master.id, // re-use the already-archived master
      service_id: service.id,
      location_id: location.id,
    });
    await archiveStaff(request, master.id);
    await waitForScheduleReady(page);
    await openFilterDropdown(page, 'Мастера');
    await setArchivedToggle(page, 'show-archived-masters-toggle', false, { waitForPersist: true });
    await closeFilterDropdown(page);

    await page.reload();
    await waitForScheduleReady(page);

    await openFilterDropdown(page, 'Мастера');
    await expect(page.locator('[data-testid="show-archived-masters-toggle"]')).not.toBeChecked({ timeout: 10_000 });
    await closeFilterDropdown(page);
    const hiddenActivityId = masterActivity!.id;
    await expect(page.locator(`[data-testid="activity-${hiddenActivityId}"]`)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await cleanup(request, `/api/v1/activities/${locationActivity.id}`);
    if (masterActivity) {
      await cleanup(request, `/api/v1/activities/${masterActivity.id}`);
    }
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S6. DayView «по мастерам»: archived column only on days with its activities
// ────────────────────────────────────────────────────────────────────────────
test('S6: day view by masters — archived column on the day with activities only', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);

  // Anchor activity: now (current week). A day later — the neighbouring day
  // must NOT gain the column (spec D8: only days with ≥1 gated activity).
  const now = new Date();
  const dayD = localIsoDate(now);
  const nextDay = localIsoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const activityD = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
    start: `${dayD}T10:00:00`,
  });
  try {
    await archiveStaff(request, master.id);
    await waitForScheduleReady(page);

    // Switch to DayView «по мастерам» on day D.
    await switchToDay(page, dayD);

    // Column present on D (and the activity card is inside it).
    await expect(page.locator(`[data-testid="archived-column-header-${master.id}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="archived-day-column-${master.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="activity-${activityD.id}"]`)).toBeVisible();

    // Neighbouring day (no activities of the archived master) — no column.
    await switchToDay(page, nextDay);
    await expect(page.locator(`[data-testid="archived-column-header-${master.id}"]`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(`[data-testid="archived-day-column-${master.id}"]`)).toHaveCount(0);
  } finally {
    await cleanup(request, `/api/v1/activities/${activityD.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// S7. Master AND location archived → full three-state toggle progression:
//     both off → hidden; masters on only → hidden; both on → visible
// ────────────────────────────────────────────────────────────────────────────
test('S7: archived master and location — card visible only with both toggles on', async ({ page, request }) => {
  const master = await createTestMaster(request);
  const service = await createTestService(request);
  const location = await createTestLocation(request);
  const activity = await createTestActivity(request, {
    master_id: master.id,
    service_id: service.id,
    location_id: location.id,
  });
  try {
    await archiveStaff(request, master.id);
    await archiveLocation(request, location.id);
    await waitForScheduleReady(page);

    const card = page.locator(`[data-testid="activity-${activity.id}"]`);

    // 1. Both OFF → hidden (masters defaults ON, so turn it off first).
    await openFilterDropdown(page, 'Мастера');
    await setArchivedToggle(page, 'show-archived-masters-toggle', false, { waitForPersist: true });
    await closeFilterDropdown(page);
    await expect(card).toHaveCount(0, { timeout: 10_000 });

    // 2. Only masters ON → still hidden (location gate).
    await openFilterDropdown(page, 'Мастера');
    await setArchivedToggle(page, 'show-archived-masters-toggle', true, { waitForPersist: true });
    await closeFilterDropdown(page);
    await expect(card).toHaveCount(0, { timeout: 10_000 });

    // 3. Both ON → visible.
    await openFilterDropdown(page, 'Локации');
    await setArchivedToggle(page, 'show-archived-locations-toggle', true, { waitForPersist: true });
    await closeFilterDropdown(page);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('[data-testid="archived-badge"]')).toBeVisible();
    await expect(card.locator('[data-testid="archived-badge"]')).toHaveAttribute(
      'aria-label',
      'Архив: мастер, локация',
    );
  } finally {
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/services/${service.id}`);
    await cleanup(request, `/api/v1/locations/${location.id}`);
    await cleanup(request, `/api/v1/staff/${master.id}`);
  }
});
