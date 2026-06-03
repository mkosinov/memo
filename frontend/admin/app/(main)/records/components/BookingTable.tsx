'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  RECORDS, BOOKING_ACTIVITIES, CLIENTS, VISITS, VISITORS, PAYMENTS,
} from '@/lib/mock-data';
import { SERVICES, LOCATIONS, ARTISTS } from '@/lib/mock-data';
import type { BookingRecord, Activity } from '@memo/domain';
import { ClientCardModal } from './ClientCardModal';
import { DiamondIcon } from '@/app/components/shared/DiamondIcon';

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

const STATUS_LABELS: Record<string, string> = {
  WAITING: 'Ожидание',
  VISITED: 'Посетили',
  MISSED: 'Неявка',
  CANCELLED: 'Отменена',
};

const STATUS_COLORS: Record<string, string> = {
  WAITING: 'bg-gray-100 text-gray-600',
  VISITED: 'bg-emerald-100 text-emerald-700',
  MISSED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-amber-100 text-amber-700',
};

interface BookingTableProps {
  filters: {
    dateFrom: string;
    dateTo: string;
    locationId: string;
    serviceId: string;
    masterId: string;
    status: string;
  };
}

export function BookingTable({ filters }: BookingTableProps) {
  const [selectedRecord, setSelectedRecord] = useState<BookingRecord | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [clientModalId, setClientModalId] = useState<string | null>(null);

  const getActivity = (id: string): Activity | undefined =>
    BOOKING_ACTIVITIES.find((a) => a.id === id);

  const filteredRecords = useMemo(() => {
    return RECORDS.filter((r) => {
      const activity = getActivity(r.activityId);
      if (!activity) return false;
      // Date range
      if (filters.dateFrom && activity.date && activity.date < filters.dateFrom) return false;
      if (filters.dateTo && activity.date && activity.date > filters.dateTo) return false;
      // Location
      if (filters.locationId && activity.locationId !== filters.locationId) return false;
      // Service
      if (filters.serviceId && activity.serviceId !== filters.serviceId) return false;
      // Master
      if (filters.masterId && activity.masterId !== filters.masterId) return false;
      // Status
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
  }, [filters]);

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
      const aAct = getActivity(a.activityId);
      const bAct = getActivity(b.activityId);
      let cmp = 0;
      switch (sortField) {
        case 'date': {
          const aDate = aAct?.date;
          const bDate = bAct?.date;
          // Activities with dates come first
          if (aDate && !bDate) { cmp = -1; break; }
          if (!aDate && bDate) { cmp = 1; break; }
          if (aDate && bDate) {
            cmp = aDate.localeCompare(bDate);
            if (cmp === 0) cmp = (aAct?.startTime || 0) - (bAct?.startTime || 0);
          } else {
            // Both don't have dates — sort by day index (0=Mon first), then startTime
            const aDay = aAct?.day ?? 0;
            const bDay = bAct?.day ?? 0;
            cmp = aDay - bDay;
            if (cmp === 0) cmp = (aAct?.startTime || 0) - (bAct?.startTime || 0);
          }
          break;
        }
        case 'client': {
          const aCl = CLIENTS.find((c) => c.id === a.clientId)?.name || '';
          const bCl = CLIENTS.find((c) => c.id === b.clientId)?.name || '';
          cmp = aCl.localeCompare(bCl);
          break;
        }
        case 'service': {
          const aSvc = aAct ? SERVICES.find((s) => s.id === aAct.serviceId)?.name || '' : '';
          const bSvc = bAct ? SERVICES.find((s) => s.id === bAct.serviceId)?.name || '' : '';
          cmp = aSvc.localeCompare(bSvc);
          break;
        }
        case 'master': {
          const aMst = aAct ? ARTISTS.find((a) => a.id === aAct.masterId)?.shortName || '' : '';
          const bMst = bAct ? ARTISTS.find((a) => a.id === bAct.masterId)?.shortName || '' : '';
          cmp = aMst.localeCompare(bMst);
          break;
        }
        case 'location': {
          const aLoc = aAct ? LOCATIONS.find((l) => l.id === aAct.locationId)?.name || '' : '';
          const bLoc = bAct ? LOCATIONS.find((l) => l.id === bAct.locationId)?.name || '' : '';
          cmp = aLoc.localeCompare(bLoc);
          break;
        }
        case 'guests': {
          const aG = VISITS.filter((v) => v.recordId === a.id).length;
          const bG = VISITS.filter((v) => v.recordId === b.id).length;
          cmp = aG - bG;
          break;
        }
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'total': {
          const aTot = VISITS.filter((v) => v.recordId === a.id).reduce((s, v) => s + v.priceCharged, 0);
          const bTot = VISITS.filter((v) => v.recordId === b.id).reduce((s, v) => s + v.priceCharged, 0);
          cmp = aTot - bTot;
          break;
        }
        case 'payment': {
          const aTot2 = VISITS.filter((v) => v.recordId === a.id).reduce((s, v) => s + v.priceCharged, 0);
          const bTot2 = VISITS.filter((v) => v.recordId === b.id).reduce((s, v) => s + v.priceCharged, 0);
          const aPaid = PAYMENTS.filter((p) => p.recordId === a.id && p.paid).reduce((s, p) => s + p.amount, 0);
          const bPaid = PAYMENTS.filter((p) => p.recordId === b.id && p.paid).reduce((s, p) => s + p.amount, 0);
          const aLevel = aPaid >= aTot2 ? 0 : aPaid > 0 ? 1 : 2;
          const bLevel = bPaid >= bTot2 ? 0 : bPaid > 0 ? 1 : 2;
          cmp = aLevel - bLevel;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRecords, sortField, sortDir]);

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
  const selectedActivity = selectedRecord ? getActivity(selectedRecord.activityId) : null;
  const selectedClient = selectedRecord ? CLIENTS.find((c) => c.id === selectedRecord.clientId) : null;
  const selectedVisits = selectedRecord ? VISITS.filter((v) => v.recordId === selectedRecord.id) : [];
  const selectedPayments = selectedRecord ? PAYMENTS.filter((p) => p.recordId === selectedRecord.id) : [];
  const totalForRecord = (recordId: string): number =>
    VISITS.filter((v) => v.recordId === recordId).reduce((s, v) => s + v.priceCharged, 0);
  const paidForRecord = (recordId: string): number =>
    PAYMENTS.filter((p) => p.recordId === recordId && p.paid).reduce((s, p) => s + p.amount, 0);

  return (
    <div className="flex">
      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('date')}>
                Дата / Время {sortIcon('date')}
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('client')}>
                Клиент {sortIcon('client')}
              </th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('guests')}>
                Гостей {sortIcon('guests')}
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('service')}>
                Услуга {sortIcon('service')}
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('master')}>
                Мастер {sortIcon('master')}
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('location')}>
                Локация {sortIcon('location')}
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('status')}>
                Статус {sortIcon('status')}
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('total')}>
                Сумма {sortIcon('total')}
              </th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" style={{ color: 'var(--ink-light)' }} onClick={() => handleSort('payment')}>
                Оплата {sortIcon('payment')}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.map((record) => {
              const activity = getActivity(record.activityId);
              const client = CLIENTS.find((c) => c.id === record.clientId);
              const service = activity ? SERVICES.find((s) => s.id === activity.serviceId) : null;
              const location = activity ? LOCATIONS.find((l) => l.id === activity.locationId) : null;
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
                  <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--ink-mid)' }}>
                    {activity ? (
                      <>
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>
                          {activity.date ? formatDateRu(activity.date) : `День ${activity.day + 1}`}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
                          {formatTime(activity.startTime)}
                        </div>
                      </>
                    ) : '—'}
                  </td>

                  {/* Клиент */}
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setClientModalId(record.clientId);
                      }}
                      className="text-sm font-medium transition-colors text-left"
                      style={{ color: 'var(--brand)' }}
                    >
                      {client?.name ?? '—'}
                    </button>
                  </td>

                  {/* Гостей */}
                  <td className="px-4 py-3 text-center text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {Math.max(1, VISITS.filter((v) => v.recordId === record.id).length)}
                  </td>

                  {/* Услуга */}
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink)' }}>
                    <div className="flex items-center gap-2">
                      {activity?.isPrivate ? (
                        <DiamondIcon className="mr-1" />
                      ) : null}
                      {service?.name ?? '—'}
                    </div>
                  </td>

                  {/* Мастер */}
                  <td className="px-4 py-3">
                    {activity ? (
                      <div
                        className="w-5 h-5 rounded-full"
                        style={{ backgroundColor: ARTISTS.find((a) => a.id === activity.masterId)?.color || '#999' }}
                        title={ARTISTS.find((a) => a.id === activity.masterId)?.shortName}
                      />
                    ) : '—'}
                  </td>

                  {/* Локация */}
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {location?.name ?? '—'}
                  </td>

                  {/* Статус */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[record.status]}`}>
                      {STATUS_LABELS[record.status]}
                    </span>
                  </td>

                  {/* Сумма */}
                  <td className="px-4 py-3 text-sm text-right font-medium" style={{ color: 'var(--ink)' }}>
                    {formatPrice(total)}
                  </td>

                  {/* Оплата */}
                  <td className="px-4 py-3 text-center">
                    {paid >= total ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--success)' }}>✓ Оплачено</span>
                    ) : paid > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--warning)' }}>Частично ({formatPrice(paid)})</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--danger)' }}>Не оплачено</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {paginatedRecords.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
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
                setClientModalId(selectedRecord.clientId);
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
              {SERVICES.find((s) => s.id === selectedActivity.serviceId)?.name}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--ink-light)' }}>
              {selectedActivity.date ? formatDateRu(selectedActivity.date) : `День ${selectedActivity.day + 1}`} · {formatTime(selectedActivity.startTime)}
            </div>
            <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
              {LOCATIONS.find((l) => l.id === selectedActivity.locationId)?.name} · {ARTISTS.find((a) => a.id === selectedActivity.masterId)?.name}
            </div>
            <div className="mt-2">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[selectedRecord.status]}`}>
                {STATUS_LABELS[selectedRecord.status]}
              </span>
            </div>
          </div>

          {/* Visitors & Pricing */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--ink-light)' }}>Посетители и цены</div>
            <div className="space-y-2">
              {selectedVisits.map((visit) => {
                const visitor = VISITORS.find((v) => v.id === visit.visitorId);
                return (
                  <div key={visit.id} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <span style={{ color: 'var(--ink)' }}>{visitor?.name ?? '—'}</span>
                      {visitor && !visitor.isAdult && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{visitor.age} лет</span>
                      )}
                      {visit.isPrimary && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">Осн.</span>
                      )}
                    </div>
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>{formatPrice(visit.priceCharged)}</span>
                  </div>
                );
              })}
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
                        <span className={`w-2 h-2 rounded-full ${payment.paid ? 'bg-emerald-500' : 'bg-red-400'}`} />
                        <span style={{ color: 'var(--ink-mid)' }}>{payment.method ? methodLabels[payment.method] ?? payment.method : 'Без метода'}</span>
                      </div>
                      <span className={`font-medium ${payment.paid ? 'text-emerald-600' : 'text-red-500'}`}>{formatPrice(payment.amount)}</span>
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
