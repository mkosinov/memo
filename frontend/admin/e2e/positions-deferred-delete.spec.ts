import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { cleanup, createTestStaff } from './fixtures/factories';
import {
  clickRowDelete,
  openRowActionDropdown,
  waitForPositionsReady,
  withUndoWindow,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #324 §9.5–§9.6 — deferred POSITION delete through the dictionary.
 *
 * Same deferred pipeline as records/activities/tags (#285/#286/#318): the
 * row delete click fires a PURE dry-run preview (DELETE ?dry_run=true,
 * NO body) →
 *   · §9.5 busy position (2 holders) → 409 with the staff_positions tree →
 *     DeleteDialog «Сотрудники — потеряют должность» → checkbox confirm →
 *     optimistic removal + 5s undo ring → commit DELETE `{resolutions:
 *     {staff_positions:'cascade'}, expected:{staff_positions:[…]}}` →
 *     after the window the position row is gone and BOTH staff cards
 *     survive without the position.
 *   · §9.6 system position («мастер») → the guard fires INSIDE the dry-run
 *     (422 POSITION_IS_SYSTEM) → explanation toast, nothing enqueued, the
 *     row stays; the delete-block guard itself (api-level: dry_run AND
 *     commit both 422) is owned by backend/tests/test_api_positions.py.
 *
 * Full Cycle per test: SETUP via factories → UI action → UI asserts
 * → DB asserts (SQLite) → cleanup in finally. Holders are created via
 * createTestStaff with positions — RESET_SQL restores staff_positions
 * to seed after every test, so the wiped links leak nowhere.
 */

/** The undo toast that carries the deferred-delete message (#94 ring). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** COMMIT-DELETE listener: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none —
 *  postData() === null, so the predicate cannot match the preview. */
function commitDeleteWait(page: Page, positionId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/positions/${positionId}`) &&
      r.url().includes('dry_run') === false &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

test.describe('Deferred position delete (GH #324 §9.5–§9.6)', () => {
  // ── §9.5: busy position (2 holders) — dialog → confirm → strip links ──

  test('§9.5: position held by 2 staff — dialog «Сотрудники: 2 потеряют должность», commit strips both', async ({
    page,
    request,
  }) => {
    // 1. SETUP — a fresh position + 2 staff cards holding it (one carries
    // only it; the other keeps a seed built-in beside it — the delete must
    // strip the target link and leave the built-in intact).
    const title = `§9.5 Должность ${Date.now()}`;
    const created = await request.post(`${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/v1/positions`, {
      data: { title },
    });
    expect(created.status()).toBe(201);
    const position = (await created.json()) as { id: string; title: string };

    const holderA = await createTestStaff(request, { positions: [position.id] });
    const holderB = await createTestStaff(request, {
      positions: [position.id, 'smm'],
    });
    expect(
      queryDBRows(`SELECT * FROM staff_positions WHERE position_id='${position.id}'`),
    ).toHaveLength(2);

    try {
      await waitForPositionsReady(page);
      const row = page.locator(`[data-testid="position-row-${position.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the row delete fires the dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/positions/${position.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — the 409 tree: the staff_positions node with both
      // holders as items (id = staff_id — the id `expected` verifies).
      const deps = dryRunJson.dependencies as Array<{
        entity: string;
        count: number;
        allowed_actions: string[];
        items?: Array<{ id: string; label: string }>;
      }>;
      const holdersDep = deps.find((d) => d.entity === 'staff_positions')!;
      expect(holdersDep).toMatchObject({ count: 2, allowed_actions: ['cascade'] });
      expect(new Set(holdersDep.items!.map((i) => i.id))).toEqual(
        new Set([holderA.id, holderB.id]),
      );

      // VERIFY UI — DeleteDialog with the position-side wording
      // («потеряют должность») and both staff names as item lines.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-testid="dep-staff_positions"]')).toContainText(
        'Сотрудники — потеряют должность:',
      );
      await expect(page.locator('[data-testid="dep-staff_positions"] li')).toHaveCount(2);

      // Confirm gated on the single «Подтверждаю удаление зависимостей» checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();
      await page.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();

      // 4. ACTION — confirm; enqueue is sync → row disappears + ring toast;
      // the commit DELETE (with body) fires at the 5s window end. The
      // window runs under the paused page clock (#417): the wrapper's
      // instant rewind expires it instead of a real 5.5s sleep;
      // commitDeleteWait above was registered before the window-creating
      // click (helper contract).
      const commitWait = commitDeleteWait(page, position.id);
      await withUndoWindow(page, async () => {
        await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
        await expect(dialog).toHaveCount(0);
        // #417: the confirm chain is fully synchronous (remove → enqueue →
        // onDone), but TanStack Query v5's notifyManager flushes cache→React
        // notifications via setTimeout(0) — frozen under the paused page
        // clock, so the page-level list provider never re-renders. A 1ms
        // fast-forward releases the batch; React then renders the row's
        // optimistic removal through its (unfaked) MessageChannel.
        await page.clock.fastForward(1);
        await expect(row).not.toBeVisible();
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
      });

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // The commit body: the cascade resolution + the expected id-set from
      // the dialog tree's items (D6).
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        resolutions: { staff_positions: 'cascade' },
        expected: {
          staff_positions: expect.arrayContaining([holderA.id, holderB.id]),
        },
      });

      // 5. VERIFY DB — after the commit window (expired by the wrapper's
      // rewind; the 204 commit response above proves the server finished):
      // position gone, both join rows stripped, BOTH staff cards alive
      // (holderB keeps «smm»).
      expect(queryDBRow(`SELECT id FROM positions WHERE id='${position.id}'`)).toBeNull();
      expect(
        queryDBRows(`SELECT * FROM staff_positions WHERE position_id='${position.id}'`),
      ).toHaveLength(0);
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${holderA.id}'`)).not.toBeNull();
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${holderB.id}'`)).not.toBeNull();
      expect(
        queryDBRows(
          `SELECT * FROM staff_positions WHERE staff_id='${holderB.id}'`,
        ).map((r) => r.position_id),
      ).toEqual(['smm']);
    } finally {
      // 5. CLEANUP — staff rows are UUID test data (RESET_SQL removes them
      // next test anyway); the position delete already succeeded.
      await cleanup(request, `/api/v1/staff/${holderA.id}`);
      await cleanup(request, `/api/v1/staff/${holderB.id}`);
      await cleanup(request, `/api/v1/positions/${position.id}`);
    }
  });

  // ── §9.6: system position — dry-run 422, toast, nothing changes ────────

  test('§9.6 UI smoke: built-in «мастер» delete — 422 from the dry-run, explanation toast, row untouched', async ({
    page,
  }) => {
    await waitForPositionsReady(page);
    const row = page.locator('[data-testid="position-row-master"]');
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 1. ACTION — the row delete dry-runs; the is_system guard fires INSIDE
    // the dry-run (422 POSITION_IS_SYSTEM — nothing is ever enqueued).
    const dryRunPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/positions/master') &&
        resp.url().includes('dry_run=true') &&
        resp.status() === 422,
    );
    const dropdown = await openRowActionDropdown(row);
    await clickRowDelete(dropdown);
    const dryRun = await dryRunPromise;

    // 2. VERIFY UI — the explanation surfaces as an error toast; NO ring
    // toast, NO dialog, the row stays.
    expect((await dryRun.json()).detail.code).toBe('POSITION_IS_SYSTEM');
    await expect(page.getByTestId('toast-error')).toContainText(
      'Встроенная должность не удаляется',
    );
    await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="toast-info"]')).toHaveCount(0);
    await expect(row).toBeVisible();

    // 3. VERIFY DB — untouched: still there, still a built-in, links intact.
    expect(
      queryDBRow(`SELECT title, is_system FROM positions WHERE id='master'`),
    ).toMatchObject({ title: 'Мастер', is_system: 1 });
    expect(
      Number(
        queryDBRow(`SELECT COUNT(*) AS n FROM staff_positions WHERE position_id='master'`)!.n,
      ),
    ).toBeGreaterThan(0);
  });
});
