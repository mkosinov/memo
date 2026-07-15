'use client';

import React, { useState, useCallback, useRef } from 'react';
import type { ClientResponse, ClientWithStats } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { useQueryClient } from '@tanstack/react-query';
import { updateVisitor } from '@memo/api-client';
import { RecordSummary } from '@/app/components/shared/record/blocks/RecordSummary';
import { RecordVisitsTable } from '@/app/components/shared/record/blocks/RecordVisitsTable';
import { RecordPaymentsTable } from '@/app/components/shared/record/blocks/RecordPaymentsTable';
import { RecordComments } from '@/app/components/shared/record/blocks/RecordComments';
import { RecordTimestamps } from '@/app/components/shared/record/blocks/RecordTimestamps';
import { ClientStatistics } from '@/app/components/shared/record/blocks/ClientStatistics';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useUI } from '@/contexts/UIContext';
import { safeStatus } from '@/app/lib/status-utils';
import { computeRecordStatus } from '@memo/domain';
import { parseApiError } from '@/app/lib/api/parseApiError';

interface ClientTabProps {
  recordId: string;
  activityId: string;
  clientId: string;
  client: ClientResponse | ClientWithStats | undefined;
  onDeleteRecord: (id: string) => void;
  onClose?: () => void;
}

export function ClientTab({
  recordId,
  activityId,
  clientId,
  client,
  onDeleteRecord,
  onClose: _onClose,
}: ClientTabProps) {
  const isDeletingRef = useRef(false);
  const queryClient = useQueryClient();
  const { showToast } = useUI();

  // ── Canonical data from useRecordData (single source of truth) ──────
  const {
    record,
    visitorsMap,
    tariffs,
    payments,
    status,
  } = useRecordData(recordId, clientId);

  // ── Mutations (fine-grained where possible) ──────────────────────────
  const {
    updateRecord,
    addVisit,
    patchVisit,
    deleteVisitDeferred,
    addPayment,
    patchPayment,
    deletePaymentDeferred,
  } = useRecordMutations(activityId, recordId);

  // ── Local state ──────────────────────────────────────────────────────
  const [comment, setComment] = useState(record?.comment || '');

  // Sync local comment when the record changes (e.g. after invalidation).
  React.useEffect(() => {
    if (record?.comment !== undefined) {
      setComment(record.comment || '');
    }
  }, [record?.comment]);

  // ── Handlers ─────────────────────────────────────────────────────────

  /**
   * Visitor name/age change — fine-grained: updateVisitor + invalidate
   * ['visitors', clientId] so the canonical hook refetches. No optimistic
   * override layer.
   */
  const handleVisitorChange = useCallback(
    (visitorId: string, data: { name?: string; age?: number | null }) => {
      const apiData = { ...data, age: data.age ?? undefined };
      updateVisitor(visitorId, apiData)
        .then(() => {
          // Reader: ['visitors', clientId] in useRecordData
          queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
        })
        .catch((err) => {
          showToast(parseApiError(err).message, 'error');
        });
    },
    [clientId, queryClient, showToast],
  );

  // Status change on the record (RecordSummary StatusPicker) — coarse
  // record-level patch: all visits set to the new status in one PATCH.
  // Spec allows record-level ops to stay via `updateRecord` from the hook.
  const handleStatusChange = useCallback(
    async (newStatus: VisitStatus) => {
      const visits = record?.visits ?? [];
      const updatedVisits = visits.map((v) => ({
        visitor_id: v.visitor_id,
        price: v.price,
        status: newStatus,
      }));
      try {
        await updateRecord(recordId, { visits: updatedVisits } as any);
      } catch {
        showToast('Ошибка обновления статуса', 'error');
      }
    },
    [record?.visits, recordId, updateRecord, showToast],
  );

  const handleAnonymChange = useCallback(
    async (value: number) => {
      try {
        await updateRecord(recordId, { anonym_visits: value } as any);
      } catch {
        showToast('Ошибка изменения анонимных посетителей', 'error');
      }
    },
    [recordId, updateRecord, showToast],
  );

  const handleCommentChange = useCallback(
    async (value: string) => {
      setComment(value);
      try {
        await updateRecord(recordId, { comment: value } as any);
      } catch {
        showToast('Ошибка сохранения комментария', 'error');
      }
    },
    [recordId, updateRecord, showToast],
  );

  const handleDelete = useCallback(() => {
    isDeletingRef.current = true;
    showToast('Запись удалена через 5 секунд', () => {
      isDeletingRef.current = false;
    });
    setTimeout(() => {
      if (isDeletingRef.current) {
        onDeleteRecord(recordId);
      }
    }, 5000);
  }, [onDeleteRecord, recordId, showToast]);

  // ── Derived data ─────────────────────────────────────────────────────

  const visits = record?.visits ?? [];
  const derivedStatus: VisitStatus =
    status ??
    computeRecordStatus(
      visits.map((v) => ({ id: v.id, status: safeStatus(v.status) })),
    );

  const totalCost = visits.reduce((sum, v) => sum + v.price, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const toPay = Math.max(0, totalCost - totalPaid);

  // Compute stats for ClientStatistics
  const stats =
    client && 'visits_count' in client
      ? {
          visitsCount: client.visits_count,
          missedVisits: client.missed_visits,
          lastVisit: client.last_visit,
          totalPaid: client.total_paid,
        }
      : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="client-tab">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 space-y-[30px]">
        {/* Summary: cost + status */}
        <RecordSummary
          totalCost={totalCost}
          totalPaid={totalPaid}
          seats={visits.length + (record?.anonym_visits ?? 0)}
          status={derivedStatus}
          onStatusChange={handleStatusChange}
        />

        {/* Client statistics */}
        <ClientStatistics stats={stats} />

        {/* Visits table */}
        <RecordVisitsTable
          visits={visits}
          visitorsMap={visitorsMap}
          tariffs={tariffs}
          anonymVisits={record?.anonym_visits ?? 0}
          totalCost={totalCost}
          recordStatus={derivedStatus}
          clientId={clientId}
          onAddVisit={addVisit}
          onPatchVisit={patchVisit}
          onDeleteVisit={(visitId: string) => deleteVisitDeferred(visitId)}
          onChangeVisitor={handleVisitorChange}
          onAnonymVisitsChange={handleAnonymChange}
        />

        {/* Payments table */}
        <RecordPaymentsTable
          payments={payments}
          defaultAmount={toPay}
          onAddPayment={addPayment}
          onPatchPayment={patchPayment}
          onDeletePayment={(paymentId: string) => deletePaymentDeferred(paymentId)}
        />

        {/* Comment */}
        <RecordComments value={comment} onChange={handleCommentChange} />
      </div>

      {/* Footer — fixed at bottom of modal body, aligned with TabNav's "+ Запись" border-t */}
      <div
        className="shrink-0 border-t px-4 py-3 bg-white flex items-center justify-between gap-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <RecordTimestamps
          createdAt={record?.created_at ?? ''}
          updatedAt={record?.updated_at ?? ''}
        />
        <button
          onClick={handleDelete}
          className="text-sm text-red-500 hover:text-red-600 transition-colors shrink-0"
          data-testid="btn-delete-record"
        >
          Удалить запись
        </button>
      </div>
    </div>
  );
}
