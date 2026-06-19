'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  createRecord,
  createClient,
  createVisitor,
  searchClientByPhone,
  patchRecord,
  deleteRecord as apiDeleteRecord,
  patchActivity,
  createPayment,
  deletePayment as apiDeletePayment,
  deleteVisitor as apiDeleteVisitor,
} from '@memo/api-client';

interface VisitData {
  visitor_id?: string;
  price: number;
  custom_price?: number | null;
  status?: string;
}

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
    if (recordId) {
      queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    }
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
      const visitIds: string[] = [];
      for (const v of input.visitors) {
        if (v.name) {
          const visitor = await createVisitor({
            client_id: clientId,
            name: v.name,
            age: v.age ? Number(v.age) : undefined,
          });
          visitIds.push(visitor.id);
        }
      }

      // 3. Default price from first tariff if any
      const firstTariff = serviceTariffs[0];

      // 4. Create record
      await createRecord({
        activity_id: activityId,
        client_id: clientId,
        seats: input.seats,
        visits: visitIds.map((vid) => ({
          visitor_id: vid,
          price: firstTariff?.price ?? 0,
        })),
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

  const deleteRecord = useCallback(async () => {
    await apiDeleteRecord(recordId);
    invalidateAll();
  }, [recordId, invalidateAll]);

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
    async (amount: number, method: string) => {
      await createPayment({ record_id: recordId, amount, method: method as 'cash' | 'card' | 'transfer' });
      invalidateAll();
    },
    [recordId, invalidateAll],
  );

  const deletePayment = useCallback(
    async (paymentId: string) => {
      await apiDeletePayment(paymentId);
      invalidateAll();
    },
    [invalidateAll],
  );

  return {
    createRecord: createRecordMutation,
    saveRecord,
    deleteRecord,
    addVisitor,
    deleteVisitor,
    addPayment,
    deletePayment,
  };
}
