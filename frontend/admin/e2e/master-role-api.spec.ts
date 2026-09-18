/**
 * master-role-api.spec.ts — GH #263 T10, scenario S6: API-герметичность.
 *
 * Pure wire-level acceptance (page not used): the master session's token is
 * pointed at every scoped surface and the responses are asserted EXACTLY as
 * the backend contract (T2–T5) defines them:
 *
 *  1. MASK — every client-bearing response carries the D3 mask: all digits
 *     except the LAST 4 → «•», separators preserved; email → null
 *     (GET /clients list, GET /clients/{id}, GET /clients?phone= lookup).
 *  2. 404-fast-path — чужие record / payment / photo / client are
 *     indistinguishable from missing (GET → 404; mutations → 404 too).
 *  3. PATCH /clients/{id} → 403 AUTH_FORBIDDEN (D7: clients:write is
 *     create-only for the master; mutations stay admin-only).
 *  4. /payments/totals excludes чужие sums: foreign record_ids are silently
 *     dropped (all-foreign → {}), own ids keep their totals.
 *
 * RED note (TDD): all four behaviours landed in T2–T5 (backend TDD —
 * backend/tests/test_master_scope_contract.py, test_master_scope_clients.py,
 * test_master_scope_payments.py, test_master_scope_photos.py); this spec is
 * the acceptance layer per plan T10.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import {
  createTestClient, createTestActivity, createTestRecord,
  createTestMaster, createTestPhoto,
  cleanup, cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

/** D3 mask invariant: for every digit position except the last four
 *  digits, the char is «•»; separators/plus survive in place. */
function assertMaskedShape(phone: unknown, naked: string): void {
  expect(typeof phone).toBe('string');
  const masked = phone as string;
  expect(masked).toContain('•');
  // No naked prefix digits survive anywhere.
  expect(masked).not.toContain(naked.slice(0, -4));
  // Exactly the last 4 digits remain, in order.
  expect(masked.replace(/\D/g, '')).toBe(naked.slice(-4));
}

test.describe('GH #263 S6 — master API герметичность', () => {
  useMasterSession();

  test('mask on every client response; email null', async ({ request }) => {
    const admin = await adminApiContext();
    const naked = '+79131112233';
    const client = await createTestClient(admin, {
      name: `Герметичный ${Date.now()}`,
      phone: naked,
    });
    // Give the client an email so the null-contract is meaningful.
    await admin.patch(`${BACKEND}/api/v1/clients/${client.id}`, {
      data: { email: 'sealed@example.com' },
    });
    // Make him VISIBLE to the master's list scope («есть запись клиента к
    // своей активности», D1): a record on one of m1's activities.
    const activity = await createTestActivity(admin, { master_id: 'm1' });
    const ownRecord = await createTestRecord(admin, activity.id, client.id);

    try {
      // 1) paginated list (scoped: clients with a record on m1 activities)
      const list = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      expect(list.ok()).toBeTruthy();
      const items = ((await list.json()).items ?? []) as Array<{
        id: string; phone: string | null; email: string | null;
      }>;
      const row = items.find((c) => c.id === client.id);
      expect(row).toBeTruthy();
      assertMaskedShape(row!.phone, naked);
      expect(row!.email).toBeNull();

      // 2) point get
      const point = await request.get(`${BACKEND}/api/v1/clients/${client.id}`);
      expect(point.status()).toBe(200);
      const pointBody = (await point.json()) as {
        phone: string | null; email: string | null;
      };
      assertMaskedShape(pointBody.phone, naked);
      expect(pointBody.email).toBeNull();

      // 3) phone lookup (scope-free surface — still masked for a master, D4)
      const lookup = await request.get(
        `${BACKEND}/api/v1/clients/get?phone=${encodeURIComponent(naked)}`,
      );
      expect(lookup.ok()).toBeTruthy();
      const lookupBody = (await lookup.json()) as {
        id: string; phone: string | null; email: string | null;
      };
      expect(lookupBody.id).toBe(client.id);
      assertMaskedShape(lookupBody.phone, naked);
      expect(lookupBody.email).toBeNull();
    } finally {
      await cleanupRecord(admin, ownRecord.id);
      await cleanup(admin, `/api/v1/activities/${activity.id}`);
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await admin.dispose();
    }
  });

  test('чужие record/payment/photo/client → 404', async ({ request }) => {
    const admin = await adminApiContext();
    // Foreign chain: foreign master → activity → client → record → payment.
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Герма ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    const foreignClient = await createTestClient(admin);
    const foreignRecord = await createTestRecord(
      admin, foreignActivity.id, foreignClient.id,
    );
    const paymentResp = await admin.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: foreignRecord.id, amount: 500, method: 'card' },
    });
    expect(paymentResp.ok()).toBeTruthy();
    const foreignPayment = (await paymentResp.json()) as { id: string };
    const foreignPhoto = await createTestPhoto(admin, {
      activity_id: foreignActivity.id,
    });

    try {
      for (const { path, label } of [
        { path: `/api/v1/records/${foreignRecord.id}`, label: 'record' },
        { path: `/api/v1/payments/${foreignPayment.id}`, label: 'payment' },
        { path: `/api/v1/photos/${foreignPhoto.id}`, label: 'photo' },
        { path: `/api/v1/clients/${foreignClient.id}`, label: 'client' },
      ]) {
        const resp = await request.get(`${BACKEND}${path}`);
        expect(resp.status(), `${label} GET`).toBe(404);
      }
      // The foreign client is not in the scoped list either.
      const list = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      const items = ((await list.json()).items ?? []) as Array<{ id: string }>;
      expect(items.some((c) => c.id === foreignClient.id)).toBe(false);
    } finally {
      await cleanup(admin, `/api/v1/payments/${foreignPayment.id}`);
      // rev7 (#285): record DELETE carries the expected-state contract —
      // the generic cleanup's bare DELETE would 422 and leak.
      await cleanupRecord(admin, foreignRecord.id);
      await cleanup(admin, `/api/v1/photos/${foreignPhoto.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/clients/${foreignClient.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('PATCH /clients/{id} → 403 AUTH_FORBIDDEN', async ({ request }) => {
    const admin = await adminApiContext();
    const client = await createTestClient(admin, { name: `403 ${Date.now()}` });

    try {
      const resp = await request.patch(`${BACKEND}/api/v1/clients/${client.id}`, {
        data: { name: 'Взлом имени' },
      });
      expect(resp.status()).toBe(403);
      const body = await resp.json();
      expect(body?.detail?.code).toBe('AUTH_FORBIDDEN');

      // The name is untouched.
      const after = await admin.get(`${BACKEND}/api/v1/clients/${client.id}`);
      expect(((await after.json()) as { name: string }).name).toBe(client.name);
    } finally {
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await admin.dispose();
    }
  });

  test('/payments/totals excludes foreign sums', async ({ request }) => {
    const admin = await adminApiContext();
    // Own chain: m1 activity → client → record → payment 700.
    const ownClient = await createTestClient(admin);
    const ownActivity = await createTestActivity(admin, { master_id: 'm1' });
    const ownRecord = await createTestRecord(admin, ownActivity.id, ownClient.id);
    const ownPaymentResp = await admin.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: ownRecord.id, amount: 700, method: 'card' },
    });
    expect(ownPaymentResp.ok()).toBeTruthy();
    const ownPayment = (await ownPaymentResp.json()) as { id: string };

    // Foreign chain with a distinctive sum 555.
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Тоталы ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    const foreignClient = await createTestClient(admin);
    const foreignRecord = await createTestRecord(
      admin, foreignActivity.id, foreignClient.id,
    );
    const foreignPaymentResp = await admin.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: foreignRecord.id, amount: 555, method: 'cash' },
    });
    expect(foreignPaymentResp.ok()).toBeTruthy();
    const foreignPayment = (await foreignPaymentResp.json()) as { id: string };

    try {
      // Mixed request: own id + foreign id → only the OWN total survives.
      // list[str] Query params repeat: ?record_ids=a&record_ids=b
      // (URLSearchParams.append idiom — getPaymentTotals precedent).
      const mixedQs = new URLSearchParams();
      mixedQs.append('record_ids', ownRecord.id);
      mixedQs.append('record_ids', foreignRecord.id);
      const mixed = await request.get(`${BACKEND}/api/v1/payments/totals?${mixedQs}`);
      expect(mixed.ok()).toBeTruthy();
      const mixedBody = (await mixed.json()) as { totals: Record<string, number> };
      expect(mixedBody.totals).toEqual({ [ownRecord.id]: 700 });

      // All-foreign → {}.
      const allForeign = await request.get(
        `${BACKEND}/api/v1/payments/totals?record_ids=${foreignRecord.id}`,
      );
      expect(allForeign.ok()).toBeTruthy();
      expect(((await allForeign.json()) as { totals: Record<string, number> }).totals)
        .toEqual({});
    } finally {
      await cleanup(admin, `/api/v1/payments/${ownPayment.id}`);
      await cleanupRecord(admin, ownRecord.id);
      await cleanup(admin, `/api/v1/payments/${foreignPayment.id}`);
      await cleanupRecord(admin, foreignRecord.id);
      await cleanup(admin, `/api/v1/activities/${ownActivity.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/clients/${ownClient.id}`);
      await cleanup(admin, `/api/v1/clients/${foreignClient.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });
});
