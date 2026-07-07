import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  patchRecord: vi.fn(),
  deleteRecord: vi.fn(),
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

import {
  patchRecord,
  deleteRecord,
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
import type { RecordResponse, PaymentResponse } from '@memo/api-client';

const mockPatchRecord = vi.mocked(patchRecord);
const mockDeleteRecord = vi.mocked(deleteRecord);
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
  is_active: true,
  visits: [],
};

const mockVisitorResponse = {
  id: 'vis-new',
  client_id: 'c1',
  name: 'Новый гость',
  age: null,
  created_at: '',
  updated_at: '',
  is_active: true,
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

describe('useRecordMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchRecord.mockResolvedValue(mockRecordResponse as never);
    mockDeleteRecord.mockResolvedValue(undefined as never);
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

    it('invalidates record and records queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.saveRecord({ visits: [] });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  describe('deleteRecord', () => {
    it('calls deleteRecord API with the record id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteRecord();
      });

      expect(mockDeleteRecord).toHaveBeenCalledWith(recordId);
    });

    it('invalidates record and records queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteRecord();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

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

    it('invalidates queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitor('vis1', [{ visitor_id: 'vis1', price: 3500 }]);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
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

    it('invalidates queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'cash');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
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

    it('invalidates record query on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({ client_id: 'c1', name: 'Гость', price: 1000 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
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

    it('invalidates record query on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchVisit('visit-1', { price: 4000 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
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

    it('invalidates record query on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisit('visit-1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
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

    it('invalidates record and payments queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchPayment('pay1', { amount: 4000 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
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

    it('invalidates queries on success', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  // ─── Optimistic setQueryData tests (Bug C) ──────────────────────────────

  describe('optimistic cache updates (setQueryData)', () => {
    it('addVisit updates [record, recordId] cache with the new visit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addVisit({
          client_id: 'c1',
          name: 'Test',
          tariff_id: 't1',
          price: 3500,
        });
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
    });

    it('addVisit invalidates [visitors, clientId] (regression fix)', async () => {
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

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
    });

    it('deleteVisit optimistically removes visit from [record, recordId] cache', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisit('visit-1');
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
    });

    it('patchVisit updates [record, recordId] cache with patched visit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchVisit('visit-1', { price: 4000 });
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
    });

    it('addPayment updates [payments, recordId] cache with the new payment', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addPayment(3500, 'card');
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['payments', recordId],
        expect.any(Function),
      );
    });

    it('deletePayment optimistically removes payment from [payments, recordId] cache', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePayment('pay1');
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['payments', recordId],
        expect.any(Function),
      );
    });

    it('patchPayment updates [payments, recordId] cache with patched payment', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchPayment('pay1', { amount: 4000 });
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['payments', recordId],
        expect.any(Function),
      );
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

    it('deleteVisitDeferred removes row + shows toast, no DELETE sent', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing', mockShowToast);
      });

      // Row removed from cache (setQueryData called to filter it out)
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['record', recordId],
        expect.any(Function),
      );
      // DELETE NOT sent yet
      expect(mockDeleteVisit).not.toHaveBeenCalled();
      // Toast shown with undo callback
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Удалено'),
        expect.any(Function),
      );
    });

    it('deleteVisitDeferred fires DELETE after 5s if not undone', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing', mockShowToast);
      });

      // DELETE not sent yet
      expect(mockDeleteVisit).not.toHaveBeenCalled();

      // Fast-forward 5s
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockDeleteVisit).toHaveBeenCalledTimes(1);
      expect(mockDeleteVisit).toHaveBeenCalledWith('visit-existing');
    });

    it('undo cancels the deferred DELETE and restores the row', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedRecordWithVisit(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing', mockShowToast);
      });

      // Grab the undo function from the toast call
      const undoFn = mockShowToast.mock.calls[0][1] as () => void;

      // Call undo
      await act(async () => {
        undoFn();
      });

      // Fast-forward 5s — DELETE should NOT fire
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockDeleteVisit).not.toHaveBeenCalled();

      // Row restored in cache — verify by reading cache
      const cached = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(cached?.visits).toHaveLength(1);
      expect(cached?.visits[0].id).toBe('visit-existing');
    });

    it('deletePaymentDeferred removes row + shows toast, no DELETE sent', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing', mockShowToast);
      });

      // DELETE NOT sent yet
      expect(mockDeletePayment).not.toHaveBeenCalled();
      // Toast shown with undo callback
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Удалено'),
        expect.any(Function),
      );
      // Payment removed from cache
      const cached = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(cached).toHaveLength(0);
    });

    it('deletePaymentDeferred fires DELETE after 5s if not undone', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing', mockShowToast);
      });

      expect(mockDeletePayment).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockDeletePayment).toHaveBeenCalledTimes(1);
      expect(mockDeletePayment).toHaveBeenCalledWith('pay-existing');
    });

    it('undo restores payment and cancels deferred DELETE', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedPaymentsCache(queryClient);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      const mockShowToast = vi.fn();

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing', mockShowToast);
      });

      const undoFn = mockShowToast.mock.calls[0][1] as () => void;

      await act(async () => {
        undoFn();
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockDeletePayment).not.toHaveBeenCalled();

      // Payment restored in cache
      const cached = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(cached).toHaveLength(1);
      expect(cached![0].id).toBe('pay-existing');
    });
  });
});
