/**
 * S1 — Client deferred delete on the #345 conveyor (spec §6 S1):
 * records nullify + visitors cascade + client_tags auto-cascade.
 *
 * Flow: the click fires the PURE dry-run preview (DELETE ?dry_run=true,
 * no body) → 409 `has_dependencies` with the tree (records nullify +
 * visitors cascade with `cascade_preview` + per-row `items`, #345 §4.3;
 * client_tags auto) → DeleteDialog Mode A with per-row one-liners →
 * checkbox confirm → OPTIMISTIC row removal + «Удалено. Отменить» toast
 * with the 5s countdown ring → commit at window end:
 * DELETE `{resolutions: {records:'nullify', visitors:'cascade'},
 * expected: {records:[ids], visitors:[ids]}}` (auto dep omitted from
 * resolutions; expected id-sets from the FULL tree's items) → 204:
 *   · records survive with client_id=NULL (payments survive with them)
 *   · visitors + their visits + tag join rows are gone
 *   · the client row is physically deleted
 *
 * Request-level rule (#318/#285): the click's dry-run has
 * postData() === null — every "was the delete committed" assertion keys
 * on the COMMIT DELETE (non-null body), never on the preview.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestClient,
  createTestClientTag,
  createTestPayment,
  createTestPhoto,
  createTestRecord,
} from './fixtures/factories';
import {
  clickRowDelete,
  commitDeleteWait,
  confirmDeleteDialog,
  openRowActionDropdown,
  trackBodyDeletes,
  undoToast,
  waitForClientsReady,
  waitForPhotosReady,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

test.describe('S1 — Client deferred delete with nullify + cascade resolutions', () => {
  test('dialog one-liners → confirm → ring toast → commit {resolutions, expected} → 204', async ({
    page,
    request,
  }) => {
    // 1. SETUP — client + record (2 visitor seats) + payment + client tag.
    const client = await createTestClient(request, { name: `S1 Client ${Date.now()}` });
    const activity = await createTestActivity(request);
    // Two visitor seats => the visitors cascade previews 2 visits.
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [
        { name: `S1 Vis A ${Date.now()}`, price: 2000 },
        { name: `S1 Vis B ${Date.now()}`, price: 1500 },
      ],
    });
    const payment = await createTestPayment(request, record.id, { amount: 2000 });
    const tag = await createTestClientTag(request, client.id);
    // Visitor rows on the client (one per seat) — ids feed `expected`.
    const visitorRows = queryDBRows(
      `SELECT id, name FROM visitors WHERE client_id='${client.id}'`,
    ) as Array<{ id: string; name: string }>;
    expect(visitorRows).toHaveLength(2);

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the click fires the pure dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/clients/${client.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — 409 tree shape: records nullify, visitors cascade +
      //    preview, both carrying per-row items (§4.3).
      expect(dryRunJson.detail).toBe('has_dependencies');
      const deps = dryRunJson.dependencies;
      const recordsDep = deps.find((d: any) => d.entity === 'records');
      const visitorsDep = deps.find((d: any) => d.entity === 'visitors');
      const tagsDep = deps.find((d: any) => d.entity === 'client_tags');
      expect(recordsDep).toMatchObject({ count: 1, allowed_actions: ['nullify'], auto: false });
      expect(recordsDep.items).toEqual([expect.objectContaining({ id: record.id })]);
      expect(visitorsDep).toMatchObject({ count: 2, allowed_actions: ['cascade'], auto: false });
      expect(visitorsDep.cascade_preview).toEqual({ visits: 2 });
      expect(
        new Set((visitorsDep.items as Array<{ id: string }>).map((i) => i.id)),
      ).toEqual(new Set(visitorRows.map((v) => v.id)));
      expect(tagsDep).toMatchObject({ count: 1, allowed_actions: ['cascade'], auto: true });

      // VERIFY UI — Mode A: per-row one-liners for the choice deps + the
      // auto tag counter line. The record one-liner is
      // «{service}, {date}, {client name}» — assert the client name stem.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-records"]')).toContainText('Записи');
      await expect(page.locator('[data-testid="dep-records"]')).toContainText(client.name);
      await expect(page.locator('[data-testid="dep-visitors"]')).toContainText(
        'Посетители — будут удалены:',
      );
      for (const v of visitorRows) {
        await expect(page.locator('[data-testid="dep-visitors"]')).toContainText(v.name);
      }
      await expect(page.locator('[data-testid="dep-client_tags"]')).toContainText('Теги');

      // Confirm is gated on the single "Подтверждаю удаление зависимостей" checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();

      // 4. ACTION — confirm; enqueue is sync → dialog closes, row disappears
      //    optimistically + ring toast; the commit fires at the 5s window end.
      const commitWait = commitDeleteWait(page, '/api/v1/clients', client.id);
      await confirmDeleteDialog(page);
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // The commit body: choice-dep resolutions + expected id-sets from the
      // dialog tree's items (client_tags is auto → omitted from resolutions
      // and carries no items → absent from expected).
      const body = JSON.parse(commit.request().postData() ?? '{}');
      expect(body.resolutions).toEqual({ records: 'nullify', visitors: 'cascade' });
      expect(body.expected).toEqual({
        records: [record.id],
        visitors: expect.arrayContaining(visitorRows.map((v) => v.id)),
      });

      // 5. VERIFY DB — the §6 S1 cascade semantics.
      // client gone
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).toBeNull();
      // records survive, anonymised
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBeNull();
      // payments still present (record-scoped, survive the nullify)
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM payments WHERE record_id='${record.id}'`)!.n).toBe(1);
      // visitors + their visits + tag join rows gone
      expect(queryDBRows(`SELECT * FROM visitors WHERE client_id='${client.id}'`)).toHaveLength(0);
      expect(queryDBRows(`SELECT * FROM visits WHERE record_id='${record.id}'`)).toHaveLength(0);
      expect(queryDBRows(`SELECT * FROM client_tags WHERE client_id='${client.id}'`)).toHaveLength(0);
    } finally {
      // Nullified records survive the client delete — remove them explicitly.
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/tags/${tag.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('dry-run preview never mutates — dialog cancel keeps the client, DELETE never sent', async ({ page, request }) => {
    // The §4.1 preview is `?dry_run=true` (pure, never touches rows). Guard:
    // no mutation may happen and no committing DELETE (with body) may fire
    // while the dialog sits open or after «Отмена».
    const client = await createTestClient(request, { name: `S1 DryRun ${Date.now()}` });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const { bodyDeletes, stop } = trackBodyDeletes(page, '/api/v1/clients', client.id);

      // ACTION — the dry-run 409 opens the dialog; «Отмена» closes it.
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // VERIFY UI — the row stayed visible the whole time.
      await expect(row).toBeVisible();

      // Let the full 5s window elapse: no committing DELETE was sent (the
      // dry-run preview — postData() === null — does not count).
      await page.waitForTimeout(5_500);
      expect(bodyDeletes).toHaveLength(0);
      stop();

      // VERIFY DB — records intact (still linked), client intact.
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).not.toBeNull();
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBe(client.id);
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM visitors WHERE client_id='${client.id}'`)!.n).toBe(1);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── GH #211 extension — client-owned photos auto-nullify on delete ──────

  test('client with photos — dry-run lists photos auto-nullify; after the commit the photo row shows «—»', async ({ page, request }) => {
    // SETUP: client owning one photo (4-owner model — the photo carries no
    // other owner FK). The photos dep is auto (§4 matrix) — it previews in
    // the dry-run tree but needs NO user resolution.
    const client = await createTestClient(request, { name: `S1 Photos ${Date.now()}` });
    const photo = await createTestPhoto(request, { client_id: client.id });

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // ACTION — the click fires the pure dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/clients/${client.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // VERIFY — the tree lists the photos dep as auto-nullify.
      const photosDep = (dryRunJson.dependencies as Array<{ entity: string; count: number; allowed_actions: string[]; auto: boolean }>)
        .find((d) => d.entity === 'photos');
      expect(photosDep).toMatchObject({ count: 1, allowed_actions: ['nullify'], auto: true });

      // VERIFY UI — the auto dep row renders (photos are auto → no choice,
      // no checkbox: the tree is information-only).
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('Фото');
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('1');
      await expect(page.locator('[data-testid="delete-dialog-confirm-checkbox"]')).toHaveCount(0);

      // ACTION — confirm; all-auto tree → empty resolutions; auto deps stay
      // OUT of the resolutions body (server resolves them per §6 rule 3) and
      // carry no items → expected {}.
      const commitWait = commitDeleteWait(page, '/api/v1/clients', client.id);
      await confirmDeleteDialog(page);
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        resolutions: {},
        expected: {},
      });

      // VERIFY DB — photo survives the client delete with client_id NULLed.
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).toBeNull();
      expect(queryDBRow(`SELECT client_id FROM photos WHERE id='${photo.id}'`)!.client_id).toBeNull();

      // VERIFY UI — the photos table keeps the row; «Клиент» renders «—».
      await waitForPhotosReady(page);
      const photoRow = page.locator(`[data-testid="photo-row-${photo.id}"]`);
      await expect(photoRow).toBeVisible({ timeout: 10_000 });
      await expect(photoRow).toContainText('—');
      await expect(photoRow).not.toContainText(client.name);
    } finally {
      await cleanup(request, `/api/v1/photos/${photo.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
