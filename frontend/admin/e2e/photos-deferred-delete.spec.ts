import { test, expect } from './fixtures/test';
import type { Page, Request } from '@playwright/test';
import {
  cleanup,
  createTestPhoto,
  createTestTag,
  linkPhotoTag,
} from './fixtures/factories';
import {
  clickRowDelete,
  openRowActionDropdown,
  waitForPhotosReady,
  withUndoWindow,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #324 §9.1–§9.2 — deferred photo delete through the photos directory.
 *
 * The photo route rides the SAME deferred pipeline as records/activities/
 * tags (#285/#286/#318): the row delete click fires a PURE dry-run preview
 * (DELETE ?dry_run=true, NO body) →
 *   · clean photo → 204 → optimistic row removal + «Удалено. Отменить»
 *     toast with the 5s countdown ring → undo returns the row with NO
 *     delete request fired (§9.1); the un-cancelled window commits DELETE
 *     `{expected:{}}`.
 *   · tagged photo → 409 with the photo_tags tree → DeleteDialog
 *     «Теги — будут отвязаны» → checkbox confirm → optimistic removal +
 *     undo toast → commit DELETE `{resolutions:{photo_tags:'cascade'},
 *     expected:{photo_tags:[…]}}` → after the window the photo is gone
 *     from the gallery while the tags survive in the catalog (§9.2).
 *
 * Request-level rule (#285/#318): the click's dry-run has
 * postData() === null — every "was the delete committed" assertion keys
 * on the COMMIT DELETE (non-null body), never on the preview.
 *
 * Full Cycle per test: SETUP via factories/SQL → UI action → UI asserts
 * → DB asserts (SQLite) → cleanup in finally. photo_tags has no API
 * writer — links are raw SQL, same as the tags spec's record_tags.
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** The undo toast that carries the deferred-delete message (#94 ring). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** COMMIT-DELETE listener: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none —
 *  postData() === null, so the predicate cannot match the preview. */
function commitDeleteWait(page: Page, photoId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/photos/${photoId}`) &&
      r.url().includes('dry_run') === false &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

/** Tracker of COMMITTING photo deletes (DELETE with a NON-EMPTY body). The
 *  dry-run preview (postData() === null) is not counted (#285 S2 pattern). */
function trackBodyDeletes(page: Page, photoId: string) {
  const bodyDeletes: string[] = [];
  const onRequest = (req: Request) => {
    if (
      req.method() === 'DELETE' &&
      req.url().includes(`/api/v1/photos/${photoId}`) &&
      !req.url().includes('dry_run') &&
      req.postData() !== null
    ) {
      bodyDeletes.push(req.url());
    }
  };
  page.on('request', onRequest);
  return { bodyDeletes, stop: () => page.off('request', onRequest) };
}

test.describe('Deferred photo delete (GH #324 §9.1–§9.2)', () => {
  // ── §9.1: clean photo — ring 5s, undo returns the row, no delete ────────

  test('§9.1: clean photo — ring toast, «Отменить» returns the row, no delete request fired', async ({
    page,
    request,
  }) => {
    // 1. SETUP — an untagged photo (no owner, no links → dry-run is 204).
    const photo = await createTestPhoto(request);

    try {
      await waitForPhotosReady(page);
      const row = page.locator(`[data-testid="photo-row-${photo.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, photo.id);

      // 2. ACTION — the click dry-runs clean (204, no body) → NO dialog, the
      // row disappears optimistically with the undo toast. The undo window
      // runs under the paused page clock (#417): the wrapper's instant
      // rewind expires it instead of a real 5.5s sleep; the DELETE tracker
      // above was registered before the «×» click (helper contract).
      const dropdown = await openRowActionDropdown(row);
      await withUndoWindow(page, async () => {
        await clickRowDelete(dropdown);

        await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
        // The toast is plain React state (UIContext) — it renders on the
        // real macrotask loop and proves the async dry-run resolved and
        // the enqueue (optimistic remove + notifications) completed.
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        // #417: TanStack Query v5's notifyManager flushes cache→React
        // notifications via setTimeout(0) — frozen under the paused page
        // clock, so the page-level list provider never re-renders. A 1ms
        // fast-forward releases the batch; React then renders the row's
        // optimistic removal through its (unfaked) MessageChannel.
        await page.clock.fastForward(1);
        await expect(row).not.toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();

        // …undone inside the window: the toast hides (the row returns —
        // asserted after the wrapper, where the rewind has flushed the
        // restore notifications; the pilot's #291 order).
        await toast.getByRole('button', { name: 'Отменить' }).click();
        await expect(toast).toBeHidden();
      });

      // The row is back (undo restore flushed by the wrapper's rewind).
      await expect(row).toBeVisible();

      // The window expired via the wrapper's rewind and the drainMs buffer
      // already elapsed inside it — no committing DELETE was sent (the
      // dry-run preview — postData() === null — does not count; #417 step
      // 5, negative-case sync).
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // 3. VERIFY DB — the photo is still alive.
      const dbRow = queryDBRow(`SELECT id FROM photos WHERE id='${photo.id}'`);
      expect(dbRow).not.toBeNull();
      expect(dbRow!.id).toBe(photo.id);
    } finally {
      // 5. CLEANUP — idempotent: a succeeded delete dry-run-404s quietly.
      await cleanup(request, `/api/v1/photos/${photo.id}`);
    }
  });

  // ── §9.2: photo with 2 tags — dialog preview → confirm → unlink commit ──

  test('§9.2: photo with 2 tags — dialog «Теги — будут отвязаны», commit unlinks, tags survive', async ({
    page,
    request,
  }) => {
    // 1. SETUP — photo + 2 tags linked via raw SQL (photo_tags has no API
    // writer — same precedent as record_tags in the tags spec).
    const tagA = await createTestTag(request, { title: `§9.2 Тег А ${Date.now()}` });
    const tagB = await createTestTag(request, { title: `§9.2 Тег Б ${Date.now()}` });
    const photo = await createTestPhoto(request);
    linkPhotoTag(photo.id, tagA.id);
    linkPhotoTag(photo.id, tagB.id);
    expect(
      queryDBRows(`SELECT * FROM photo_tags WHERE photo_id='${photo.id}'`),
    ).toHaveLength(2);

    try {
      await waitForPhotosReady(page);
      const row = page.locator(`[data-testid="photo-row-${photo.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the row delete fires the dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/photos/${photo.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — the 409 tree: the photo_tags node with both tag items.
      const deps = dryRunJson.dependencies as Array<{
        entity: string;
        count: number;
        allowed_actions: string[];
        items?: Array<{ id: string; label: string }>;
      }>;
      const tagsDep = deps.find((d) => d.entity === 'photo_tags')!;
      expect(tagsDep).toMatchObject({ count: 2, allowed_actions: ['cascade'] });
      expect(new Set(tagsDep.items!.map((i) => i.id))).toEqual(
        new Set([tagA.id, tagB.id]),
      );

      // VERIFY UI — DeleteDialog with the photo-side wording («будут
      // отвязаны») and both tag titles as item lines.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-testid="dep-photo_tags"]')).toContainText(
        'Теги — будут отвязаны:',
      );
      await expect(page.locator('[data-testid="dep-photo_tags"]')).toContainText(tagA.title);
      await expect(page.locator('[data-testid="dep-photo_tags"]')).toContainText(tagB.title);
      await expect(page.locator('[data-testid="dep-photo_tags"] li')).toHaveCount(2);

      // Confirm gated on the single «Подтверждаю удаление зависимостей» checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();
      await page.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();

      // 4. ACTION — confirm; enqueue is sync → row disappears + ring toast;
      // the commit DELETE (with body) fires at the 5s window end. The
      // window runs under the paused page clock (#417): the wrapper's
      // instant rewind expires it instead of a real 5.5s sleep;
      // commitDeleteWait above was registered before the window-creating
      // click (helper contract).
      const commitWait = commitDeleteWait(page, photo.id);
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
        resolutions: { photo_tags: 'cascade' },
        expected: { photo_tags: expect.arrayContaining([tagA.id, tagB.id]) },
      });

      // 5. VERIFY DB — after the commit window (expired by the wrapper's
      // rewind; the 204 commit response above proves the server finished):
      // photo gone, join rows unlinked, BOTH tag rows alive (the catalog
      // keeps them).
      expect(queryDBRow(`SELECT id FROM photos WHERE id='${photo.id}'`)).toBeNull();
      expect(
        queryDBRows(`SELECT * FROM photo_tags WHERE photo_id='${photo.id}'`),
      ).toHaveLength(0);
      for (const t of [tagA, tagB]) {
        expect(queryDBRow(`SELECT id FROM tags WHERE id='${t.id}'`)).not.toBeNull();
        // …and the catalog API still serves the tag.
        const resp = await request.get(`${BACKEND}/api/v1/tags/${t.id}`);
        expect(resp.status()).toBe(200);
      }
    } finally {
      // 5. CLEANUP — photo first (cascades any leftover links), then tags.
      await cleanup(request, `/api/v1/photos/${photo.id}`);
      await cleanup(request, `/api/v1/tags/${tagA.id}`);
      await cleanup(request, `/api/v1/tags/${tagB.id}`);
    }
  });
});
