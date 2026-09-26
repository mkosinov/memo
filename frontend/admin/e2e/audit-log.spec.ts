/**
 * audit-log.spec.ts — GH #344 §9 user scenarios (each → E2E, spec §11).
 *
 * Six scenarios over the «Журнал» section (/audit, admin-only):
 *  С1 — admin opens «Журнал»: table with columns «кто / что / над чем /
 *       когда / изменения», history prepared through UI actions (a tag
 *       created via the /tags dialog).
 *  С2 — two browser contexts (server-push pattern, fixtures/server-push.ts
 *       precedent): user B changes a payment amount through the modal UI;
 *       admin A sees «изменил платёж … 500 → 700» in the journal.
 *  С3 — author/action/entity/period filters narrow the table; reset
 *       returns the full feed. The author step first has Б — the seeded
 *       demo master — patch HIS OWN record's payment through the modal
 *       UI, so a Б-authored row exists and selecting Б in the filter
 *       provably drops the admin-authored rows (narrowing, not a no-op).
 *  С4 — master: no «Журнал» menu item; direct /audit → NoAccessScreen;
 *       bare API GET /api/v1/audit-logs → 403 AUTH_FORBIDDEN.
 *  С5 — client phone changed via UI: the journal row shows the change
 *       with a MASKED number (last 4 digits, mask_phone contract).
 *  С6 — visitor deleted via UI: row «удалил посетителя …» with the
 *       deleted visitor's signature.
 *
 * Journal freshness: the audit query family is NOT an SSE entity — A's
 * already-open /audit view does not live-update; the scenarios re-enter
 * /audit (page.goto) after the write, which is the section's contract.
 *
 * The #239 invariant neighbours (server-push specs) are untouched; this
 * spec only READS journal rows and mutates through ordinary entity UIs.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestPayment,
  createTestVisitor,
  createTestTag,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { openRecordTab } from './helpers/anonymous-visits';
import { masterAuthStatePath } from './fixtures/auth-state';
import type { Page } from '@playwright/test';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Marker prefix — unique per run/test so journal assertions never
 * collide with rows left by sibling specs (audit_logs are NOT wiped by
 * the per-test seed reset; rows accumulate across a run). */
function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Navigate to /audit and wait for the journal page to be ready:
 * heading + table + the paged GET /audit-logs response. The listener is
 * armed BEFORE goto so the load-time fetch cannot slip past. */
async function waitForAuditReady(page: Page): Promise<void> {
  const listResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/audit-logs') &&
      !r.url().includes('authors') &&
      r.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto('/audit');
  await page.waitForSelector('h1:has-text("Журнал")', { timeout: 30_000 });
  await page.waitForSelector('table', { timeout: 30_000 });
  await listResponse;
}

/** One journal row (data-testid="audit-row-{id}") filtered by text. */
function auditRow(page: Page, text: string | RegExp) {
  return page.locator('[data-testid^="audit-row-"]').filter({ hasText: text });
}

/**
 * Resolve the journal row id for one entity's action via the reading API
 * (`?entity_id=…&action=…`, spec §6) — the precise locator aid for rows
 * whose text is ambiguous (a create row and an update/delete row of the
 * same entity share the marker text; the update row's label may lack the
 * name entirely — §5.1 derives it from the CHANGED fields only).
 * Returns null while the row has not landed (callers poll).
 */
async function findJournalRowId(
  request: import('@playwright/test').APIRequestContext,
  entityId: string,
  action: string,
): Promise<string | null> {
  const resp = await request.get(
    `${BACKEND}/api/v1/audit-logs?entity_id=${entityId}&action=${action}`,
  );
  if (!resp.ok()) return null;
  const json = (await resp.json()) as { items?: Array<{ id: string }> };
  return json.items?.[0]?.id ?? null;
}

/** Expand the row's «Изменения» decryption and return the row locator
 * (the toggle button lives inside [data-testid^="audit-changes-"]). */
async function expandChanges(row: ReturnType<typeof auditRow>): Promise<void> {
  await row
    .locator('[data-testid^="audit-changes-"]')
    .getByRole('button')
    .click();
}

// ── Admin scenarios С1–С3, С5, С6 ───────────────────────────────────────────

test.describe('GH #344 §9 — журнал действий администратора', () => {
  // ── С1: открыть журнал с историей, подготовленной UI-действиями ─────────

  test('С1: админ открывает «Журнал» — таблица истории с колонками', async ({
    page,
    request,
  }) => {
    const tagName = `audit-c1-${uid()}`;
    let tagId: string | null = null;

    // UI action prepares journal history: create a tag through /tags.
    await page.goto('/tags');
    await page.waitForSelector('h1:has-text("Управление тегами")', { timeout: 30_000 });
    await page.click('text=+ Добавить тег');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').first().fill(tagName);
    const createResponse = page.waitForResponse(
      (r) => r.url().includes('/api/v1/tags') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    const resp = await createResponse;
    expect(resp.status()).toBe(201);
    tagId = ((await resp.json()) as { id: string }).id;

    try {
      // Open the journal: heading + table with the five spec §7 columns.
      await waitForAuditReady(page);
      for (const header of ['Когда', 'Кто', 'Действие', 'Над чем', 'Изменения']) {
        await expect(page.locator('th', { hasText: header })).toBeVisible();
      }

      // The UI-created tag is journaled: action «создал», entity «Тег».
      const row = auditRow(page, tagName);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText('создал');
      await expect(row).toContainText('Тег');

      // The author column shows the admin's reference (seed admin has no
      // staff card → phone fallback label) + the role badge.
      await expect(row).toContainText('+79990000001');
      await expect(row.locator('[data-testid="audit-role-badge"]')).toHaveText(
        'Администратор',
      );
    } finally {
      if (tagId) await cleanup(request, `/api/v1/tags/${tagId}`);
    }
  });

  // ── С2: чужое действие видно (двухконтекстный сценарий) ─────────────────

  test('С2: пользователь Б меняет сумму платежа — админ А видит «изменил платёж … 500 → 700»', async ({
    browser,
    request,
  }) => {
    const marker = `audit-c2-${uid()}`;

    // SETUP via admin API: client + activity + record + payment(500).
    const client = await createTestClient(request, { name: `C2 ${marker}` });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });
    const payment = await createTestPayment(request, record.id, { amount: 500 });

    // Two browser contexts = two admins (server-push pattern; manual
    // contexts inherit the project storageState — verified by probe).
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    try {
      // B changes the payment amount through the record modal UI.
      await openRecordTab(pageB, record.id);
      const paymentRow = pageB.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(paymentRow).toBeVisible({ timeout: 10_000 });

      const patchDone = pageB.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/payments/${payment.id}`) &&
          r.request().method() === 'PATCH',
        { timeout: 15_000 },
      );
      const amountInput = paymentRow.locator('input[type="number"]');
      await amountInput.fill('700');
      await amountInput.press('Enter'); // blur-to-commit → PATCH
      const patch = await patchDone;
      expect(patch.status()).toBe(200);

      // A opens the journal and sees B's write: «изменил» + «Платёж 700»
      // (label derives from the after-values, spec §5.1 «Платёж 3500, card»
      // — amount-only diff renders «Платёж 700») with the amount
      // decryption «500 → 700». The [^0-9] guard keeps «Платёж 7000»
      // (a sibling spec's payment) from matching.
      await waitForAuditReady(pageA);
      const row = auditRow(pageA, /Платёж 700(?:[^0-9]|$)/);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText('изменил');
      await expandChanges(row);
      await expect(row).toContainText('amount');
      await expect(row).toContainText('500 → 700');
    } finally {
      await ctxA.close();
      await ctxB.close();
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── С3: фильтры сужают таблицу, сброс возвращает полную ленту ───────────

  test('С3: фильтры по автору/действию/сущности/периоду сужают таблицу; сброс возвращает всю ленту', async ({
    page,
    request,
    browser,
  }) => {
    const tagName = `audit-c3-tag-${uid()}`;
    const clientName = `audit-c3-client-${uid()}`;
    let tagId: string | null = null;
    let clientId: string | null = null;

    // Two different entities authored by the admin: a tag (entity tags)
    // and a client (entity clients) — both action create.
    const tag = await createTestTag(request, { title: tagName });
    tagId = tag.id;
    const client = await createTestClient(request, { name: clientName });
    clientId = client.id;

    // Б — the seeded demo master, a DISTINCT author (the admin of С1/С2 is
    // the only other journal writer in this run). His own record's payment
    // is patched through the modal UI (master-role-payments S3 precedent:
    // activity pinned to m1 — the seed card the demo master is linked to),
    // which journals an update row carrying Б's user_id. Without such a
    // row the author-filter step below could not prove narrowing.
    const clientB = await createTestClient(request);
    const activityB = await createTestActivity(request, { master_id: 'm1' });
    const recordB = await createTestRecord(request, activityB.id, clientB.id, {
      visits: [],
    });
    const paymentB = await createTestPayment(request, recordB.id, { amount: 500 });

    const ctxB = await browser.newContext({ storageState: masterAuthStatePath() });
    const pageB = await ctxB.newPage();

    try {
      // Б changes the payment amount through the record modal UI (500→700,
      // blur-to-commit → PATCH — same mechanics as С2, another session).
      await openRecordTab(pageB, recordB.id);
      const paymentRowB = pageB.locator(`[data-testid="payment-${paymentB.id}"]`);
      await expect(paymentRowB).toBeVisible({ timeout: 10_000 });
      const patchDoneB = pageB.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/payments/${paymentB.id}`) &&
          r.request().method() === 'PATCH',
        { timeout: 15_000 },
      );
      const amountInputB = paymentRowB.locator('input[type="number"]');
      await amountInputB.fill('700');
      await amountInputB.press('Enter');
      expect((await patchDoneB).status()).toBe(200);
      await ctxB.close();

      // Б's journal row: resolved by entity_id+action because the label
      // text «Платёж 700» also occurs in С2's admin-authored row (journal
      // rows accumulate across the run — only ids are unambiguous).
      await expect
        .poll(() => findJournalRowId(request, paymentB.id, 'update'), {
          timeout: 15_000,
        })
        .not.toBeNull();
      const masterRowId = (await findJournalRowId(
        request,
        paymentB.id,
        'update',
      ))!;

      await waitForAuditReady(page);

      // Full feed: all three marker rows are visible.
      const tagRow = auditRow(page, tagName);
      const clientRow = auditRow(page, clientName);
      const masterRow = page.locator(`[data-testid="audit-row-${masterRowId}"]`);
      await expect(tagRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });
      await expect(masterRow).toBeVisible({ timeout: 10_000 });

      // Entity filter (Тег): the tag row stays, the client row is gone.
      await page.getByLabel('Сущность').selectOption('tags');
      await expect(tagRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toHaveCount(0);

      // Action filter (удалил) on top: neither create row survives.
      await page.getByLabel('Действие').selectOption('delete');
      await expect(tagRow).toHaveCount(0);
      await expect(clientRow).toHaveCount(0);

      // Reset BOTH filters via the reset link — the full feed returns.
      await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
      await expect(tagRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });

      // Author filter (Б — the demo master): the dropdown offers both
      // journal authors from /audit-logs/authors (admin = phone-fallback
      // label, Б = his staff card name). Selecting Б keeps Б's row and
      // DROPS both admin-authored marker rows — narrowing a no-op
      // user_id filter could never demonstrate.
      const authorSelect = page.getByLabel('Автор');
      const adminOption = authorSelect.locator('option', {
        hasText: '+79990000001',
      });
      await expect(adminOption).toHaveCount(1);
      const masterOption = authorSelect.locator('option', {
        hasText: 'Середа Ольга',
      });
      await expect(masterOption).toHaveCount(1);
      await authorSelect.selectOption({ label: 'Середа Ольга' });
      await expect(masterRow).toBeVisible({ timeout: 10_000 });
      await expect(masterRow).toContainText('изменил');
      await expect(tagRow).toHaveCount(0);
      await expect(clientRow).toHaveCount(0);

      // Reset: the full feed returns.
      await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
      await expect(tagRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });
      await expect(masterRow).toBeVisible({ timeout: 10_000 });

      // Period filter (date_from tomorrow): no journal row can match —
      // the table collapses to the «Нет действий» stub.
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await page.locator('input[aria-label="Период"]').first().fill(tomorrow);
      await expect(tagRow).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByText('Нет действий')).toBeVisible();

      // Reset: the full feed returns.
      await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
      await expect(tagRow).toBeVisible({ timeout: 10_000 });
      await expect(clientRow).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctxB.close();
      if (tagId) await cleanup(request, `/api/v1/tags/${tagId}`);
      if (clientId) await cleanup(request, `/api/v1/clients/${clientId}`);
      await cleanupRecord(request, recordB.id);
      await cleanup(request, `/api/v1/clients/${clientB.id}`);
      await cleanup(request, `/api/v1/activities/${activityB.id}`);
    }
  });

  // ── С5: маскирование телефона в снимке изменения ────────────────────────

  test('С5: телефон клиента изменён через UI — в журнале маскированный номер (последние 4 цифры)', async ({
    page,
    request,
  }) => {
    const name = `audit-c5-${uid()}`;
    const oldPhone = `+7999${String(Date.now()).slice(-7)}`;
    const newPhone = `+7999${String(Date.now() + 1).slice(-7)}`;

    const client = await createTestClient(request, {
      name,
      phone: oldPhone,
    });

    try {
      // Change the phone through the client card UI.
      await page.goto('/clients');
      await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 30_000 });
      const row = page.locator('table tbody tr').filter({ hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      const patchDone = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/clients/${client.id}`) &&
          (r.request().method() === 'PATCH' ||
            r.request().method() === 'PUT'),
        { timeout: 15_000 },
      );
      await page.locator('#client-phone').fill(newPhone);
      await page.getByRole('button', { name: 'Сохранить' }).click();
      const patch = await patchDone;
      expect(patch.ok()).toBeTruthy();

      // The journal UPDATE row's label derives from the CHANGED fields
      // only (§5.1 — here just the masked phone), so text-matching by
      // client name would hit the CREATE row instead. Resolve the update
      // row's id via the reading API (?entity_id=…&action=update) and
      // assert on the exact UI row.
      await expect
        .poll(() => findJournalRowId(request, client.id, 'update'), {
          timeout: 15_000,
        })
        .not.toBeNull();
      const updateRowId = (await findJournalRowId(
        request,
        client.id,
        'update',
      ))!;

      await waitForAuditReady(page);
      const updateRow = page.locator(`[data-testid="audit-row-${updateRowId}"]`);
      await expect(updateRow).toBeVisible({ timeout: 10_000 });
      await expect(updateRow).toContainText('изменил');
      await expandChanges(updateRow);

      // The phone pair is MASKED: bullets + the last 4 digits of each
      // number; the full digits never appear (mask_phone contract).
      const changes = updateRow.locator('[data-testid^="audit-changes-"]');
      await expect(changes).toContainText('phone');
      await expect(changes).toContainText('•');
      await expect(changes).toContainText(newPhone.slice(-4));
      await expect(changes).not.toContainText(newPhone.slice(0, -4));
      await expect(changes).not.toContainText(oldPhone.slice(0, -4));
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── С6: снимок удаления посетителя ──────────────────────────────────────

  test('С6: удаление посетителя — строка «удалил посетителя …» с подписью удалённого', async ({
    page,
    request,
  }) => {
    const clientName = `audit-c6-${uid()}`;
    const visitorName = `Посетитель C6 ${uid()}`;

    const client = await createTestClient(request, { name: clientName });
    const visitor = await createTestVisitor(request, client.id, {
      name: visitorName,
    });

    try {
      // Delete the visitor through the client card UI.
      await page.goto('/clients');
      await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 30_000 });
      const row = page.locator('table tbody tr').filter({ hasText: clientName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      const deleteDone = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/visitors/${visitor.id}`) &&
          r.request().method() === 'DELETE',
        { timeout: 15_000 },
      );
      const visitorRow = modal
        .locator('[data-testid="visitor-row"]')
        .filter({ hasText: visitorName });
      await expect(visitorRow).toBeVisible({ timeout: 10_000 });
      await visitorRow
        .locator('button[aria-label="Удалить посетителя"]')
        .click();
      expect((await deleteDone).status()).toBe(204);

      // The journal row: «удалил» + «Посетитель: {name}» signature
      // (§4.3 explicit mark — the label carries the deleted row's name).
      // Resolved via entity_id+action=delete so the visitor's own create
      // row (same text) never matches.
      await expect
        .poll(() => findJournalRowId(request, visitor.id, 'delete'), {
          timeout: 15_000,
        })
        .not.toBeNull();
      const deleteRowId = (await findJournalRowId(
        request,
        visitor.id,
        'delete',
      ))!;

      await waitForAuditReady(page);
      const jr = page.locator(`[data-testid="audit-row-${deleteRowId}"]`);
      await expect(jr).toBeVisible({ timeout: 10_000 });
      await expect(jr).toContainText('удалил');
      await expect(jr).toContainText(`Посетитель: ${visitorName}`);
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});

// ── С4: мастер не допущен ───────────────────────────────────────────────────

test.describe('GH #344 §9 С4 — мастер не допущен к журналу', () => {
  useMasterSession();

  test('С4: нет пункта меню; /audit — экран запрета; API — 403', async ({
    page,
  }) => {
    // No «Журнал» nav item in the master's menu.
    await page.goto('/schedule');
    const menubar = page.locator('[data-testid="menubar"]');
    await expect(menubar).toBeVisible({ timeout: 30_000 });
    await expect(menubar.getByRole('link', { name: 'Журнал' })).toHaveCount(0);

    // Direct /audit deep link → the NoAccessScreen, URL kept (GH #263 T9).
    await page.goto('/audit');
    const noAccess = page.locator('[data-testid="no-access"]');
    await expect(noAccess).toBeVisible({ timeout: 30_000 });
    await expect(noAccess).toContainText('Нет доступа к разделу');
    expect(new URL(page.url()).pathname).toBe('/audit');

    // Bare API request through the master's session → 403 AUTH_FORBIDDEN.
    const apiResp = await page.request.get(`${BACKEND}/api/v1/audit-logs`);
    expect(apiResp.status()).toBe(403);
    const errBody = await apiResp.json();
    expect(errBody?.detail?.code ?? errBody?.code).toBe('AUTH_FORBIDDEN');
  });
});
