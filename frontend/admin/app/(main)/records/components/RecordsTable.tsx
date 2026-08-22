'use client';

import React, { useState } from 'react';
import { useRecords } from '@/contexts/RecordsContext';
import type { RecordSortField } from '@/contexts/RecordsContext';
import { useRecordData } from '@/hooks/useRecordData';
import type { RecordResponse, ActivityResponse } from '@memo/api-client';
import { displayMasterName } from '@/lib/utils';
import { ClientQuickCard } from './ClientQuickCard';
import { DiamondIcon } from '@/app/components/shared/DiamondIcon';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';
import { ErrorState } from '@/app/components/error';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';

// ─── Column definitions ──────────────────────────────────────────────────

const TABLE_COLUMNS = [
  { key: 'date', label: 'Дата / Время', defaultVisible: true },
  { key: 'client', label: 'Клиент', defaultVisible: true },
  { key: 'guests', label: 'Гостей', defaultVisible: true },
  { key: 'service', label: 'Услуга', defaultVisible: true },
  { key: 'master', label: 'Мастер', defaultVisible: true },
  { key: 'location', label: 'Локация', defaultVisible: true },
  { key: 'status', label: 'Статус', defaultVisible: true },
  { key: 'total', label: 'Сумма', defaultVisible: true },
  { key: 'payment', label: 'Оплата', defaultVisible: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' ', ' ');
}

function formatTime(time: number): string {
  const h = Math.floor(time);
  const m = Math.round((time - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** Normalize JS getDay() (0=Sun..6=Sat) to Mon=0..Sun=6, extract date and startTime. */
function parseActivityStart(start: string): { date: string; day: number; startTime: number } {
  const d = new Date(start);
  const day = (d.getUTCDay() + 6) % 7;
  const startTime = d.getUTCHours() + d.getUTCMinutes() / 60;
  const date = start.slice(0, 10);
  return { date, day, startTime };
}

export function RecordsTable() {
  const {
    records, clients, payments, activities, masters, services, locations,
    total, page, perPage, setPage, setPerPage, sortBy, sortOrder, setSort,
    error, refetch,
  } = useRecords();

  const [selectedRecord, setSelectedRecord] = useState<RecordResponse | null>(null);
  const [clientModalId, setClientModalId] = useState<string | null>(null);

  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('records-columns');
      if (stored) return JSON.parse(stored);
    } catch {}
    return TABLE_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
  });

  const getActivity = (id: string): ActivityResponse | undefined =>
    activities.get(id);

  // Sort is server-driven: header clicks go to the context, indicator reads it
  const sortIcon = (field: string) =>
    sortBy !== field ? ' ↕' : sortOrder === 'asc' ? ' ↑' : ' ↓';
  const totalPages = Math.ceil(total / perPage);

  // PagedListState.setSort is two-arg and applies field+order verbatim
  // (toggle moved OUT of the context — §6.10.4). This pre-#139 table keeps
  // its historical click behavior locally: same field cycles asc→desc, a new
  // field starts asc. After the T8 table migration, DataTable computes this.
  const handleHeaderSort = (field: RecordSortField) => {
    const next = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';
    setSort(field, next);
  };

  // Detail helpers
  const selectedActivity = selectedRecord ? getActivity(selectedRecord.activity_id) : null;
  const selectedClient = selectedRecord?.client_id ? clients.get(selectedRecord.client_id) : null;
  const selectedVisits = selectedRecord?.visits ?? [];
  // Per-record payments for the detail panel come from useRecordData
  // (hook is called unconditionally; ids are empty strings when nothing is selected,
  // which disables the underlying queries).
  const { payments: selectedPayments } = useRecordData(
    selectedRecord?.id ?? '',
    selectedRecord?.client_id ?? '',
  );
  const totalForRecord = (recordId: string): number => {
    const record = records.find((r) => r.id === recordId);
    return record?.visits.reduce((s, v) => s + v.price, 0) ?? 0;
  };
  const paidForRecord = (recordId: string): number => payments.get(recordId) ?? 0;

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="flex">
      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        {/* Column picker bar */}
        <div className="flex items-center justify-end px-4 py-2 border-b" style={{ borderColor: 'var(--line)' }}>
          <ColumnPicker
            columns={TABLE_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleKeys}
            onChange={setVisibleKeys}
            storageKey="records-columns"
          />
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
              {visibleKeys.includes('date') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('date')}>
                Дата / Время {sortIcon('date')}
              </th>
              )}
              {visibleKeys.includes('client') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('client')}>
                Клиент {sortIcon('client')}
              </th>
              )}
              {visibleKeys.includes('guests') && (
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('guests')}>
                Гостей {sortIcon('guests')}
              </th>
              )}
              {visibleKeys.includes('service') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('service')}>
                Услуга {sortIcon('service')}
              </th>
              )}
              {visibleKeys.includes('master') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('master')}>
                Мастер {sortIcon('master')}
              </th>
              )}
              {visibleKeys.includes('location') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('location')}>
                Локация {sortIcon('location')}
              </th>
              )}
              {visibleKeys.includes('status') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('status')}>
                Статус {sortIcon('status')}
              </th>
              )}
              {visibleKeys.includes('total') && (
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('total')}>
                Сумма {sortIcon('total')}
              </th>
              )}
              {visibleKeys.includes('payment') && (
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleHeaderSort('payment')}>
                Оплата {sortIcon('payment')}
              </th>
              )}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const activity = getActivity(record.activity_id);
              const client = record.client_id ? clients.get(record.client_id) : null;
              const service = activity ? services.get(activity.service_id) : null;
              const location = activity ? locations.get(activity.location_id) : null;
              const recordTotal = totalForRecord(record.id);
              const recordPaid = paidForRecord(record.id);
              const isSelected = selectedRecord?.id === record.id;

              return (
                <tr
                  key={record.id}
                  onClick={() => setSelectedRecord(isSelected ? null : record)}
                  className="border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--line)',
                    backgroundColor: isSelected ? 'var(--surface)' : 'transparent',
                  }}
                >
                  {/* Дата / Время */}
                  {visibleKeys.includes('date') && (
                  <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--ink-mid)' }}>
                    {activity ? (() => {
                      const parsed = parseActivityStart(activity.start);
                      return (
                        <>
                          <div className="font-medium" style={{ color: 'var(--ink)' }}>
                            {formatDateRu(parsed.date)}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
                            {formatTime(parsed.startTime)}
                          </div>
                        </>
                      );
                    })() : '—'}
                  </td>
                  )}

                  {/* Клиент */}
                  {visibleKeys.includes('client') && (
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (record.client_id) setClientModalId(record.client_id);
                      }}
                      className="text-sm font-medium transition-colors text-left"
                      style={{ color: 'var(--brand)' }}
                    >
                      {client?.name ?? '—'}
                    </button>
                  </td>
                  )}

                  {/* Гостей */}
                  {visibleKeys.includes('guests') && (
                  <td className="px-4 py-3 text-center text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {Math.max(1, record.visits.length)}
                  </td>
                  )}

                  {/* Услуга */}
                  {visibleKeys.includes('service') && (
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink)' }}>
                    <div className="flex items-center gap-2">
                      {activity?.is_private ? (
                        <DiamondIcon className="mr-1" />
                      ) : null}
                      {service?.title ?? '—'}
                    </div>
                  </td>
                  )}

                  {/* Мастер */}
                  {visibleKeys.includes('master') && (
                  <td className="px-4 py-3">
                    {activity ? (() => {
                      const master = masters.get(activity.master_id);
                      return (
                        <div
                          className="w-5 h-5 rounded-full"
                          style={{ backgroundColor: master?.color || '#999' }}
                          title={master ? displayMasterName(master) : undefined}
                        />
                      );
                    })() : '—'}
                  </td>
                  )}

                  {/* Локация */}
                  {visibleKeys.includes('location') && (
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {location?.name ?? '—'}
                  </td>
                  )}

                  {/* Статус */}
                  {visibleKeys.includes('status') && (
                  <td className="px-4 py-3">
                    <StatusBadge status={safeStatus(record.status)} />
                  </td>
                  )}

                  {/* Сумма */}
                  {visibleKeys.includes('total') && (
                  <td className="px-4 py-3 text-sm text-right font-medium" style={{ color: 'var(--ink)' }}>
                    {formatPrice(recordTotal)}
                  </td>
                  )}

                  {/* Оплата */}
                  {visibleKeys.includes('payment') && (
                  <td className="px-4 py-3 text-center">
                    {recordPaid >= recordTotal ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--success)' }}>✓ Оплачено</span>
                    ) : recordPaid > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--warning)' }}>Частично ({formatPrice(recordPaid)})</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--danger)' }}>Не оплачено</span>
                    )}
                  </td>
                  )}
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={visibleKeys.length} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
                  Записи не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-light)' }}>
            <span>Строк:</span>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              className="border rounded px-2 py-1 text-xs"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)', color: 'var(--ink)' }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>{total} всего</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-sm rounded border disabled:opacity-30"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              ←
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1 text-sm rounded border ${p === page ? 'font-bold' : ''}`}
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: p === page ? 'var(--brand)' : 'transparent',
                  color: p === page ? 'white' : 'var(--ink)',
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm rounded border disabled:opacity-30"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              →
            </button>
          </div>
        </div>
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

      {/* Client Card Modal */}
      {clientModalId && (
        <ClientQuickCard
          clientId={clientModalId}
          onClose={() => setClientModalId(null)}
        />
      )}
    </div>
  );
}
