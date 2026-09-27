import { test, expect } from './fixtures/test';

/**
 * #349 Task 5 — wave group 1 URL filters (positions, tags, locations), US-5
 * core: opening a link with the page's filters restores the table state in
 * EXACTLY ONE list request; a smoke per page.
 *
 * Parameterized skeleton (spec §5 «Тестирование волны»): one PAGE table per
 * checklist entry — the link params and the UI assertions stay declarative.
 * Counter convention follows the #231 S1/#349 clients test: count GETs to the
 * LIST endpoint pathname (`/api/v1/<entity>`; point paths like
 * `/api/v1/positions/<id>` are not list traffic).
 */

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
];

/** Registers a list-request counter BEFORE navigation and returns it. */
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

        // Defaults applied: page 1 (prev disabled), per_page default.
        const prevBtn = page.getByRole('button', { name: 'Предыдущая страница' });
        await expect(prevBtn).toBeDisabled({ timeout: 20_000 });
        const pageSize = page.getByTestId('page-size-select');
        await expect(pageSize).toHaveValue('10');

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
});
