'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import { formatSeats } from '@/app/lib/pluralize';
import type { RecordWithDerived } from './types';

export interface RecordHeaderProps {
  data: RecordWithDerived;
  onAnonymVisitsChange?: (value: number) => void;
  isReadOnly?: boolean;
}

export function RecordHeader({ data, onAnonymVisitsChange, isReadOnly }: RecordHeaderProps) {
  const { record, client, status, visits } = data;
  const [anonym, setAnonym] = useState(record.anonym_visits ?? 0);

  // Debounced save — fires 500ms after the last change
  useEffect(() => {
    if (!onAnonymVisitsChange) return;
    if (anonym === (record.anonym_visits ?? 0)) return;
    const t = setTimeout(() => onAnonymVisitsChange(anonym), 500);
    return () => clearTimeout(t);
  }, [anonym, record.anonym_visits, onAnonymVisitsChange]);

  const totalSeats = visits.length + Number(anonym);

  return (
    <div className="space-y-2 border-b border-gray-200 pb-3 dark:border-gray-700" data-testid="record-header">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" data-testid="client-name">
            {client?.name ?? <span className="italic text-gray-500">Без имени</span>}
          </div>
          {client?.phone && (
            <div className="text-xs text-gray-600 dark:text-gray-400" data-testid="client-phone">
              {client.phone}
            </div>
          )}
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" data-testid="seats-summary">
        <span>{formatSeats(visits.length)}</span>
        {!isReadOnly && (
          <>
            <span>+</span>
            <input
              type="number"
              min={0}
              value={anonym}
              onChange={(e) => setAnonym(Math.max(0, Number(e.target.value)))}
              data-testid="anonym-visits-input"
              aria-label="Количество анонимных посетителей"
              className="w-12 rounded border px-1 py-0.5 text-center"
            />
            <span>анонимных</span>
          </>
        )}
        {totalSeats !== visits.length && (
          <span className="text-gray-500">(итого {totalSeats})</span>
        )}
      </div>
    </div>
  );
}
