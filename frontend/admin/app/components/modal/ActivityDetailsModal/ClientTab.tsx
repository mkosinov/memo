'use client';

import React, { useState, useCallback } from 'react';
import type { ClientResponse, ClientWithStats, DependencyNode } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { patchVisitor, getActivity, ApiError } from '@memo/api-client';
import { RecordSummary } from '@/app/components/shared/record/blocks/RecordSummary';
import { RecordVisitsTable } from '@/app/components/shared/record/blocks/RecordVisitsTable';
import { RecordPaymentsTable } from '@/app/components/shared/record/blocks/RecordPaymentsTable';
import { RecordComments } from '@/app/components/shared/record/blocks/RecordComments';
import { RecordTimestamps } from '@/app/components/shared/record/blocks/RecordTimestamps';
import { ClientStatistics } from '@/app/components/shared/record/blocks/ClientStatistics';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useDeleteRecord } from '@/hooks/useDeleteRecord';
import { useUI } from '@/contexts/UIContext';
import { safeStatus } from '@/app/lib/status-utils';
import { computeRecordStatus } from '@memo/domain';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { formatRecordLabel } from '@/lib/utils';

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

  // Delete — Addendum 13 / GH #139 T8-FE2a: replaces the legacy 5-second
  // setTimeout + undo toast with an explicit-confirmation dry-run flow.
  const deleteMutation = useDeleteRecord();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; deps: DependencyNode[] } | null>(null);

  // Parent activity — used for the dialog's record label (records have no
  // name; "15 мая · 14:00"). Same cache key useRecordData primes, so this
  // dedupes with no extra fetch.
  const { data: activity } = useQuery({
    queryKey: ['activity', record?.activity_id],
    queryFn: () => getActivity(record!.activity_id),
    enabled: !!record?.activity_id,
  });

  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(recordId);
      // No deps — already deleted (hook toasted): keep today's navigation.
      onDeleteRecord(recordId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const deps = err.dependencies ?? deleteMutation.dependencies ?? [];
        if (deps.length > 0) {
          setDeleteTarget({ id: recordId, deps });
          return;
        }
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [deleteMutation, recordId, onDeleteRecord, showToast]);

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
   * Visitor name/age change — fine-grained: patchVisitor (PATCH) + invalidate
   * ['visitors', clientId] so the canonical hook refetches. No optimistic
   * override layer.
   */
  const handleVisitorChange = useCallback(
    (visitorId: string, data: { name?: string; age?: number | null }) => {
      const apiData = { ...data, age: data.age ?? undefined };
      patchVisitor(visitorId, apiData)
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
    client && 'records_count' in client
      ? {
          recordsCount: client.records_count,
          missedRecords: client.missed_records,
          lastRecord: client.last_record,
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
          onClick={() => void handleDelete()}
          className="text-sm text-red-500 hover:text-red-600 transition-colors shrink-0"
          data-testid="btn-delete-record"
        >
          Удалить запись
        </button>
      </div>

      {/* Delete dialog — Addendum 13: opened on dry-run 409; confirm calls
          resolveDelete (explicit cascade confirmation — no undo timer), then
          keeps today's post-delete navigation via onDeleteRecord. */}
      {deleteTarget && (
        <DeleteDialog
          entityName={formatRecordLabel(activity?.start)}
          entityType="record"
          entityId={deleteTarget.id}
          dependencies={deleteTarget.deps}
          onResolve={async (id, resolutions) => {
            await deleteMutation.resolveDelete.mutateAsync({ id, resolutions });
          }}
          onArchive={async () => { /* records have no archive flow — never Mode B */ }}
          onDone={() => {
            setDeleteTarget(null);
            onDeleteRecord(recordId);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
