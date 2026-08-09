/**
 * Tests for recordCacheSync — pure helpers that patch record/visit/payment
 * caches consistently across canonical + list keys.
 *
 * Uses a real QueryClient (no mocks) to verify the actual cache-key topology:
 *   - ['record', id]               — canonical
 *   - ['records', ...params]        — main list (envelope {items,total,page,per_page})
 *   - ['records', 'client', id]     — per-client list (plain array)
 *   - ['payments', recordId]        — per-record payments
 *   - ['payments']                  — global payments list
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  RecordResponse,
  VisitResponse,
  PaymentResponse,
} from '@memo/api-client';

import {
  patchRecordEverywhere,
  upsertVisit,
  removeVisit,
  upsertPayment,
  removePayment,
  seedRecordFromList,
} from '../lib/cache/recordCacheSync';

const recordId = 'r1';
const otherRecordId = 'r2';
const visitId = 'v1';
const otherVisitId = 'v2';
const paymentId = 'p1';
const otherPaymentId = 'p2';

function makeVisit(id: string, overrides: Partial<VisitResponse> = {}): VisitResponse {
  return {
    id,
    record_id: recordId,
    visitor_id: null,
    tariff_id: 't1',
    price: 3500,
    custom_price: null,
    status: 'waiting',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makePayment(
  id: string,
  overrides: Partial<PaymentResponse> = {},
): PaymentResponse {
  return {
    id,
    record_id: recordId,
    amount: 3500,
    method: 'card',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeRecord(
  id: string,
  overrides: Partial<RecordResponse> = {},
): RecordResponse {
  return {
    id,
    activity_id: 'ev_1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    anonym_visits: 0,
    comment: null,
    custom_price: null,
    created_at: '2026-05-10T10:00:00',
    updated_at: '2026-05-10T10:00:00',
    visits: [makeVisit(visitId)],
    ...overrides,
  };
}

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

describe('patchRecordEverywhere', () => {
  it('patches canonical key AND every list key containing this record', () => {
    // Seed: canonical + envelope main list + per-client list (plain array)
    qc.setQueryData(['record', recordId], makeRecord(recordId));
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [makeRecord(recordId), makeRecord(otherRecordId)],
      total: 2,
      page: 1,
      per_page: 10,
    });
    qc.setQueryData(
      ['records', 'client', 'c1'],
      [makeRecord(recordId)],
    );

    patchRecordEverywhere(qc, recordId, (r) => ({
      ...r,
      status: 'cancelled',
    }));

    // Canonical
    expect(qc.getQueryData<RecordResponse>(['record', recordId])?.status).toBe(
      'cancelled',
    );
    // Main list (envelope) — the matching record is patched, other stays
    const dateList = qc.getQueryData<PaginatedResponse<RecordResponse>>([
      'records',
      '2026-01-01',
      '2026-01-31',
    ]);
    expect(dateList?.items.find((r) => r.id === recordId)?.status).toBe(
      'cancelled',
    );
    expect(dateList?.items.find((r) => r.id === otherRecordId)?.status).toBe(
      'confirmed',
    );
    // Per-client list
    expect(
      qc.getQueryData<RecordResponse[]>(['records', 'client', 'c1'])?.[0]?.status,
    ).toBe('cancelled');
  });

  it('patches envelope caches, preserving page metadata', () => {
    qc.setQueryData(['record', recordId], makeRecord(recordId));
    qc.setQueryData(['records', 1, 10], {
      items: [makeRecord(recordId), makeRecord(otherRecordId)],
      total: 2,
      page: 1,
      per_page: 10,
    });

    patchRecordEverywhere(qc, recordId, (r) => ({ ...r, comment: 'patched' }));

    const after = qc.getQueryData<PaginatedResponse<RecordResponse>>([
      'records',
      1,
      10,
    ]);
    expect(after?.items.find((r) => r.id === recordId)?.comment).toBe(
      'patched',
    );
    expect(after?.total).toBe(2);
    expect(after?.page).toBe(1);
  });

  it('is a no-op when canonical cache is missing (null guard)', () => {
    // No canonical entry seeded; lists seeded only
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [makeRecord(recordId)],
      total: 1,
      page: 1,
      per_page: 10,
    });

    let calledWith = 0;
    patchRecordEverywhere(qc, recordId, (r) => {
      calledWith += 1;
      return { ...r, status: 'cancelled' };
    });

    // Updater must not be invoked for missing canonical
    expect(calledWith).toBe(0);
    // List cache must remain untouched
    expect(
      qc.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-01-01',
        '2026-01-31',
      ])?.items[0]?.status,
    ).toBe('confirmed');
  });
});

describe('upsertVisit', () => {
  it('adds a new visit to canonical AND every list cache', () => {
    const listRecord = makeRecord(recordId, { visits: [] });
    qc.setQueryData(['record', recordId], listRecord);
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [listRecord],
      total: 1,
      page: 1,
      per_page: 10,
    });
    qc.setQueryData(['records', 'client', 'c1'], [listRecord]);

    const newVisit = makeVisit('v-new');
    upsertVisit(qc, recordId, newVisit);

    // Canonical
    const canonical = qc.getQueryData<RecordResponse>(['record', recordId]);
    expect(canonical?.visits).toHaveLength(1);
    expect(canonical?.visits[0].id).toBe('v-new');

    // Main list (envelope)
    const dateList = qc.getQueryData<PaginatedResponse<RecordResponse>>([
      'records',
      '2026-01-01',
      '2026-01-31',
    ]);
    expect(dateList?.items[0].visits[0].id).toBe('v-new');

    // Per-client list
    const clientList = qc.getQueryData<RecordResponse[]>([
      'records',
      'client',
      'c1',
    ]);
    expect(clientList?.[0].visits[0].id).toBe('v-new');
  });

  it('replaces an existing visit by id (no duplicate)', () => {
    qc.setQueryData(['record', recordId], makeRecord(recordId));
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [makeRecord(recordId)],
      total: 1,
      page: 1,
      per_page: 10,
    });

    const updated = makeVisit(visitId, { status: 'visited', price: 9999 });
    upsertVisit(qc, recordId, updated);

    const canonical = qc.getQueryData<RecordResponse>(['record', recordId]);
    expect(canonical?.visits).toHaveLength(1);
    expect(canonical?.visits[0].status).toBe('visited');
    expect(canonical?.visits[0].price).toBe(9999);

    const dateList = qc.getQueryData<PaginatedResponse<RecordResponse>>([
      'records',
      '2026-01-01',
      '2026-01-31',
    ]);
    expect(dateList?.items[0].visits).toHaveLength(1);
    expect(dateList?.items[0].visits[0].status).toBe('visited');
  });
});

describe('removeVisit', () => {
  it('removes the visit from canonical AND list caches', () => {
    qc.setQueryData(['record', recordId], makeRecord(recordId));
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [makeRecord(recordId)],
      total: 1,
      page: 1,
      per_page: 10,
    });
    qc.setQueryData(['records', 'client', 'c1'], [makeRecord(recordId)]);

    removeVisit(qc, recordId, visitId);

    expect(qc.getQueryData<RecordResponse>(['record', recordId])?.visits).toEqual(
      [],
    );
    expect(
      qc.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-01-01',
        '2026-01-31',
      ])?.items[0].visits,
    ).toEqual([]);
    expect(
      qc.getQueryData<RecordResponse[]>(['records', 'client', 'c1'])?.[0].visits,
    ).toEqual([]);
  });

  it('is a no-op when canonical is missing (null guard)', () => {
    qc.setQueryData(['records', '2026-01-01', '2026-01-31'], {
      items: [makeRecord(recordId)],
      total: 1,
      page: 1,
      per_page: 10,
    });

    removeVisit(qc, recordId, visitId);

    // List is untouched because canonical was absent
    expect(
      qc.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-01-01',
        '2026-01-31',
      ])?.items[0].visits,
    ).toHaveLength(1);
  });
});

describe('upsertPayment', () => {
  it('writes BOTH per-record key AND global payments list', () => {
    const perRecordList = [makePayment(otherPaymentId, { id: 'px' })] as Array<
      PaymentResponse & { id: string }
    >;
    // seed per-record key with one unrelated payment
    qc.setQueryData(['payments', recordId], [
      makePayment(otherPaymentId, { id: 'px' }),
    ]);
    // seed global list with one unrelated payment
    qc.setQueryData<PaymentResponse[]>(['payments'], [
      makePayment(otherPaymentId, { id: 'px', record_id: otherRecordId }),
    ]);

    const newPay = makePayment(paymentId);
    upsertPayment(qc, recordId, newPay);

    // Per-record key — new payment added
    const perRecord = qc.getQueryData<PaymentResponse[]>(['payments', recordId]);
    expect(perRecord).toHaveLength(2);
    expect(perRecord?.find((p) => p.id === paymentId)).toEqual(newPay);

    // Global list — new payment added (other preserved)
    const global = qc.getQueryData<PaymentResponse[]>(['payments']);
    expect(global?.find((p) => p.id === paymentId)).toEqual(newPay);
  });

  it('replaces an existing payment by id', () => {
    const existing = makePayment(paymentId, { amount: 100 });
    qc.setQueryData(['payments', recordId], [existing]);
    qc.setQueryData<PaymentResponse[]>(['payments'], [
      { ...existing, record_id: otherRecordId },
    ]);

    const updated = makePayment(paymentId, { amount: 5000 });
    upsertPayment(qc, recordId, updated);

    const perRecord = qc.getQueryData<PaymentResponse[]>(['payments', recordId]);
    expect(perRecord).toHaveLength(1);
    expect(perRecord?.[0].amount).toBe(5000);

    const global = qc.getQueryData<PaymentResponse[]>(['payments']);
    expect(global?.[0].amount).toBe(5000);
  });
});

describe('removePayment', () => {
  it('removes the payment from per-record key AND global list', () => {
    const pay = makePayment(paymentId);
    qc.setQueryData(['payments', recordId], [pay, makePayment('p-keep')]);
    qc.setQueryData<PaymentResponse[]>(['payments'], [
      { ...pay, record_id: recordId },
      makePayment('p-keep', { record_id: otherRecordId }),
    ]);

    removePayment(qc, recordId, paymentId);

    const perRecord = qc.getQueryData<PaymentResponse[]>(['payments', recordId]);
    expect(perRecord?.map((p) => p.id)).toEqual(['p-keep']);

    const global = qc.getQueryData<PaymentResponse[]>(['payments']);
    expect(global?.map((p) => p.id)).toEqual(['p-keep']);
  });
});

describe('seedRecordFromList', () => {
  it('seeds canonical key when absent', () => {
    const rec = makeRecord(recordId);
    expect(qc.getQueryData(['record', recordId])).toBeUndefined();

    seedRecordFromList(qc, rec);

    expect(qc.getQueryData<RecordResponse>(['record', recordId])).toEqual(rec);
  });

  it('is a no-op when canonical key already has data (fresher data wins)', () => {
    const existing = makeRecord(recordId, { status: 'visited' });
    qc.setQueryData(['record', recordId], existing);

    const fromList = makeRecord(recordId, { status: 'cancelled' });
    seedRecordFromList(qc, fromList);

    // Existing canonical is preserved
    expect(qc.getQueryData<RecordResponse>(['record', recordId])?.status).toBe(
      'visited',
    );
  });
});
