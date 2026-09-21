import { test, expect } from './fixtures/test';
import type { Page, Request } from '@playwright/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestClient,
  createTestRecord,
  createTestService,
  createTestTag,
  linkRecordTag,
} from './fixtures/factories';
import { waitForTagsReady, openRowActionDropdown, clickRowDelete } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #318 — deferred tag delete with undo (spec §4 S1–S3, S9; §6 e2e).
 *
 * The tags dictionary routes through the SAME deferred pipeline as
 * records/activities (#285/#286): the row delete click fires a PURE
 * dry-run preview (DELETE ?dry_run=true, NO body) →
 *   · clean tag → 204 → optimistic row removal + «Удалено. Отменить»
 *     toast with the 5s countdown ring → commit DELETE `{expected:{}}`;
 *   · busy tag → 409 with the 8-way join tree → DeleteDialog with
 *     per-parent one-liners («— будут сняты:») → checkbox confirm →
 *     optimistic removal + undo toast → commit DELETE
 *     `{resolutions: {…cascade}, expected: {id-sets from items}}`.
 *
 * Request-level rule (#285/#286): the click's dry-run has
 * postData() === null — every "was the delete committed" assertion keys
 * on the COMMIT DELETE (non-null body), never on the preview.
 *
 * Full Cycle per test: SETUP via factories/SQL → UI action → UI asserts
 * → DB asserts (SQLite) → cleanup in finally. Tag→record links are raw
 * SQL (record_tags has no API writer — same as backend tests).
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** The undo toast that carries the deferred-delete message (#94 ring). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** COMMIT-DELETE listener: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none —
 *  postData() === null, so the predicate cannot match the preview. */
function commitDeleteWait(page: Page, tagId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/tags/${tagId}`) &&
      r.url().includes('dry_run') === false &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

/** Tracker of COMMITTING tag deletes (DELETE with a NON-EMPTY body). The
 *  dry-run preview (postData() === null) is not counted (#285 S2 pattern). */
function trackBodyDeletes(page: Page, tagId: string) {
  const bodyDeletes: string[] = [];
  const onRequest = (req: Request) => {
    if (
      req.method() === 'DELETE' &&
      req.url().includes(`/api/v1/tags/${tagId}`) &&
      !req.url().includes('dry_run') &&
      req.postData() !== null
    ) {
      bodyDeletes.push(req.url());
    }
  };
  page.on('request', onRequest);
  return { bodyDeletes, stop: () => page.off('request', onRequest) };
}

test.describe('Deferred tag delete with undo (GH #318)', () => {
  // ── S1: busy tag — dialog with per-parent lines → confirm → commit ───────

  test('S1: busy tag (2 services + 3 records) — dialog one-liners, confirm, row gone + ring toast, DB clean after window', async ({
    page,
    request,
  }) => {
    // 1. SETUP — tag on 2 services (API tag_ids) + 3 records (raw SQL).
    const tag = await createTestTag(request, { title: `S1 Busy ${Date.now()}` });
    const serviceA = await createTestService(request, {
      title: `S1 Стрижка ${Date.now()}`,
      tag_ids: [tag.id],
    });
    const serviceB = await createTestService(request, {
      title: `S1 Маникюр ${Date.now()}`,
      tag_ids: [tag.id],
    });
    expect(
      queryDBRows(`SELECT * FROM service_tags WHERE tag_id='${tag.id}'`),
    ).toHaveLength(2);
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const records = [
      await createTestRecord(request, activity.id, client.id),
      await createTestRecord(request, activity.id, client.id),
      await createTestRecord(request, activity.id, client.id),
    ];
    for (const r of records) linkRecordTag(r.id, tag.id);
    expect(
      queryDBRows(`SELECT * FROM record_tags WHERE tag_id='${tag.id}'`),
    ).toHaveLength(3);

    try {
      await waitForTagsReady(page);
      const row = page.locator(`[data-testid="tag-row-${tag.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — row delete fires the dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/tags/${tag.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — the 409 tree: services + records with items (D6).
      const deps = dryRunJson.dependencies as Array<{
        entity: string;
        count: number;
        allowed_actions: string[];
        items?: Array<{ id: string; label: string }>;
      }>;
      const servicesDep = deps.find((d) => d.entity === 'service_tags')!;
      const recordsDep = deps.find((d) => d.entity === 'record_tags')!;
      expect(servicesDep).toMatchObject({ count: 2, allowed_actions: ['cascade'] });
      expect(recordsDep).toMatchObject({ count: 3, allowed_actions: ['cascade'] });
      expect(new Set(servicesDep.items!.map((i) => i.id))).toEqual(
        new Set([serviceA.id, serviceB.id]),
      );
      expect(recordsDep.items).toHaveLength(3);

      // VERIFY UI — DeleteDialog with per-parent one-liners, tag-side
      // wording («будут сняты»), service titles as item lines.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-testid="dep-service_tags"]')).toContainText(
        'Услуги — будут сняты:',
      );
      await expect(page.locator('[data-testid="dep-service_tags"]')).toContainText(
        serviceA.title,
      );
      await expect(page.locator('[data-testid="dep-service_tags"]')).toContainText(
        serviceB.title,
      );
      await expect(page.locator('[data-testid="dep-record_tags"]')).toContainText(
        'Записи — будут сняты:',
      );
      await expect(page.locator('[data-testid="dep-record_tags"] li')).toHaveCount(3);

      // Confirm gated on the single «Подтверждаю удаление зависимостей» checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();
      await page.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();

      // 4. ACTION — confirm; enqueue is sync → row disappears + ring toast;
      // the commit DELETE (with body) fires at the 5s window end.
      const commitWait = commitDeleteWait(page, tag.id);
      await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
      await expect(dialog).toHaveCount(0);

      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByRole('button', { name: 'Отменить' })).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // The commit body: resolutions for every collected dep + expected
      // id-sets from the dialog tree's items (D6).
      const body = JSON.parse(commit.request().postData() ?? '{}');
      expect(body.resolutions).toEqual({
        service_tags: 'cascade',
        record_tags: 'cascade',
      });
      expect(body.expected).toEqual({
        service_tags: expect.arrayContaining([serviceA.id, serviceB.id]),
        record_tags: expect.arrayContaining(records.map((r) => r.id)),
      });

      // 5. VERIFY DB — after the commit window: tag gone, join rows
      // unlinked, every parent row alive (tag unlink never destroys).
      await page.waitForTimeout(5_500);
      expect(queryDBRow(`SELECT id FROM tags WHERE id='${tag.id}'`)).toBeNull();
      expect(queryDBRows(`SELECT * FROM record_tags WHERE tag_id='${tag.id}'`)).toHaveLength(0);
      expect(queryDBRows(`SELECT * FROM service_tags WHERE tag_id='${tag.id}'`)).toHaveLength(0);
      for (const s of [serviceA, serviceB]) {
        expect(queryDBRow(`SELECT id FROM services WHERE id='${s.id}'`)).not.toBeNull();
      }
      for (const r of records) {
        expect(queryDBRow(`SELECT id FROM records WHERE id='${r.id}'`)).not.toBeNull();
      }
    } finally {
      // 5. CLEANUP — parents first, then the tag itself (idempotent: the
      // succeeded delete dry-run-404s quietly inside cleanupTag).
      for (const r of records) await cleanupRecord(request, r.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/services/${serviceA.id}`);
      await cleanup(request, `/api/v1/services/${serviceB.id}`);
      await cleanup(request, `/api/v1/tags/${tag.id}`);
    }
  });

  // ── S2: clean tag — no dialog, deferred delete committed at window end ──

  test('S2: clean tag — no dialog, row gone + ring toast, commit `{expected:{}}`, gone from DB', async ({
    page,
    request,
  }) => {
    const tag = await createTestTag(request, { title: `S2 Clean ${Date.now()}` });

    try {
      await waitForTagsReady(page);
      const row = page.locator(`[data-testid="tag-row-${tag.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Register BEFORE the click so the listener cannot miss the commit.
      const commitWait = commitDeleteWait(page, tag.id);

      // ACTION — the click dry-runs clean (204, no body) → NO dialog, the
      // row disappears optimistically with the undo toast.
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);

      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      // Window expires → commit fires with the clean-path body → 204.
      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({ expected: {} });

      // VERIFY DB — hard delete after the window (DB-poll pattern, #285).
      await page.waitForTimeout(5_500);
      expect(queryDBRow(`SELECT id FROM tags WHERE id='${tag.id}'`)).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/tags/${tag.id}`);
    }
  });

  // ── S3: cancel in the dialog — nothing changed, no commit DELETE ─────────

  test('S3: busy tag — dialog cancel keeps the tag and every link, DELETE never sent', async ({
    page,
    request,
  }) => {
    const tag = await createTestTag(request, { title: `S3 Cancel ${Date.now()}` });
    const service = await createTestService(request, {
      title: `S3 Сервис ${Date.now()}`,
      tag_ids: [tag.id],
    });
    expect(
      queryDBRows(`SELECT * FROM service_tags WHERE tag_id='${tag.id}'`),
    ).toHaveLength(1);

    try {
      await waitForTagsReady(page);
      const row = page.locator(`[data-testid="tag-row-${tag.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, tag.id);

      // ACTION — the dry-run 409 opens the dialog; «Отмена» closes it.
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="dep-service_tags"]')).toContainText(
        service.title,
      );

      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(dialog).toHaveCount(0);

      // VERIFY UI — the row stayed visible the whole time.
      await expect(row).toBeVisible();

      // Let the full window elapse: no committing DELETE was sent (the
      // dry-run preview — postData() === null — does not count).
      await page.waitForTimeout(5_500);
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // VERIFY DB — the tag and its link are untouched.
      expect(queryDBRow(`SELECT id FROM tags WHERE id='${tag.id}'`)).not.toBeNull();
      expect(
        queryDBRows(`SELECT * FROM service_tags WHERE tag_id='${tag.id}'`),
      ).toHaveLength(1);
    } finally {
      await cleanup(request, `/api/v1/services/${service.id}`);
      await cleanup(request, `/api/v1/tags/${tag.id}`);
    }
  });

  // ── S9: undo inside the window — row returns, no commit DELETE ───────────

  test('S9: clean tag delete undone — row returns, no committing DELETE, tag survives', async ({
    page,
    request,
  }) => {
    const tag = await createTestTag(request, { title: `S9 Undo ${Date.now()}` });

    try {
      await waitForTagsReady(page);
      const row = page.locator(`[data-testid="tag-row-${tag.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, tag.id);

      // ACTION — clean delete: optimistic removal + undo toast…
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      // …undone inside the window: row returns, toast hides.
      await toast.getByRole('button', { name: 'Отменить' }).click();
      await expect(row).toBeVisible();
      await expect(toast).toBeHidden();

      // Let the full window elapse: no committing DELETE was sent.
      await page.waitForTimeout(5_500);
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // VERIFY DB — the tag is still alive.
      const tagRow = queryDBRow(`SELECT id FROM tags WHERE id='${tag.id}'`);
      expect(tagRow).not.toBeNull();
      expect(tagRow!.id).toBe(tag.id);
    } finally {
      await cleanup(request, `/api/v1/tags/${tag.id}`);
    }
  });
});
