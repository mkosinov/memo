import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { createTestActivity, cleanup, cleanupRecord } from './fixtures/factories';
import {
  gotoScheduleWeek,
  clickActivityCard,
  clickModalTab,
  waitForRecordsReady,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = resolveBackendUrl();
void BACKEND; // GH #387 fence — both URL vars must be present and same-host

/**
 * GH #484 Task 8 — User Scenario S6, the E2E leg (spec §4): mock
 * delivery through the FULL enabled stack.
 *
 * The stack runs with the notify subsystem enabled AND the WORKER child
 * (scripts/e2e-shard-start.sh in NOTIFY_E2E_ENABLED=1 mode spawns
 * dispatcher + worker; NOTIFY_CHANNEL_PRIORITY=mock — §3.8). Creating a
 * record with the «отправлять оповещения» checkbox on a future activity
 * for a fresh client passes NORMALLY and the records UI is unchanged
 * (the record lands in the records list). The pipeline then runs
 * end-to-end: dispatcher → queue → worker (mock channel) → statuses →
 * the dispatcher reader drives the task row to `sent`.
 *
 * Per the S1-precedent split (spec §3.6), the DELIVERY assertions
 * (recorder artifact `{address, text}`, LTRIM bound) live in the marked
 * backend check `backend/tests/test_notify_redis_s6_delivery.py`. Here
 * the DB view of the COMPLETED pipeline is the SYNC POINT: the task row
 * must reach `sent` before cleanup — this is exactly what fails without
 * the worker in the stack (the row stays `queued` forever), which is the
 * RED-phase contract of Task 8.
 *
 * Run against the enabled stack only (skipped everywhere else — standard
 * shards stay byte-identical, S2/S10):
 *   stack:  NOTIFY_E2E_ENABLED=1 SHARD_ID=notify \
 *           TEST_DB_PATH=backend/test_memo_notify_e2e.db \
 *           bash scripts/e2e-shard-start.sh
 *   run:    cd frontend/admin && NOTIFY_E2E_ENABLED=1 SHARD_PORT=3006 \
 *           BACKEND_URL=http://127.0.0.1:8005 \
 *           NEXT_PUBLIC_API_URL=http://127.0.0.1:8005 \
 *           TEST_DB_PATH=backend/test_memo_notify_e2e.db \
 *           pnpm exec playwright test e2e/notify-s6-mock-delivery.spec.ts
 * (both URL vars, same host — GH #387; no SHARD_ID so the standalone
 * TEST_DB_PATH resolution applies).
 */

/** A start ~3 days ahead at 12:00 UTC — safely future for the
 *  business_now (Europe/Moscow) predicate, never crossing a local
 *  midnight (UTC noon = Moscow 15:00, same date part). */
function futureStart(): { date: string; start: string } {
  const d = new Date(Date.now() + 3 * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  return { date, start: `${date}T12:00:00` };
}

test.describe('Notify enabled stack — S6 mock delivery (GH #484)', () => {
  test.skip(
    process.env.NOTIFY_E2E_ENABLED !== '1',
    'S6 targets the enabled notify stack WITH the worker child: run with NOTIFY_E2E_ENABLED=1 against scripts/e2e-shard-start.sh in enabled mode (GH #484 §3.8/§4)',
  );

  test('record with «отправлять оповещения» delivers through the worker — records UI unchanged', async ({
    page,
    request,
  }) => {
    // 1. SETUP — a FUTURE activity (the new_record scenario skips past
    //    events; §3.4 predicate activity.start > business_now).
    const { date, start } = futureStart();
    const activity = await createTestActivity(request, { start });

    const uid = Date.now();
    const nationalDigits = `999${String(uid).slice(-7)}`;
    const testPhone = `+7${nationalDigits}`;
    const testClientName = `Notify S6 Client ${uid}`;

    // `any` (house pattern, notify-s1 spec): the rows are assigned
    // inside expect.poll callbacks, which control-flow analysis cannot
    // see — a `T | null` annotation narrows to `null`/`never` in the
    // finally block and breaks the optional-chain cleanup accesses.
    let recordRow: any = null;
    let clientRow: any = null;
    let taskRow: any = null;

    try {
      // 2. ACTION — open the activity modal → «+» tab → fill the form
      //    (fresh client by phone, one visitor) and CHECK the box.
      await gotoScheduleWeek(page, date);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await clickActivityCard(page, card);
      await expect(page.locator('[data-testid="activity-details-modal"]')).toBeVisible();
      await clickModalTab(page, 'tab-add');
      await expect(page.locator('[data-testid="new-record-tab"]')).toBeVisible();

      await page.locator('[data-testid="input-phone"]').fill(testPhone);
      await page.locator('[data-testid="input-phone"]').blur();
      await page.locator('[data-testid="input-client-name"]').fill(testClientName);

      await page
        .locator('[data-testid="new-record-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      const visitorRow = page.locator('[data-testid="visitor-form-row"]').first();
      await visitorRow.locator('input').first().fill(`Notify S6 Visitor ${uid % 100000}`);

      const checkbox = page.locator('[data-testid="checkbox-notifications"]');
      await checkbox.check();
      await expect(checkbox).toBeChecked();

      await page.locator('[data-testid="btn-create-record"]').click();

      // 3. VERIFY UI — the creation flow is UNCHANGED: success toast,
      //    the records page renders as always, and the new record IS in
      //    the list (the date filters cover the future activity's date).
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });
      await waitForRecordsReady(page);
      await expect(page.locator('h1:has-text("Управление записями")')).toBeVisible();

      const dateFromWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') && r.url().includes(`date_from=${date}`),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill(date);
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes(`date_to=${date}`),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill(date);
      await dateToWait;
      await expect(
        page.locator('tbody tr').filter({ hasText: testClientName }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // 4. VERIFY DB — the flag chain landed (part 1 contract): client
      //    created (consent defaults ON), record bound to it with
      //    records.notify = 1.
      await expect.poll(async () => {
        clientRow = queryDBRow(
          `SELECT * FROM clients WHERE phone='${testPhone}' AND is_active=1`,
        );
        return clientRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(clientRow!.name).toBe(testClientName);

      await expect.poll(async () => {
        recordRow = queryDBRow(
          `SELECT * FROM records WHERE client_id='${clientRow!.id}'`,
        );
        return recordRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(recordRow!.notify).toBe(1);

      // 5. SYNC POINT (worker-dependent, the S6 core) — the task row
      //    must reach `sent`: the worker consumed the stream, delivered
      //    through the mock channel (NOTIFY_CHANNEL_PRIORITY=mock) and
      //    the dispatcher reader applied the §4.3 statuses. Without the
      //    worker child in the stack the row stays `queued` forever —
      //    this poll is the RED-phase failure of Task 8.
      await expect.poll(async () => {
        taskRow = queryDBRow(
          `SELECT status FROM notify_tasks WHERE client_id='${clientRow!.id}' AND scenario='new_record'`,
        );
        return taskRow !== null && taskRow.status === 'sent';
      }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true);
    } finally {
      // 6. CLEANUP — safe only AFTER the task reached `sent` (step 5):
      //    the pipeline is complete, the frozen payload was delivered;
      //    deleting the record/client earlier could close the live-read
      //    event mid-flight (§3.4).
      if (recordRow?.id) await cleanupRecord(request, recordRow.id);
      if (clientRow?.id) await cleanup(request, `/api/v1/clients/${clientRow.id}`);
    }
  });
});
