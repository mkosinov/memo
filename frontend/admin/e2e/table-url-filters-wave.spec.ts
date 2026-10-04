import { test, expect } from './fixtures/test';
import { createTestTag, cleanup } from './fixtures/factories';
import type { APIRequestContext } from '@playwright/test';

/**
 * #349 Task 5 — wave group 1 URL filters (positions, tags, locations), US-5
 * core: opening a link with the page's filters restores the table state in
 * EXACTLY ONE list request; a smoke per page.
 *
 * #349 Task 6 — wave group 2: /services joins WAVE_PAGES (its canonical
 * filter half) + a dedicated combined-link case below (service filters +
 * mat_-prefixed materials filters in ONE URL, spec §2).
 *
 * #349 Task 9 — wave group 4: /audit joins WAVE_PAGES (seeded per test —
 * the journal ships no seed rows) + a dedicated discrete-filters case
 * below (action+entity+user_id+period in ONE URL, spec §5 п.7).
 *
 * Parameterized skeleton (spec §5 «Тестирование волны»): one PAGE table per
 * checklist entry — the link params and the UI assertions stay declarative.
 * Counter convention follows the #231 S1/#349 clients test: count GETs to the
 * LIST endpoint pathname (`/api/v1/<entity>`; point paths like
 * `/api/v1/positions/<id>` — and /audit-logs/authors — are not list traffic).
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

interface WavePage {
  /** Route pathname, e.g. /positions. */
  route: string;
  /** List endpoint pathname watched by the request counter. */
  listPath: string;
  /**
   * A link with each page's VALID filter params (canonical API names). Only
   * params the page actually supports — positions has no sort/q/status
   * (empty sort whitelist), tags/locations add q (+status for locations).
   */
  linkWithFilters: string;
  /** Params that must reach the wire verbatim on the single mount request. */
  expectedWireParams: Record<string, string>;
  /** A link whose params are ALL invalid for the page (dirty-URL smoke). */
  dirtyLink: string;
  /** Page-size select default ('10' everywhere; /audit's factory = 20). */
  defaultPerPage?: string;
  /**
   * Optional per-test data seeding returning a cleanup (the journal has NO
   * seed rows — a tag created via API journals an admin-authored
   * create/tags row, the audit-log.spec.ts pattern).
   */
  seed?: (request: APIRequestContext) => Promise<() => Promise<void>>;
}

/** Seed one journal row: an admin-authored tag create (action=create, entity=tags). */
async function seedAuditRow(request: APIRequestContext): Promise<() => Promise<void>> {
  const tag = await createTestTag(request, { title: `audit-wave-${Date.now()}` });
  return () => cleanup(request, `/api/v1/tags/${tag.id}`);
}

const WAVE_PAGES: WavePage[] = [
  {
    route: '/positions',
    listPath: '/api/v1/positions',
    // Positions: no sortable columns (D4), no search, no status → the link
    // carries pagination only; sort_by=title is dirty for this page.
    linkWithFilters: '/positions?page=1&per_page=50',
    expectedWireParams: { page: '1', per_page: '50' },
    dirtyLink: '/positions?sort_by=title&sort_order=desc&page=0&per_page=7',
  },
  {
    route: '/tags',
    listPath: '/api/v1/tags',
    linkWithFilters: '/tags?sort_by=title&sort_order=desc&page=1&per_page=50',
    expectedWireParams: { sort_by: 'title', sort_order: 'desc', page: '1', per_page: '50' },
    dirtyLink: '/tags?sort_by=bogus&sort_order=desc&page=0&q=x',
  },
  {
    route: '/locations',
    listPath: '/api/v1/locations',
    // q=этаж matches the seed addresses («Альпика, 1 этаж» etc.) — the
    // server-side search fires (≥2 chars); status=all + capacity sort cover
    // the page's own filter surface.
    linkWithFilters:
      '/locations?q=%D1%8D%D1%82%D0%B0%D0%B6&status=all&sort_by=capacity&sort_order=desc&page=1&per_page=50',
    expectedWireParams: {
      q: 'этаж',
      status: 'all',
      sort_by: 'capacity',
      sort_order: 'desc',
      page: '1',
      per_page: '50',
    },
    dirtyLink: '/locations?sort_by=bogus&page=0&status=xyz&q=x',
  },
  {
    // #349 Task 6 — the services HALF of /services (canonical names). The
    // mat_-prefixed materials half is covered by the combined-link case
    // below (the materials table mounts on the tab switch, not on load).
    route: '/services',
    listPath: '/api/v1/services',
    // q=акв matches the seed service «Акварель» (≥2 chars → server search).
    linkWithFilters:
      '/services?q=%D0%B0%D0%BA%D0%B2&status=all&sort_by=title&sort_order=desc&page=1&per_page=50',
    expectedWireParams: {
      q: 'акв',
      status: 'all',
      sort_by: 'title',
      sort_order: 'desc',
      page: '1',
      per_page: '50',
    },
    dirtyLink: '/services?sort_by=bogus&status=xyz&page=0&per_page=7&mat_sort_by=bogus&mat_page=0',
  },
  {
    // #349 Task 8 — wave group 3: /staff (the ONE staff management page;
    // read-only /masters is untouched). q=Ольга matches the seed staff
    // «Ольга Середа» (first/last name substring, ≥2 chars).
    route: '/staff',
    listPath: '/api/v1/staff',
    linkWithFilters:
      '/staff?q=%D0%9E%D0%BB%D1%8C%D0%B3%D0%B0&status=all&sort_by=name&sort_order=desc&page=1&per_page=50',
    expectedWireParams: {
      q: 'Ольга',
      status: 'all',
      sort_by: 'name',
      sort_order: 'desc',
      page: '1',
      per_page: '50',
    },
    // sort_by=position is dirty for this page (M2M — excluded from the
    // whitelist, domain-rules/staff.md).
    dirtyLink: '/staff?sort_by=position&status=xyz&page=0&q=x',
  },
  {
    // #349 Task 8 — wave group 3: /photos. URL contract is q + tag_id
    // (repeatable) + page + per_page (spec §5 п.6). q=guest + tag7 match
    // the seed photos guest-1/guest-2.jpg (both tagged tag7).
    route: '/photos',
    listPath: '/api/v1/photos',
    linkWithFilters: '/photos?q=guest&tag_id=tag7&page=1&per_page=50',
    expectedWireParams: {
      q: 'guest',
      tag_id: 'tag7',
      page: '1',
      per_page: '50',
    },
    dirtyLink: '/photos?tag_id=%21%21bad%21%21&page=0&per_page=7&q=x',
  },
  {
    // #349 Task 9 — wave group 4: /audit (журнал). URL contract (spec §5
    // п.7): user_id/action/entity/date_from/date_to + page/per_page; the
    // period names are date_from/date_to (NOT from/to) with the «не
    // задано» default; sort is server-fixed and NEVER URL-addressable.
    // The journal ships no seed rows — the per-test seed creates a tag via
    // API, journals an admin-authored create/tags row the link matches.
    // per_page default = 20 (the AuditLogContext factory default).
    route: '/audit',
    listPath: '/api/v1/audit-logs',
    defaultPerPage: '20',
    linkWithFilters:
      '/audit?action=create&entity=tags&date_from=2020-01-01&date_to=2030-12-31&page=1&per_page=50',
    expectedWireParams: {
      action: 'create',
      entity: 'tags',
      date_from: '2020-01-01',
      date_to: '2030-12-31',
      page: '1',
      per_page: '50',
    },
    dirtyLink: '/audit?action=bogus&entity=bogus&date_from=not-a-date&date_to=31-12-2030&page=0&per_page=7',
    seed: seedAuditRow,
  },
];

/**
 * Registers a list-request counter BEFORE navigation and returns it.
 */
function listCounter(page: import('@playwright/test').Page, listPath: string): string[] {
  const listRequests: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.pathname === listPath) {
      listRequests.push(req.url());
    }
  });
  return listRequests;
}

test.describe('#349 — wave group 1 URL filters (US-5)', () => {
  for (const pageCase of WAVE_PAGES) {
    test.describe(`page ${pageCase.route}`, () => {
      // Per-test data seeding (audit only today): creates the rows the
      // page's assertions need, cleans up afterwards.
      let seedCleanup: (() => Promise<void>) | undefined;
      test.beforeEach(async ({ request }) => {
        seedCleanup = pageCase.seed ? await pageCase.seed(request) : undefined;
      });
      test.afterEach(async () => {
        await seedCleanup?.();
      });

      // ── US-5 core: link with filters → state restored, exactly one request
      test('US-5: link with filters restores state, exactly one list request', async ({
        page,
      }) => {
        const listRequests = listCounter(page, pageCase.listPath);
        await page.goto(pageCase.linkWithFilters);

        // The page-size select carries per_page from the link.
        const pageSize = page.getByTestId('page-size-select');
        await expect(pageSize).toHaveValue(
          pageCase.expectedWireParams.per_page!,
          { timeout: 20_000 },
        );
        await expect(page.locator('table tbody tr').first()).toBeVisible({
          timeout: 20_000,
        });

        // Observation window: rows visible, then a short late-stray buffer.
        await page.waitForTimeout(500);

        // US-5 DoD: the link mount fired EXACTLY ONE list request carrying
        // the link's params verbatim.
        expect(listRequests).toHaveLength(1);
        const only = new URL(listRequests[0]!);
        for (const [key, value] of Object.entries(pageCase.expectedWireParams)) {
          expect(only.searchParams.get(key), `${key} on the wire`).toBe(value);
        }
      });

      // ── Dirty link: silent defaults, URL untouched (US-3 contract on wave
      //    pages — same silent-fallback semantics as the clients precedent).
      test('dirty URL falls back to defaults silently, no rewrite', async ({ page }) => {
        await page.goto(pageCase.dirtyLink);

        // Defaults applied: page 1 (prev disabled), per_page default
        // (10 everywhere; /audit's factory default is 20).
        const prevBtn = page.getByRole('button', { name: 'Предыдущая страница' });
        await expect(prevBtn).toBeDisabled({ timeout: 20_000 });
        const pageSize = page.getByTestId('page-size-select');
        await expect(pageSize).toHaveValue(pageCase.defaultPerPage ?? '10');

        // The dirty URL is NOT rewritten: garbage params stay as-is.
        await expect(page).toHaveURL(/page=0/);
      });

      // ── Smoke: the page opens and a basic interaction works through the
      //    URL-backed state (page-size change lands in the address).
      test('smoke: open + page-size interaction writes the URL', async ({ page }) => {
        await page.goto(pageCase.route);
        await expect(page.locator('table tbody tr').first()).toBeVisible({
          timeout: 20_000,
        });
        const pageSize = page.getByTestId('page-size-select');
        await pageSize.selectOption('50');
        await expect(page).toHaveURL(/per_page=50/, { timeout: 10_000 });
      });
    });
  }

  // ── #349 Task 6 — combined link: BOTH filter sets in ONE /services URL.
  //    The materials table does NOT load on mount (view defaults to
  //    'services'; MaterialsProvider mounts only on the tab switch — code
  //    fact), so the DoD counters are: services list EXACTLY 1 on mount;
  //    materials list EXACTLY 1 after the switch, carrying the link's
  //    mat_-prefixed params translated to canonical wire names (spec §2).
  test('#349 T6: combined link restores BOTH filter sets on /services', async ({ page }) => {
    const servicesRequests = listCounter(page, '/api/v1/services');
    const materialsRequests = listCounter(page, '/api/v1/materials');
    // q=акв → «Акварель»; mat_q=мас → «Масло» (seed titles, ≥2 chars).
    await page.goto(
      '/services?q=%D0%B0%D0%BA%D0%B2&status=all&sort_by=title&sort_order=desc&page=1&per_page=50' +
        '&mat_q=%D0%BC%D0%B0%D1%81&mat_status=all&mat_sort_by=title&mat_sort_order=asc&mat_page=1&mat_per_page=20',
    );

    // Services half restored: table visible through the URL-backed state.
    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 20_000,
    });
    const pageSize = page.getByTestId('page-size-select');
    await expect(pageSize).toHaveValue('50', { timeout: 20_000 });
    await page.waitForTimeout(500);

    // Services list: EXACTLY ONE mount request, params verbatim; the
    // materials table has NOT mounted yet (no branch, no fetch).
    expect(servicesRequests).toHaveLength(1);
    const onlyServices = new URL(servicesRequests[0]!);
    for (const [key, value] of Object.entries({
      q: 'акв',
      status: 'all',
      sort_by: 'title',
      sort_order: 'desc',
      page: '1',
      per_page: '50',
    })) {
      expect(onlyServices.searchParams.get(key), `${key} on the wire`).toBe(value);
    }
    expect(materialsRequests).toHaveLength(0);

    // Switch to the «Материалы» tab — the URL state (NOT fresh defaults)
    // drives the first materials fetch: mat_* translated to canonical names.
    await page.getByRole('button', { name: 'Материалы' }).click();
    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);

    expect(materialsRequests).toHaveLength(1);
    const onlyMaterials = new URL(materialsRequests[0]!);
    for (const [key, value] of Object.entries({
      q: 'мас',
      status: 'all',
      sort_by: 'title',
      sort_order: 'asc',
      page: '1',
      per_page: '20',
    })) {
      expect(onlyMaterials.searchParams.get(key), `mat_${key} → ${key} on the wire`).toBe(value);
    }
    // The services table kept its state in the URL (hidden, not wiped).
    // [?&]-anchored: a bare /q=/ could also match the substring in mat_q=.
    await expect(page).toHaveURL(/[?&]q=%D0%B0%D0%BA%D0%B2/);
    await expect(page).toHaveURL(/mat_q=%D0%BC%D0%B0%D1%81/);
  });
});

// ─── #349 Task 7 — records: period (datePair) + table filters ─────────────
// Not in WAVE_PAGES: the seed records live in June 2026, so the BARE
// /records route (default current-week period) renders ZERO rows — the
// parameterized smoke (rows visible on the bare route) cannot apply. The
// dedicated cases below cover the wave contract page-specifically.

/** ISO monday..sunday of the CURRENT week — the records default period. */
function defaultWeekISO(): { monday: string; sunday: string } {
  const day = new Date();
  const today = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dow = (today.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { monday: iso(monday), sunday: iso(sunday) };
}

test.describe('#349 Task 7 — records: period + filters in one URL', () => {
  // Seed facts (test_memo_349.db): all records' activities are 2026-06-15..20;
  // «Анна Иванова» has two visited records at location «grand» — the combined
  // link below yields exactly those rows deterministically.
  const RECORDS_LINK =
    '/records?from=2026-06-01&to=2026-06-30&q=%D0%90%D0%BD%D0%BD%D0%B0&status=visited&location_id=grand&sort_by=client&sort_order=desc&page=1&per_page=50';

  test('US-1/US-5: link restores period in the date inputs + filters, exactly one list request', async ({
    page,
  }) => {
    // The composite view endpoint (getRecordsView → GET /api/v1/records/view).
    const listRequests = listCounter(page, '/api/v1/records/view');
    await page.goto(RECORDS_LINK);

    // Period restored in the date inputs; per_page in the page-size select.
    await expect(page.getByLabel('Фильтр по дате от')).toHaveValue('2026-06-01', {
      timeout: 20_000,
    });
    await expect(page.getByLabel('Фильтр по дате до')).toHaveValue('2026-06-30');
    await expect(page.getByTestId('page-size-select')).toHaveValue('50');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });

    // Observation window: rows visible, then a short late-stray buffer.
    await page.waitForTimeout(500);

    // DoD: the link mount fired EXACTLY ONE records list request, carrying
    // the period (from/to → date_from/date_to on the wire) + filters verbatim.
    expect(listRequests).toHaveLength(1);
    const only = new URL(listRequests[0]!);
    for (const [key, value] of Object.entries({
      date_from: '2026-06-01',
      date_to: '2026-06-30',
      q: 'Анна',
      status: 'visited',
      location_id: 'grand',
      sort_by: 'client',
      sort_order: 'desc',
      page: '1',
      per_page: '50',
    })) {
      expect(only.searchParams.get(key), `${key} on the wire`).toBe(value);
    }
  });

  test('US-2: «назад» cancels a period change (push = history step, Gate B)', async ({
    page,
  }) => {
    await page.goto('/records');
    // The default week is empty of seed rows — wait for the bar itself.
    await expect(page.getByLabel('Фильтр по дате от')).toBeVisible({ timeout: 20_000 });

    // A period change is a HISTORY STEP: editing «Дата от» pushes ?from=.
    const dateFrom = page.getByLabel('Фильтр по дате от');
    await dateFrom.fill('2026-06-01');
    await expect(page).toHaveURL(/from=2026-06-01/, { timeout: 10_000 });

    // «назад» cancels the period change: no params, default week restored.
    await page.goBack();
    await expect(page).toHaveURL(/\/records$/, { timeout: 10_000 });
    const { monday, sunday } = defaultWeekISO();
    await expect(dateFrom).toHaveValue(monday);
    await expect(page.getByLabel('Фильтр по дате до')).toHaveValue(sunday);
  });

  test('dirty period (from > to) → default week, URL never rewritten', async ({ page }) => {
    await page.goto('/records?from=2030-12-31&to=2020-01-01');

    // Both sides fall back to the default current-week monday..sunday…
    const { monday, sunday } = defaultWeekISO();
    await expect(page.getByLabel('Фильтр по дате от')).toHaveValue(monday, { timeout: 20_000 });
    await expect(page.getByLabel('Фильтр по дате до')).toHaveValue(sunday);

    // …and the dirty URL stays as-is (silent read, no rewrite).
    await expect(page).toHaveURL(/from=2030-12-31&to=2020-01-01/);
  });
});

// ─── #349 Task 8 — photos: tag_id ARRAY (repeatable param) ────────────────
// Seed facts (test_memo_349.db): tag1=«новинка», tag2=«хит»; ph5
// (/images/tag-pair.jpg) is the ONLY photo with BOTH tags; ph6
// (/images/guest-1.jpg) carries tag1+tag7 — after removing tag2 the AND
// set widens to ph5+ph6 deterministically.

test.describe('#349 Task 8 — photos: tag_id array in one URL', () => {
  test('link with tag_id=tag1&tag_id=tag2 → both chips active, one request, AND semantics', async ({
    page,
  }) => {
    const listRequests = listCounter(page, '/api/v1/photos');
    await page.goto('/photos?tag_id=tag1&tag_id=tag2');

    // Both filter chips restored from the URL (each chip's ✕ carries the
    // tag title in its aria-label).
    await expect(page.getByRole('button', { name: 'Удалить тег новинка' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Удалить тег хит' })).toBeVisible();

    // AND semantics: exactly the both-tagged seed row is visible.
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('/images/tag-pair.jpg')).toBeVisible();

    // Observation window: rows visible, then a short late-stray buffer.
    await page.waitForTimeout(500);

    // DoD: the link mount fired EXACTLY ONE list request, BOTH tag_id
    // values verbatim on the wire (repeatable param).
    expect(listRequests).toHaveLength(1);
    const only = new URL(listRequests[0]!);
    expect(only.searchParams.getAll('tag_id')).toEqual(['tag1', 'tag2']);
  });

  test('removing one tag of two → URL keeps a single tag_id, one new request', async ({ page }) => {
    const listRequests = listCounter(page, '/api/v1/photos');
    await page.goto('/photos?tag_id=tag1&tag_id=tag2');
    await expect(page.getByRole('button', { name: 'Удалить тег хит' })).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(300);
    const mountRequests = listRequests.length;
    expect(mountRequests).toBe(1);

    // Remove «хит» (tag2) via its chip ✕.
    await page.getByRole('button', { name: 'Удалить тег хит' }).click();

    // URL: exactly ONE tag_id param survives — tag1; tag2 fully gone.
    await expect(page).toHaveURL(/tag_id=tag1/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/tag_id=tag2/);
    expect((page.url().match(/tag_id=/g) ?? []).length).toBe(1);

    // Chips: «новинка» stays active, «хит» is gone.
    await expect(page.getByRole('button', { name: 'Удалить тег новинка' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Удалить тег хит' })).toHaveCount(0);

    // The filter change fired exactly ONE more list request with the
    // remaining single tag; the AND set widens to include ph6 (tag1+tag7).
    await page.waitForTimeout(500);
    expect(listRequests.length).toBe(mountRequests + 1);
    const last = new URL(listRequests[listRequests.length - 1]!);
    expect(last.searchParams.getAll('tag_id')).toEqual(['tag1']);
    await expect(page.getByText('/images/guest-1.jpg')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── #349 Task 9 — audit: discrete filters + period in one URL ─────────────
// The seed admin's user_id is a runtime UUID — resolved through the authors
// API (GET /audit-logs/authors) after seeding a row, never hardcoded. The
// combined link covers EVERY discrete filter of the journal (spec §5 п.7):
// action + entity + user_id + the datePair period, all applied on the ONE
// mount request; then ONE discrete filter change → exactly one more request
// (single push, page reset implicit).

test.describe('#349 Task 9 — audit: discrete filters in one URL', () => {
  test('combined link action+entity+user_id+period → all applied by one request; one discrete change → one push', async ({
    page,
    request,
  }) => {
    // Seed: an admin-authored create/tags journal row (unique title).
    const tag = await createTestTag(request, {
      title: `audit-t9-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });

    // Resolve the admin author id (authors API labels the phone fallback).
    const authorsResp = await request.get(`${BACKEND}/api/v1/audit-logs/authors`);
    expect(authorsResp.ok()).toBeTruthy();
    const authors = (await authorsResp.json()) as Array<{
      user_id: string;
      label?: string | null;
    }>;
    const admin = authors.find((a) => (a.label ?? '').includes('+79990000001'));
    expect(admin, 'seed admin present in the authors list').toBeDefined();

    try {
      const listRequests = listCounter(page, '/api/v1/audit-logs');
      await page.goto(
        `/audit?action=create&entity=tags&user_id=${admin!.user_id}` +
          '&date_from=2020-01-01&date_to=2030-12-31&page=1&per_page=50',
      );

      // Every discrete control restored from the URL: action/entity/user_id
      // selects + BOTH period date inputs (datePair).
      await expect(page.getByLabel('Действие')).toHaveValue('create', { timeout: 20_000 });
      await expect(page.getByLabel('Сущность')).toHaveValue('tags');
      await expect(page.getByLabel('Автор')).toHaveValue(admin!.user_id);
      const periodInputs = page.locator('input[aria-label="Период"]');
      await expect(periodInputs.nth(0)).toHaveValue('2020-01-01');
      await expect(periodInputs.nth(1)).toHaveValue('2030-12-31');

      // The seeded row survives the combined narrowing.
      await expect(
        page.locator('[data-testid^="audit-row-"]').filter({ hasText: tag.title }),
      ).toBeVisible({ timeout: 20_000 });

      // Observation window, then the ONE-request DoD with params verbatim.
      await page.waitForTimeout(500);
      expect(listRequests).toHaveLength(1);
      const only = new URL(listRequests[0]!);
      for (const [key, value] of Object.entries({
        action: 'create',
        entity: 'tags',
        user_id: admin!.user_id,
        date_from: '2020-01-01',
        date_to: '2030-12-31',
        page: '1',
        per_page: '50',
      })) {
        expect(only.searchParams.get(key), `${key} on the wire`).toBe(value);
      }

      // ONE discrete filter change (Действие → удалил): a single push —
      // URL swaps action, the OTHER link filters stay, page resets to the
      // stripped default 1, and exactly ONE more list request fires.
      const mountRequests = listRequests.length;
      await page.getByLabel('Действие').selectOption('delete');
      // [?&]-anchored patterns: a bare /page=/ would also match the
      // substring inside per_page=50 (same class as /q= vs mat_q=).
      await expect(page).toHaveURL(/[?&]action=delete/, { timeout: 10_000 });
      await expect(page).not.toHaveURL(/[?&]action=create/);
      await expect(page).toHaveURL(/[?&]entity=tags/);
      await expect(page).toHaveURL(/[?&]user_id=/);
      await expect(page).not.toHaveURL(/[?&]page=/); // page=1 default → stripped

      await page.waitForTimeout(500);
      expect(listRequests.length).toBe(mountRequests + 1);
      const last = new URL(listRequests[listRequests.length - 1]!);
      expect(last.searchParams.get('action')).toBe('delete');
      expect(last.searchParams.get('entity')).toBe('tags');
      expect(last.searchParams.get('user_id')).toBe(admin!.user_id);
      // The narrowed feed (action=delete) no longer contains OUR seeded
      // create row — сужение доказано на собственных данных. The feed may
      // hold accumulated delete-строки from earlier tests/runs (audit_logs
      // are cleaned only at RUN start, not per test) — ими не владеем,
      // не ассертим.
      await expect(
        page.locator('[data-testid^="audit-row-"]').filter({ hasText: tag.title }),
      ).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/tags/${tag.id}`);
    }
  });
});
