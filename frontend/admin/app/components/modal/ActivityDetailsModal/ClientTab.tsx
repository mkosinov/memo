'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { RecordResponse, ClientResponse, VisitorResponse, PaymentResponse, TariffResponse } from '@memo/api-client';
import type { RecordPatchData } from '@/hooks/useRecordMutations';
import type { VisitStatus } from '@memo/domain';
import { useRouter } from 'next/navigation';
import { RecordHeader } from '@/app/components/shared/records/RecordHeader';
import { RecordVisitRow } from '@/app/components/shared/records/RecordVisitRow';
import { PaymentList } from '@/app/components/shared/payments/PaymentList';
import { PaymentForm } from '@/app/components/shared/payments/PaymentForm';
import { PaymentTotals } from '@/app/components/shared/payments/PaymentTotals';
import { AddVisitorForm } from '@/app/components/shared/visitors/AddVisitorForm';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import type { RecordWithDerived } from '@/app/components/shared/records/types';
import { computeRecordStatus } from '@memo/domain';
import { safeStatus } from '@/app/lib/status-utils';
import { formatSeats } from '@/app/lib/pluralize';

interface ClientTabProps {
  record: RecordResponse;
  client: ClientResponse | undefined;
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
  const { visitorsMap } = useRecordData(record.id, client?.id ?? '');
  const { updateVisitStatus } = useRecordMutations(record.activity_id ?? '', record.id);

  // Derive status from visits (atom pattern)
  const status: VisitStatus = computeRecordStatus(
    (visits || []).map(v => ({ id: v.id, status: safeStatus(v.status) })),
  );

  // Build RecordWithDerived for atom consumption
  const recordData: RecordWithDerived = {
    record,
    status,
    visits: visits || [],
    payments,
    client: client ? { id: client.id, name: client.name, phone: client.phone } : null,
    tariffs: serviceTariffs,
  };

  // ── Surface-specific handlers ─────────────────────────────────────────────

  const handleOpenProfile = useCallback(() => {
    if (!client) return;
    onClose?.();
    router.push(`/clients?clientId=${client.id}`);
  }, [client, onClose, router]);

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

  const handleAnonymChange = useCallback((value: number) => {
    onUpdateRecord(record.id, { anonym_visits: value } as any).catch(() => {
      showToast('Ошибка изменения анонимных посетителей');
    });
  }, [record.id, onUpdateRecord, showToast]);

  const handleVisitChange = useCallback((visitId: string, data: { status?: VisitStatus; name?: string; age?: number | null; tariff_id?: string }) => {
    // Status-only changes → dedicated endpoint
    if (data.status !== undefined && data.name === undefined && data.age === undefined && data.tariff_id === undefined) {
      updateVisitStatus(visitId, data.status);
      return;
    }
    // Non-status changes → full visit update via record patch
    const updatedVisits = (visits || []).map(v => {
      if (v.id !== visitId) return { visitor_id: v.visitor_id, price: v.price, status: v.status };
      return {
        visitor_id: v.visitor_id,
        price: v.price,
        status: data.status || v.status,
        name: data.name,
        age: data.age,
        tariff_id: data.tariff_id,
      };
    });
    onUpdateRecord(record.id, { visits: updatedVisits } as any).catch(() => {
      showToast('Ошибка обновления посетителя');
    });
  }, [visits, record.id, onUpdateRecord, showToast, updateVisitStatus]);

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

  const totalCost = (visits || []).reduce((sum, v) => sum + v.price, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4 p-4" data-testid="client-tab">
      {/* Record header with name, phone, status, anonym_visits */}
      <RecordHeader data={recordData} onAnonymVisitsChange={handleAnonymChange} />

      {/* Client link */}
      {client && (
        <div>
          <button
            onClick={handleOpenProfile}
            className="inline-flex items-center gap-1.5 text-brand text-xs hover:underline"
            data-testid="client-link"
            type="button"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Открыть профиль
          </button>
        </div>
      )}

      {/* Visitors — shared atom rows */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-ink-mid">Посетители</h4>
          <span className="text-xs text-ink-mid" data-testid="record-seats">
            {formatSeats(record.seats)}
          </span>
        </div>

        {visits.length === 0 && (
          <p className="text-xs text-ink-light">Нет посетителей</p>
        )}

        {visits.map((visit) => {
          const visitor = visitorsMap.get(visit.visitor_id ?? '');
          return (
            <RecordVisitRow
              key={visit.id}
              visit={visit}
              visitorName={visitor?.name}
              visitorAge={visitor?.age}
              tariffId={visit.tariff_id ?? ''}
              tariffs={serviceTariffs}
              onChange={(data) => handleVisitChange(visit.id, data)}
              onDelete={() => handleDeleteVisit(visit.id)}
            />
          );
        })}

        <AddVisitorForm tariffs={serviceTariffs} onAdd={handleAddVisitor} onCancel={() => {}} />
      </div>

      {/* Payment section — shared atoms */}
      <div className="space-y-2" data-testid="payment-summary">
        <h4 className="text-xs font-medium text-ink-mid">Оплата</h4>
        <PaymentTotals total={totalCost} paid={totalPaid} />
        <PaymentList payments={payments} onDelete={handleDeletePayment} />
        <div className="mt-2">
          <PaymentForm total={totalCost} paid={totalPaid} onSubmit={handleAddPayment} />
        </div>
      </div>

      {/* Delete button */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={handleDelete}
          className="text-sm text-red-500 hover:text-red-600 transition-colors"
          data-testid="btn-delete-record"
        >
          Удалить запись
        </button>
      </div>
    </div>
  );
}
