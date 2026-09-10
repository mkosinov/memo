/**
 * S4 — Delete Client → records nullify + visitors cascade (with visits) +
 * tags auto-cascade (#207 §12).
 *
 * Flow (§12 S4): no-body DELETE → 409 with `records` (["nullify"]),
 * `visitors` (["cascade"], cascade_preview: {visits: N}), `client_tags`
 * (["cascade"], auto). Type-confirm picks the choice actions →
 * DELETE with body `{resolutions:{records:'nullify', visitors:'cascade'}}`
 * (tags auto — omitted). 204 in ONE transaction:
 *   · records survive with client_id=NULL (payments survive with them)
 *   · visitors + their visits + tag join rows are gone
 *   · the client row is physically deleted
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
  createTestVisit,
  createTestVisitor,
} from './fixtures/factories';
import {
  clickRowDelete,
  confirmDeleteDialog,
  openRowActionDropdown,
  waitForClientsReady,
  waitForPhotosReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

test.describe('S4 — Client delete with nullify + cascade resolutions', () => {
  test('nullifies records, cascades visitors, keeps record-scoped payments', async ({ page, request }) => {
    // 1. SETUP — client + record (2 visits) + payment + client tag.
    const client = await createTestClient(request, { name: `S4 Client ${Date.now()}` });
    const activity = await createTestActivity(request);
    // Two visitor seats => the visitors cascade previews 2 visits.
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [
        { name: `S4 Vis A ${Date.now()}`, price: 2000 },
        { name: `S4 Vis B ${Date.now()}`, price: 1500 },
      ],
    });
    const payment = await createTestPayment(request, record.id, { amount: 2000 });
    const tag = await createTestClientTag(request, client.id);
    // Visitor names via DB join (the record POST creates one Visitor per seat).
    const visitorNames = queryDBRows(
      `SELECT v.name AS name FROM visits vs JOIN visitors v ON vs.visitor_id = v.id WHERE vs.record_id='${record.id}'`,
    ).map((r) => r.name as string);
    expect(visitorNames).toHaveLength(2);

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — request delete. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/clients/${client.id}`) && resp.status() === 409
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — 409 tree shape: records nullify, visitors cascade + preview.
      const deps = dryRunJson.dependencies;
      const recordsDep = deps.find((d: any) => d.entity === 'records');
      const visitorsDep = deps.find((d: any) => d.entity === 'visitors');
      const tagsDep = deps.find((d: any) => d.entity === 'client_tags');
      expect(recordsDep).toMatchObject({ count: 1, allowed_actions: ['nullify'] });
      expect(visitorsDep).toMatchObject({ count: 2, allowed_actions: ['cascade'] });
      expect(visitorsDep.cascade_preview).toEqual({ visits: 2 });
      expect(tagsDep).toMatchObject({ count: 1, allowed_actions: ['cascade'] });

      // VERIFY UI — Mode A: all three deps + the visits preview in the row.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      // Nullify marker ○ + count + nullify suffix. Count 1 renders the
      // singular "отвязан от клиента" (DeleteDialog.pluralSuffix) — assert
      // the shared stem so the form stays robust if the seed grows.
      await expect(page.locator('[data-testid="dep-records"]')).toContainText('1');
      await expect(page.locator('[data-testid="dep-records"]')).toContainText('отвязан');
      // Cascade marker → + the cascade_preview visits total
      await expect(page.locator('[data-testid="dep-visitors"]')).toContainText('2');
      await expect(page.locator('[data-testid="dep-visitors"]')).toContainText('удалены');
      await expect(page.locator('[data-testid="dep-visitors"]')).toContainText('визиты: 2');
      await expect(page.locator('[data-testid="dep-client_tags"]')).toContainText('Теги');

      // Confirm is gated on the single "Подтверждаю удаление зависимостей" checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();

      // 4. ACTION — capture the resolve call; confirm.
      const resolvePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/clients/${client.id}`) && resp.request().method() === 'DELETE'
      );
      await confirmDeleteDialog(page);
      const resolve = await resolvePromise;
      expect(resolve.status()).toBe(204);
      const postBody = () => {
        try { return JSON.parse(resolve.request().postData() ?? ''); }
        catch { return undefined; }
      };
      expect(postBody()).toEqual({
        resolutions: { records: 'nullify', visitors: 'cascade' },
      });
      await waitForToast(page, 'Клиент удалён');
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 5. VERIFY DB — the cascade semantics from §12 S4.
      // client gone
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).toBeNull();
      // records survive, anonymised
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBeNull();
      // payments still present (record-scoped, survive the nullify)
      expect(queryDBRow(`SELECT COUNT(*) AS n FROM payments WHERE record_id='${record.id}'`)!.n).toBe(1);
      // visitors + their visits gone; tag join rows gone
      for (const name of visitorNames) {
        expect(queryDBRows(
          `SELECT * FROM visitors WHERE client_id='${client.id}' AND name='${name.replace(/'/g, "''")}'`,
        )).toHaveLength(0);
      }
      expect(queryDBRows(`SELECT * FROM visitors WHERE client_id='${client.id}'`)).toHaveLength(0);
      expect(queryDBRows(
        `SELECT * FROM visits WHERE record_id='${record.id}'`,
      )).toHaveLength(0);
      expect(queryDBRows(
        `SELECT * FROM client_tags WHERE client_id='${client.id}'`,
      )).toHaveLength(0);
    } finally {
      // Nullified records survive the client delete — remove them explicitly.
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/tags/${tag.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('dry-run DELETE never mutates — nothing resolves until the confirm click', async ({ page, request }) => {
    // The §7.3 flow fires a real DELETE (no body) to fetch the 409 tree.
    // Guard: that dry-run must not touch rows; the mutation happens only
    // inside the with-body confirm call.
    const client = await createTestClient(request, { name: `S4 DryRun ${Date.now()}` });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();

      // Cancel immediately — no mutation may have happened.
      await page.locator('[data-testid="delete-dialog-cancel-btn"]').click();
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // Records intact (still linked), client intact.
      expect(queryDBRow(`SELECT id FROM clients WHERE id='${client.id}'`)).not.toBeNull();
      expect(queryDBRow(`SELECT client_id FROM records WHERE id='${record.id}'`)!.client_id).toBe(client.id);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── GH #211 extension — client-owned photos auto-nullify on delete ──────

  test('client with photos — dry-run lists photos auto-nullify; after delete the photo row shows «—»', async ({ page, request }) => {
    // SETUP: client owning one photo (4-owner model — the photo carries no
    // other owner FK). The photos dep is auto (§4 matrix) — it previews in
    // the dry-run tree but needs NO user resolution.
    const client = await createTestClient(request, { name: `S4 Photos ${Date.now()}` });
    const photo = await createTestPhoto(request, { client_id: client.id });

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // ACTION — request delete. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/clients/${client.id}`) && resp.status() === 409
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // VERIFY — the tree lists the photos dep as auto-nullify.
      const photosDep = (dryRunJson.dependencies as Array<{ entity: string; count: number; allowed_actions: string[] }>)
        .find((d) => d.entity === 'photos');
      expect(photosDep).toMatchObject({ count: 1, allowed_actions: ['nullify'] });

      // VERIFY UI — the auto dep row renders (photos are auto → no click needed).
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('Фото');
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('1');

      // ACTION — confirm (typed name unlocks it); auto deps stay OUT of the
      // resolutions body (server resolves them per §6 rule 3).
      const resolvePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/clients/${client.id}`) && resp.request().method() === 'DELETE'
      );
      await confirmDeleteDialog(page);
      const resolve = await resolvePromise;
      expect(resolve.status()).toBe(204);
      const postBody = () => {
        try { return JSON.parse(resolve.request().postData() ?? ''); }
        catch { return undefined; }
      };
      expect(postBody()).toEqual({ resolutions: {} });
      await waitForToast(page, 'Клиент удалён');

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
