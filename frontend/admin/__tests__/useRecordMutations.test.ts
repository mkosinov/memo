import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', () => ({
  createRecord: vi.fn(),
  createClient: vi.fn(),
  getClientByPhone: vi.fn(),
  getClientsPaged: vi.fn(),
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
  // Shape-compatible stand-in — the hook throws it client-side for the
  // String(20) compact guard; tests only read `.message`.
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
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
  getClientsPaged,
  getRecord,
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
  updateVisitStatus,
} from '@memo/api-client';
import { useRecordMutations } from '../hooks/useRecordMutations';
import type {
  PaginatedResponse,
  RecordResponse,
  PaymentResponse,
  VisitResponse,
} from '@memo/api-client';

const mockCreateRecord = vi.mocked(createRecord);
const mockCreateClient = vi.mocked(createClient);
const mockGetClientByPhone = vi.mocked(getClientByPhone);
const mockGetClientsPaged = vi.mocked(getClientsPaged);
const mockGetRecord = vi.mocked(getRecord);
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
const mockUpdateVisitStatus = vi.mocked(updateVisitStatus);

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

/** Minimal deferred — lets a test resolve a mocked API promise in chosen order (#359). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

/** Anonymous visit (#257): visitor_id = null, default tariff/price. */
const mockAnonymousVisitResponse = {
  id: 'visit-anon',
  record_id: recordId,
  visitor_id: null,
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
    // Default: no client matches the typed digits (unknown-number create path).
    mockGetClientsPaged.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 10,
    } as never);
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
    mockUpdateVisitStatus.mockResolvedValue(mockVisitResponse as never);
    mockGetRecord.mockResolvedValue(mockRecordResponse as never);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('createRecord — clients-list staleness (#140)', () => {
    it('invalidates [clients] when a NEW client is created via the unknown-number create branch', async () => {
      // No client matches the typed digits → falls into createClient
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

      expect(mockGetClientsPaged).not.toHaveBeenCalled();
      expect(mockCreateClient).toHaveBeenCalledWith({
        name: 'Новый клиент',
        phone: '',
        channel: 'whatsapp',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients'] });
    });

    it('does NOT invalidate [clients] when an EXISTING client is reused via the digits fetch', async () => {
      // Existing-client path: digits fetch finds a match → createClient never runs → no new client
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-existing', phone: '+79990001122' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);

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
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-existing', phone: '+79990001122' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(baseCreateRecordInput, serviceTariffs);
      });

      expect(mockGetClientsPaged).toHaveBeenCalledWith({ phone: '9990001122', per_page: 10 });
      expect(mockGetClientByPhone).not.toHaveBeenCalled();
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-existing' }),
      );
    });
  });

  // ─── GH #221 Task 7: save-time digits resolution (no duplicates, fail closed) ───

  // toNationalDigits reduction cases (spec §3) moved to
  // app/components/shared/phone/__tests__/format.test.ts (GH #414 Task 1 —
  // the function now lives in app/components/shared/phone/format.ts).

  describe('createRecord — unpicked save-time resolution (GH #221 Task 7 / #414 Task 5)', () => {
    /** Input exactly as PhoneInput lifts it since #414: the compact
     *  «+<код><нац. цифры>». The old #221 visible formatted string no
     *  longer reaches the hook — the entered side of the сверка is the
     *  compact, and the reduction compares it against the stored string. */
    const compactInput = {
      ...baseCreateRecordInput,
      phone: '+79991234567',
    };

    it('(a) binds the EXISTING client stored as a compact by digits equality; createClient NOT called', async () => {
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-existing', phone: '+79991234567' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      // Fresh full-digits fetch — never the suggestion snapshot, never the exact route.
      expect(mockGetClientsPaged).toHaveBeenCalledWith({ phone: '9991234567', per_page: 10 });
      expect(mockGetClientByPhone).not.toHaveBeenCalled();
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-existing' }),
      );
    });

    it('(a2) matches a client stored in the OLD «8 …» spelling (reduction parity)', async () => {
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-old-format', phone: '8 999 123-45-67' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-old-format' }),
      );
    });

    it('(a3) matches a client stored in the OLD spaced «+7 …» spelling', async () => {
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-spaced', phone: '+7 (999) 123-45-67' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-spaced' }),
      );
    });

    it('(b) BY compact «+375…» keeps its full digits — matches the stored compact', async () => {
      // Non-RU codes never lose digits: the 11-digit drop fires only on a
      // leading 7/8, so the BY reduction includes the country code.
      const byInput = { ...baseCreateRecordInput, phone: '+375291234567' };
      mockGetClientsPaged.mockResolvedValue({
        items: [{ ...mockClientResponse, id: 'c-by', phone: '+375 29 1234567' }],
        total: 1,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(byInput, serviceTariffs);
      });

      expect(mockGetClientsPaged).toHaveBeenCalledWith({ phone: '375291234567', per_page: 10 });
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-by' }),
      );
    });

    it('(c) garbage stored rows never match → createClient with the compact (мусор → создание)', async () => {
      mockGetClientsPaged.mockResolvedValue({
        items: [
          { ...mockClientResponse, id: 'c-garbage', phone: 'спам' },
          { ...mockClientResponse, id: 'c-short', phone: '12345' },
        ],
        total: 2,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      expect(mockCreateClient).toHaveBeenCalledWith({
        name: 'Новый клиент',
        phone: '+79991234567',
        channel: 'whatsapp',
      });
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-new' }),
      );
    });

    it('(d) unknown number → createClient called with the compact verbatim', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      // Storage contract (#414): a changed number is saved as the compact,
      // exactly as lifted — not the reduced digits, not a re-formatted view.
      expect(mockCreateClient).toHaveBeenCalledWith({
        name: 'Новый клиент',
        phone: '+79991234567',
        channel: 'whatsapp',
      });
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-new' }),
      );
    });

    it('(e) two clients sharing the reduction → the FIRST returned row binds', async () => {
      mockGetClientsPaged.mockResolvedValue({
        items: [
          { ...mockClientResponse, id: 'c-first', phone: '+79991234567' },
          { ...mockClientResponse, id: 'c-second', phone: '8 999 123-45-67' },
        ],
        total: 2,
        page: 1,
        per_page: 10,
      } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(compactInput, serviceTariffs);
      });

      // First-match parity with the old first-or-404 semantics.
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'c-first' }),
      );
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('(f) fetch failure propagates — mutation rejects, NO silent create (fail closed)', async () => {
      mockGetClientsPaged.mockRejectedValue(new Error('network down') as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.createRecord(compactInput, serviceTariffs);
        }),
      ).rejects.toThrow('network down');

      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).not.toHaveBeenCalled();
    });

    // ── Defensive String(20) guard (GH #414 §Форматирование, хранение) ──
    // A compact of a valid list-country number is ≤16 chars; anything past
    // the clients.phone column limit cannot be stored — block the save.

    it('blocks the save when the compact exceeds the String(20) limit — clear message, no API calls', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      // 21 chars — no valid list-country compact is ever this long.
      await expect(
        act(async () => {
          await result.current.createRecord(
            { ...baseCreateRecordInput, phone: '+79991234567012345678' },
            serviceTariffs,
          );
        }),
      ).rejects.toThrow('Слишком длинный номер телефона');

      expect(mockGetClientsPaged).not.toHaveBeenCalled();
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockCreateRecord).not.toHaveBeenCalled();
    });

    it('allows a compact of exactly 20 chars — the guard fires only PAST the limit', async () => {
      const phone20 = '+3752912345670123456'; // «+375» + 16 national digits
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          { ...baseCreateRecordInput, phone: phone20 },
          serviceTariffs,
        );
      });

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({ phone: phone20 }),
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

  describe('deleteVisitor — removed from the hook (#324 Task 8)', () => {
    it('is no longer exposed by the hook — callers use useDeleteVisitor (entity-level conveyor)', () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      expect(result.current).not.toHaveProperty('deleteVisitor');
    });

    it('the convertAnonymousVisit rollback still runs and carries the {expected:{}} body (bare DELETE → 422)', async () => {
      mockPatchVisit.mockRejectedValue(new Error('patch failed') as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
        }),
      ).rejects.toThrow('patch failed');

      // The orphan rollback target is visit-less (a leaf) — the family body
      // is the leaf-clean snapshot; without it the server answers 422.
      expect(mockDeleteVisitor).toHaveBeenCalledWith('vis-new', { expected: {} });
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

    it('syncs patched visit into canonical AND list caches via the projection helper (#359)', async () => {
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

  // ─── #359: per-visit edit counter + apply-guard (spec §Технические изменения п.2) ───
  // "Побеждает последний выпущенный запрос, а не последний прибывший ответ":
  // every issued request registers its seq + serialized field set BEFORE the
  // API call; a response may only project fields no LATER issued request
  // carries. Projection on success only — the error path is unchanged.

  describe('visit edit counter + response projection guard (#359)', () => {
    const seededVisit: VisitResponse = {
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

    /** Seed canonical + main-list caches with the record holding seededVisit. */
    function seedCanonicalWithVisit(queryClient: QueryClient) {
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [seededVisit],
      });
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [{ ...mockRecordResponse, visits: [seededVisit] }],
        total: 1,
        page: 1,
        per_page: 10,
      });
    }

    it('a same-field response overridden by a LATER issued request is not written', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCanonicalWithVisit(queryClient);
      const d1 = deferred<VisitResponse>();
      const d2 = deferred<VisitResponse>();
      mockPatchVisit
        .mockImplementationOnce(() => d1.promise)
        .mockImplementationOnce(() => d2.promise);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let first: Promise<unknown> = Promise.resolve();
      let second: Promise<unknown> = Promise.resolve();
      act(() => {
        first = result.current.patchVisit('visit-1', { price: 4000 });
        second = result.current.patchVisit('visit-1', { price: 5000 });
      });

      // Later request answers FIRST — its price lands.
      await act(async () => {
        d2.resolve({ ...seededVisit, price: 5000, updated_at: '2026-05-10T12:00:00' });
        await second;
      });
      expect(
        queryClient.getQueryData<RecordResponse>(['record', recordId])?.visits[0].price,
      ).toBe(5000);

      // Early request's response arrives LAST — its price must NOT regress.
      await act(async () => {
        d1.resolve({ ...seededVisit, price: 4000, updated_at: '2026-05-10T10:00:00' });
        await first;
      });
      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits[0].price).toBe(5000);
      // List mirror agrees — the stale response reached no copy.
      const listCache = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      expect(listCache?.items[0]?.visits[0].price).toBe(5000);
    });

    it('a late response of an early request for ANOTHER field still writes its own field', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCanonicalWithVisit(queryClient);
      const d1 = deferred<VisitResponse>();
      const d2 = deferred<VisitResponse>();
      mockPatchVisit
        .mockImplementationOnce(() => d1.promise)
        .mockImplementationOnce(() => d2.promise);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let first: Promise<unknown> = Promise.resolve();
      let second: Promise<unknown> = Promise.resolve();
      act(() => {
        first = result.current.patchVisit('visit-1', { tariff_id: 't2' }); // issued first
        second = result.current.patchVisit('visit-1', { price: 5000 }); // issued second
      });

      // price lands from the newer request.
      await act(async () => {
        d2.resolve({ ...seededVisit, price: 5000, updated_at: '2026-05-10T12:00:00' });
        await second;
      });
      // tariff answer arrives LAST, carrying a stale price column — its OWN
      // field must still be written, the foreign column must not.
      await act(async () => {
        d1.resolve({ ...seededVisit, tariff_id: 't2', updated_at: '2026-05-10T10:00:00' });
        await first;
      });

      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits[0].tariff_id).toBe('t2');
      expect(canonical?.visits[0].price).toBe(5000);
    });

    it('projects ONLY the body fields — other response columns do not clobber the cache', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCanonicalWithVisit(queryClient);
      mockPatchVisit.mockResolvedValue({
        ...seededVisit,
        price: 4000,
        custom_price: 500, // NOT in the body → must NOT be written
        status: 'visited', // NOT in the body → must NOT be written
        updated_at: '2026-05-10T12:00:00',
      } as never);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.patchVisit('visit-1', { price: 4000 });
      });

      const visit = queryClient.getQueryData<RecordResponse>(['record', recordId])?.visits[0];
      expect(visit?.price).toBe(4000);
      expect(visit?.custom_price).toBeNull();
      expect(visit?.status).toBe('waiting');
      expect(visit?.updated_at).toBe('2026-05-10T12:00:00'); // implicit, always applied
    });

    it('updateVisitStatus projects its status field and KEEPS the invalidation', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCanonicalWithVisit(queryClient);
      mockUpdateVisitStatus.mockResolvedValue({
        ...seededVisit,
        status: 'visited',
        custom_price: 999, // foreign column — must NOT be written
      } as never);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.updateVisitStatus('visit-1', 'visited');
      });

      const visit = queryClient.getQueryData<RecordResponse>(['record', recordId])?.visits[0];
      expect(visit?.status).toBe('visited');
      expect(visit?.custom_price).toBeNull();
      // The invalidation stays (spec п.2 — ради статуса родительской записи).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });

    it('a later updateVisitStatus blocks an earlier patchVisit(status) late response (shared ledger)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      seedCanonicalWithVisit(queryClient);
      const d1 = deferred<VisitResponse>();
      const d2 = deferred<VisitResponse>();
      mockPatchVisit.mockImplementationOnce(() => d1.promise);
      mockUpdateVisitStatus.mockImplementationOnce(() => d2.promise);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let first: Promise<unknown> = Promise.resolve();
      let second: Promise<unknown> = Promise.resolve();
      act(() => {
        first = result.current.patchVisit('visit-1', { status: 'visited' }); // issued first
        second = result.current.updateVisitStatus('visit-1', 'missed'); // issued second
      });

      // The status mutation answers FIRST — its status lands.
      await act(async () => {
        d2.resolve({ ...seededVisit, status: 'missed', updated_at: '2026-05-10T12:00:00' });
        await second;
      });
      expect(
        queryClient.getQueryData<RecordResponse>(['record', recordId])?.visits[0].status,
      ).toBe('missed');

      // The older field PATCH answers LAST — its status must NOT regress.
      await act(async () => {
        d1.resolve({ ...seededVisit, status: 'visited', updated_at: '2026-05-10T10:00:00' });
        await first;
      });
      expect(
        queryClient.getQueryData<RecordResponse>(['record', recordId])?.visits[0].status,
      ).toBe('missed');
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

    it('deleteVisitDeferred uses removeVisit helper (canonical + list keys)', async () => {
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
        await result.current.deleteVisitDeferred('visit-1');
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

    it('patchVisit uses the projection helper — canonical + list keys (#359)', async () => {
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

    it('deletePaymentDeferred uses removePayment helper (per-record + global keys)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
      queryClient.setQueryData(['payments', recordId], [mockPaymentResponse]);
      queryClient.setQueryData(['payments'], [mockPaymentResponse]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay1');
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
      // #324 family contract: the commit carries the mandatory {expected}
      // body — visits are leaves, so the clean snapshot {expected: {}}.
      expect(mockDeleteVisit).toHaveBeenCalledWith('visit-existing', { expected: {} });
    });

    it('undo restores the visit via upsertVisit helper and cancels the commit', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      // #243 S5: seed the deleted visit as a MIDDLE row (index 1 of 3) so the
      // undo position is observable — appending would put it after 'visit-c'.
      const visitA = { ...existingVisit, id: 'visit-a' };
      const visitC = { ...existingVisit, id: 'visit-c' };
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [visitA, existingVisit, visitC],
      });

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-existing');
      });

      // Row removed from the middle optimistically
      const afterRemove = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(afterRemove?.visits.map((v) => v.id)).toEqual(['visit-a', 'visit-c']);

      // Grab the undo function
      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        undo: () => void;
      };
      await act(async () => {
        action.undo();
      });

      // The provider would not call commit() if undo runs first; verify the undo
      // restored the canonical cache — the row is back AT ITS ORIGINAL INDEX
      // (#243 S5), not appended to the end.
      const cached = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(cached?.visits).toHaveLength(3);
      expect(cached?.visits.map((v) => v.id)).toEqual([
        'visit-a',
        'visit-existing',
        'visit-c',
      ]);
      expect(mockDeleteVisit).not.toHaveBeenCalled();
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
      // #324 family contract: the commit carries the mandatory {expected}
      // body — payments are leaves, so the clean snapshot {expected: {}}.
      expect(mockDeletePayment).toHaveBeenCalledWith('pay-existing', { expected: {} });
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
      // #243 S5: seed BOTH keys with the deleted row at NON-FINAL positions —
      // per-record index 1 of 3, global index 0 of 3. The per-record and global
      // lists have independent orderings, so each restore uses its own index.
      const payA = { ...existingPayment, id: 'pay-a' };
      const payB = { ...existingPayment, id: 'pay-b' };
      const payX = { ...existingPayment, id: 'pay-x', record_id: 'r-other' };
      const payY = { ...existingPayment, id: 'pay-y', record_id: 'r-other' };
      queryClient.setQueryData(['payments', recordId], [payA, existingPayment, payB]);
      queryClient.setQueryData(['payments'], [existingPayment, payX, payY]);

      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay-existing');
      });

      // Rows removed optimistically from BOTH keys
      const afterRemove = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(afterRemove?.map((p) => p.id)).toEqual(['pay-a', 'pay-b']);
      const globalAfterRemove = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(globalAfterRemove?.map((p) => p.id)).toEqual(['pay-x', 'pay-y']);

      const action = mockEnqueuePendingAction.mock.calls[0][0] as {
        undo: () => void;
      };
      await act(async () => {
        action.undo();
      });

      // Payment restored in per-record cache AT ITS ORIGINAL INDEX (S5)
      const cached = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      expect(cached?.map((p) => p.id)).toEqual(['pay-a', 'pay-existing', 'pay-b']);
      // Global list restored AT ITS ORIGINAL INDEX too (S5)
      const global = queryClient.getQueryData<PaymentResponse[]>(['payments']);
      expect(global?.map((p) => p.id)).toEqual(['pay-existing', 'pay-x', 'pay-y']);
      expect(mockDeletePayment).not.toHaveBeenCalled();
    });
  });

  // ─── #257 T5: unified visitors model — anonymous tail, stepper, conversion ───

  describe('createRecord — anonymous tail as visits (US1, #257)', () => {
    it('appends `seats` anonymous visit items (no visitor_id, default tariff/price) after the named visits', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          {
            ...baseCreateRecordInput,
            seats: 2,
            visitors: [{ name: 'Гость', tariffId: 't1' }],
          },
          serviceTariffs,
        );
      });

      expect(mockCreateRecord).toHaveBeenCalledTimes(1);
      const payload = mockCreateRecord.mock.calls[0][0];
      // One named visit + an anonymous tail of 2 (seats), first-tariff defaults.
      expect(payload.visits).toEqual([
        { visitor_id: mockVisitorResponse.id, tariff_id: 't1', price: 3500 },
        { tariff_id: 't1', price: 3500 },
        { tariff_id: 't1', price: 3500 },
      ]);
    });

    it('never sends anonym_visits (or seats) to the backend', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord({ ...baseCreateRecordInput, seats: 3 }, serviceTariffs);
      });

      const payload = mockCreateRecord.mock.calls[0][0];
      expect(payload).not.toHaveProperty('anonym_visits');
      expect(payload).not.toHaveProperty('seats');
      // The tail IS present as anonymous visit elements instead.
      expect(payload.visits).toHaveLength(3);
      payload.visits?.forEach((v) => expect(v.visitor_id).toBeUndefined());
    });

    it('seats=0 → only named visits, no anonymous tail', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          { ...baseCreateRecordInput, seats: 0, visitors: [{ name: 'Гость', tariffId: 't1' }] },
          serviceTariffs,
        );
      });

      const payload = mockCreateRecord.mock.calls[0][0];
      expect(payload.visits).toEqual([
        { visitor_id: mockVisitorResponse.id, tariff_id: 't1', price: 3500 },
      ]);
    });

    it('no service tariffs → anonymous tail items carry price 0 and no tariff_id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.createRecord(
          { ...baseCreateRecordInput, seats: 1, visitors: [] },
          [],
        );
      });

      const payload = mockCreateRecord.mock.calls[0][0];
      expect(payload.visits).toHaveLength(1);
      // price 0 AND no tariff_id (toEqual treats `tariff_id: undefined` as absent,
      // so a stray non-null tariff value would still fail this assertion).
      expect(payload.visits?.[0]).toEqual({ tariff_id: undefined, price: 0 });
    });

    it('anonymous tail defaults via the resolver — first adult, not the first in list (GH #284)', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      // Kid-first list proves the classifier (not array position) picks the
      // default: anonymous seats have no age → adult side → t1.
      await act(async () => {
        await result.current.createRecord(
          { ...baseCreateRecordInput, seats: 1, visitors: [] },
          [
            { id: 't2', price: 2500, audience: 'kid' },
            { id: 't1', price: 3500, audience: 'adult' },
          ],
        );
      });

      const payload = mockCreateRecord.mock.calls[0][0];
      expect(payload.visits?.[0]).toEqual({ tariff_id: 't1', price: 3500 });
    });
  });

  describe('addAnonymousVisit — stepper +1 (US2, #257)', () => {
    // The backend returns the anonymous visit shape (visitor_id = null).
    beforeEach(() => {
      mockCreateVisit.mockResolvedValue(mockAnonymousVisitResponse as never);
    });

    it('creates ONE visit with visitor_id null and the default tariff/price', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.addAnonymousVisit({ id: 't1', price: 3500 });
      });

      expect(mockCreateVisit).toHaveBeenCalledWith({
        record_id: recordId,
        visitor_id: null,
        tariff_id: 't1',
        price: 3500,
      });
      expect(returned).toEqual(mockAnonymousVisitResponse);
    });

    it('without a default tariff → no tariff_id, price 0', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addAnonymousVisit();
      });

      expect(mockCreateVisit).toHaveBeenCalledWith({
        record_id: recordId,
        visitor_id: null,
        tariff_id: undefined,
        price: 0,
      });
    });

    it('upserts the new visit into canonical + list caches and invalidates record+lists', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['record', recordId], { ...mockRecordResponse, visits: [] });
      queryClient.setQueryData(['records', '2026-06-10', '2026-06-10'], {
        items: [{ ...mockRecordResponse, visits: [] }],
        total: 1,
        page: 1,
        per_page: 10,
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.addAnonymousVisit({ id: 't1', price: 3500 });
      });

      // Canonical cache contains the anonymous visit
      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      expect(canonical?.visits.map((v) => v.id)).toContain('visit-anon');
      // List cache copy too
      const listCache = queryClient.getQueryData<PaginatedResponse<RecordResponse>>([
        'records',
        '2026-06-10',
        '2026-06-10',
      ]);
      expect(listCache?.items[0]?.visits.map((v) => v.id)).toContain('visit-anon');
      // Readers: ScheduleActivityCard (['records',df,dt]) + RecordModal (['record',id])
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['record', recordId] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  describe('convertAnonymousVisit — single PATCH, no array rewrite (D7, #257)', () => {
    it('creates a visitor for the record client then PATCHes the visit with visitor_id', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', 12);
      });

      // The record is fetched fresh (pattern of addVisitorToRecord)
      expect(mockGetRecord).toHaveBeenCalledWith(recordId);
      expect(mockCreateVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый гость',
        age: 12,
      });
      // The conversion itself is ONE point PATCH on the visit — no patchRecord
      expect(mockPatchVisit).toHaveBeenCalledWith('visit-anon', { visitor_id: 'vis-new' });
      expect(mockPatchRecord).not.toHaveBeenCalled();
      expect(returned).toEqual(mockVisitResponse);
    });

    it('age null → createVisitor without age (adult default, visitors.md)', async () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.convertAnonymousVisit('visit-anon', 'Взрослый гость', null);
      });

      expect(mockCreateVisitor).toHaveBeenCalledTimes(1);
      const arg = mockCreateVisitor.mock.calls[0][0];
      expect(arg.age).toBeUndefined();
      expect(arg.client_id).toBe('c1');
      expect(arg.name).toBe('Взрослый гость');
    });

    it('invalidates [visitors, clientId] on success (pattern of addVisit)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
    });

    it('syncs the patched visit into the canonical cache via the projection helper (#359)', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      // Both the seeded cache AND the mocked getRecord (fetched fresh by the
      // conversion flow) must hold the anonymous visit — the server record
      // contains it. #359 forbids zombie-inserting a visit missing from the
      // cache, so a visits:[] getRecord mock would (correctly) no-op.
      const recordWithAnonVisit = {
        ...mockRecordResponse,
        visits: [mockAnonymousVisitResponse],
      };
      queryClient.setQueryData(['record', recordId], recordWithAnonVisit);
      mockGetRecord.mockResolvedValue(recordWithAnonVisit as never);
      // The backend returns the visit with the visitor bound.
      mockPatchVisit.mockResolvedValue({ ...mockAnonymousVisitResponse, visitor_id: 'vis-new' } as never);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
      });

      const canonical = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      const patched = canonical?.visits.find((v) => v.id === 'visit-anon');
      expect(patched?.visitor_id).toBe('vis-new');
    });

    it('PATCH failure → deletes the created visitor (no orphan) and rethrows', async () => {
      mockPatchVisit.mockRejectedValue(new Error('patch failed') as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
        }),
      ).rejects.toThrow('patch failed');

      // Rollback: the freshly created visitor must not survive the failure
      expect(mockDeleteVisitor).toHaveBeenCalledWith('vis-new', { expected: {} });
    });

    it('PATCH failure → also invalidates [visitors, clientId] (rollback path)', async () => {
      mockPatchVisit.mockRejectedValue(new Error('patch failed') as never);
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
        }),
      ).rejects.toThrow('patch failed');

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
    });

    it('rollback failure → ORIGINAL PATCH error propagates, [visitors] still invalidated', async () => {
      // PATCH fails AND the rollback deleteVisitor fails too.
      mockPatchVisit.mockRejectedValue(new Error('patch failed') as never);
      mockDeleteVisitor.mockRejectedValue(new Error('delete failed') as never);
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
        }),
      ).rejects.toThrow('patch failed');

      // The rollback was attempted but its failure must not mask the original
      // error, and the visitors invalidation must NOT be skipped.
      expect(mockDeleteVisitor).toHaveBeenCalledWith('vis-new', { expected: {} });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
    });

    it('ambiguous failure — PATCH landed server-side → visitor kept (no cascade), resolves with the bound visit', async () => {
      // 1st fetch (hook start): visit still anonymous.
      // 2nd fetch (reconcile in catch): the PATCH actually landed — visit bound.
      mockGetRecord
        .mockResolvedValueOnce({ ...mockRecordResponse, visits: [mockAnonymousVisitResponse] } as never)
        .mockResolvedValueOnce({
          ...mockRecordResponse,
          visits: [{ ...mockAnonymousVisitResponse, visitor_id: 'vis-new' }],
        } as never);
      mockPatchVisit.mockRejectedValue(new Error('transport down') as never);
      const { queryClient, wrapper } = createQueryClientWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      let returned: unknown;
      await act(async () => {
        returned = await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
      });

      // Blind delete would cascade-destroy the now-linked visit — must NOT happen.
      expect(mockDeleteVisitor).not.toHaveBeenCalled();
      // Reconciled success: the visit IS bound server-side.
      expect(returned).toEqual({ ...mockAnonymousVisitResponse, visitor_id: 'vis-new' });
      // The client's visitors list changed either way — still invalidated.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visitors', 'c1'] });
    });

    it('record without client → guard throws, no visitor created, no PATCH', async () => {
      mockGetRecord.mockResolvedValue({ ...mockRecordResponse, client_id: null } as never);
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await expect(
        act(async () => {
          await result.current.convertAnonymousVisit('visit-anon', 'Новый гость', null);
        }),
      ).rejects.toThrow('Record has no client');

      expect(mockCreateVisitor).not.toHaveBeenCalled();
      expect(mockPatchVisit).not.toHaveBeenCalled();
      expect(mockDeleteVisitor).not.toHaveBeenCalled();
    });
  });

  describe('updateAnonymVisits removed (#257)', () => {
    it('is no longer exposed by the hook', () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      expect(result.current).not.toHaveProperty('updateAnonymVisits');
    });
  });

  describe('instant deletePayment/deleteVisit removed (#243 phase 1)', () => {
    it('is no longer exposed by the hook — callers must use the deferred variants', () => {
      const { wrapper } = createQueryClientWrapper();
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });
      expect(result.current).not.toHaveProperty('deleteVisit');
      expect(result.current).not.toHaveProperty('deletePayment');
      // The deferred replacements remain available.
      expect(result.current.deleteVisitDeferred).toBeDefined();
      expect(result.current.deletePaymentDeferred).toBeDefined();
    });

    it('deleteVisitDeferred enqueues a pending action instead of firing an instant DELETE', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['record', recordId], {
        ...mockRecordResponse,
        visits: [mockAnonymousVisitResponse],
      });
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deleteVisitDeferred('visit-anon');
      });

      // Deferred contract: enqueue, NOT instant DELETE.
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockDeleteVisit).not.toHaveBeenCalled();
    });

    it('deletePaymentDeferred enqueues a pending action instead of firing an instant DELETE', async () => {
      const { queryClient, wrapper } = createQueryClientWrapper();
      queryClient.setQueryData(['payments', recordId], [mockPaymentResponse]);
      const { result } = renderHook(() => useRecordMutations(activityId, recordId), { wrapper });

      await act(async () => {
        await result.current.deletePaymentDeferred('pay1');
      });

      // Deferred contract: enqueue, NOT instant DELETE.
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(mockDeletePayment).not.toHaveBeenCalled();
    });
  });
});
