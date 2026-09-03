'use client';

import React from 'react';
import type { RecordView } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';
import { DiamondIcon } from '@/app/components/shared/DiamondIcon';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';
import { formatTime } from '@/lib/utils';

// ─── Helpers (verbatim from the pre-#139 RecordsTable) ──────────────────────
// formatTime lives in @/lib/utils (identical HH:MM zero-pad helper — dedup).

export function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

export function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' ', ' ');
}

/** Normalize JS getDay() (0=Sun..6=Sat) to Mon=0..Sun=6, extract date and startTime. */
export function parseActivityStart(start: string): { date: string; day: number; startTime: number } {
  const d = new Date(start);
  const day = (d.getUTCDay() + 6) % 7;
  const startTime = d.getUTCHours() + d.getUTCMinutes() / 60;
  const date = start.slice(0, 10);
  return { date, day, startTime };
}

// ─── Columns config (GH #213 §6.2 — row-field rendering) ───────────────────

/**
 * Columns config for the Records table (#139 T8 FE2b; GH #213 Task 7). Nine
 * entries — keys are exactly the RecordSortField union members (all
 * server-sortable; backend whitelist domain-rules/records.md §Sort semantics;
 * initial fetch preserved at sort_by=date&sort_order=asc — B2 cat 15).
 *
 * The RecordColumnLookup seam is gone: cells read the denormalized RecordView
 * row fields delivered by GET /records/view (spec §6.2/§6.3 — display fields
 * are byte-compatible with the old map lookups; archived entities resolve
 * their names, deleted/dangling ones → null → '—' / gray dot). `onClientClick`
 * replaces the pre-#139 inline `stopPropagation` — DataTable's row-click
 * `closest` guard scopes the click away from the inner button (§6.3).
 */
export const recordColumns = (cbs: {
  onClientClick: (record: RecordView) => void;
}): ColumnDef<RecordView>[] => {
  const { onClientClick } = cbs;

  return [
    {
      key: 'date',
      label: 'Дата / Время',
      defaultVisible: true,
      render: (row) => {
        if (!row.activity_start) return '—';
        const parsed = parseActivityStart(row.activity_start);
        return (
          <div className="whitespace-nowrap">
            <div className="font-medium" style={{ color: 'var(--ink)' }}>
              {formatDateRu(parsed.date)}
            </div>
            <div className="text-xs" style={{ color: 'var(--ink-light)' }}>
              {formatTime(parsed.startTime)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'client',
      label: 'Клиент',
      defaultVisible: true,
      render: (row) => (
        <button
          onClick={() => onClientClick(row)}
          className="text-sm font-medium transition-colors text-left"
          style={{ color: 'var(--brand)' }}
        >
          {row.client_name ?? '—'}
        </button>
      ),
    },
    {
      key: 'guests',
      label: 'Гостей',
      align: 'center',
      defaultVisible: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-mid)' }}>{Math.max(1, row.visits.length)}</span>
      ),
    },
    {
      key: 'service',
      label: 'Услуга',
      defaultVisible: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.is_private ? <DiamondIcon className="mr-1" /> : null}
          {row.service_title ?? '—'}
        </div>
      ),
    },
    {
      key: 'master',
      label: 'Мастер',
      defaultVisible: true,
      render: (row) => (
        <div
          className="w-5 h-5 rounded-full"
          style={{ backgroundColor: row.master_color ?? '#999' }}
          title={row.master_name ?? undefined}
        />
      ),
    },
    {
      key: 'location',
      label: 'Локация',
      defaultVisible: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-mid)' }}>{row.location_name ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      label: 'Статус',
      defaultVisible: true,
      render: (row) => <StatusBadge status={safeStatus(row.status)} />,
    },
    {
      key: 'total',
      label: 'Сумма',
      align: 'right',
      defaultVisible: true,
      render: (row) => {
        const recordTotal = row.visits.reduce((s, v) => s + v.price, 0);
        return <span className="font-medium">{formatPrice(recordTotal)}</span>;
      },
    },
    {
      key: 'payment',
      label: 'Оплата',
      align: 'center',
      defaultVisible: true,
      render: (row) => {
        const recordTotal = row.visits.reduce((s, v) => s + v.price, 0);
        const recordPaid = row.paid;
        if (recordPaid >= recordTotal) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--success)' }}>
              ✓ Оплачено
            </span>
          );
        }
        if (recordPaid > 0) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--warning)' }}>
              Частично ({formatPrice(recordPaid)})
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--danger)' }}>
            Не оплачено
          </span>
        );
      },
    },
  ];
};

// ─── Action factory (§6.3) ──────────────────────────────────────────────────

/**
 * Actions factory. Delete-only: the pre-#139 records table has NO table-level
 * edit entry point (the row-click detail panel IS the edit path), so there is
 * no onEdit (§6.9; plan Task 8 Part C). `danger: true` → the menu item renders
 * in --danger color; the parent wires it to the Addendum-13 dry-run
 * DeleteDialog flow via useDeleteRecord (§6.9).
 */
export const recordsActions = (cbs: {
  onDelete: (record: RecordView) => void;
}): ((row: RecordView) => RowAction<RecordView>[]) => {
  return (row) => [
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
