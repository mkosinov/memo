'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CLIENTS, VISITORS, RECORDS, BOOKING_ACTIVITIES, VISITS, PAYMENTS,
  SERVICES, LOCATIONS, ARTISTS,
} from '@/lib/mock-data';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Подтверждена',
  CANCELLED: 'Отменена',
  NO_SHOW: 'Неявка',
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
  NO_SHOW: 'bg-gray-100 text-gray-600',
};

export default function ClientCardPage() {
  const params = useParams();
  const clientId = (params?.id ?? '') as string;

  const client = CLIENTS.find((c) => c.id === clientId);
  const clientVisitors = VISITORS.filter((v) => v.clientId === clientId);
  const clientRecords = RECORDS.filter((r) => r.clientId === clientId);

  const recordDetails = useMemo(() => {
    return clientRecords.map((record) => {
      const activity = BOOKING_ACTIVITIES.find((a) => a.id === record.activityId);
      const service = activity ? SERVICES.find((s) => s.id === activity.serviceId) : null;
      const location = activity ? LOCATIONS.find((l) => l.id === activity.locationId) : null;
      const visits = VISITS.filter((v) => v.recordId === record.id);
      const payments = PAYMENTS.filter((p) => p.recordId === record.id);
      const totalPrice = visits.reduce((s, v) => s + v.priceCharged, 0);
      const paidAmount = payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
      return { record, activity, service, location, visits, totalPrice, paidAmount };
    });
  }, [clientRecords]);

  const totalVisits = clientRecords.filter((r) => r.status === 'CONFIRMED').length;
  const totalSpent = recordDetails
    .filter((d) => d.record.status !== 'CANCELLED')
    .reduce((s, d) => s + d.paidAmount, 0);

  // ─── Not Found State ──────────────────────────────────────────────────

  if (!client) {
    return (
      <div className="p-4">
        <div className="max-w-[900px] mx-auto rounded-xl border p-12 text-center"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
          <div className="text-4xl mb-4">👤</div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>
            Клиент не найден
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--ink-light)' }}>
            Клиент с таким идентификатором не существует
          </p>
          <Link
            href="/bookings"
            className="inline-flex px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--brand)', color: 'white' }}
          >
            ← К записям
          </Link>
        </div>
      </div>
    );
  }

  // ─── Main Content ─────────────────────────────────────────────────────

  return (
    <div className="p-4">
      <div className="max-w-[900px] mx-auto space-y-4">
        {/* Header Card */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
          <div className="px-6 py-5" style={{ backgroundColor: 'var(--brand)' }}>
            <div className="flex justify-between items-start text-white">
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-3">
                  👤 {client.name}
                </h1>
                <div className="text-sm mt-1 text-white/70">{client.phone}</div>
              </div>
              <Link
                href="/bookings"
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}
              >
                ← Записи
              </Link>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'var(--line)' }}>
            <div className="px-6 py-4 text-center">
              <div className="text-xl font-bold" style={{ color: 'var(--brand)' }}>{totalVisits}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Визитов</div>
            </div>
            <div className="px-6 py-4 text-center">
              <div className="text-xl font-bold" style={{ color: 'var(--success)' }}>{clientVisitors.length}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Посетителей</div>
            </div>
            <div className="px-6 py-4 text-center">
              <div className="text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatPrice(totalSpent)}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Потрачено</div>
            </div>
          </div>
        </div>

        {/* Visitors Section */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
          <div className="px-6 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Связанные посетители</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3">
              {clientVisitors.map((visitor) => (
                <div key={visitor.id} className="p-3 rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{visitor.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {visitor.isAdult ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Взрослый</span>
                    ) : (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Ребенок, {visitor.age} лет</span>
                    )}
                  </div>
                </div>
              ))}
              {clientVisitors.length === 0 && (
                <div className="col-span-2 text-sm text-center py-4" style={{ color: 'var(--ink-light)' }}>
                  Нет связанных посетителей
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History Section */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
          <div className="px-6 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>История записей</h2>
            <Link
              href="/bookings"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              + Новая запись
            </Link>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {recordDetails.map(({ record, activity, service, location, totalPrice, paidAmount }) => (
              <div key={record.id} className="px-6 py-4 transition-colors hover:bg-surface">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{service?.name ?? '—'}</span>
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[record.status]}`}>
                        {STATUS_LABELS[record.status]}
                      </span>
                      {activity && !activity.isPublic && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--danger)' }}>ИНД</span>
                      )}
                    </div>
                    <div className="text-xs mt-1.5" style={{ color: 'var(--ink-light)' }}>
                      {activity ? `${activity.startTime}–${activity.startTime + activity.duration} · ${location?.name ?? '—'}` : '—'}
                    </div>
                    {record.comment && (
                      <div className="text-xs mt-1 italic" style={{ color: 'var(--ink-light)' }}>{record.comment}</div>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{formatPrice(totalPrice)}</div>
                    <div className="text-xs mt-0.5">
                      {paidAmount >= totalPrice ? (
                        <span className="text-emerald-600">Оплачено</span>
                      ) : paidAmount > 0 ? (
                        <span className="text-amber-600">Частично ({formatPrice(paidAmount)})</span>
                      ) : (
                        <span className="text-red-500">Не оплачено</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {recordDetails.length === 0 && (
              <div className="px-6 py-12 text-center text-sm" style={{ color: 'var(--ink-light)' }}>
                Нет записей
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
