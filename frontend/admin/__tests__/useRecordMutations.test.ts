import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createRecord: vi.fn(),
  createClient: vi.fn(),
  getClientByPhone: vi.fn(),
  getRecord: vi.fn(),
  updateVisitStatus: vi.fn(),
  patchRecord: vi.fn(),
  patchActivity: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  createVisitor: vi.fn(),
  deleteVisitor: vi.fn(),
  createVisit: vi.fn(),
  patchVisit: vi.fn(),
  deleteVisit: vi.fn(),
}));

// Mock the PendingActions provider so the hook's usePendingActions() call is controlled by tests.
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

import {
  createRecord,
  createClient,
  getClientByPhone,
  patchRecord,
  patchActivity,
  createPayment,
  patchPayment,
  deletePayment,
  createVisitor,
  deleteVisitor,
  createVisit,
  patchVisit,
  deleteVisit,
} from '@memo/api-client';
import { useRecordMutations } from '../hooks/useRecordMutations';
import type { PaginatedResponse, RecordResponse, PaymentResponse } from '@memo/api-client';

const mockCreateRecord = vi.mocked(createRecord);
const mockCreateClient = vi.mocked(createClient);
const mockGetClientByPhone = vi.mocked(getClientByPhone);
const mockPatchRecord = vi.mocked(patchRecord);
const mockPatchActivity = vi.mocked(patchActivity);
const mockCreatePayment = vi.mocked(createPayment);
const mockPatchPayment = vi.mocked(patchPayment);
const mockDeletePayment = vi.mocked(deletePayment);
const mockCreateVisitor = vi.mocked(createVisitor);
const mockDeleteVisitor = vi.mocked(deleteVisitor);
const mockCreateVisit = vi.mocked(createVisit);
const mockPatchVisit = vi.mocked(patchVisit);
const mockDeleteVisit = vi.mocked(deleteVisit);

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

const activityId = 'a1';
const recordId = 'r1';

const mockRecordResponse = {
  id: recordId,
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '',
  updated_at: '',
  visits: [],
};

const mockVisitorResponse = {
  id: 'vis-new',
  client_id: 'c1',
  name: 'Новый гость',
  age: null,
  created_at: '',
  updated_at: '',
};

const mockPaymentResponse = {
  id: 'pay1',
  record_id: recordId,
  amount: 3500,
  method: 'card',
  created_at: '',
  updated_at: '',
};

const mockVisitResponse = {
  id: 'visit-new',
  record_id: recordId,
  visitor_id: 'vis-new',
  tariff_id: 't1',
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
};

const mockClientResponse = {
  id: 'c-new',
  name: 'Новый клиент',
  phone: '+79990001122',
  channel: 'whatsapp',
  comment: null,
  created_at: '',
  updated_at: '',
};

const baseCreateRecordInput = {
  kind: 'unpicked' as const,
  phone: '+79990001122',
  name: 'Новый клиент',
  notify: false,
  channel: 'whatsapp',
  seats: 0,
  visitors: [],
  client_id: null,
};

const serviceTariffs = [{ id: 't1', price: 3500 }];

describe('useRecordMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueuePendingAction.mockReset();
    mockCreateRecord.mockResolvedValue(mockRecordResponse as never);
    mockCreateClient.mockResolvedValue(mockClientResponse as never);
    mockPatchRecord.mockResolvedValue(mockRecordResponse as never);
    mockPatchActivity.mockResolvedValue({ id: 'ev_1' } as never);
    mockCreatePayment.mockResolvedValue(mockPaymentResponse as never);
    mockPatchPayment.mockResolvedValue(mockPaymentResponse as never);
    mockDeletePayment.mockResolvedValue(undefined as never);
    mockCreateVisitor.mockResolvedValue(mockVisitorResponse as never);
    mockDeleteVisitor.mockResolvedValue(undefined as never);
    mockCreateVisit.mockResolvedValue(mockVisitResponse as never);
    mockPatchVisit.mockResolvedValue(mockVisitResponse as never);
    mockDeleteVisit.mockResolvedValue(undefined as never);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('createRecord — clients-list staleness (#140)', () => {
    it('invalidates [clients] when a NEW client is created via the phone-collision/409 catch branch', async () => {
      // getClientByPhone rejects (phone collision / 409) → falls into catch → createClient
      mockGetClientByPhone.mockRejectedValue(new Error('409 conflict') as never);

      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(baseCreateRecordInput, serviceTariffs);
      });

      expect(mockCreateClient).toHaveBeenCalled();
      // Bug fix: the freshly created client must become visible in /clients
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('invalidates [clients] when a NEW client is created via the phone-less quick-add else branch', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          { ...baseCreateRecordInput, phone: '' },
          serviceTariffs,
        );
      });

      expect(mockGetClientByPhone).not.toHaveBeenCalled();
      expect(mockCreateClient).toHaveBeenCalledWith({
        name: 'Новый клиент',
        phone: '',
        channel: 'whatsapp',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('does NOT invalidate [clients] when an EXISTING client is reused via getClientByPhone', async () => {
      // Existing-client path: lookup succeeds → createClient never runs → no new client
      mockGetClientByPhone.mockResolvedValue({ ...mockClientResponse, id: 'c-existing' } as never);

      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(baseCreateRecordInput, serviceTariffs);
      });

      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });
  });

  // ─── GH #221 Task 6: picked-client path (bind by id, skip resolve-or-create) ───

  describe('createRecord — picked client (GH #221)', () => {
    const pickedInput = {
      kind: 'picked' as const,
      client_id: 'c-picked',
      notify: false,
      channel: 'whatsapp',
      seats: 0,
      visitors: [],
    };

    it('creates the record bound to client_id and never calls getClientByPhone/createClient', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(pickedInput, serviceTariffs);
      });

      // The picked id is used for the record AND for its visitors.
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-picked' }),
      );
      // The exact-route lookup and resolve-or-create are skipped entirely.
      expect(mockGetClientByPhone).not.toHaveBeenCalled();
      expect(mockCreateClient).not.toHaveBeenCalled();
      // No new client created → no [clients] invalidation.
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('binds picked-client visitors to the picked client id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          {
            ...pickedInput,
            visitors: [{ name: 'Гость', tariffId: 't1' }],
          },
          serviceTariffs,
        );
      });

      expect(mockCreateVisitor).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-picked', name: 'Гость' }),
      );
    });

    it('still resolves-or-creates when nothing is picked (unpicked path unchanged)', async () => {
      mockGetClientByPhone.mockResolvedValue({ ...mockClientResponse, id: 'c-existing' } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(baseCreateRecordInput, serviceTariffs);
      });

      expect(mockGetClientByPhone).toHaveBeenCalledWith('+79990001122');
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-existing' }),
      );
    });
  });

  describe('saveRecord', () => {
    it('calls patchRecord with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({
          customPrice: '5000',
          comment: 'Тестовый комментарий',
          visits: [{ visitor_id: 'vis1', price: 3500 }],
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith(recordId, {
        custom_price: 5000,
        comment: 'Тестовый комментарий',
        visits: [{ visitor_id: 'vis1', price: 3500 }],
      });
    });

    it('calls patchActivity when activity data is provided', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({
          activityId: 'ev_1',
          activityStart: '2026-06-10T14:00:00',
          activityServiceId: 's1',
          visits: [],
        });
      });

      expect(mockPatchActivity).toHaveBeenCalledWith('ev_1', {
        start: '2026-06-10T14:00:00',
        service_id: 's1',
      });
      expect(mockPatchRecord).toHaveBeenCalledWith(recordId, {
        custom_price: null,
        comment: null,
        visits: [],
      });
    });

    it('does not call patchActivity when activity data is missing', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({
          visits: [{ visitor_id: 'vis1', price: 3500 }],
        });
      });

      expect(mockPatchActivity).not.toHaveBeenCalled();
      expect(mockPatchRecord).toHaveBeenCalled();
    });

    it('trims empty customPrice to null', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({
          customPrice: '   ',
          visits: [],
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith(recordId, {
        custom_price: null,
        comment: null,
        visits: [],
      });
    });

    it('invalidates targeted record + records queries on success (no 5-key blanket)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({ visits: [] });
      });

      // Reader: ScheduleActivityCard (uses ['records',df,dt]) + RecordModal (uses ['record',id])
      // Not: ['activities'], ['clients'] (not changed)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // payments not invalidated by saveRecord (no payment changed)
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  // NOTE: the bound `deleteRecord` was removed (Addendum 13 / GH #139
  // T8-FE2a) — records deletion now flows through the shared unbound hook
  // hooks/useDeleteRecord.ts; its tests (API call, prefix-match cache
  // removal, targeted invalidations, dependency-tree parking) live in
  // __tests__/useDeleteRecord.test.ts.

  describe('addVisitor', () => {
    it('calls createVisitor with the provided data', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisitor({
          client_id: 'c1',
          name: 'Новый гость',
          age: 10,
        });
      });

      expect(mockCreateVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый гость',
        age: 10,
      });
    });

    it('returns the created visitor response', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.addVisitor({
          client_id: 'c1',
          name: 'Новый гость',
        });
      });

      expect(returned).toEqual(mockVisitorResponse);
    });
  });

  describe('deleteVisitor', () => {
    it('calls deleteVisitor API and patches record with remaining visits', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      const currentVisits = [
        { visitor_id: 'vis1', price: 3500 },
        { visitor_id: 'vis2', price: 2500 },
      ];

      await act(async () => {
        await result.current.deleteVisitor('vis1', currentVisits);
      });

      expect(mockDeleteVisitor).toHaveBeenCalledWith('vis1');
      expect(mockPatchRecord).toHaveBeenCalledWith(recordId, {
        visits: [{ visitor_id: 'vis2', price: 2500 }],
      });
    });

    it('invalidates record and records queries on success (no 5-key blanket)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitor('vis1', [{ visitor_id: 'vis1', price: 3500 }]);
      });

      // Reader: ScheduleActivityCard (['records',df,dt]) + RecordModal (['record',id])
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      // No blanket 5-key invalidation
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['activities'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  describe('addPayment', () => {
    it('calls createPayment with record id, amount and method', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'card');
      });

      expect(mockCreatePayment).toHaveBeenCalledWith({
        record_id: recordId,
        amount: 3500,
        method: 'card',
      });
    });

    it('invalidates record queries on success (no 5-key blanket; payments synced via helper)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'cash');
      });

      // Reader: RecordModal visit + visit cells use ['record',id] only.
      // The new payment is pushed to both ['payments', recordId] and ['payments'] via upsertPayment helper.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      // No blanket 5-key
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['activities'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('returns the created payment response', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.addPayment(3500, 'card');
      });

      expect(returned).toEqual(mockPaymentResponse);
    });

    it('invalidates [records] so RecordsTable paid badge refreshes (R4/US-4)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'card');
      });

      // Reader: RecordsTable reads `paid` from the view row — prefix ['records']
      // catches all pages/filters. Existing ['record', id] invalidation stays.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
    });

    it('writes the new payment into BOTH [payments, recordId] and global [payments] via helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      // Seed both caches with a sentinel payment so we can verify the new one is appended
      queryClient.setQueryData(['payments', recordId], [
        { ...mockPaymentResponse, id: 'pay-prev', amount: 100 },
      ]);
      queryClient.setQueryData(['payments'], [
        { ...mockPaymentResponse, id: 'pay-prev', amount: 100 },
      ]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'card');
      });

      // Per-record cache contains the new payment
      const perRecord = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(perRecord?.map((p) => p.id)).toEqual(['pay-prev', 'pay1']);
      // Global cache ALSO contains the new payment (canonical ['payments'] reader sees it)
      const global = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(global?.map((p) => p.id)).toEqual(['pay-prev', 'pay1']);
    });
  });

  describe('addVisit', () => {
    it('creates a visitor then a visit referencing it, and returns the visit', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.addVisit({
          client_id: 'c1',
          name: 'Новый гость',
          age: 10,
          tariff_id: 't1',
          price: 3500,
        });
      });

      expect(mockCreateVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый гость',
        age: 10,
      });
      expect(mockCreateVisit).toHaveBeenCalledWith({
        record_id: recordId,
        visitor_id: mockVisitorResponse.id,
        tariff_id: 't1',
        price: 3500,
      });
      expect(returned).toEqual(mockVisitResponse);
    });

    it('syncs new visit into canonical AND list caches via upsertVisit helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      // Seed both canonical and date-bounded list so the helper can mirror the new visit
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [],
      });
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [{ ...mockRecordResponse, visits: [] }],
        total: 1,
        page: 1,
        per_page: 10,
      });

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({ client_id: 'c1', name: 'Гость', tariff_id: 't1', price: 1000 });
      });

      // Canonical cache
      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits.map((v) => v.id)).toContain('visit-new');
      // List cache (envelope) — the helper's setQueriesData mirrored the same record
      const listCache = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      expect(listCache?.items[0]?.visits.map((v) => v.id)).toContain('visit-new');
    });

    // Regression for #127 §3: per-client list cache ['records', 'client', clientId]
    // was previously dead — helper's setQueriesData prefix must now also seed it.
    it('syncs new visit into per-client list cache [records, client, clientId]', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      // Seed canonical AND per-client list (this list is what ClientRecordTab reads
      // when a client is selected from the clients page).
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [],
      });
      queryClient.setQueryData(['records', 'client', 'c1'], [
        { ...mockRecordResponse, visits: [] },
      ]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({ client_id: 'c1', name: 'Гость', tariff_id: 't1', price: 1000 });
      });

      // Per-client list cache was updated by the helper's setQueriesData prefix match
      const clientList = queryClient.getQueryData<RecordResponse[]>([
        'records',
        'client',
        'c1',
      ]);
      expect(clientList?.[0]?.visits.map((v) => v.id)).toContain('visit-new');
    });

    it('invalidates [visitors, clientId] (regression fix) — no 5-key blanket', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({
          client_id: 'c1',
          name: 'Test',
          price: 3500,
        });
      });

      // Reader: ClientInfoTab visitors list uses ['visitors', clientId]
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
      // No blanket
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['activities'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  describe('patchVisit', () => {
    it('calls the patchVisit API and returns the updated visit', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.patchVisit('visit-1', { tariff_id: 't2', price: 4000 });
      });

      expect(mockPatchVisit).toHaveBeenCalledWith('visit-1', { tariff_id: 't2', price: 4000 });
      expect(returned).toEqual(mockVisitResponse);
    });

    it('syncs patched visit into canonical AND list caches via upsertVisit helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const existingVisit = {
        id: 'visit-1',
        record_id: recordId,
        visitor_id: 'vis-1',
        tariff_id: 't1',
        price: 3500,
        custom_price: null,
        status: 'waiting',
        created_at: '',
        updated_at: '',
      };
      const otherRecord = { ...mockRecordResponse, id: 'r2', visits: [] };
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [existingVisit],
      });
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [{ ...mockRecordResponse, visits: [existingVisit] }, otherRecord],
        total: 2,
        page: 1,
        per_page: 10,
      });
      // Server returns the patched visit shape (price: 4000).
      mockPatchVisit.mockResolvedValue({ ...existingVisit, price: 4000 } as never);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchVisit('visit-1', { price: 4000 });
      });

      // Canonical price updated
      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits[0].price).toBe(4000);
      // List-cache copy of the same record ALSO updated
      const listCache = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      expect(listCache?.items[0]?.visits[0].price).toBe(4000);
      // r2 untouched
      expect(listCache?.items[1]?.id).toBe('r2');
    });
  });

  describe('deleteVisit', () => {
    it('calls the deleteVisit API', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisit('visit-1');
      });

      expect(mockDeleteVisit).toHaveBeenCalledWith('visit-1');
    });

    it('optimistically removes visit from BOTH canonical and list caches via removeVisit helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const existingVisit = {
        id: 'visit-1',
        record_id: recordId,
        visitor_id: 'vis-1',
        tariff_id: 't1',
        price: 3500,
        custom_price: null,
        status: 'waiting',
        created_at: '',
        updated_at: '',
      };
      const otherRecord = { ...mockRecordResponse, id: 'r2', visits: [] };
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [existingVisit],
      });
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [{ ...mockRecordResponse, visits: [existingVisit] }, otherRecord],
        total: 2,
        page: 1,
        per_page: 10,
      });

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisit('visit-1');
      });

      // Canonical no longer has visit-1
      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits).toHaveLength(0);
      // List cache copy also no longer has visit-1
      const listCache = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      expect(listCache?.items[0]?.visits).toHaveLength(0);
      // r2 untouched
      expect(listCache?.items[1]?.id).toBe('r2');
    });
  });

  describe('patchPayment', () => {
    it('calls the patchPayment API and returns the updated payment', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.patchPayment('pay1', { amount: 4000 });
      });

      expect(mockPatchPayment).toHaveBeenCalledWith('pay1', { amount: 4000 });
      expect(returned).toEqual(mockPaymentResponse);
    });

    it('writes patched payment into BOTH [payments, recordId] AND global [payments] via helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const existing = { ...mockPaymentResponse, id: 'pay1', amount: 3500 };
      queryClient.setQueryData(['payments', recordId], [existing]);
      queryClient.setQueryData(['payments'], [existing]);
      // apiPatchPayment returns the new patched shape (uses mockPaymentResponse with amount 3500)
      mockPatchPayment.mockResolvedValue({ ...mockPaymentResponse, id: 'pay1', amount: 4000 } as never);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchPayment('pay1', { amount: 4000 });
      });

      const perRecord = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(perRecord?.[0].amount).toBe(4000);
      const global = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(global?.[0].amount).toBe(4000);
    });

    it('invalidates [records] so RecordsTable paid badge refreshes (R4/US-4)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchPayment('pay1', { amount: 4000 });
      });

      // Reader: RecordsTable reads `paid` from the view row — prefix ['records']
      // catches all pages/filters.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('deletePayment', () => {
    it('calls deletePayment API with the payment id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      expect(mockDeletePayment).toHaveBeenCalledWith('pay1');
    });

    it('removes payment from BOTH [payments, recordId] AND global [payments] via helper', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const existing = { ...mockPaymentResponse, id: 'pay1', amount: 3500 };
      const other = { ...mockPaymentResponse, id: 'pay-other', amount: 100 };
      queryClient.setQueryData(['payments', recordId], [existing, other]);
      queryClient.setQueryData(['payments'], [existing, other]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      const perRecord = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(perRecord?.map((p) => p.id)).toEqual(['pay-other']);
      const global = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(global?.map((p) => p.id)).toEqual(['pay-other']);
    });

    it('invalidates [records] so RecordsTable paid badge refreshes (R4/US-4)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      // Reader: RecordsTable reads `paid` from the view row — prefix ['records']
      // catches all pages/filters. Existing ['record', id] invalidation stays.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
    });
  });

  // ─── Optimistic cache update tests — helpers route through setQueryData + setQueriesData ─

  describe('optimistic cache updates (helpers route through setQueryData + setQueriesData)', () => {
    it('addVisit uses upsertVisit helper (canonical + list keys via setQueryData/setQueriesData)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const setQueriesDataSpy = vi.spyOn(queryClient, 'setQueriesData');
      // Seed canonical so the helper can patch
      queryClient.setQueryData(['record', recordId], { ...mockRecordResponse, visits: [] });
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({
          client_id: 'c1',
          name: 'Test',
          tariff_id: 't1',
          price: 3500,
        });
      });

      // Canonical key + list prefix via helpers
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
      expect(setQueriesDataSpy).toHaveBeenCalledWith(
        { queryKey: ['records'] },
        expect.any(Function),
      );
    });

    it('deleteVisit uses removeVisit helper (canonical + list keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const setQueriesDataSpy = vi.spyOn(queryClient, 'setQueriesData');
      const existingVisit = {
        id: 'visit-1',
        record_id: recordId,
        visitor_id: 'vis-1',
        tariff_id: 't1',
        price: 3500,
        custom_price: null,
        status: 'waiting',
        created_at: '',
        updated_at: '',
      };
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [existingVisit],
      });
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisit('visit-1');
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
      expect(setQueriesDataSpy).toHaveBeenCalledWith(
        { queryKey: ['records'] },
        expect.any(Function),
      );
    });

    it('patchVisit uses upsertVisit helper (canonical + list keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const setQueriesDataSpy = vi.spyOn(queryClient, 'setQueriesData');
      const existingVisit = {
        id: 'visit-1',
        record_id: recordId,
        visitor_id: 'vis-1',
        tariff_id: 't1',
        price: 3500,
        custom_price: null,
        status: 'waiting',
        created_at: '',
        updated_at: '',
      };
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [existingVisit],
      });
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchVisit('visit-1', { price: 4000 });
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
      expect(setQueriesDataSpy).toHaveBeenCalledWith(
        { queryKey: ['records'] },
        expect.any(Function),
      );
    });

    it('addPayment uses upsertPayment helper (per-record + global keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      queryClient.setQueryData(['payments', recordId], []);
      queryClient.setQueryData(['payments'], []);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'card');
      });

      // Per-record + global ['payments']
      const perRecordCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0][1] === recordId,
      );
      const globalCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0].length === 1,
      );
      expect(perRecordCall).toBeDefined();
      expect(globalCall).toBeDefined();
    });

    it('deletePayment uses removePayment helper (per-record + global keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      queryClient.setQueryData(['payments', recordId], [mockPaymentResponse]);
      queryClient.setQueryData(['payments'], [mockPaymentResponse]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      const perRecordCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0][1] === recordId,
      );
      const globalCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0].length === 1,
      );
      expect(perRecordCall).toBeDefined();
      expect(globalCall).toBeDefined();
    });

    it('patchPayment uses upsertPayment helper (per-record + global keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const existing = { ...mockPaymentResponse, amount: 3500 };
      queryClient.setQueryData(['payments', recordId], [existing]);
      queryClient.setQueryData(['payments'], [existing]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchPayment('pay1', { amount: 4000 });
      });

      const perRecordCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0][1] === recordId,
      );
      const globalCall = setQueryDataSpy.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0][0] === 'payments' && call[0].length === 1,
      );
      expect(perRecordCall).toBeDefined();
      expect(globalCall).toBeDefined();
    });
  });

  // ─── Deferred delete with undo (Bug E) ──────────────────────────────────

  describe('deferred delete with undo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const existingVisit = {
      id: 'visit-existing',
      record_id: recordId,
      visitor_id: 'vis-1',
      tariff_id: 't1',
      price: 3500,
      custom_price: null,
      status: 'waiting',
      created_at: '',
      updated_at: '',
    };

    const existingPayment = {
      id: 'pay-existing',
      record_id: recordId,
      amount: 2500,
      method: 'card' as const,
      created_at: '',
      updated_at: '',
    };

    function seedRecordWithVisit(queryClient: QueryClient) {
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [existingVisit],
      });
    }

    function seedPaymentsCache(queryClient: QueryClient) {
      queryClient.setQueryData(['payments', recordId], [existingPayment]);
    }

    it('deleteVisitDeferred removes row + enqueues pending action, no DELETE sent', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing');
      });

      // Row removed from cache optimistically (canonical via removeVisit helper)
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
      // DELETE NOT sent yet
      expect(mockDeleteVisit).not.toHaveBeenCalled();
      // enqueuePendingAction called with delete kind + 5s + Russian message + undo+commit
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        id: string;
        kind: string;
        message: string;
        delayMs: number;
        undo: () => void;
        commit: () => Promise<void>;
      };
      expect(action.kind).toBe('delete');
      expect(action.delayMs).toBe(5000);
      expect(action.message).toContain('Удалено');
      expect(action.message).toContain('Отменить');
      expect(typeof action.undo).toBe('function');
      expect(typeof action.commit).toBe('function');
    });

    it('deleteVisitDeferred fires DELETE after 5s via commit() (provider owns timer)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing');
      });

      // Commit function not called yet — provider schedules it
      expect(mockDeleteVisit).not.toHaveBeenCalled();

      // Simulate the provider firing commit after 5s
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        commit: () => Promise<void>;
      };
      await act(async () => {
        await action.commit();
      });

      expect(mockDeleteVisit).toHaveBeenCalledTimes(1);
      expect(mockDeleteVisit).toHaveBeenCalledWith('visit-existing');
    });

    it('undo restores the visit via upsertVisit helper and cancels the commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing');
      });

      // Grab the undo function
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        undo: () => void;
      };
      await act(async () => {
        action.undo();
      });

      // The provider would not call commit() if undo runs first; verify the undo
      // restored the canonical cache (the row is back).
      const cached = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(cached?.visits).toHaveLength(1);
      expect(cached?.visits[0].id).toBe('visit-existing');
    });

    it('deletePaymentDeferred removes row + enqueues pending action, no DELETE sent', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing');
      });

      // DELETE NOT sent yet
      expect(mockDeletePayment).not.toHaveBeenCalled();
      // enqueuePendingAction called
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        id: string;
        kind: string;
        delayMs: number;
        undo: () => void;
        commit: () => Promise<void>;
      };
      expect(action.kind).toBe('delete');
      expect(action.delayMs).toBe(5000);
      expect(typeof action.undo).toBe('function');
      expect(typeof action.commit).toBe('function');
      // Payment removed from per-record cache optimistically
      const cached = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(cached).toHaveLength(0);
    });

    it('deletePaymentDeferred fires DELETE after 5s via commit() and reconciles [payments]', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing');
      });

      expect(mockDeletePayment).not.toHaveBeenCalled();

      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        commit: () => Promise<void>;
      };
      await act(async () => {
        await action.commit();
      });

      expect(mockDeletePayment).toHaveBeenCalledTimes(1);
      expect(mockDeletePayment).toHaveBeenCalledWith('pay-existing');
      // After commit, [payments, recordId] is reconciled (row stays removed) and
      // global [payments] has pay-existing filtered out via removePayment helper.
      const perRecord = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(perRecord).toHaveLength(0);
      const global = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(global?.find((p) => p.id === 'pay-existing')).toBeUndefined();
    });

    it('deletePaymentDeferred invalidates [records] on COMMIT, not on defer (R4/US-4)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing');
      });

      // Defer phase: optimistic cache write only — no ['records'] invalidation yet
      // (the payment row is still undoable at this point).
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['records'] });

      // Simulate the provider firing commit after 5s
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        commit: () => Promise<void>;
      };
      await act(async () => {
        await action.commit();
      });

      // Commit path: ['records'] invalidated so RecordsTable paid badge refreshes
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('undo restores payment and cancels the commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing');
      });

      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        undo: () => void;
      };
      await act(async () => {
        action.undo();
      });

      // Payment restored in per-record cache
      const cached = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(cached).toHaveLength(1);
      expect(cached![0].id).toBe('pay-existing');
    });
  });
});
