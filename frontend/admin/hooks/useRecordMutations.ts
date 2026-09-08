'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  createRecord,
  createClient,
  createVisitor,
  getClientByPhone,
  patchRecord,
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
import {
  removePayment,
  removeVisit,
  upsertPayment,
  upsertVisit,
} from '@/lib/cache/recordCacheSync';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { invalidateEntities } from '@/lib/invalidate';
import { qk } from '@/lib/queryKeys';

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
  const { enqueuePendingAction } = usePendingActions();

  // ── Targeted invalidations ─────────────────────────────────────────────
  // Per #127 Task 4: do NOT use a 5-key blanket hammer on fine-grained ops.
  // Each invalidate below is paired with a comment naming its reader.

  /** Reader: RecordModal (['record', id]) + ScheduleActivityCard (['records', df, dt]). */
  const invalidateRecordAndLists = useCallback(() => {
    if (recordId) {
      queryClient.invalidateQueries({ queryKey: qk.record(recordId) });
    }
    invalidateEntities(queryClient, ['records']);
  }, [queryClient, recordId]);

  /** Lighter invalidation for ops that only change a single record's canonical store. */
  const invalidateRecord = useCallback(() => {
    if (recordId) {
      queryClient.invalidateQueries({ queryKey: qk.record(recordId) });
    }
  }, [queryClient, recordId]);

  // ── Record-level mutations ─────────────────────────────────────────────

  const createRecordMutation = useCallback(
    async (
      input: CreateRecordInput,
      serviceTariffs: Array<{ id: string; price: number }>,
    ) => {
      // 1. Resolve or create client
      let clientId: string;
      let createdClientId: string | null = null;
      if (input.phone) {
        try {
          const existing = await getClientByPhone(input.phone);
          clientId = existing.id;
        } catch {
          const created = await createClient({
            name: input.name,
            phone: input.phone,
            channel: input.channel,
          });
          clientId = created.id;
          createdClientId = created.id;
        }
      } else {
        const created = await createClient({
          name: input.name,
          phone: '',
          channel: input.channel,
        });
        clientId = created.id;
        createdClientId = created.id;
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

      // 5. Invalidate readers of the new record
      // Reader: ScheduleActivityCard (['records',df,dt]) + RecordModal (['record',id])
      invalidateRecordAndLists();

      // 6. Staleness fix (#140): if this quick-add CREATED a new client, the
      //    ['clients'] list is now stale — the new client would be invisible in
      //    /clients until the next refetch (≤30s). Invalidate so it appears
      //    immediately. Awaited: the mutation stays pending until the refetch
      //    lands. Skipped on the existing-client reuse path (no new client).
      //    Reader: ClientsPage (['clients'])
      if (createdClientId !== null) {
        await queryClient.invalidateQueries({ queryKey: qk.clients });
      }
    },
    [activityId, invalidateRecordAndLists, queryClient],
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
      // Reader: RecordModal (['record',id]) + ScheduleActivityCard (['records',df,dt])
      invalidateRecordAndLists();
    },
    [recordId, invalidateRecordAndLists],
  );

  const updateRecord = useCallback(
    async (id: string, updates: RecordPatchData): Promise<void> => {
      await patchRecord(id, updates);
      // Reader: RecordModal (['record',id]) + ScheduleActivityCard (['records',df,dt])
      invalidateRecordAndLists();
    },
    [invalidateRecordAndLists],
  );

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
      // Reader: RecordModal (['record',id]) + ScheduleActivityCard (['records',df,dt])
      invalidateRecordAndLists();
    },
    [recordId, invalidateRecordAndLists],
  );

  // ── Payment mutations (fine-grained — use cacheSync helpers) ─────────

  const addPayment = useCallback(
    async (amount: number, method: string, date?: string) => {
      const payment = await createPayment({
        record_id: recordId,
        amount,
        method: method as 'cash' | 'card' | 'transfer',
        ...(date ? { created_at: date } : {}),
      });
      // Optimistic cache update — writes BOTH per-record and global ['payments'].
      // Reader: RecordModal (['payments', recordId]) + future global payments reader (['payments'])
      upsertPayment(queryClient, recordId, payment);
      // Targeted invalidation for the record's visit/visit-cell UI.
      invalidateRecord();
      // R4 (US-4): RecordsTable reads `paid` from the view row — prefix
      // ['records'] invalidation catches all pages/filters so the badge refreshes.
      invalidateEntities(queryClient, ['records']);
      return payment;
    },
    [recordId, queryClient, invalidateRecord],
  );

  const deletePayment = useCallback(
    async (paymentId: string) => {
      // Optimistic: remove from BOTH per-record and global ['payments'] caches.
      removePayment(queryClient, recordId, paymentId);
      await apiDeletePayment(paymentId);
      // Targeted invalidation: the record's payment tab uses ['payments', recordId].
      invalidateRecord();
      // R4 (US-4): RecordsTable reads `paid` from the view row — prefix
      // ['records'] invalidation catches all pages/filters so the badge refreshes.
      invalidateEntities(queryClient, ['records']);
    },
    [recordId, queryClient, invalidateRecord],
  );

  // ── Record-level visit / visitor mutations (non fine-grained) ─────────

  const addVisitorToRecord = useCallback(
    async (data: { name: string; age?: number; price: number }) => {
      const record = await queryClient.fetchQuery({
        queryKey: qk.record(recordId),
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
      // Reader: RecordModal (['record',id]) + ScheduleActivityCard (['records',df,dt])
      invalidateRecordAndLists();
    },
    [recordId, queryClient, invalidateRecordAndLists],
  );

  const updateAnonymVisits = useCallback(
    async (recordId: string, anonymVisits: number) => {
      await patchRecord(recordId, { anonym_visits: anonymVisits });
      // Reader: RecordModal (['record',id]) + ScheduleActivityCard (['records',df,dt])
      invalidateRecordAndLists();
    },
    [invalidateRecordAndLists],
  );

  const updateVisitStatus = useCallback(
    async (visitId: string, status: string) => {
      await apiUpdateVisitStatus(visitId, status);
      // Reader: ScheduleActivityCard (['records',df,dt]) + RecordModal (['record',id])
      invalidateRecordAndLists();
    },
    [invalidateRecordAndLists],
  );

  // ── Fine-grained visit mutations (use cacheSync helpers) ─────────────

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
      // Optimistic cache update — helper syncs canonical ['record',id] + every ['records',...] list.
      // Reader: ScheduleActivityCard (['records',df,dt]) + RecordModal (['record',id])
      upsertVisit(queryClient, recordId, visit);
      // Regression fix: invalidate visitors cache using direct client_id
      // Reader: ClientInfoTab visitors list (['visitors', clientId])
      queryClient.invalidateQueries({ queryKey: qk.visitors(data.client_id) });
      return visit;
    },
    [recordId, queryClient],
  );

  const patchVisit = useCallback(
    async (visitId: string, data: VisitPatch) => {
      const visit = await apiPatchVisit(visitId, data);
      // Optimistic cache update via helper — syncs canonical + every list.
      // Reader: ScheduleActivityCard + RecordModal
      upsertVisit(queryClient, recordId, visit);
      return visit;
    },
    [recordId, queryClient],
  );

  const deleteVisit = useCallback(
    async (visitId: string) => {
      // Optimistic: remove visit from BOTH canonical and list caches via helper.
      // Reader: ScheduleActivityCard + RecordModal
      removeVisit(queryClient, recordId, visitId);
      await apiDeleteVisit(visitId);
    },
    [recordId, queryClient],
  );

  const patchPayment = useCallback(
    async (paymentId: string, data: { amount?: number; method?: string }) => {
      const payment = await apiPatchPayment(paymentId, data);
      // Optimistic cache update via helper — writes BOTH per-record and global ['payments'].
      // Reader: RecordModal (['payments', recordId]) + future global payments reader
      upsertPayment(queryClient, recordId, payment);
      // R4 (US-4): RecordsTable reads `paid` from the view row — prefix
      // ['records'] invalidation catches all pages/filters so the badge refreshes.
      invalidateEntities(queryClient, ['records']);
      return payment;
    },
    [recordId, queryClient],
  );

  // ── Deferred delete with undo (delegate to PendingActions provider) ───

  const deleteVisitDeferred = useCallback(
    async (visitId: string) => {
      // 1. Snapshot the visit from the canonical cache BEFORE removing.
      //    The helper guards `old == null` so we still pass through safely.
      const record = queryClient.getQueryData<RecordResponse>(qk.record(recordId));
      const savedVisit = record?.visits.find((v) => v.id === visitId);

      // 2. Optimistically remove from canonical + list caches via helper.
      removeVisit(queryClient, recordId, visitId);

      // 3. Delegate timer+toast to the provider. The provider:
      //    - shows the toast with the undo callback,
      //    - schedules the commit() after 5s,
      //    - cancels both if undo runs first.
      // Bug #2 fix: the action survives modal close because the provider
      // lives at app level.
      enqueuePendingAction({
        id: `delete-visit-${visitId}`,
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        // Undo: write the snapshotted visit back via the helper.
        // The helper guards `old == null` (spec §7) — if the canonical
        // record was removed, we silently no-op.
        undo: () => {
          if (savedVisit) upsertVisit(queryClient, recordId, savedVisit);
        },
        // Commit: call the real API and reconcile (canonical + lists).
        // The optimistic remove already removed it from caches; if the API
        // fails, the row is gone from cache but also from the server — the
        // remaining inconsistency is acceptable for a delete.
        commit: async () => {
          await apiDeleteVisit(visitId);
          // Targeted reconcile: a failed optimistic remove or stale cache
          // would be re-aligned by re-running the helper.
          removeVisit(queryClient, recordId, visitId);
        },
      });
    },
    [recordId, queryClient, enqueuePendingAction],
  );

  const deletePaymentDeferred = useCallback(
    async (paymentId: string) => {
      // 1. Snapshot the payment from the per-record cache BEFORE removing.
      const savedPayments = queryClient.getQueryData<PaymentResponse[]>(qk.recordPayments(recordId));
      const savedPayment = savedPayments?.find((p) => p.id === paymentId);

      // 2. Optimistically remove from BOTH per-record and global ['payments'] via helper.
      removePayment(queryClient, recordId, paymentId);

      // 3. Delegate timer+toast to the provider.
      enqueuePendingAction({
        id: `delete-payment-${paymentId}`,
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        undo: () => {
          if (savedPayment) upsertPayment(queryClient, recordId, savedPayment);
        },
        // Commit: API delete + targeted reconcile of per-record + global ['payments'].
        // Absorbs #130 Bug 2 — old code did not reconcile ['payments'] after API success.
        commit: async () => {
          await apiDeletePayment(paymentId);
          // Targeted reconcile: ensure both caches reflect the deletion even if
          // an external mutation or a stale optimistic state drifted.
          removePayment(queryClient, recordId, paymentId);
          // R4 (US-4): RecordsTable reads `paid` from the view row — invalidate on
          // COMMIT (not on defer) so the badge refreshes once the delete is final.
          invalidateEntities(queryClient, ['records']);
        },
      });
    },
    [recordId, queryClient, enqueuePendingAction],
  );

  return {
    createRecord: createRecordMutation,
    saveRecord,
    updateRecord,
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
