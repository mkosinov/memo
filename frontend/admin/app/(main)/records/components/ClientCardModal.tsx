'use client';

import React, { useMemo } from 'react';
import { useRecords } from '@/contexts/RecordsContext';
import { DiamondIcon } from '@/app/components/shared/DiamondIcon';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function formatTime(time: number): string {
  const h = Math.floor(time);
  const m = Math.round((time - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────

interface ClientCardModalProps {
  clientId: string;
  onClose: () => void;
}

export function ClientCardModal({ clientId, onClose }: ClientCardModalProps) {
  const { clients, records, activities, services, locations, payments } = useRecords();

  const client = clients.get(clientId) ?? null;
  const clientRecords = useMemo(
    () => records.filter((r) => r.client_id === clientId),
    [records, clientId],
  );

  const recordDetails = useMemo(() => {
    return clientRecords.map((record) => {
      const activity = activities.get(record.activity_id);
      const service = activity ? services.get(activity.service_id) : null;
      const location = activity ? locations.get(activity.location_id) : null;
      const recordPayments = payments.get(record.id) ?? [];
      const totalPrice = record.visits.reduce((s, v) => s + v.price, 0);
      const paidAmount = recordPayments.reduce((s, p) => s + p.amount, 0);
      return { record, activity, service, location, totalPrice, paidAmount };
    });
  }, [clientRecords, activities, services, locations, payments]);

  const totalVisitCount = clientRecords.filter((r) => r.status === 'visited').length;
  const totalGuests = clientRecords.reduce((s, r) => s + Math.max(1, r.visits.length), 0);
  const totalSpent = recordDetails
    .filter((d) => d.record.status !== 'cancelled')
    .reduce((s, d) => s + d.paidAmount, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border overflow-y-auto max-h-[90vh] w-full max-w-[900px] mx-4"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="sticky top-0 flex justify-end p-2" style={{ zIndex: 1 }}>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-light)' }}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Client not found */}
        {!client ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-4">👤</div>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>
              Клиент не найден
            </h2>
          </div>
        ) : (
          <>
            {/* Header Card */}
            <div className="px-6 pb-6">
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                <div className="px-6 py-5" style={{ backgroundColor: 'var(--brand)' }}>
                  <h1 className="text-xl font-semibold text-white flex items-center gap-3">
                    👤 {client.name}
                  </h1>
                  <div className="text-sm mt-1 text-white/70">{client.phone}</div>
                </div>
                <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'var(--line)' }}>
                  <div className="px-6 py-4 text-center">
                    <div className="text-xl font-bold" style={{ color: 'var(--brand)' }}>{totalVisitCount}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Визитов</div>
                  </div>
                  <div className="px-6 py-4 text-center">
                    <div className="text-xl font-bold" style={{ color: 'var(--success)' }}>{totalGuests}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Гостей</div>
                  </div>
                  <div className="px-6 py-4 text-center">
                    <div className="text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatPrice(totalSpent)}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink-light)' }}>Потрачено</div>
                  </div>
                </div>
              </div>
            </div>

            {/* History Section */}
            <div className="px-6 pb-6">
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>История записей</h2>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {recordDetails.map(({ record, activity, service, location, totalPrice, paidAmount }) => (
                    <div key={record.id} className="px-6 py-4 transition-colors hover:bg-surface">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{service?.title ?? '—'}</span>
                             <StatusBadge status={safeStatus(record.status)} />
                            {activity?.is_private && (
                              <DiamondIcon className="text-[10px]" />
                            )}
                          </div>
                          <div className="text-xs mt-1.5" style={{ color: 'var(--ink-light)' }}>
                            {activity
                              ? `${formatTime(new Date(activity.start).getUTCHours() + new Date(activity.start).getUTCMinutes() / 60)} · ${location?.name ?? '—'}`
                              : '—'}
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
          </>
        )}
      </div>
    </div>
  );
}
