'use client';

import React from 'react';
import type {
  ActivityResponse,
  ClientWithStats,
  LocationResponse,
  MasterResponse,
  RecordResponse,
  ServiceResponse,
} from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';
import { DiamondIcon } from '@/app/components/shared/DiamondIcon';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';
import { displayMasterName, formatTime } from '@/lib/utils';

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

// ─── Column lookup seam (§6.15) ─────────────────────────────────────────────

/**
 * Reference maps the cells need. The wrapper memoizes the factory output
 * keyed on these maps. `onClientClick` replaces the pre-#139 inline
 * `stopPropagation` — DataTable's row-click `closest` guard scopes the
 * click away from the inner button (§6.3).
 */
export interface RecordColumnLookup {
  activities: Map<string, ActivityResponse>;
  clients: Map<string, ClientWithStats>;
  masters: Map<string, MasterResponse>;
  services: Map<string, ServiceResponse>;
  locations: Map<string, LocationResponse>;
  payments: Map<string, number>; // record_id → total paid amount
  onClientClick: (record: RecordResponse) => void;
}

/**
 * Columns config for the Records table (#139 T8 FE2b). Nine entries — keys
 * are exactly the RecordSortField union members (all server-sortable; backend
 * whitelist domain-rules/records.md §Sort semantics; initial fetch preserved
 * at sort_by=date&sort_order=asc — B2 cat 15). Cell JSX extracted verbatim
 * from the pre-#139 RecordsTable.
 */
export const recordColumns = (lookup: RecordColumnLookup): ColumnDef<RecordResponse>[] => {
  const { activities, clients, masters, services, locations, payments, onClientClick } = lookup;

  return [
    {
      key: 'date',
      label: 'Дата / Время',
      defaultVisible: true,
      render: (record) => {
        const activity = activities.get(record.activity_id);
        if (!activity) return '—';
        const parsed = parseActivityStart(activity.start);
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
      render: (record) => {
        const client = record.client_id ? clients.get(record.client_id) : null;
        return (
          <button
            onClick={() => onClientClick(record)}
            className="text-sm font-medium transition-colors text-left"
            style={{ color: 'var(--brand)' }}
          >
            {client?.name ?? '—'}
          </button>
        );
      },
    },
    {
      key: 'guests',
      label: 'Гостей',
      align: 'center',
      defaultVisible: true,
      render: (record) => (
        <span style={{ color: 'var(--ink-mid)' }}>{Math.max(1, record.visits.length)}</span>
      ),
    },
    {
      key: 'service',
      label: 'Услуга',
      defaultVisible: true,
      render: (record) => {
        const activity = activities.get(record.activity_id);
        const service = activity ? services.get(activity.service_id) : null;
        return (
          <div className="flex items-center gap-2">
            {activity?.is_private ? <DiamondIcon className="mr-1" /> : null}
            {service?.title ?? '—'}
          </div>
        );
      },
    },
    {
      key: 'master',
      label: 'Мастер',
      defaultVisible: true,
      render: (record) => {
        const activity = activities.get(record.activity_id);
        if (!activity) return '—';
        const master = masters.get(activity.master_id);
        return (
          <div
            className="w-5 h-5 rounded-full"
            style={{ backgroundColor: master?.color || '#999' }}
            title={master ? displayMasterName(master) : undefined}
          />
        );
      },
    },
    {
      key: 'location',
      label: 'Локация',
      defaultVisible: true,
      render: (record) => {
        const activity = activities.get(record.activity_id);
        const location = activity ? locations.get(activity.location_id) : null;
        return <span style={{ color: 'var(--ink-mid)' }}>{location?.name ?? '—'}</span>;
      },
    },
    {
      key: 'status',
      label: 'Статус',
      defaultVisible: true,
      render: (record) => <StatusBadge status={safeStatus(record.status)} />,
    },
    {
      key: 'total',
      label: 'Сумма',
      align: 'right',
      defaultVisible: true,
      render: (record) => {
        const recordTotal = record.visits.reduce((s, v) => s + v.price, 0);
        return <span className="font-medium">{formatPrice(recordTotal)}</span>;
      },
    },
    {
      key: 'payment',
      label: 'Оплата',
      align: 'center',
      defaultVisible: true,
      render: (record) => {
        const recordTotal = record.visits.reduce((s, v) => s + v.price, 0);
        const recordPaid = payments.get(record.id) ?? 0;
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
  onDelete: (record: RecordResponse) => void;
}): ((row: RecordResponse) => RowAction<RecordResponse>[]) => {
  return (row) => [
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
