'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  patchRecord,
  deleteRecord as apiDeleteRecord,
  patchActivity,
  createPayment,
  deletePayment as apiDeletePayment,
  createVisitor,
  deleteVisitor as apiDeleteVisitor,
} from '@memo/api-client';

interface VisitData {
  visitor_id?: string;
  price: number;
  custom_price?: number | null;
  status?: string;
}

export function useRecordMutations(recordId: string) {
  const queryClient = useQueryClient();

  const invalidateRecord = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    queryClient.invalidateQueries({ queryKey: ['records'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  }, [queryClient, recordId]);

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

      invalidateRecord();
    },
    [recordId, invalidateRecord],
  );

  const deleteRecord = useCallback(async () => {
    await apiDeleteRecord(recordId);
    invalidateRecord();
  }, [recordId, invalidateRecord]);

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
      invalidateRecord();
    },
    [recordId, invalidateRecord],
  );

  const addPayment = useCallback(
    async (amount: number, method: string) => {
      await createPayment({ record_id: recordId, amount, method: method as 'cash' | 'card' | 'transfer' });
      invalidateRecord();
    },
    [recordId, invalidateRecord],
  );

  const deletePayment = useCallback(
    async (paymentId: string) => {
      await apiDeletePayment(paymentId);
      invalidateRecord();
    },
    [invalidateRecord],
  );

  return {
    saveRecord,
    deleteRecord,
    addVisitor,
    deleteVisitor,
    addPayment,
    deletePayment,
  };
}
