import { test, expect } from './fixtures/test';
import type { Page, Request } from '@playwright/test';
import {
  cleanup,
  cleanupRecord,
  createTestActivity,
  createTestClient,
  createTestRecord,
  createTestVisit,
  createTestVisitor,
} from './fixtures/factories';
import { waitForClientsReady, withUndoWindow } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #324 §9.3–§9.4 — deferred VISITOR delete from the client card (the
 * one production surface: ClientInfoTab's × per visitor row).
 *
 * Same deferred pipeline as records/activities/tags (#285/#286/#318): the
 * × click fires a PURE dry-run preview (DELETE ?dry_run=true, NO body) →
 *   · §9.3 visitor with 3 visits → 409 with the visits tree → DeleteDialog
 *     «Посещения — будут удалены» → checkbox confirm → optimistic row
 *     removal + 5s undo ring → commit DELETE `{resolutions:
 *     {visits:'cascade'}, expected:{visits:[…]}}` → after the window the
 *     visitor AND its visits are gone and the record's status/seats are
 *     recomputed honestly (visited,3 → waiting,0).
 *   · §9.4 clean visitor → 204 → ring `{expected:{}}`; a second user adds
 *     a visit to the visitor mid-window (direct API insert — the same race
 *     simulation as the records S6 / tags #318 stale scenarios) → commit
 *     409 `stale_dependencies` → staleAwareOnError: row returned + honest
 *     red toast «Не удалось удалить: данные изменились» with «Обновить».
 *
 * Request-level rule (#285/#318): the click's dry-run has
 * postData() === null — every "was the delete committed" assertion keys
 * on the COMMIT DELETE (non-null body), never on the preview.
 *
 * Full Cycle per test: SETUP via factories → UI action → UI asserts
 * → DB asserts (SQLite) → cleanup in finally.
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** The client-card modal (click a clients-table row to open). */
function clientCard(page: Page) {
  return page.locator('[data-testid="client-card-modal"]');
}

/** One visitor row inside the card's «Клиент» tab, matched by name. */
function visitorRow(page: Page, name: string) {
  return page
    .locator('[data-testid="visitor-row"]')
    .filter({ hasText: name });
}

/** The undo toast that carries the deferred-delete message (#94 ring). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** COMMIT-DELETE listener: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none —
 *  postData() === null, so the predicate cannot match the preview. */
function commitDeleteWait(page: Page, visitorId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/visitors/${visitorId}`) &&
      r.url().includes('dry_run') === false &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

/** Tracker of COMMITTING visitor deletes (DELETE with a NON-EMPTY body). */
function trackBodyDeletes(page: Page, visitorId: string) {
  const bodyDeletes: string[] = [];
  const onRequest = (req: Request) => {
    if (
      req.method() === 'DELETE' &&
      req.url().includes(`/api/v1/visitors/${visitorId}`) &&
      !req.url().includes('dry_run') &&
      req.postData() !== null
    ) {
      bodyDeletes.push(req.url());
    }
  };
  page.on('request', onRequest);
  return { bodyDeletes, stop: () => page.off('request', onRequest) };
}

test.describe('Deferred visitor delete from the client card (GH #324 §9.3–§9.4)', () => {
  // The client-card flow is heavier than a directory row: waitForClientsReady
  // loads /clients twice (initial + stale-cache reload), the card modal
  // mounts the whole client tab, and each test waits out the 5s commit
  // window plus a 5.5s DB-settle. First-visit dev compilation of /clients
  // alone can take 20s+ — double the default headroom.
  test.setTimeout(120_000);

  // ── §9.3: visitor with 3 visits — dialog → confirm → visits cascade +
  //        honest record recompute ─────────────────────────────────────────

  test('§9.3: visitor with 3 visits — dialog «Посещения: 3 будут удалены», commit cascades, record recomputed', async ({
    page,
    request,
  }) => {
    // 1. SETUP — client (card owner) + a record whose ONLY visitor is the
    // delete target: 3 visits (2 waiting + 1 visited → record.status
    // 'visited', seats 3 — the honest recompute lands at waiting/0).
    const client = await createTestClient(request, {
      name: `§9.3 Клиент ${Date.now()}`,
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });
    const visitorName = `§9.3 Посетитель ${Date.now()}`;
    const visitor = await createTestVisitor(request, client.id, {
      name: visitorName,
    });
    await createTestVisit(request, record.id, visitor.id, { price: 3000 });
    await createTestVisit(request, record.id, visitor.id, { price: 3000 });
    await createTestVisit(request, record.id, visitor.id, {
      price: 3500,
      status: 'visited',
    });
    expect(
      queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
    ).toHaveLength(3);
    expect(
      queryDBRow(`SELECT seats, status FROM records WHERE id='${record.id}'`),
    ).toMatchObject({ seats: 3, status: 'visited' });

    try {
      // Open the client card — the «Клиент» tab (default) lists visitors.
      await waitForClientsReady(page, { waitForName: client.name });
      const clientsRow = page
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await clientsRow.click();
      await expect(clientCard(page)).toBeVisible({ timeout: 10_000 });

      const row = visitorRow(page, visitorName);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the × fires the dry-run preview (no body) → 409 with
      // the visits tree.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/visitors/${visitor.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      await row.getByRole('button', { name: 'Удалить посетителя' }).click();
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — the 409 tree: the visits node (cascade, 3 items).
      const deps = dryRunJson.dependencies as Array<{
        entity: string;
        count: number;
        allowed_actions: string[];
        items?: Array<{ id: string; label: string }>;
      }>;
      const visitsDep = deps.find((d) => d.entity === 'visits')!;
      expect(visitsDep).toMatchObject({ count: 3, allowed_actions: ['cascade'] });
      expect(visitsDep.items).toHaveLength(3);

      // VERIFY UI — DeleteDialog «Посещения — будут удалены:» + 3 item
      // lines; the visitor-side wording keeps the destroy tail.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-testid="dep-visits"]')).toContainText(
        'Посещения — будут удалены:',
      );
      await expect(page.locator('[data-testid="dep-visits"] li')).toHaveCount(3);

      // Confirm gated on the single «Подтверждаю удаление зависимостей» checkbox.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();
      await page.locator('[data-testid="delete-dialog-confirm-checkbox"]').check();

      // 4. ACTION — confirm; enqueue is sync → the card row disappears +
      // ring toast; the commit DELETE (with body) fires at the 5s window
      // end. The window runs under the paused page clock (#417): the
      // wrapper's instant rewind expires it instead of a real 5.5s sleep;
      // commitDeleteWait above was registered before the window-creating
      // click (helper contract).
      const commitWait = commitDeleteWait(page, visitor.id);
      await withUndoWindow(page, async () => {
        await page.locator('[data-testid="delete-dialog-confirm-btn"]').click();
        await expect(dialog).toHaveCount(0);

        await expect(row).not.toBeVisible();
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
      });

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // The commit body: the cascade resolution + the expected id-set from
      // the dialog tree's items (D6) — visitor_tags carries no items here
      // (the visitor has no own tags; nodes without items are skipped).
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        resolutions: { visits: 'cascade' },
        expected: { visits: expect.arrayContaining(visitsDep.items!.map((i) => i.id)) },
      });

      // 5. VERIFY DB — after the commit window (expired by the wrapper's
      // rewind; the 204 commit response above proves the server finished):
      // visitor + visits gone, record recomputed honestly (visited,3 →
      // waiting,0).
      expect(queryDBRow(`SELECT id FROM visitors WHERE id='${visitor.id}'`)).toBeNull();
      expect(
        queryDBRows(`SELECT id FROM visits WHERE visitor_id='${visitor.id}'`),
      ).toHaveLength(0);
      expect(
        queryDBRow(`SELECT seats, status FROM records WHERE id='${record.id}'`),
      ).toMatchObject({ seats: 0, status: 'waiting' });
    } finally {
      // 5. CLEANUP — record (visits already died with the visitor), then
      // the chain; the client cascade removes any leftover visitor.
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── §9.4: mid-window race — visit added, commit 409, row returns ───────

  test('§9.4: mid-window race — visit added to the deleting visitor, commit 409, row returns with «Обновить»', async ({
    page,
    request,
  }) => {
    // 1. SETUP — a CLEAN visitor (no visits → the dry-run is 204, ring
    // without dialog; the commit carries {expected:{}}).
    const client = await createTestClient(request, {
      name: `§9.4 Клиент ${Date.now()}`,
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });
    const visitorName = `§9.4 Посетитель ${Date.now()}`;
    const visitor = await createTestVisitor(request, client.id, {
      name: visitorName,
    });

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const clientsRow = page
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await clientsRow.click();
      await expect(clientCard(page)).toBeVisible({ timeout: 10_000 });

      const row = visitorRow(page, visitorName);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const commitWait = commitDeleteWait(page, visitor.id);

      // 2. ACTION — the × dry-runs clean (204) → optimistic removal + ring.
      await row.getByRole('button', { name: 'Удалить посетителя' }).click();

      await expect(row).not.toBeVisible();
      await expect(undoToast(page)).toBeVisible();

      // The race (records S6 body shape): a colleague adds a visit to the
      // SAME visitor while the undo window is open (direct API insert —
      // the same simulation as the tags/records stale scenarios).
      const visitResp = await page.request.post(`${BACKEND}/api/v1/visits`, {
        data: { record_id: record.id, visitor_id: visitor.id, price: 3500 },
      });
      expect(visitResp.status()).toBe(201);
      const visit = (await visitResp.json()) as { id: string };

      // Window expires → the commit DELETE carries expected:{} but the
      // visitor now has a visit the snapshot never confirmed → 409.
      const commit = await commitWait;
      expect(commit.status()).toBe(409);

      // Honest error: the row returns + the red toast carries the text
      // «Не удалось удалить: данные изменились» AND the «Обновить» action
      // (toast lives 4500ms — assert and click promptly).
      await expect(row).toBeVisible();
      const errorToast = page
        .locator('[data-testid="toast-error"]')
        .filter({ hasText: 'Не удалось удалить: данные изменились' });
      await expect(errorToast).toBeVisible();
      const refreshBtn = errorToast.getByRole('button', { name: 'Обновить' });
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();

      // Fresh state: the visitor AND the raced visit are alive…
      await expect(row).toBeVisible();
      const dbVisitor = queryDBRow(`SELECT id FROM visitors WHERE id='${visitor.id}'`);
      expect(dbVisitor).not.toBeNull();
      const dbVisit = queryDBRow(`SELECT id FROM visits WHERE id='${visit.id}'`);
      expect(dbVisit).not.toBeNull();
    } finally {
      // 5. CLEANUP — the visitor SURVIVED the stale commit: remove it with
      // the client cascade, record + chain first.
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
