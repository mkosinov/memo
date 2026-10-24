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
 * GH #483 Task 8 — User Scenario S1 (spec §4): the ENABLED notify stack.
 *
 * The stack is up with the notify subsystem enabled (dispatcher child +
 * a real Redis; scripts/e2e-shard-start.sh in NOTIFY_E2E_ENABLED=1 mode).
 * Creating a record with the «отправлять оповещения» checkbox on a future
 * activity for a fresh client (consent is ON by default, family spec §3.8
 * — part 1 wired the checkbox flag) passes NORMALLY: the records UI is
 * unchanged. The dispatcher then turns the journaled event into a queued
 * notify task (the post-scenario QUEUE assertion itself — stream ≥ 1 task
 * with the family §4.2 payload — is the marked backend test
 * backend/tests/test_notify_redis_s1_queue.py, run AFTER this scenario;
 * spec §3.6). Here we assert the DB side of that pipeline as a SYNC
 * POINT: the queued task row must exist before cleanup deletes the
 * record — a deleted record would make the live-read scenario close the
 * event WITHOUT a task (§3.4) and the whole point of the run would
 * silently evaporate. (#484 Task 8: the stack also runs the worker now —
 * the row may already have advanced past 'queued' to 'sending'/'sent'
 * when this sync point reads it.)
 *
 * Run against the enabled stack only (skipped everywhere else — standard
 * shards stay byte-identical, S2):
 *   stack:  NOTIFY_E2E_ENABLED=1 SHARD_ID=notify \
 *           TEST_DB_PATH=backend/test_memo_notify_e2e.db \
 *           bash scripts/e2e-shard-start.sh
 *   run:    cd frontend/admin && NOTIFY_E2E_ENABLED=1 SHARD_PORT=3006 \
 *           BACKEND_URL=http://127.0.0.1:8005 \
 *           NEXT_PUBLIC_API_URL=http://127.0.0.1:8005 \
 *           TEST_DB_PATH=backend/test_memo_notify_e2e.db \
 *           pnpm exec playwright test e2e/notify-s1-enabled-stack.spec.ts
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

test.describe('Notify enabled stack — S1 (GH #483)', () => {
  test.skip(
    process.env.NOTIFY_E2E_ENABLED !== '1',
    'S1 targets the enabled notify stack: run with NOTIFY_E2E_ENABLED=1 against scripts/e2e-shard-start.sh in enabled mode (GH #483 §3.5/§4)',
  );

  test('record with «отправлять оповещения» creates normally and the dispatcher queues the task', async ({
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
    const testClientName = `Notify S1 Client ${uid}`;

    // `any` (house pattern, activity-details-modal.spec.ts): the rows are
    // assigned inside expect.poll callbacks, which control-flow analysis
    // cannot see — a `T | null` annotation narrows to `null`/`never` in
    // the finally block and breaks the optional-chain cleanup accesses.
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
      await visitorRow.locator('input').first().fill(`Notify S1 Visitor ${uid % 100000}`);

      const checkbox = page.locator('[data-testid="checkbox-notifications"]');
      await checkbox.check();
      await expect(checkbox).toBeChecked();

      await page.locator('[data-testid="btn-create-record"]').click();

      // 3. VERIFY UI — the creation flow is UNCHANGED: success toast, and
      //    the records page renders as always.
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });
      await waitForRecordsReady(page);
      await expect(page.locator('h1:has-text("Управление записями")')).toBeVisible();

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

      // 5. SYNC POINT (queue-side, DB view) — the enabled dispatcher
      //    consumed the journaled event and created the task (creation
      //    status 'queued'). Since #484 Task 8 the stack also runs the
      //    WORKER: by the time this read lands, the row may legitimately
      //    have advanced to 'sending'/'sent' — each of the three proves
      //    the pipeline reached the queue ('failed' does not and fails
      //    the scenario). The stream/payload assertion itself lives in
      //    the marked backend test (spec §3.6); this poll only proves
      //    the pipeline reached the queue before cleanup runs.
      await expect.poll(async () => {
        taskRow = queryDBRow(
          `SELECT status FROM notify_tasks WHERE client_id='${clientRow!.id}' AND scenario='new_record'`,
        );
        return taskRow !== null;
      }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true);
      expect(['queued', 'sending', 'sent']).toContain(taskRow!.status);
    } finally {
      // 6. CLEANUP — safe only AFTER the task row exists (step 5): the
      //    dispatcher processes events with LIVE reads, and a deleted
      //    record/client closes the event without a task (§3.4).
      if (recordRow?.id) await cleanupRecord(request, recordRow.id);
      if (clientRow?.id) await cleanup(request, `/api/v1/clients/${clientRow.id}`);
    }
  });
});
