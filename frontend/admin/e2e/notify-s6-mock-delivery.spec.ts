import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import {
  createTestActivity,
  createTestClient,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import {
  gotoScheduleWeek,
  clickActivityCard,
  clickModalTab,
  waitForRecordsReady,
} from './fixtures/helpers';
import { queryDB, queryDBRow, queryDBRows } from './fixtures/db-query';

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

/**
 * GH #485 Task 6 — spec §12 User Scenarios 1, 2, 5 (§13: the E2E leg
 * «продолжение специ notify-s6-mock-delivery», scenarios 1–3, 5; the
 * spawn half of scenario 3 needs TWO mock channels in the priority —
 * the contour covers it with injected channels, the enabled stack runs
 * NOTIFY_CHANNEL_PRIORITY=mock).
 *
 * The scenario driver is the #484 seam: the notify ADDRESS (= the
 * client phone, frozen verbatim) scripts the mock outcome — the
 * `fail-app:` prefix is the unresolvable-address analogue (worker-484
 * spec §3.6), a plain phone delivers to the recorder. Record creation
 * goes through the authenticated API (`notify: true` needs a non-null
 * actor, GH #482 §3.3 — the storageState `request` fixture carries the
 * session), the pipeline then runs end-to-end: dispatcher → queue →
 * worker (mock channel) → statuses → attempts/root outcome in the DB.
 *
 * Same run recipe as the S6 test above (both URL vars, same host —
 * GH #387; no SHARD_ID so the standalone TEST_DB_PATH applies).
 */
test.describe("Notify enabled stack — §12 scenarios (GH #485)", () => {
  test.skip(
    process.env.NOTIFY_E2E_ENABLED !== "1",
    "targets the enabled notify stack WITH the worker child: run with NOTIFY_E2E_ENABLED=1 against scripts/e2e-shard-start.sh in enabled mode (GH #485 §12/§13)",
  );

  test("§12-1: delivered task keeps the actually-sent text in its attempt", async ({
    request,
  }) => {
    // 1. SETUP — a future activity + a fresh named client (consent ON,
    //    plain phone → the mock delivers to the recorder).
    const { start } = futureStart();
    const activity = await createTestActivity(request, { start });
    const uid = Date.now();
    const clientName = `Notify 485 S1 Client ${uid}`;
    const client = await createTestClient(request, {
      name: clientName,
      phone: `+7999${String(uid).slice(-7)}`,
    });

    // `any` (house pattern, the S6 test above): rows are assigned inside
    // expect.poll callbacks — control-flow analysis narrows `T | null` to
    // `never` in the finally block and breaks the optional chains.
    let taskRow: any = null;
    let record: any = null;

    try {
      // 2. ACTION — authenticated create with the notify flag (GH #482
      //    §3.3): the §3.4 predicate passes (future start, consent ON,
      //    phone present) → the scenario freezes payload+template and
      //    queues the first-priority (mock) channel task.
      record = await createTestRecord(request, activity.id, client.id, {
        notify: true,
      });
      expect(record.id).toBeTruthy();

      // 3. VERIFY DB — the chain-completed task (sent + root outcome).
      await expect
        .poll(
          async () => {
            taskRow = queryDBRow(
              `SELECT id, status, delivery_outcome FROM notify_tasks
           WHERE client_id='${client.id}' AND scenario='new_record'`,
            );
            return taskRow !== null && taskRow.status === "sent";
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);
      expect(taskRow!.delivery_outcome).toBe("delivered");

      // …and the append-only attempt journal stores the ACTUALLY-SENT
      // text (§8.4): the sent/delivered row carries `sent_text` rendered
      // by the worker from the FROZEN template — client name + the seed
      // greeting are in the rendering by construction.
      const attempts = queryDBRows(
        `SELECT stage, outcome, sent_text FROM notify_task_attempts
         WHERE task_id='${taskRow!.id}'`,
      );
      const sent = attempts.find(
        (a) => a.stage === "sent" && a.outcome === "delivered",
      );
      expect(sent).toBeTruthy();
      expect(String(sent!.sent_text)).toContain(clientName);
      expect(String(sent!.sent_text)).toContain("Вы записаны");
    } finally {
      // 4. CLEANUP — safe after the terminal state (the S6 rule above).
      if (record?.id) await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test("§12-2: unresolvable address → attempt with the cause; chain closes «не доставлено» (mock is the last channel)", async ({
    request,
  }) => {
    // 1. SETUP — the marker phone IS the #484 unresolvable-address
    //    analogue: the address is the client phone frozen verbatim, and
    //    the mock raises ChannelAppError on the `fail-app:` prefix.
    const { start } = futureStart();
    const activity = await createTestActivity(request, { start });
    const uid = Date.now();
    const markerPhone = `fail-app:+7999${String(uid).slice(-7)}`;
    const client = await createTestClient(request, {
      name: `Notify 485 S2 Client ${uid}`,
      phone: markerPhone,
    });

    let taskRow: any = null;
    let record: any = null;

    try {
      // 2. ACTION — authenticated create with the notify flag.
      record = await createTestRecord(request, activity.id, client.id, {
        notify: true,
      });
      expect(record.id).toBeTruthy();

      // 3. VERIFY DB — the task fails terminally AND the chain closes
      //    on the root: `mock` is the LAST priority channel (§8.2 — no
      //    candidate → delivery_outcome = not_delivered).
      await expect
        .poll(
          async () => {
            taskRow = queryDBRow(
              `SELECT id, status, delivery_outcome, root_task_id FROM notify_tasks
           WHERE client_id='${client.id}' AND scenario='new_record'`,
            );
            return (
              taskRow !== null &&
              taskRow.status === "failed" &&
              taskRow.delivery_outcome === "not_delivered"
            );
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);

      // …the attempt carries the CAUSE (§8.4 — human-readable error with
      // the outcome category): the app_error row holds the scripted
      // mock message; the final not_delivered row closes the channel.
      const attempts = queryDBRows(
        `SELECT stage, outcome, error FROM notify_task_attempts
         WHERE task_id='${taskRow!.id}'`,
      );
      const failedWithCause = attempts.find(
        (a) =>
          a.stage === "failed" &&
          a.outcome === "app_error" &&
          String(a.error).startsWith("mock: scripted app failure"),
      );
      expect(failedWithCause).toBeTruthy();
      expect(
        attempts.some(
          (a) => a.stage === "failed" && a.outcome === "not_delivered",
        ),
      ).toBe(true);

      // …no continuation task was spawned (single-channel chain: the
      // root task is the only one — UNIQUE(root_task_id, channel)).
      const chainRows = queryDBRows(
        `SELECT id FROM notify_tasks WHERE root_task_id='${taskRow!.root_task_id}'`,
      );
      expect(chainRows.length).toBe(1);
    } finally {
      // 4. CLEANUP — safe after the terminal state.
      if (record?.id) await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test("§12-5: admin edits the template via the DB — new tasks render the new text, the task frozen earlier keeps the old one", async ({
    request,
  }) => {
    // 1. SETUP — the universal new_record template row the dispatcher
    //    freezes for mock tasks (tier-2 lookup: event_type + channel IS
    //    NULL, deterministic order — render.py find_template).
    const template = queryDBRow(
      `SELECT id, body FROM notify_templates
       WHERE event_type='new_record' AND channel IS NULL
       ORDER BY created_at, id LIMIT 1`,
    );
    expect(template).toBeTruthy();
    const originalBody: string = template!.body;

    const { start } = futureStart();
    const activity = await createTestActivity(request, { start });
    const uid = Date.now();
    const marker = `485-S5-EDIT-${uid}`;
    const editedBody = `${marker}: правка шаблона из теста — {{ client.name }}, ждём вас!`;

    const clientA = await createTestClient(request, {
      name: `Notify 485 S5 A ${uid}`,
      phone: `+7998${String(uid).slice(-7)}`,
    });
    const clientB = await createTestClient(request, {
      name: `Notify 485 S5 B ${uid}`,
      phone: `+7997${String(uid).slice(-7)}`,
    });

    // `any` — the house pattern (see the S6 test above).
    let taskA: any = null;
    let taskB: any = null;
    let recordA: any = null;
    let recordB: any = null;

    try {
      // 2. TASK A — created BEFORE the edit: the dispatcher freezes the
      //    ORIGINAL template into the task row (§3.2 — the freeze, not
      //    a render). Waiting for the frozen row proves the freeze
      //    happened before the edit regardless of delivery timing: the
      //    worker renders from the frozen copy (ADR 014), so a task
      //    still in flight at edit time is covered by the same column.
      recordA = await createTestRecord(request, activity.id, clientA.id, {
        notify: true,
      });
      expect(recordA.id).toBeTruthy();
      await expect
        .poll(
          async () => {
            taskA = queryDBRow(
              `SELECT id, status, template_body FROM notify_tasks
           WHERE client_id='${clientA.id}' AND scenario='new_record'`,
            );
            return taskA !== null && taskA.template_body === originalBody;
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);

      // 3. ACTION — the admin edit, applied straight to the stack DB
      //    (the established test seam; the per-test canon reset also
      //    restores the row — the finally restore is belt-and-braces).
      queryDB(
        `UPDATE notify_templates SET body='${editedBody}' WHERE id='${template!.id}'`,
      );
      expect(
        queryDBRow(
          `SELECT body FROM notify_templates WHERE id='${template!.id}'`,
        )!.body,
      ).toBe(editedBody);

      // 4. TASK B — created AFTER the edit: the freeze picks up the NEW
      //    body (the lookup runs dispatcher-side at task creation).
      recordB = await createTestRecord(request, activity.id, clientB.id, {
        notify: true,
      });
      expect(recordB.id).toBeTruthy();

      // 5. VERIFY DB — both tasks deliver; A from the OLD freeze, B from
      //    the NEW one — the actually-sent texts prove the split.
      await expect
        .poll(
          async () => {
            taskB = queryDBRow(
              `SELECT id, status, template_body FROM notify_tasks
           WHERE client_id='${clientB.id}' AND scenario='new_record'`,
            );
            return (
              taskB !== null &&
              taskB.status === "sent" &&
              taskB.template_body === editedBody
            );
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            taskA = queryDBRow(
              `SELECT id, status, template_body FROM notify_tasks
           WHERE client_id='${clientA.id}' AND scenario='new_record'`,
            );
            return taskA !== null && taskA.status === "sent";
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);
      expect(taskA!.template_body).toBe(originalBody);

      const sentText = (taskId: string): string => {
        const rows = queryDBRows(
          `SELECT stage, outcome, sent_text FROM notify_task_attempts
           WHERE task_id='${taskId}'`,
        );
        const sent = rows.find(
          (a) => a.stage === "sent" && a.outcome === "delivered",
        );
        expect(sent).toBeTruthy();
        return String(sent!.sent_text);
      };

      expect(sentText(taskB!.id)).toContain(marker);
      expect(sentText(taskA!.id)).not.toContain(marker);
      expect(sentText(taskA!.id)).toContain(clientA.name);
    } finally {
      // 6. CLEANUP — restore the seed template FIRST (new tasks between
      //    the finally start and the canon reset would render the edit),
      //    then the created rows (terminal-state rule above).
      queryDB(
        `UPDATE notify_templates SET body='${originalBody}' WHERE id='${template!.id}'`,
      );
      if (recordB?.id) await cleanupRecord(request, recordB.id);
      if (recordA?.id) await cleanupRecord(request, recordA.id);
      await cleanup(request, `/api/v1/clients/${clientB.id}`);
      await cleanup(request, `/api/v1/clients/${clientA.id}`);
    }
  });
});
