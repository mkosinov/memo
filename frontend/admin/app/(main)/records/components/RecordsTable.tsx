'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRecords } from '@/contexts/RecordsContext';
import type { RecordResponse, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';
import { useRecordData } from '@/hooks/useRecordData';
import { useDeleteRecord } from '@/hooks/useDeleteRecord';
import { useUI } from '@/contexts/UIContext';
import { displayMasterName, formatRecordLabel, formatTime } from '@/lib/utils';
import { DataTable } from '@/app/components/shared/DataTable';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { ClientQuickCard } from './ClientQuickCard';
import { recordColumns, recordsActions, formatPrice, formatDateRu, parseActivityStart } from './recordsColumns';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';

export function RecordsTable() {
  const recordsCtx = useRecords();
  const {
    records, clients, activities, masters, services, locations,
  } = recordsCtx;
  const { showToast } = useUI();

  const [selectedRecord, setSelectedRecord] = useState<RecordResponse | null>(null);
  const [clientModalId, setClientModalId] = useState<string | null>(null);

  // Delete — Addendum 13 / GH #139 T8: shared dry-run hook + dialog. Mirrors
  // the FE2a call sites (ClientRecordTab/ClientTab) EXACTLY: no-body DELETE →
  // 204 (instant, hook toasts) or 409 → park deps + open DeleteDialog; the
  // dialog confirms via resolveDelete.
  const deleteMutation = useDeleteRecord();
  const [deleteTarget, setDeleteTarget] = useState<{
    record: RecordResponse;
    deps: DependencyNode[];
  } | null>(null);

  const handleDelete = useCallback(async (record: RecordResponse) => {
    try {
      await deleteMutation.mutateAsync(record.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const deps = err.dependencies ?? deleteMutation.dependencies ?? [];
        if (deps.length > 0) {
          setDeleteTarget({ record, deps });
          return;
        }
      }
      showToast(
        err instanceof Error ? err.message : 'Не удалось удалить. Попробуйте ещё раз.',
        'error',
      );
    }
  }, [deleteMutation, showToast]);

  // §6.15 — memoize the factory outputs. The columns closure captures the
  // current reference maps (recomputes when they change). The actions memo is
  // NOT referentially stable: useDeleteRecord returns a fresh mutation object
  // identity every render, so handleDelete — and with it this useMemo —
  // recomputes on every render. Harmless: DataTable does not depend on the
  // referential stability of `actions`.
  const columns = useMemo(
    () =>
      recordColumns({
        activities,
        clients,
        masters,
        services,
        locations,
        payments: recordsCtx.payments,
        onClientClick: (r) => {
          if (r.client_id) setClientModalId(r.client_id);
        },
      }),
    [activities, clients, masters, services, locations, recordsCtx.payments],
  );
  const actions = useMemo(
    () => recordsActions({ onDelete: (r) => void handleDelete(r) }),
    [handleDelete],
  );

  // ─── Detail panel helpers ───────────────────────────────────────────────

  const selectedActivity = selectedRecord ? activities.get(selectedRecord.activity_id) ?? null : null;
  const selectedClient = selectedRecord?.client_id ? clients.get(selectedRecord.client_id) ?? null : null;
  const selectedVisits = selectedRecord?.visits ?? [];
  // Per-record payments for the detail panel come from useRecordData
  // (hook is called unconditionally; ids are empty strings when nothing is
  // selected, which disables the underlying queries).
  const { payments: selectedPayments } = useRecordData(
    selectedRecord?.id ?? '',
    selectedRecord?.client_id ?? '',
  );
  const totalForRecord = (recordId: string): number => {
    const record = records.find((r) => r.id === recordId);
    return record?.visits.reduce((s, v) => s + v.price, 0) ?? 0;
  };

  return (
    <div className="flex">
      {/* Table — shared DataTable (spec §6.6 thin wrapper; the toolbar/pager/
          ColumnPicker/ErrorState/empty state live inside DataTable). The
          wrapper keeps the pre-#139 `overflow-x-auto` (Addendum 11 wrapper
          parity): without it the flex item's automatic min-width resolves to
          the table's min-content and pushes the 360px detail panel past the
          page card's overflow-hidden right edge on wide rows. */}
      <div className="flex-1 overflow-x-auto">
        <DataTable<RecordResponse>
          storageKey="records-columns"
          columns={columns}
          tableState={recordsCtx}
          actions={actions}
          onRowClick={(r) =>
            setSelectedRecord((sel) => (sel?.id === r.id ? null : r))
          }
          // Selected row carries the surface token (per the locked plan
          // wiring — replaces the pre-#139 inline backgroundColor).
          rowClassName={(r) => (selectedRecord?.id === r.id ? 'bg-surface' : undefined)}
          rowKey={(r) => r.id}
          // NO rowTestId (Addendum 6): the pre-#139 records table had none
          // — grep-verified (visual spec: "No row testids"); the prop exists
          // only to preserve EXISTING prefixes.
          // NO emptyLabel (Addendum 12): unified «Нет записей» default.
        />
      </div>

      {/* Detail Panel */}
      {selectedRecord && selectedActivity && (
        <div className="w-[360px] border-l overflow-auto p-4 space-y-4" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
          <div className="flex justify-between items-start">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Детали записи</h3>
            <button
              onClick={() => setSelectedRecord(null)}
              className="text-lg leading-none transition-colors"
              style={{ color: 'var(--ink-light)' }}
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>

          {/* Client Card */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--ink-light)' }}>Клиент</div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (selectedRecord.client_id) setClientModalId(selectedRecord.client_id);
              }}
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--brand)' }}
            >
              {selectedClient?.name ?? '—'}
            </button>
            {selectedClient && (
              <div className="text-xs mt-1" style={{ color: 'var(--ink-light)' }}>{selectedClient.phone}</div>
            )}
          </div>

          {/* Activity Card */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--ink-light)' }}>Занятие</div>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {services.get(selectedActivity.service_id)?.title}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--ink-light)' }}>
              {(() => {
                const parsed = parseActivityStart(selectedActivity.start);
                return (
                  <>
                    {formatDateRu(parsed.date)} · {formatTime(parsed.startTime)}
                  </>
                );
              })()}
            </div>
            <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
              {locations.get(selectedActivity.location_id)?.name} · {masters.get(selectedActivity.master_id) ? displayMasterName(masters.get(selectedActivity.master_id)!) : '—'}
            </div>
            <div className="mt-2">
              <StatusBadge status={safeStatus(selectedRecord.status)} />
            </div>
          </div>

          {/* Visitors & Pricing */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--ink-light)' }}>Посетители и цены</div>
            <div className="space-y-2">
              {selectedVisits.map((visit) => (
                <div key={visit.id} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--ink)' }}>Посетитель</span>
                  </div>
                  <span className="font-medium" style={{ color: 'var(--ink)' }}>{formatPrice(visit.price)}</span>
                </div>
              ))}
              <div className="border-t pt-2 mt-2 flex justify-between text-sm font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
                <span>Итого</span>
                <span>{formatPrice(totalForRecord(selectedRecord.id))}</span>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--ink-light)' }}>Оплата</div>
            {selectedPayments.length > 0 ? (
              <div className="space-y-2">
                {selectedPayments.map((payment) => {
                  const methodLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };
                  return (
                    <div key={payment.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span style={{ color: 'var(--ink-mid)' }}>{payment.method ? methodLabels[payment.method] ?? payment.method : 'Без метода'}</span>
                      </div>
                      <span className="font-medium text-emerald-600">{formatPrice(payment.amount)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--ink-light)' }}>Нет платежей</div>
            )}
          </div>

          {/* Comment */}
          {selectedRecord.comment && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--ink-light)' }}>Комментарий</div>
              <div className="text-sm" style={{ color: 'var(--ink-mid)' }}>{selectedRecord.comment}</div>
            </div>
          )}
        </div>
      )}

      {/* Delete dialog — Addendum 13: opened on dry-run 409, closed on
          done/cancel. Mirrors ClientRecordTab exactly (FE2a). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={formatRecordLabel(activities.get(deleteTarget.record.activity_id)?.start)}
          entityType="record"
          entityId={deleteTarget.record.id}
          dependencies={deleteTarget.deps}
          onResolve={async (id, resolutions) => {
            await deleteMutation.resolveDelete.mutateAsync({ id, resolutions });
          }}
          onArchive={async () => { /* records have no archive flow — never Mode B */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Client Quick Card (records-side read-only viewer, §6.13 rename) */}
      {clientModalId && (
        <ClientQuickCard
          clientId={clientModalId}
          onClose={() => setClientModalId(null)}
        />
      )}
    </div>
  );
}
