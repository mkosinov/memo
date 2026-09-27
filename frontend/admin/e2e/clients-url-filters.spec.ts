import { test, expect } from './fixtures/test';
import { clientSearchInput, expectDeepLinkChip, expectClientSearchEmpty } from './fixtures/helpers';
import { createTestClient, cleanup } from './fixtures/factories';

/**
 * #349 Task 4 — clients table URL filters (spec §2/§4, US-1/US-3/US-4).
 *
 * The canonical table params (q/status/sort_by/sort_order/page/per_page) live
 * in the address via useClientsUrlState; the deep-link ?clientId= stays a
 * separate modality param on top. Counter convention follows the #231 S1
 * test: count GETs to the LIST endpoint pathname /api/v1/clients (point
 * paths under /api/v1/clients/<id>… are not list traffic).
 */

function uid(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Registers a list-request counter BEFORE navigation and returns it. */
function listCounter(page: import('@playwright/test').Page): string[] {
  const listRequests: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.pathname === '/api/v1/clients') {
      listRequests.push(req.url());
    }
  });
  return listRequests;
}

test.describe('#349 — clients URL filters', () => {
  // ── US-1: shared link with filters restores the table in ONE request ────

  test('US-1: link with q+status+page+per_page restores state, exactly one list request', async ({
    page,
    request,
  }) => {
    const ts = uid();
    // Enough rows for a stable two-page view under per_page=10 (11 rows →
    // page 2 shows 1 row; the seed adds 5 more clients to the total).
    const created: string[] = [];
    for (let i = 0; i < 11; i++) {
      const c = await createTestClient(request, { name: `US1-${ts}-${i}` });
      created.push(c.id);
    }

    try {
      const listRequests = listCounter(page);
      await page.goto(
        `/clients?q=${encodeURIComponent(`US1-${ts}`)}&status=all&page=2&per_page=10`,
      );

      // Search box carries q; status select = «Все»; pager on page 2 of 10/стр.
      await expect(clientSearchInput(page)).toHaveValue(`US1-${ts}`, { timeout: 10_000 });
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('all');
      const pageSize = page.getByTestId('page-size-select');
      await expect(pageSize).toHaveValue('10');

      // Rows present on the requested page (page 2 = the 11th row) and the
      // pager highlights page 2.
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      const page2Btn = page.getByRole('button', { name: '2', exact: true });
      await expect(page2Btn).toHaveAttribute('aria-current', 'page');

      // Observation window: rows visible, then a short late-stray buffer.
      await page.waitForTimeout(500);

      // US-1 DoD: the link mount fired EXACTLY ONE list request, and it
      // carried the link's params verbatim.
      expect(listRequests).toHaveLength(1);
      const only = new URL(listRequests[0]!);
      expect(only.searchParams.get('q')).toBe(`US1-${ts}`);
      expect(only.searchParams.get('status')).toBe('all');
      expect(only.searchParams.get('page')).toBe('2');
      expect(only.searchParams.get('per_page')).toBe('10');
    } finally {
      for (const id of created) await cleanup(request, `/api/v1/clients/${id}`);
    }
  });

  // ── US-3: dirty link — silent defaults, valid q applied, URL untouched ──

  test('US-3: dirty URL falls back to defaults per invalid field, keeps valid q, no rewrite', async ({
    page,
    request,
  }) => {
    const ts = uid();
    const target = await createTestClient(request, { name: `US3-${ts}-ма` });
    const other = await createTestClient(request, { name: `US3-other-${ts}` });

    try {
      const dirty =
        `/clients?status=xyz&page=0&sort_order=sideways&q=${encodeURIComponent('ма')}` +
        `&u=${encodeURIComponent(target.id)}`;
      await page.goto(dirty);

      // Defaults applied silently: status back to «Активные», page 1.
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('active', { timeout: 10_000 });
      const prevBtn = page.getByRole('button', { name: 'Предыдущая страница' });
      await expect(prevBtn).toBeDisabled(); // page=0 → default 1

      // Valid q applied: the target row is found by the server-side search.
      // q=ма matches `US3-${ts}-ма` (the suffix) but not `US3-other-${ts}`
      // (no «ма» fragment) — the q stays effective.
      await expect(
        page.locator('table tbody tr').filter({ hasText: `US3-${ts}-ма` }),
      ).toBeVisible({ timeout: 10_000 });

      // The dirty URL is NOT rewritten: garbage params stay as-is.
      await expect(page).toHaveURL(/status=xyz/);
      await expect(page).toHaveURL(/page=0/);
      await expect(page).toHaveURL(/sort_order=sideways/);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      await cleanup(request, `/api/v1/clients/${other.id}`);
    }
  });

  // ── US-4: deep-link clientId × filters — one request, close keeps all ───

  test('US-4: ?clientId=X&status=all — card over the filtered list, 1 request, close keeps filters', async ({
    page,
    request,
  }) => {
    const ts = uid();
    const target = await createTestClient(request, { name: `US4-${ts}-ма` });
    const other = await createTestClient(request, { name: `US4-other-${ts}` });

    try {
      const listRequests = listCounter(page);
      await page.goto(
        `/clients?clientId=${target.id}&status=all&q=${encodeURIComponent('ма')}`,
      );

      // The card opens automatically over the narrowed+filtered list.
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(
        page.locator('table tbody tr').filter({ hasText: `US4-${ts}-ма` }),
      ).toBeVisible();
      // The chip stays up; the search box carries q (no UUID in it).
      await expectDeepLinkChip(page, 'Открыт по ссылке');
      await expect(clientSearchInput(page)).toHaveValue('ма');

      // US-4 DoD: the mount fired exactly ONE list request — narrowed id +
      // explicit status + q in a single GET.
      await page.waitForTimeout(500);
      expect(listRequests).toHaveLength(1);
      const only = new URL(listRequests[0]!);
      expect(only.searchParams.getAll('id')).toEqual([target.id]);
      expect(only.searchParams.get('status')).toBe('all');
      expect(only.searchParams.get('q')).toBe('ма');

      // Close the card by backdrop: filters, narrowing, address all stay.
      const backdrop = page.locator('[data-testid="client-card-backdrop"]');
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await expect(modal).not.toBeVisible({ timeout: 5000 });

      await expect(clientSearchInput(page)).toHaveValue('ма');
      await expectDeepLinkChip(page, 'Открыт по ссылке');
      await expect(page).toHaveURL(new RegExp(`clientId=${target.id}`));
      await expect(page).toHaveURL(/status=all/);
      await expect(page.locator('table tbody tr')).toHaveCount(1);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      await cleanup(request, `/api/v1/clients/${other.id}`);
    }
  });

  // ── Behavioral Delta: closing the deep-link chip without explicit status
  //    returns the status select to the default «Активные» (spec §3).

  test('BD: chip ✕ without explicit status — effective status returns to «Активные»', async ({
    page,
    request,
  }) => {
    const ts = uid();
    const target = await createTestClient(request, { name: `BD-${ts}` });

    try {
      await page.goto(`/clients?clientId=${target.id}`);
      // clientId present, no explicit status → effective «Все» (no URL write).
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('all', { timeout: 10_000 });
      await expect(page).not.toHaveURL(/status=/); // overlay never written

      // Close the auto-opened card, then ✕ the chip.
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="client-card-backdrop"]').click({
        position: { x: 5, y: 5 },
        force: true,
      });
      await expect(modal).not.toBeVisible({ timeout: 5000 });
      await page.getByRole('button', { name: 'Снять сужение' }).click();

      // clientId gone from the address → effective status falls back to
      // «Активные» (the rule, not a URL write).
      await expect(page).not.toHaveURL(/clientId=/, { timeout: 10_000 });
      await expect(statusSelect).toHaveValue('active', { timeout: 10_000 });
      await expect(page).not.toHaveURL(/status=/); // still no explicit write
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
    }
  });
});
