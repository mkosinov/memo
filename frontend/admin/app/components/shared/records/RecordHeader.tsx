'use client';

import { useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import { formatSeats } from '@/app/lib/pluralize';
import type { RecordWithDerived } from './types';

export interface RecordHeaderProps {
  data: RecordWithDerived;
  /** Stepper +1 — creates ONE real anonymous visit (visitor_id = null). */
  onAddAnonymousVisit?: () => Promise<void>;
  /** Stepper −1 — deletes the last anonymous visit. */
  onDeleteAnonymousVisit?: () => Promise<void>;
  isReadOnly?: boolean;
}

export function RecordHeader({
  data,
  onAddAnonymousVisit,
  onDeleteAnonymousVisit,
  isReadOnly,
}: RecordHeaderProps) {
  const { client, status, visits } = data;
  // Pending guard: a repeated click before the response lands is ignored
  // (one mutation in flight at a time — both buttons share the busy flag).
  const [busy, setBusy] = useState(false);

  // Anonymous seats are real visits with visitor_id = null (#257) — the
  // counter is derived from the visits the card already has, no extra query.
  const anonymousCount = visits.filter((v) => v.visitor_id == null).length;
  const totalSeats = visits.length;

  const handleAdd = async () => {
    if (busy || !onAddAnonymousVisit) return;
    setBusy(true);
    try {
      await onAddAnonymousVisit();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !onDeleteAnonymousVisit) return;
    setBusy(true);
    try {
      await onDeleteAnonymousVisit();
    } finally {
      setBusy(false);
    }
  };

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
            <span data-testid="anonym-visits-count">{anonymousCount} анонимных</span>
            <button
              type="button"
              data-testid="anonym-visits-dec"
              aria-label="Убрать анонимного посетителя"
              disabled={busy || anonymousCount === 0 || !onDeleteAnonymousVisit}
              onClick={() => void handleDelete()}
              className="h-5 w-5 flex items-center justify-center rounded border text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              −
            </button>
            <button
              type="button"
              data-testid="anonym-visits-inc"
              aria-label="Добавить анонимного посетителя"
              disabled={busy || !onAddAnonymousVisit}
              onClick={() => void handleAdd()}
              className="h-5 w-5 flex items-center justify-center rounded border text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              +
            </button>
          </>
        )}
        {totalSeats !== visits.length && (
          <span className="text-gray-500">(итого {totalSeats})</span>
        )}
      </div>
    </div>
  );
}
