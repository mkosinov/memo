'use client';

import React, { useState, useCallback, useRef } from 'react';
import type { RecordResponse, ClientResponse, VisitorResponse, PaymentResponse, TariffResponse, ClientWithStats } from '@memo/api-client';
import type { RecordPatchData } from '@/hooks/useRecordMutations';
import type { VisitStatus } from '@memo/domain';
import { useRouter } from 'next/navigation';
import { RecordSummary } from '@/app/components/shared/record/blocks/RecordSummary';
import { RecordVisitsTable } from '@/app/components/shared/record/blocks/RecordVisitsTable';
import { RecordPaymentsTable } from '@/app/components/shared/record/blocks/RecordPaymentsTable';
import { RecordComments } from '@/app/components/shared/record/blocks/RecordComments';
import { RecordTimestamps } from '@/app/components/shared/record/blocks/RecordTimestamps';
import { ClientStatistics } from '@/app/components/shared/record/blocks/ClientStatistics';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useOptimisticVisitMutation } from '@/hooks/useOptimisticVisitMutation';
import type { RecordWithDerived } from '@/app/components/shared/records/types';
import { computeRecordStatus } from '@memo/domain';
import { safeStatus } from '@/app/lib/status-utils';
import { WaitingIcon, VisitedIcon, MissedIcon, CancelledIcon } from '@/app/components/shared/icons/StatusIcons';

const STATUS_CONFIG: Record<VisitStatus, { label: string; color: string }> = {
  waiting: { label: 'Ожидание', color: '#F59E0B' },
  visited: { label: 'Посетил', color: '#10B981' },
  cancelled: { label: 'Отменён', color: '#6B7280' },
  missed: { label: 'Неявка', color: '#EF4444' },
};

function renderStatusIcon(status: VisitStatus): React.ReactNode {
  const iconClass = 'w-3.5 h-3.5';
  switch (status) {
    case 'waiting': return <WaitingIcon className={iconClass} />;
    case 'visited': return <VisitedIcon className={iconClass} />;
    case 'cancelled': return <CancelledIcon className={iconClass} />;
    case 'missed': return <MissedIcon className={iconClass} />;
  }
}

interface ClientTabProps {
  record: RecordResponse;
  client: ClientResponse | ClientWithStats | undefined;
  visitors: VisitorResponse[];
  visits: RecordResponse['visits'];
  payments: PaymentResponse[];
  serviceTariffs: TariffResponse[];
  onUpdateRecord: (id: string, data: RecordPatchData) => Promise<void>;
  onDeleteRecord: (id: string) => void;
  onAddPayment: (recordId: string, amount: number, method: string) => void;
  onDeletePayment: (paymentId: string) => Promise<void>;
  onAddVisitor?: (data: { name: string; age?: number; price: number }) => Promise<void>;
  showToast: (message: string, undo?: () => void) => void;
  onClose?: () => void;
}

export function ClientTab({
  record,
  client,
  visitors,
  visits,
  payments,
  serviceTariffs,
  onUpdateRecord,
  onDeleteRecord,
  onAddPayment,
  onDeletePayment,
  onAddVisitor,
  showToast,
  onClose,
}: ClientTabProps) {
  const isDeletingRef = useRef(false);
  const router = useRouter();
  const { visitorsMap: realVisitorsMap } = useRecordData(record.id, client?.id ?? '');
  const { updateVisitStatus } = useRecordMutations(record.activity_id ?? '', record.id);

  // Optimistic visit mutation layer
  const {
    mergedVisitorsMap,
    mergedVisits,
    handleVisitorChange,
    handleVisitChange,
    handleVisitPriceChange,
  } = useOptimisticVisitMutation({
    record,
    visitorsMap: realVisitorsMap,
    serviceTariffs,
    onUpdateRecord,
    updateVisitStatus,
    showToast,
  });

  // Derive status from visits
  const status: VisitStatus = computeRecordStatus(
    (visits || []).map(v => ({ id: v.id, status: safeStatus(v.status) })),
  );

  // Comment state
  const [comment, setComment] = useState(record.comment || '');

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    isDeletingRef.current = true;
    showToast('Запись удалена через 5 секунд', () => {
      isDeletingRef.current = false;
    });
    setTimeout(() => {
      if (isDeletingRef.current) {
        onDeleteRecord(record.id);
      }
    }, 5000);
  }, [onDeleteRecord, record.id, showToast]);

  const handleStatusChange = useCallback((newStatus: VisitStatus) => {
    // Update all visits to the new status
    const updatedVisits = (visits || []).map(v => ({
      visitor_id: v.visitor_id,
      price: v.price,
      status: newStatus,
    }));
    onUpdateRecord(record.id, { visits: updatedVisits } as any).catch(() => {
      showToast('Ошибка обновления статуса');
    });
  }, [visits, record.id, onUpdateRecord, showToast]);

  const handleDeleteVisit = useCallback(async (visitId: string) => {
    const remaining = (visits || []).filter(v => v.id !== visitId).map(v => ({
      visitor_id: v.visitor_id,
      price: v.price,
      status: v.status,
    }));
    try {
      await onUpdateRecord(record.id, { visits: remaining } as any);
    } catch {
      showToast('Ошибка удаления посетителя');
    }
  }, [visits, record.id, onUpdateRecord, showToast]);

  const handleAddVisitor = useCallback(async (data: { name: string; age: number | null; tariff_id: string }) => {
    if (onAddVisitor) {
      const tariff = serviceTariffs.find(t => t.id === data.tariff_id);
      await onAddVisitor({ name: data.name, age: data.age ?? undefined, price: tariff?.price ?? 0 });
    }
  }, [onAddVisitor, serviceTariffs]);

  const handleAnonymChange = useCallback((value: number) => {
    onUpdateRecord(record.id, { anonym_visits: value } as any).catch(() => {
      showToast('Ошибка изменения анонимных посетителей');
    });
  }, [record.id, onUpdateRecord, showToast]);

  const handleAddPayment = useCallback((p: { amount: number; method: string }) => {
    onAddPayment(record.id, p.amount, p.method);
  }, [onAddPayment, record.id]);

  const handleDeletePayment = useCallback(async (paymentId: string) => {
    try {
      await onDeletePayment(paymentId);
      showToast('Оплата удалена');
    } catch {
      showToast('Ошибка удаления оплаты');
    }
  }, [onDeletePayment, showToast]);

  const handleCommentChange = useCallback((value: string) => {
    setComment(value);
    onUpdateRecord(record.id, { comment: value } as any).catch(() => {
      showToast('Ошибка сохранения комментария');
    });
  }, [record.id, onUpdateRecord, showToast]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const totalCost = (visits || []).reduce((sum, v) => sum + v.price, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  // Compute stats for ClientStatistics
  const stats = client && 'visits_count' in client
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
          seats={(visits || []).length + (record.anonym_visits ?? 0)}
          status={status}
          onStatusChange={handleStatusChange}
        />

        {/* Client statistics */}
        <ClientStatistics stats={stats} />

        {/* Visits table */}
        <RecordVisitsTable
          visits={mergedVisits}
          visitorsMap={mergedVisitorsMap}
          tariffs={serviceTariffs}
          anonymVisits={record.anonym_visits ?? 0}
          totalCost={totalCost}
          recordStatus={status}
          onChangeVisit={handleVisitChange}
          onChangeVisitor={handleVisitorChange}
          onChangeVisitPrice={handleVisitPriceChange}
          onDeleteVisit={handleDeleteVisit}
          onAnonymVisitsChange={handleAnonymChange}
          onAddVisitor={handleAddVisitor}
        />

        {/* Payments table */}
        <RecordPaymentsTable
          payments={payments}
          onDelete={handleDeletePayment}
          onAdd={handleAddPayment}
        />

        {/* Comment */}
        <RecordComments value={comment} onChange={handleCommentChange} />
      </div>

      {/* Footer — sticky at bottom, outside scroll area */}
      <div className="shrink-0 border-t h-[61px] flex items-center justify-between gap-4 px-4"
           style={{ borderColor: 'var(--line)' }}>
        <RecordTimestamps createdAt={record.created_at} updatedAt={record.updated_at} />
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
