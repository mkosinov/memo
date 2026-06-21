'use client';

import React from 'react';
import type { VisitStatus } from '@memo/domain';
import { StatusPicker } from '@/app/components/modal/ActivityDetailsModal/StatusPicker';
import { WaitingIcon, VisitedIcon, MissedIcon, CancelledIcon } from '@/app/components/shared/icons/StatusIcons';

const STATUS_CONFIG: Record<VisitStatus, { label: string; color: string }> = {
  waiting: { label: 'Ожидание', color: '#F59E0B' },
  visited: { label: 'Посетил', color: '#10B981' },
  cancelled: { label: 'Отменён', color: '#6B7280' },
  missed: { label: 'Неявка', color: '#EF4444' },
};

function renderStatusIcon(status: VisitStatus): React.ReactNode {
  const cls = 'w-3.5 h-3.5';
  switch (status) {
    case 'waiting': return <WaitingIcon className={cls} />;
    case 'visited': return <VisitedIcon className={cls} />;
    case 'cancelled': return <CancelledIcon className={cls} />;
    case 'missed': return <MissedIcon className={cls} />;
  }
}

export interface RecordSummaryProps {
  totalCost: number;
  totalPaid: number;
  /** Total seats (named visits + anonym). */
  seats: number;
  /** Current record status (derived from visits). */
  status: VisitStatus;
  /** Called when user picks a new status via StatusPicker. */
  onStatusChange: (status: VisitStatus) => void;
}

export function RecordSummary({ totalCost, totalPaid, seats, status, onStatusChange }: RecordSummaryProps) {
  const remaining = totalCost - totalPaid;

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-lg border p-3"
      style={{ borderColor: 'var(--line)' }}
      data-testid="record-summary"
    >
      {/* Left: financial summary */}
      <div className="flex gap-4 text-sm">
        <div>
          <span className="text-ink-light">Стоимость: </span>
          <span className="font-semibold text-ink">{totalCost.toLocaleString('ru-RU')} ₽</span>
        </div>
        <div>
          <span className="text-ink-light">К оплате: </span>
          <span
            className="font-semibold"
            style={{ color: remaining > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}
          >
            {remaining.toLocaleString('ru-RU')} ₽
          </span>
        </div>
        <div>
          <span className="text-ink-light">Мест: </span>
          <span className="font-semibold text-ink">{seats}</span>
        </div>
      </div>

      {/* Right: status picker */}
      <div className="shrink-0">
        <StatusPicker
          value={status}
          onChange={onStatusChange}
          statusConfig={STATUS_CONFIG}
          iconFor={renderStatusIcon}
          testIdPrefix="record-status"
        />
      </div>
    </div>
  );
}
