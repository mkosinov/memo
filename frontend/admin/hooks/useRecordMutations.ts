'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  createRecord,
  createClient,
  createVisitor,
  searchClientByPhone,
  patchRecord,
  deleteRecord as apiDeleteRecord,
  patchActivity,
  createPayment,
  patchPayment as apiPatchPayment,
  deletePayment as apiDeletePayment,
  deleteVisitor as apiDeleteVisitor,
  updateVisitStatus as apiUpdateVisitStatus,
  createVisit,
  patchVisit as apiPatchVisit,
  deleteVisit as apiDeleteVisit,
} from '@memo/api-client';
import type { RecordResponse, PaymentResponse, VisitPatch } from '@memo/api-client';

interface VisitData {
  visitor_id?: string | null;
  tariff_id?: string | null;
  price: number;
  custom_price?: number | null;
  status?: string;
}

/** Data type accepted by patchRecord — status, comment, custom_price, visits. */
export type RecordPatchData = Partial<
  Pick<RecordResponse, 'status' | 'comment' | 'custom_price'> & {
    visits?: Array<{ visitor_id?: string | null; tariff_id?: string | null; name?: string; age?: number; price: number; custom_price?: number | null; status?: string }>;
  }
>;

interface CreateRecordInput {
  phone: string;
  name: string;
  channel: string;
  seats: number;
  visitors: Array<{ name: string; age?: string; tariffId: string }>;
}

export function useRecordMutations(activityId: string, recordId: string = '') {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['records'] });
    queryClient.invalidateQueries({ queryKey: ['activities'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    if (recordId) {
      queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    }
  }, [queryClient, recordId]);

  /** Lighter invalidation for single-entity mutations that only affect this record. */
  const invalidateRecord = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['record', recordId] });
  }, [queryClient, recordId]);

  const createRecordMutation = useCallback(
    async (
      input: CreateRecordInput,
      serviceTariffs: Array<{ id: string; price: number }>,
    ) => {
      // 1. Resolve or create client
      let clientId: string;
      if (input.phone) {
        try {
          const existing = await searchClientByPhone(input.phone);
          clientId = existing.id;
        } catch {
          const created = await createClient({
            name: input.name,
            phone: input.phone,
            channel: input.channel,
          });
          clientId = created.id;
        }
      } else {
        const created = await createClient({
          name: input.name,
          phone: '',
          channel: input.channel,
        });
        clientId = created.id;
      }

      // 2. Create visitors (skip empty names)
      const visitData: Array<{ visitorId: string; tariffId?: string }> = [];
      for (const v of input.visitors) {
        if (v.name) {
          const visitor = await createVisitor({
            client_id: clientId,
            name: v.name,
            age: v.age ? Number(v.age) : undefined,
          });
          visitData.push({ visitorId: visitor.id, tariffId: v.tariffId || undefined });
        }
      }

      // 3. Default price from first tariff if any
      const firstTariff = serviceTariffs[0];

      // 4. Create record
      await createRecord({
        activity_id: activityId,
        client_id: clientId,
        anonym_visits: input.seats,
        visits: visitData.map((vd) => {
          // Lookup tariff price by id; fall back to firstTariff
          const tariff = vd.tariffId
            ? serviceTariffs.find((t) => t.id === vd.tariffId)
            : firstTariff;
          return {
            visitor_id: vd.visitorId,
            tariff_id: vd.tariffId || undefined,
            price: tariff?.price ?? 0,
          };
        }),
      });

      // 5. Invalidate all relevant queries
      invalidateAll();
    },
    [activityId, invalidateAll],
  );

  const saveRecord = useCallback(
    async (data: {
      activityId?: string;
      activityStart?: string;
      activityServiceId?: string;
      customPrice?: string;
      comment?: string;
      visits: VisitData[];
    }) => {
      if (data.activityId && data.activityStart && data.activityServiceId) {
        await patchActivity(data.activityId, {
          start: data.activityStart,
          service_id: data.activityServiceId,
        });
      }
      await patchRecord(recordId, {
        custom_price: data.customPrice?.trim() ? Number(data.customPrice) : null,
        comment: data.comment || null,
        visits: data.visits,
      });
      invalidateAll();
    },
    [recordId, invalidateAll],
  );

  const updateRecord = useCallback(
    async (id: string, updates: RecordPatchData): Promise<void> => {
      await patchRecord(id, updates);
      invalidateAll();
    },
    [invalidateAll],
  );

  const deleteRecord = useCallback(async () => {
    await apiDeleteRecord(recordId);
    // Optimistic update: remove record from cache immediately for snappy UX
    queryClient.setQueryData<RecordResponse[]>(['records'], (old) =>
      old ? old.filter((r) => r.id !== recordId) : old,
    );
    invalidateAll();
  }, [recordId, queryClient, invalidateAll]);

  const addVisitor = useCallback(
    async (data: { client_id: string; name: string; age?: number }) => {
      return await createVisitor(data);
    },
    [],
  );

  const deleteVisitor = useCallback(
    async (visitorId: string, currentVisits: VisitData[]) => {
      await apiDeleteVisitor(visitorId);
      const remaining = currentVisits.filter((v) => v.visitor_id !== visitorId);
      await patchRecord(recordId, { visits: remaining });
      invalidateAll();
    },
    [recordId, invalidateAll],
  );

  const addPayment = useCallback(
    async (amount: number, method: string, date?: string) => {
      const payment = await createPayment({
        record_id: recordId,
        amount,
        method: method as 'cash' | 'card' | 'transfer',
        ...(date ? { created_at: date } : {}),
      });
      // Optimistic cache update so tab remounts see fresh data immediately
      queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
        return [...(old ?? []), payment];
      });
      invalidateAll();
      return payment;
    },
    [recordId, queryClient, invalidateAll],
  );

  const deletePayment = useCallback(
    async (paymentId: string) => {
      // Optimistic: remove payment from cache before API call
      queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
        return (old ?? []).filter(p => p.id !== paymentId);
      });
      await apiDeletePayment(paymentId);
      invalidateAll();
    },
    [recordId, queryClient, invalidateAll],
  );

  const addVisitorToRecord = useCallback(
    async (data: { name: string; age?: number; price: number }) => {
      const record = await queryClient.fetchQuery({
        queryKey: ['record', recordId],
        queryFn: () => import('@memo/api-client').then((m) => m.getRecord(recordId)),
      });
      const clientId = record.client_id;
      if (!clientId) throw new Error('Record has no client');

      const visitor = await createVisitor({
        client_id: clientId,
        name: data.name,
        age: data.age,
      });

      const newVisit: VisitData = {
        visitor_id: visitor.id,
        price: data.price,
      };

      await patchRecord(recordId, {
        visits: [...(record.visits as unknown as VisitData[]), newVisit],
      });
      invalidateAll();
    },
    [recordId, queryClient, invalidateAll],
  );

  const updateAnonymVisits = useCallback(
    async (recordId: string, anonymVisits: number) => {
      await patchRecord(recordId, { anonym_visits: anonymVisits });
      invalidateAll();
    },
    [invalidateAll],
  );

  const updateVisitStatus = useCallback(
    async (visitId: string, status: string) => {
      await apiUpdateVisitStatus(visitId, status);
      queryClient.invalidateQueries({ queryKey: ['records'] });
      if (recordId) {
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      }
    },
    [queryClient, recordId],
  );

  /**
   * Two-step flow: create the Visitor, then create the Visit referencing it.
   * Returns the saved VisitResponse for replace-in-place UI updates (no blink).
   */
  const addVisit = useCallback(
    async (data: { client_id: string; name: string; age?: number; tariff_id?: string | null; price: number }) => {
      const visitor = await createVisitor({ client_id: data.client_id, name: data.name, age: data.age });
      const visit = await createVisit({
        record_id: recordId,
        visitor_id: visitor.id,
        tariff_id: data.tariff_id ?? null,
        price: data.price,
      });
      // Optimistic cache update so tab remounts see fresh data immediately
      queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
        if (!old) return old;
        return { ...old, visits: [...old.visits, visit] };
      });
      invalidateRecord();
      // Regression fix: invalidate visitors cache using direct client_id
      queryClient.invalidateQueries({ queryKey: ['visitors', data.client_id] });
      return visit;
    },
    [recordId, queryClient, invalidateRecord],
  );

  const patchVisit = useCallback(
    async (visitId: string, data: VisitPatch) => {
      const visit = await apiPatchVisit(visitId, data);
      // Optimistic cache update with the server-confirmed visit
      queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
        if (!old) return old;
        return { ...old, visits: old.visits.map(v => v.id === visitId ? { ...v, ...visit } : v) };
      });
      invalidateRecord();
      return visit;
    },
    [recordId, queryClient, invalidateRecord],
  );

  const deleteVisit = useCallback(
    async (visitId: string) => {
      // Optimistic: remove visit from cache before API call
      queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
        if (!old) return old;
        return { ...old, visits: old.visits.filter(v => v.id !== visitId) };
      });
      await apiDeleteVisit(visitId);
      invalidateRecord();
    },
    [recordId, queryClient, invalidateRecord],
  );

  const patchPayment = useCallback(
    async (paymentId: string, data: { amount?: number; method?: string }) => {
      const payment = await apiPatchPayment(paymentId, data);
      // Optimistic cache update with the server-confirmed payment
      queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
        return (old ?? []).map(p => p.id === paymentId ? { ...p, ...payment } : p);
      });
      invalidateRecord();
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      return payment;
    },
    [recordId, queryClient, invalidateRecord],
  );

  // ── Deferred delete with undo (Bug E) ────────────────────────────────────

  const pendingDeleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup: clear all pending deferred-delete timers on unmount
  useEffect(() => {
    const timers = pendingDeleteTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const deleteVisitDeferred = useCallback(
    async (visitId: string, showToastFn: (msg: string, undo: () => void) => void) => {
      // 1. Save the visit from cache for potential restore
      const record = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      const savedVisit = record?.visits.find(v => v.id === visitId);

      // 2. Optimistically remove from cache
      queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
        if (!old) return old;
        return { ...old, visits: old.visits.filter(v => v.id !== visitId) };
      });

      // 3. Cancel any existing timer for this id
      const existing = pendingDeleteTimers.current.get(visitId);
      if (existing) clearTimeout(existing);

      // 4. Show toast with undo
      let undone = false;
      showToastFn('Удалено. Отменить', () => {
        undone = true;
        // Restore the row
        if (savedVisit) {
          queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
            if (!old) return old;
            return { ...old, visits: [...old.visits, savedVisit] };
          });
        }
        const timer = pendingDeleteTimers.current.get(visitId);
        if (timer) {
          clearTimeout(timer);
          pendingDeleteTimers.current.delete(visitId);
        }
      });

      // 5. Schedule the actual DELETE after 5s
      const timer = setTimeout(async () => {
        if (!undone) {
          await apiDeleteVisit(visitId);
          invalidateRecord();
        }
        pendingDeleteTimers.current.delete(visitId);
      }, 5000);
      pendingDeleteTimers.current.set(visitId, timer);
    },
    [recordId, queryClient, invalidateRecord],
  );

  const deletePaymentDeferred = useCallback(
    async (paymentId: string, showToastFn: (msg: string, undo: () => void) => void) => {
      // 1. Save the payment from cache for potential restore
      const savedPayments = queryClient.getQueryData<PaymentResponse[]>(['payments', recordId]);
      const savedPayment = savedPayments?.find(p => p.id === paymentId);

      // 2. Optimistically remove from cache
      queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
        return (old ?? []).filter(p => p.id !== paymentId);
      });

      // 3. Cancel any existing timer for this id
      const existing = pendingDeleteTimers.current.get(paymentId);
      if (existing) clearTimeout(existing);

      // 4. Show toast with undo
      let undone = false;
      showToastFn('Удалено. Отменить', () => {
        undone = true;
        // Restore the payment
        if (savedPayment) {
          queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
            return [...(old ?? []), savedPayment];
          });
        }
        const timer = pendingDeleteTimers.current.get(paymentId);
        if (timer) {
          clearTimeout(timer);
          pendingDeleteTimers.current.delete(paymentId);
        }
      });

      // 5. Schedule the actual DELETE after 5s
      const timer = setTimeout(async () => {
        if (!undone) {
          await apiDeletePayment(paymentId);
          invalidateRecord();
        }
        pendingDeleteTimers.current.delete(paymentId);
      }, 5000);
      pendingDeleteTimers.current.set(paymentId, timer);
    },
    [recordId, queryClient, invalidateRecord],
  );

  return {
    createRecord: createRecordMutation,
    saveRecord,
    updateRecord,
    deleteRecord,
    addVisitor,
    deleteVisitor,
    addPayment,
    deletePayment,
    addVisitorToRecord,
    updateAnonymVisits,
    updateVisitStatus,
    addVisit,
    patchVisit,
    deleteVisit,
    patchPayment,
    deleteVisitDeferred,
    deletePaymentDeferred,
  };
}
