'use client';

import type { PositionResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Positions dictionary table (GH #266 T9, D4).
 *
 * Every column is `sortable: false`: GET /api/v1/positions accepts pagination
 * only (no sort whitelist — the backend order is fixed at `title ASC, id ASC`).
 * The «Тип» column renders the built-in flag as a badge; the anchor is
 * `is_system` (and the fixed id for built-ins), never the title.
 */
export const positionColumns = (): ColumnDef<PositionResponse>[] => [
  {
    key: 'title',
    label: 'Должность',
    defaultVisible: true,
    width: 'flex-1',
    sortable: false,
    render: (p) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {p.title}
      </span>
    ),
  },
  {
    key: 'is_system',
    label: 'Тип',
    defaultVisible: true,
    width: 'w-40',
    sortable: false,
    // Badge mirrors the materials/services status-pill styling.
    render: (p) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: p.is_system ? 'var(--surface)' : 'var(--success-bg, #dcfce7)',
          color: p.is_system ? 'var(--ink-light)' : 'var(--success, #16a34a)',
        }}
      >
        {p.is_system ? 'Встроенная' : 'Пользовательская'}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). «Переименовать» is offered for BOTH built-ins
 * and user-defined rows (D4: the title is freely editable); «Удалить» is
 * offered for both too — the server, not the client, decides whether the row is
 * protected (built-in → 422 POSITION_IS_SYSTEM, surfaced as the explanation
 * toast). The parent wrapper implements onDelete (window.confirm + toast).
 */
export const positionActions = (cbs: {
  onEdit: (p: PositionResponse) => void;
  onDelete: (p: PositionResponse) => void;
}): ((row: PositionResponse) => RowAction<PositionResponse>[]) => {
  return (row: PositionResponse): RowAction<PositionResponse>[] => [
    { label: 'Переименовать', onClick: () => cbs.onEdit(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
