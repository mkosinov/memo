'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  RECORDS, BOOKING_ACTIVITIES, CLIENTS, VISITS, VISITORS, PAYMENTS,
} from '@/lib/mock-data';
import { SERVICES, LOCATIONS, ARTISTS } from '@/lib/mock-data';
import type { BookingRecord, Activity } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const STATUS_LABELS: Record<string, string> = {
  WAITING: 'Ожидание',
  VISITED: 'Посетили',
  MISSED: 'Неявка',
  CANCELLED: 'Отменена',
};

const STATUS_COLORS: Record<string, string> = {
  WAITING: 'bg-amber-100 text-amber-700',
  VISITED: 'bg-emerald-100 text-emerald-700',
  MISSED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-700',
};

interface BookingTableProps {
  filters: {
    date: string;
    locationId: string;
    serviceId: string;
    status: string;
  };
}

export function BookingTable({ filters }: BookingTableProps) {
  const [selectedRecord, setSelectedRecord] = useState<BookingRecord | null>(null);

  const getActivity = (id: string): Activity | undefined =>
    BOOKING_ACTIVITIES.find((a) => a.id === id);

  const filteredRecords = useMemo(() => {
    return RECORDS.filter((r) => {
      const activity = getActivity(r.activityId);
      if (!activity) return false;
      if (filters.date && activity.date && activity.date !== filters.date) return false;
      if (filters.locationId && activity.locationId !== filters.locationId) return false;
      if (filters.serviceId && activity.serviceId !== filters.serviceId) return false;
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
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
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Клиент</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Услуга</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Дата / Время</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Локация</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Статус</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Сумма</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>Оплата</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record) => {
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
                  <td className="px-4 py-3">
                    <Link
                      href={`/clients/${record.clientId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium transition-colors"
                      style={{ color: 'var(--brand)' }}
                    >
                      {client?.name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink)' }}>
                    <div className="flex items-center gap-2">
                      {activity?.isPrivate ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--danger)' }}>ИНД</span>
                      ) : null}
                      {service?.name ?? '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {activity ? (
                      <>
                        <div>{activity.date ? formatDate(activity.date) : `День ${activity.day + 1}`}</div>
                        <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
                          {activity.startTime}–{activity.startTime + activity.duration}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {location?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[record.status]}`}>
                      {STATUS_LABELS[record.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium" style={{ color: 'var(--ink)' }}>
                    {formatPrice(total)}
                  </td>
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
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
                  Записи не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
            <Link
              href={`/clients/${selectedRecord.clientId}`}
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--brand)' }}
            >
              {selectedClient?.name ?? '—'}
            </Link>
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
              {selectedActivity.date ? formatDate(selectedActivity.date) : `День ${selectedActivity.day + 1}`}, {selectedActivity.startTime}–{selectedActivity.startTime + selectedActivity.duration}
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
    </div>
  );
}
