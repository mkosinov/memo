'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRecords } from '@/contexts/RecordsContext';
import type { RecordResponse, ActivityResponse } from '@memo/api-client';
import { displayMasterName } from '@/lib/utils';
import { ClientCardModal } from './ClientCardModal';
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

interface RecordsTableProps {
  filters: {
    dateFrom: string;
    dateTo: string;
    locationId: string;
    serviceId: string;
    masterId: string;
    status: string;
  };
}

export function RecordsTable({ filters }: RecordsTableProps) {
  const { records, clients, payments, activities, masters, services, locations, error, refetch } = useRecords();

  const [selectedRecord, setSelectedRecord] = useState<RecordResponse | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
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

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const activity = getActivity(r.activity_id);
      if (!activity) return false;
      const { date } = parseActivityStart(activity.start);
      // Date range
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
      // Location
      if (filters.locationId && activity.location_id !== filters.locationId) return false;
      // Service
      if (filters.serviceId && activity.service_id !== filters.serviceId) return false;
      // Master
      if (filters.masterId && activity.master_id !== filters.masterId) return false;
      // Status
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
  }, [records, filters, activities]);

  // Sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const sortedRecords = useMemo(() => {
    if (!sortField) return filteredRecords;
    const sorted = [...filteredRecords];
    sorted.sort((a, b) => {
      const aAct = getActivity(a.activity_id);
      const bAct = getActivity(b.activity_id);
      let cmp = 0;
      switch (sortField) {
        case 'date': {
          const aParsed = aAct ? parseActivityStart(aAct.start) : null;
          const bParsed = bAct ? parseActivityStart(bAct.start) : null;
          if (aParsed && !bParsed) { cmp = -1; break; }
          if (!aParsed && bParsed) { cmp = 1; break; }
          if (aParsed && bParsed) {
            cmp = aParsed.date.localeCompare(bParsed.date);
            if (cmp === 0) cmp = aParsed.startTime - bParsed.startTime;
          } else {
            cmp = 0;
          }
          break;
        }
        case 'client': {
          const aCl = a.client_id ? clients.get(a.client_id)?.name || '' : '';
          const bCl = b.client_id ? clients.get(b.client_id)?.name || '' : '';
          cmp = aCl.localeCompare(bCl);
          break;
        }
        case 'service': {
          const aSvc = aAct ? services.get(aAct.service_id)?.title || '' : '';
          const bSvc = bAct ? services.get(bAct.service_id)?.title || '' : '';
          cmp = aSvc.localeCompare(bSvc);
          break;
        }
        case 'master': {
          const aMst = aAct ? displayMasterName(masters.get(aAct.master_id) ?? { first_name: '', last_name: '' }) : '';
          const bMst = bAct ? displayMasterName(masters.get(bAct.master_id) ?? { first_name: '', last_name: '' }) : '';
          cmp = aMst.localeCompare(bMst);
          break;
        }
        case 'location': {
          const aLoc = aAct ? locations.get(aAct.location_id)?.name || '' : '';
          const bLoc = bAct ? locations.get(bAct.location_id)?.name || '' : '';
          cmp = aLoc.localeCompare(bLoc);
          break;
        }
        case 'guests': {
          cmp = a.visits.length - b.visits.length;
          break;
        }
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'total': {
          const aTot = a.visits.reduce((s, v) => s + v.price, 0);
          const bTot = b.visits.reduce((s, v) => s + v.price, 0);
          cmp = aTot - bTot;
          break;
        }
        case 'payment': {
          const aTot2 = a.visits.reduce((s, v) => s + v.price, 0);
          const bTot2 = b.visits.reduce((s, v) => s + v.price, 0);
          const aPaid = (payments.get(a.id) ?? []).reduce((s, p) => s + p.amount, 0);
          const bPaid = (payments.get(b.id) ?? []).reduce((s, p) => s + p.amount, 0);
          const aLevel = aPaid >= aTot2 ? 0 : aPaid > 0 ? 1 : 2;
          const bLevel = bPaid >= bTot2 ? 0 : bPaid > 0 ? 1 : 2;
          cmp = aLevel - bLevel;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRecords, sortField, sortDir, clients, services, masters, locations, payments]);

  // Pagination
  const paginatedRecords = useMemo(() => {
    return sortedRecords.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedRecords, page, pageSize]);

  const totalPages = Math.ceil(sortedRecords.length / pageSize);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filters]);

  // Detail helpers
  const selectedActivity = selectedRecord ? getActivity(selectedRecord.activity_id) : null;
  const selectedClient = selectedRecord?.client_id ? clients.get(selectedRecord.client_id) : null;
  const selectedVisits = selectedRecord?.visits ?? [];
  const selectedPayments = selectedRecord ? (payments.get(selectedRecord.id) ?? []) : [];
  const totalForRecord = (recordId: string): number => {
    const record = records.find((r) => r.id === recordId);
    return record?.visits.reduce((s, v) => s + v.price, 0) ?? 0;
  };
  const paidForRecord = (recordId: string): number =>
    (payments.get(recordId) ?? []).reduce((s, p) => s + p.amount, 0);

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
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('date')}>
                Дата / Время {sortIcon('date')}
              </th>
              )}
              {visibleKeys.includes('client') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('client')}>
                Клиент {sortIcon('client')}
              </th>
              )}
              {visibleKeys.includes('guests') && (
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('guests')}>
                Гостей {sortIcon('guests')}
              </th>
              )}
              {visibleKeys.includes('service') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('service')}>
                Услуга {sortIcon('service')}
              </th>
              )}
              {visibleKeys.includes('master') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('master')}>
                Мастер {sortIcon('master')}
              </th>
              )}
              {visibleKeys.includes('location') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('location')}>
                Локация {sortIcon('location')}
              </th>
              )}
              {visibleKeys.includes('status') && (
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('status')}>
                Статус {sortIcon('status')}
              </th>
              )}
              {visibleKeys.includes('total') && (
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('total')}>
                Сумма {sortIcon('total')}
              </th>
              )}
              {visibleKeys.includes('payment') && (
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('payment')}>
                Оплата {sortIcon('payment')}
              </th>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.map((record) => {
              const activity = getActivity(record.activity_id);
              const client = record.client_id ? clients.get(record.client_id) : null;
              const service = activity ? services.get(activity.service_id) : null;
              const location = activity ? locations.get(activity.location_id) : null;
              const total = totalForRecord(record.id);
              const paid = paidForRecord(record.id);
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
                    {formatPrice(total)}
                  </td>
                  )}

                  {/* Оплата */}
                  {visibleKeys.includes('payment') && (
                  <td className="px-4 py-3 text-center">
                    {paid >= total ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--success)' }}>✓ Оплачено</span>
                    ) : paid > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--warning)' }}>Частично ({formatPrice(paid)})</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--danger)' }}>Не оплачено</span>
                    )}
                  </td>
                  )}
                </tr>
              );
            })}
            {paginatedRecords.length === 0 && (
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
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
              className="border rounded px-2 py-1 text-xs"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)', color: 'var(--ink)' }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>{sortedRecords.length} всего</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm rounded border disabled:opacity-30"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              ←
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`px-3 py-1 text-sm rounded border ${i === page ? 'font-bold' : ''}`}
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: i === page ? 'var(--brand)' : 'transparent',
                  color: i === page ? 'white' : 'var(--ink)',
                }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
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
        <ClientCardModal
          clientId={clientModalId}
          onClose={() => setClientModalId(null)}
        />
      )}
    </div>
  );
}
