'use client';

import type { VisitStatus } from '@memo/domain';
import type { VisitResponse, TariffResponse } from '@memo/api-client';
import { StatusPicker } from '../StatusPicker';
import { safeStatus } from '@/app/lib/status-utils';

export interface RecordVisitRowProps {
  visit: VisitResponse;
  visitorName?: string;
  visitorAge?: number | null;
  tariffId?: string;
  tariffs: TariffResponse[];
  isReadOnly?: boolean;
  onChange: (data: {
    name?: string;
    age?: number | null;
    tariff_id?: string;
    status?: VisitStatus;
  }) => void;
  onDelete: () => void;
}

export function RecordVisitRow({
  visit,
  visitorName = '',
  visitorAge,
  tariffId = '',
  tariffs,
  isReadOnly,
  onChange,
  onDelete,
}: RecordVisitRowProps) {
  return (
    <div
      className="flex items-center gap-2 border-b border-gray-100 py-2 dark:border-gray-800"
      data-testid={`visit-row-${visit.id}`}
    >
      {/* Name input */}
      <input
        type="text"
        value={visitorName}
        placeholder="Имя"
        disabled={isReadOnly}
        onChange={(e) => onChange({ name: e.target.value })}
        className="flex-1 rounded border px-2 py-1 text-sm"
        data-testid={`visit-${visit.id}-name`}
      />
      {/* Age input */}
      <input
        type="number"
        value={visitorAge ?? ''}
        placeholder="Возраст"
        disabled={isReadOnly}
        onChange={(e) =>
          onChange({ age: e.target.value ? Number(e.target.value) : null })
        }
        className="w-16 rounded border px-2 py-1 text-sm"
        data-testid={`visit-${visit.id}-age`}
      />
      {/* Tariff select */}
      <select
        value={tariffId}
        disabled={isReadOnly}
        onChange={(e) => onChange({ tariff_id: e.target.value })}
        className="rounded border px-2 py-1 text-sm"
        data-testid={`visit-${visit.id}-tariff`}
      >
        <option value="">— тариф —</option>
        {tariffs.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title} ({t.price} ₽)
          </option>
        ))}
      </select>
      {/* Status picker */}
      {!isReadOnly && (
        <StatusPicker
          value={safeStatus(visit.status)}
          onChange={(status) => {
            if (status) onChange({ status });
          }}
          variant="icon"
          size="sm"
          testIdPrefix={`visit-${visit.id}-status`}
        />
      )}
      {/* Delete button */}
      {!isReadOnly && (
        <button
          onClick={onDelete}
          data-testid={`visit-${visit.id}-delete`}
          className="text-red-600 hover:text-red-800"
          aria-label="Удалить посетителя"
        >
          ×
        </button>
      )}
    </div>
  );
}
