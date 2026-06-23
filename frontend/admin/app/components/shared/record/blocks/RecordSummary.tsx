'use client';

import type { VisitStatus } from '@memo/domain';
import { StatusPicker } from '@/app/components/shared/StatusPicker';

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
      className="flex items-center justify-between gap-4 rounded-lg bg-surface p-3"
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
          variant="icon"
          size="md"
          testIdPrefix="record-status"
        />
      </div>
    </div>
  );
}
