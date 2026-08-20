'use client';

import React from 'react';
import type { ClientWithStats } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

// ─── Helpers (verbatim from the pre-#139 ClientsTable) ────────────────────

function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU');
}

/**
 * Columns config for the Clients table (#139 T6). Extracted VERBATIM from
 * the pre-#139 ClientsTable cell JSX (`COLUMNS` + per-key inline blocks).
 * Keys match the backend clients sort whitelist
 * (domain-rules/clients.md §"Sort columns": name, records_count, last_record,
 * total_paid, missed_records, created_at, updated_at). Phone is sortable per
 * the pre-#139 table (it appears in the COLUMNS list with `sortable: true`)
 * even though the doc list omits it — kept as-is for parity (server tolerates
 * the field).
 *
 * Pre-#139 Clients had NO `archived` column — archive status is shown via
 * the menu-item label toggle only. Kept that parity: no `archived` column.
 */
export const clientColumns = (): ColumnDef<ClientWithStats>[] => [
  {
    key: 'name',
    label: 'Имя',
    defaultVisible: true,
    render: (c) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {c.name || 'Дорогой гость'}
      </span>
    ),
  },
  {
    key: 'phone',
    label: 'Телефон',
    defaultVisible: true,
    render: (c) => (
      <span style={{ color: 'var(--ink-mid)' }}>{c.phone || 'Не указан'}</span>
    ),
  },
  {
    key: 'records_count',
    label: 'Всего записей',
    defaultVisible: true,
    render: (c) => (
      <span style={{ color: 'var(--ink-mid)' }}>{c.records_count}</span>
    ),
  },
  {
    key: 'last_record',
    label: 'Последняя запись',
    defaultVisible: true,
    render: (c) => (
      <span style={{ color: 'var(--ink-mid)' }}>{formatDate(c.last_record)}</span>
    ),
  },
  {
    key: 'total_paid',
    label: 'Сумма оплат',
    defaultVisible: true,
    render: (c) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {formatRub(c.total_paid)}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output); the parent owns the dry-run
 * `deleteClient` → DeleteDialog flow (§6.9). Menu items mirror the pre-#139
 * dropdown: archive/restore toggle label driven by the inverted `archived`
 * field (#207 §7.2), then danger "Удалить". NO "Редактировать" — clients
 * open via row click → ClientCardModal (pre-#139 ClientsTable has no edit
 * menu item either, edit happens inside the opened modal).
 */
export const clientActions = (cbs: {
  onToggleArchive: (c: ClientWithStats) => void;
  onDelete: (c: ClientWithStats) => void;
}): ((row: ClientWithStats) => RowAction<ClientWithStats>[]) => {
  return (row: ClientWithStats): RowAction<ClientWithStats>[] => [
    { label: row.archived ? 'Восстановить' : 'В архив', onClick: () => cbs.onToggleArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
