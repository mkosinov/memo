'use client';

import type { MaterialResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Materials table (#139 T4). Extracted VERBATIM from
 * the pre-#139 MaterialsTable ALL_COLUMNS + cell JSX; every cell is custom
 * so all four use `render`. Keys match the backend materials sort whitelist
 * (domain-rules/materials.md §"List contract (GH #205)": title, description,
 * archived, created_at), so every column sorts server-side without a
 * `sortField` mapping.
 */
export const materialColumns = (): ColumnDef<MaterialResponse>[] => [
  {
    key: 'title',
    label: 'Название',
    defaultVisible: true,
    render: (m) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {m.title}
      </span>
    ),
  },
  {
    key: 'description',
    label: 'Описание',
    defaultVisible: true,
    render: (m) => (
      <span className="truncate block max-w-xs" style={{ color: 'var(--ink-mid)' }}>
        {m.description || '—'}
      </span>
    ),
  },
  {
    key: 'archived',
    label: 'Статус',
    defaultVisible: true,
    // Badge verbatim from the pre-#139 cell (inverted `archived` field, #207).
    render: (m) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: !m.archived ? 'var(--success-bg, #dcfce7)' : 'var(--surface)',
          color: !m.archived ? 'var(--success, #16a34a)' : 'var(--ink-light)',
        }}
      >
        {m.archived ? 'Архив' : 'Активен'}
      </span>
    ),
  },
  {
    key: 'used_in_services_count',
    label: 'Где используется',
    defaultVisible: true,
    // GH #223 §8/S4: plain number, no drill-down. 0 renders as "0" — it IS
    // information (the material is unused), not missing data. Non-sortable:
    // the backend sort whitelist (domain-rules/materials.md) has no such key.
    sortable: false,
    render: (m) => (
      <span className="text-sm" style={{ color: 'var(--ink)' }}>
        {m.used_in_services_count}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Создан',
    defaultVisible: false,
    render: (m) => (
      <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
        {new Date(m.created_at).toLocaleDateString('ru-RU')}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output); the parent owns the edit modal and
 * the 409 dry-run → DeleteDialog flow (§6.9 — defensive: Material has ZERO
 * FK deps, DELETE always 204, domain-rules/materials.md). Menu items mirror
 * the pre-#139 dropdown: archive/restore toggle label driven by the inverted
 * `archived` field (#207 §7.2), then danger "Удалить".
 */
export const materialActions = (cbs: {
  onToggleArchive: (m: MaterialResponse) => void;
  onDelete: (m: MaterialResponse) => void;
}): ((row: MaterialResponse) => RowAction<MaterialResponse>[]) => {
  return (row: MaterialResponse): RowAction<MaterialResponse>[] => [
    { label: row.archived ? 'Восстановить' : 'В архив', onClick: () => cbs.onToggleArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
