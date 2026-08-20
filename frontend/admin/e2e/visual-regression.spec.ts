import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  waitForScheduleReady,
  waitForRecordsReady,
  waitForTagsReady,
  waitForLocationsReady,
  waitForMastersReady,
  waitForServicesReady,
  waitForMaterialsReady,
  waitForPhotosReady,
  waitForClientsReady,
  openModal,
  openAddTab,
  cleanTestData,
} from './fixtures/helpers';

/**
 * Visual regression tests for Records page, Activity Modal, and other UI states.
 * Baseline screenshots are stored in the -snapshots/ directory next to this file.
 * Update baselines: npm run test:e2e:update
 *
 * NOTE: These tests require a running dev server (:3001) and backend (:8000).
 * First run creates baselines; subsequent runs compare against them.
 */

// ---------------------------------------------------------------------------
// Records Page — Visual Regression
// ---------------------------------------------------------------------------

test.describe('Records Page — Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    cleanTestData();
    // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START)
    // Combined with openModal/openAddTab DB lookup (Approach B+), this makes
    // visual regression baselines date-stable.
    // Must be called BEFORE page.goto() — clock.install injects an init script.
    await page.clock.install({ time: new Date('2026-06-15T10:00:00') });
  });

  test('records page default state', async ({ page }) => {
    await waitForRecordsReady(page);
    // Other tests in this shard may create records that appear here,
    // so use a generous pixel diff to tolerate extra table rows.
    await expect(page).toHaveScreenshot('records-default.png', {
      fullPage: true,
      maxDiffPixels: 5000,
    });
  });

  test('records page with filters applied', async ({ page }) => {
    await waitForRecordsReady(page);

    // Apply status filter via StatusFiltersPicker dropdown
    const trigger = page.locator('[data-testid="booking-filters-status-trigger"]');
    if ((await trigger.count()) > 0) {
      await trigger.click();
      const option = page.locator('[data-testid="booking-filters-status-option-waiting"]');
      if ((await option.count()) > 0) {
        // Wait for the filtered server response (mirrors records.spec.ts test 6)
        // so the table settles to waiting rows before the screenshot.
        const filterResponse = page.waitForResponse(
          (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
          { timeout: 10_000 },
        );
        await option.click();
        await filterResponse;
      }
    }

    // Other tests in this shard may create records that appear here
    await expect(page).toHaveScreenshot('records-filtered.png', {
      fullPage: true,
      maxDiffPixels: 5000,
    });
  });
});

// ---------------------------------------------------------------------------
// Activity Modal — Visual Regression
// ---------------------------------------------------------------------------

test.describe('Activity Modal — Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    cleanTestData();
    // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START)
    // Combined with openModal/openAddTab DB lookup (Approach B+), this makes
    // visual regression baselines date-stable.
    // Must be called BEFORE page.goto() — clock.install injects an init script.
    await page.clock.install({ time: new Date('2026-06-15T10:00:00') });
    await waitForScheduleReady(page);
  });

  test('activity modal — settings tab', async ({ page }) => {
    await openModal(page);

    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });

    await expect(page).toHaveScreenshot('modal-settings.png', {
      fullPage: false,
      maxDiffPixels: 2000,
    });
  });

  test('activity modal — new booking tab', async ({ page }) => {
    await openAddTab(page);

    // Hide the NowLine to avoid time-dependent screenshot differences
    await page.evaluate(() => {
      const nowLine = document.querySelector('[data-testid="now-line"]');
      if (nowLine) (nowLine as HTMLElement).style.display = 'none';
    });

    await expect(page).toHaveScreenshot('modal-new-booking.png', {
      fullPage: false,
      maxDiffPixels: 2000,
    });
  });
});

// ===========================================================================
// #139 — Pre-migration visual baselines for the 8 admin tables
// (tags, locations, masters, services, materials, clients, photos, records).
// 7 states each = 56 baselines; recorded BEFORE the generic DataTable
// migration so per-task diffs have a reference. EXPECTED to change as tasks
// T1+ land — the migration intentionally normalizes markup that currently
// differs between the 8 tables.
// ===========================================================================

/** Deterministic empty payload for `page.route` interception — paged lists. */
const EMPTY_PAGED = { items: [], total: 0, page: 1, per_page: 10 };

/** Hides toast(s) (`[role="status"]`) — failed queries raise a toast via QueryCache.onError. */
async function hideToasts(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('[role="status"]')
      .forEach((el) => (el as HTMLElement).style.display = 'none');
  });
}

function rowActionsButton(row: Locator): Locator {
  return row.getByRole('button', { name: 'Действия' });
}

/**
 * Exact-match sortable header cell. TH content is "<label> <glyph>" (glyph ∈
 * ↕/↑/↓). Regex anchors both ends so "Название" doesn't hit the separate
 * "Название для клиента" header on the services page.
 */
function thExact(page: Page, label: string): Locator {
  return page.locator('th', { hasText: new RegExp(`^\\s*${label}\\s*[↕↑↓]?\\s*$`) }).first();
}

interface PageTableConfig {
  /** scenario-name prefix — "<name>-table-<state>".png */
  name: string;
  /** page route, for direct goto (empty/error/skeleton bypass navigate helpers) */
  path: string;
  /** h1 text proving the page shell rendered (stable across data states) */
  h1Text: string;
  /** navigates to the page and waits for the table with seed data (fixtures/helpers) */
  navigate: (page: Page) => Promise<void>;
  /**
   * URL path + query fragment matched by page.route(). Must follow the URL
   * the page actually fetches on mount (see contexts/*).
   */
  apiUrl: string;
  /**
   * Locator of the sortable header to click in the sort-active scenario.
   * Headers are plain <th> with no testids (verified per table component).
   * Exact text match to avoid the "Название"/"Название для клиента" collision.
   */
  sortHeader: (page: Page) => Locator;
  /**
   * Locator for the element that proves the active sort glyph rendered.
   * `undefined` when the glyph isn't part of this table's current markup —
   * see the per-table "intentional delta" comments (clients, records).
   */
  glyphSelector?: string;
  /** first data row of the filled table (row testids exist for most tables) */
  row: (page: Page) => Locator;
}

const TABLE_CONFIGS: PageTableConfig[] = [
  {
    name: 'tags',
    path: '/tags',
    h1Text: 'Управление тегами',
    navigate: waitForTagsReady,
    apiUrl: '/api/v1/tags',
    // Only one column ("Тег") — the sole sortable header.
    sortHeader: (page) => thExact(page, 'Тег'),
    glyphSelector: 'th:has-text("Тег ↑")',
    row: (page) => page.locator('[data-testid^="tag-row-"]').first(),
  },
  {
    name: 'locations',
    path: '/locations',
    h1Text: 'Управление локациями',
    navigate: waitForLocationsReady,
    apiUrl: '/api/v1/locations',
    sortHeader: (page) => thExact(page, 'Название'),
    glyphSelector: 'th:has-text("Название ↑")',
    row: (page) => page.locator('[data-testid^="location-row-"]').first(),
  },
  {
    name: 'masters',
    path: '/masters',
    h1Text: 'Управление мастерами',
    navigate: waitForMastersReady,
    apiUrl: '/api/v1/masters',
    sortHeader: (page) => thExact(page, 'Имя'),
    glyphSelector: 'th:has-text("Имя ↑")',
    row: (page) => page.locator('[data-testid^="master-row-"]').first(),
  },
  {
    name: 'services',
    path: '/services',
    h1Text: 'Управление услугами',
    navigate: waitForServicesReady,
    apiUrl: '/api/v1/services',
    // thExact anchors both ends, so this hits the "Название" column, not the
    // separate "Название для клиента" header.
    sortHeader: (page) => thExact(page, 'Название'),
    glyphSelector: 'th:has-text("Название ↑")',
    // No row testids — rows carry a "Действия" ⋯ button (unique per table) to scope by.
    row: (page) => page.locator('tbody tr:has(button[aria-label="Действия"])').first(),
  },
  {
    name: 'materials',
    // waitForMaterialsReady navigates to /services and switches to the
    // "Материалы" tab; the materials fetch fires on tab click.
    path: '/services',
    h1Text: 'Управление материалами',
    navigate: waitForMaterialsReady,
    apiUrl: '/api/v1/materials',
    sortHeader: (page) => thExact(page, 'Название'),
    glyphSelector: 'th:has-text("Название ↑")',
    // No testids; rows carry "Действия" buttons, rows scoped under tbody.
    row: (page) => page.locator('tbody tr:has(button[aria-label="Действия"])').first(),
  },
  {
    name: 'clients',
    path: '/clients',
    h1Text: 'Клиенты',
    navigate: waitForClientsReady,
    apiUrl: '/api/v1/clients',
    // INTENTIONAL DELTA (pre-T1): Clients IS sortable, but the current markup
    // renders a sort glyph ONLY on the active column — inactive headers have
    // no ↕ marker (ClientsTable.tsx:168-170). EXPECTED to change post-migration
    // when the generic DataTable adds uniform ↕/↑/↓ markers.
    // Default sort is already `name asc`, so click an inactive column
    // (Телефон) to deterministically capture the ↑ active state.
    sortHeader: (page) => thExact(page, 'Телефон'),
    glyphSelector: 'th:has-text("Телефон"):has-text("↑")',
    // No row testids — rows carry a "Действия" ⋯ button (opacity-0 until hover).
    row: (page) => page.locator('tbody tr:has(button[aria-label="Действия"])').first(),
  },
  {
    name: 'photos',
    path: '/photos',
    h1Text: 'Управление фото',
    navigate: waitForPhotosReady,
    // Photos fetches a plain array (no pagination envelope) — see EMPTY_ARRAY.
    apiUrl: '/api/v1/photos',
    sortHeader: (page) => thExact(page, 'Превью'),
    glyphSelector: 'th:has-text("Превью ↑")',
    row: (page) => page.locator('[data-testid^="photo-row-"]').first(),
  },
  {
    name: 'records',
    path: '/records',
    h1Text: 'Управление записями',
    navigate: waitForRecordsReady,
    apiUrl: '/api/v1/records',
    // INTENTIONAL DELTA (pre-T1): Records has NO per-row ⋯/actions column at
    // all — row click opens a 360px side detail panel instead (RecordsTable.tsx:
    // 182-190, 359-372). Its `dropdown-open` scenario captures that row-click
    // panel so the diff after migration is explicit. Also uses the ⋯-less
    // generic header markup — glyph check below tolerates a header-only state.
    sortHeader: (page) => thExact(page, 'Гостей'),
    glyphSelector: 'th:has-text("Гостей"):has-text("↑")',
    // No row testids — first tbody tr (the empty-state tr renders only when 0 rows).
    row: (page) => page.locator('tbody tr').first(),
  },
];

/** Records-specific: row click opens the side detail panel (no ⋯ exists). */
async function openRecordsDetail(page: Page, row: Locator): Promise<void> {
  await row.click();
  await expect(page.locator('text=Детали записи')).toBeVisible();
}

/** Open the ⚙️ "Настроить колонки" popover (shared ColumnPicker, present on all 8). */
async function openColumnPicker(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Настроить колонки' }).click();
  // Popover has no testid — it contains one checkbox label per column.
  await expect(page.locator('label:has(input[type="checkbox"])').first()).toBeVisible();
}

/**
 * Direct navigation bypass for data-state intercept scenarios (empty/error/
 * skeleton). The fixtures/helpers `navigate` functions wait for `table`,
 * which these states render without (clients replaces the whole table with
 * empty/skeleton/ErrorState UI). Wait for the page-shell h1 instead; for
 * materials also perform the tab switch (h1 flips on switch — assert that
 * so a stale tab switch can't pass, matching waitForMaterialsReady).
 */
async function navigateDirect(page: Page, config: PageTableConfig): Promise<void> {
  await page.goto(config.path);
  if (config.name === 'materials') {
    await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Материалы' }).click();
    await page.waitForSelector('h1:has-text("Управление материалами")', { timeout: 15_000 });
    return;
  }
  await page.waitForSelector(`h1:has-text("${config.h1Text}")`, { timeout: 60_000 });
}

/**
 * Wait for the sort glyph to appear after a header click. The clicked header's
 * <th> becomes the ONLY one containing a sort glyph in these per-table markups
 * (services/materials: no ↕ on inactive; clients: glyph only on active column;
 * records: initial sort is `date` not `Гостей`). Tolerant fallback to a settle
 * for tables where even that never renders.
 */
async function expectSortGlyph(page: Page, config: PageTableConfig): Promise<void> {
  const glyph = config.glyphSelector ? page.locator(config.glyphSelector).first() : null;
  if (glyph) {
    await expect(glyph).toBeVisible().catch(() => {
      // Fall through — the screenshot below still captures the post-click state.
    });
  }
  await page.waitForTimeout(300); // settle for server-driven re-sort re-render
}

// ---------------------------------------------------------------------------
// State scenario builders (one test per table × state)
// ---------------------------------------------------------------------------

function filledTest(config: PageTableConfig) {
  test(`${config.name}-table-filled`, async ({ page }) => {
    await config.navigate(page);
    if (config.name === 'records') {
      // Guard: with the fixed clock (2026-06-15) the seed records r1..r6 must
      // render — never let this baseline silently capture the
      // "Записи не найдены" empty state.
      await expect(page.getByText('Записи не найдены')).toHaveCount(0);
    }
    await expect(page).toHaveScreenshot(`${config.name}-table-filled.png`, {
      fullPage: true,
      maxDiffPixels: 3000,
    });
  });
}

function sortActiveTest(config: PageTableConfig) {
  test(`${config.name}-table-sort-active`, async ({ page }) => {
    await config.navigate(page);
    await config.sortHeader(page).click();
    await expectSortGlyph(page, config);
    await expect(page).toHaveScreenshot(`${config.name}-table-sort-active.png`, {
      fullPage: true,
      maxDiffPixels: 5000, // server re-sort changes row order + glyph
    });
  });
}

function dropdownOpenTest(config: PageTableConfig) {
  test(`${config.name}-table-dropdown-open`, async ({ page }) => {
    await config.navigate(page);
    const row = config.row(page);
    if (config.name === 'records') {
      // INTENTIONAL DELTA: Records has no ⋯ column — capture the row-click
      // detail panel instead (expected to change post-#139 migration).
      await openRecordsDetail(page, row);
    } else {
      // Clients' ⋯ is opacity-0 until row hover — force-click handles that.
      await rowActionsButton(row).click({ force: true });
      const dropdown = page.locator('[data-testid^="dropdown-"]').first();
      if ((await dropdown.count()) > 0) {
        await expect(dropdown).toBeVisible();
      } else {
        // services/materials: no dropdown container — inline row actions appear.
        await expect(row.getByRole('button', { name: /В архив|Восстановить/ })).toBeVisible();
      }
    }
    await expect(page).toHaveScreenshot(`${config.name}-table-dropdown-open.png`, {
      fullPage: true,
      maxDiffPixels: 3000,
    });
  });
}

function pickerOpenTest(config: PageTableConfig) {
  test(`${config.name}-table-picker-open`, async ({ page }) => {
    await config.navigate(page);
    await openColumnPicker(page);
    await expect(page).toHaveScreenshot(`${config.name}-table-picker-open.png`, {
      fullPage: false, // popover is viewport-relative
      maxDiffPixels: 3000,
    });
  });
}

/**
 * Empty/error/skeleton intercepts register page.route() BEFORE goto so the
 * initial mount fetch is captured. Fulfill responses include CORS headers
 * (API served from :8000, page from the Next port). These states bypass the
 * fixtures/helpers navigate functions (they wait for `table`, which error/
 * skeleton states don't render) — see navigateDirect().
 */
function emptyTest(config: PageTableConfig) {
  test(`${config.name}-table-empty`, async ({ page }) => {
    const body = config.name === 'photos' ? [] : EMPTY_PAGED;
    await page.route(`**${config.apiUrl}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      }),
    );
    await navigateDirect(page, config);
    // Migrated tables use the shared DataTable default "Нет записей" (addendum 12
    // ruling); non-migrated tables keep their per-entity copy (verified in their
    // table components).
    const emptyText: Record<string, string> = {
      tags: 'Нет записей',
      locations: 'Нет записей',
      masters: 'Нет записей',
      services: 'Нет записей',
      materials: 'Нет записей',
      // #139 T6 + Addendum #12 — clients' pre-#139 empty copy
      // ("Нет клиентов" / "Ничего не найдено") unified to "Нет записей"
      // for ALL 8 tables per the user ruling.
      clients: 'Нет записей',
      photos: 'Фото не найдены',
      records: 'Записи не найдены',
    };
    await expect(page.getByText(emptyText[config.name]).first()).toBeVisible();
    await expect(page).toHaveScreenshot(`${config.name}-table-empty.png`, {
      fullPage: true,
      maxDiffPixels: 3000,
    });
  });
}

function errorTest(config: PageTableConfig) {
  test(`${config.name}-table-error`, async ({ page }) => {
    await page.route(`**${config.apiUrl}*`, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ detail: 'Test 500' }),
      }),
    );
    await navigateDirect(page, config);
    // QueryClient retry: 2 (~1s + ~2s backoff) — expect timeout covers it.
    await expect(page.locator('[data-testid="error-state"]')).toBeVisible({ timeout: 15_000 });
    // The failed query also raises an error toast (QueryCache.onError → showToast);
    // hide it so the baseline captures only the ErrorState (same pattern as
    // the now-line hiding in the modal scenarios above).
    await hideToasts(page);
    await expect(page).toHaveScreenshot(`${config.name}-table-error.png`, {
      fullPage: true,
      maxDiffPixels: 3000,
    });
  });
}

function skeletonTest(config: PageTableConfig) {
  test(`${config.name}-table-skeleton`, async ({ page }) => {
    // Never-resolving response keeps the page in its initial loading state.
    await page.route(`**${config.apiUrl}*`, () => new Promise<void>(() => {}));
    // Clock is already installed in beforeEach (date-stable baselines).
    await navigateDirect(page, config);
    if (config.name === 'clients' || config.name === 'tags' || config.name === 'locations' || config.name === 'masters' || config.name === 'materials' || config.name === 'services') {
      // Clients renders 10 skeleton bars (.animate-pulse) while loading;
      // Tags renders them via the shared DataTable since #139 T1 (locked
      // delta §6.8/plan: skeleton rows replace the old "Загрузка..." div);
      // Locations follows via the shared DataTable since #139 T2;
      // Masters follows via the shared DataTable since #139 T3;
      // Materials follows via the shared DataTable since #139 T4;
      // Services follows via the shared DataTable since #139 T5.
      await expect(page.locator('.animate-pulse').first()).toBeVisible();
    } else if (config.name === 'records') {
      // INTENTIONAL DELTA: RecordsTable never consumes `loading` — the initial
      // render is the empty table + "Записи не найдены" (no skeleton exists).
      // The snapshot documents that absence; the generic DataTable adds one.
      await expect(page.getByText('Записи не найдены')).toBeVisible();
    } else {
      // Dictionary tables + photos render a plain "Загрузка..." div.
      await expect(page.getByText('Загрузка...').first()).toBeVisible();
    }
    await expect(page).toHaveScreenshot(`${config.name}-table-skeleton.png`, {
      fullPage: true,
      maxDiffPixels: 3000,
    });
  });
}

// ---------------------------------------------------------------------------
// Per-table describe blocks — scenario title includes the state (list reporter)
// ---------------------------------------------------------------------------

for (const config of TABLE_CONFIGS) {
  test.describe(`${config.name} table — #139 pre-migration baselines`, () => {
    test.beforeEach(async ({ page }) => {
      // Mirrors the Records describe above: strip UUID test data so snapshots
      // always show seed rows only (tags/locations/masters/services/clients/
      // photos seed IDs are short; cleanTestData's length filters keep them).
      cleanTestData();
      // Mock browser time to the fixed reference week (matches seed WEEK_FIXED_START).
      // Date-stable baselines: the Records page filters by the *browser current
      // week* and seed records r1..r6 live in the week of 2026-06-15, so without
      // this the table renders "Записи не найдены". Also pins any relative-date
      // cells on the other tables (e.g. photos). Must be called BEFORE page.goto()
      // — clock.install injects an init script.
      await page.clock.install({ time: new Date('2026-06-15T10:00:00') });
    });
    filledTest(config);
    sortActiveTest(config);
    dropdownOpenTest(config);
    pickerOpenTest(config);
    emptyTest(config);
    errorTest(config);
    skeletonTest(config);
  });
}
