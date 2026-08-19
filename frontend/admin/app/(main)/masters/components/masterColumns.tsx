'use client';

import type { MasterResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';
import { displayMasterName } from '@/lib/utils';

/**
 * Columns config for the Masters table (#139 T3). Extracted VERBATIM from
 * the pre-#139 MastersTable COLUMNS + cell JSX; custom cells use `render`.
 * Keys match the backend masters sort whitelist (domain-rules/masters.md
 * §"List contract (GH #205)": name, specialty, position, color, avatar,
 * status), so every column sorts server-side without a `sortField` mapping.
 */
export const masterColumns = (): ColumnDef<MasterResponse>[] => [
  {
    key: 'name',
    label: 'Имя',
    width: 'flex-1',
    defaultVisible: true,
    // Pre-#139: name cell carried `font-medium` (all other cells default) and
    // rendered the combined "Фамилия Имя" via displayMasterName (lib/utils).
    render: (m) => <span className="font-medium">{displayMasterName(m)}</span>,
  },
  {
    key: 'specialty',
    label: 'Специальность',
    width: 'w-[150px]',
    defaultVisible: true,
    // Pre-#139 cells carried `--ink-mid`; the DataTable base td uses `--ink`.
    render: (m) => <span style={{ color: 'var(--ink-mid)' }}>{m.specialty}</span>,
  },
  {
    key: 'position',
    label: 'Должность',
    width: 'w-[150px]',
    defaultVisible: true,
    render: (m) => <span style={{ color: 'var(--ink-mid)' }}>{m.position}</span>,
  },
  {
    key: 'color',
    label: 'Цвет',
    width: 'w-[80px]',
    defaultVisible: true,
    // Swatch + hex verbatim from the pre-#139 cell.
    render: (m) => (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: m.color }} />
        <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
          {m.color}
        </span>
      </div>
    ),
  },
  {
    key: 'avatar',
    label: 'Аватар',
    width: 'w-[60px]',
    defaultVisible: false,
    render: (m) =>
      m.avatar_url ? (
        <img src={m.avatar_url} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
      ) : (
        <span style={{ color: 'var(--ink-light)' }}>—</span>
      ),
  },
  {
    key: 'status',
    label: 'Статус',
    width: 'w-[100px]',
    defaultVisible: false,
    // Badge verbatim from the pre-#139 cell (inverted `archived` field, #207).
    render: (m) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          m.archived ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {m.archived ? 'Архив' : 'Активен'}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output); the parent owns the edit modal and
 * the 409 dry-run → DeleteDialog flow (§6.9). Menu items mirror the pre-#139
 * dropdown: archive/restore toggle label driven by the inverted `archived`
 * field (#207 §7.2), then danger "Удалить".
 */
export const masterActions = (cbs: {
  onToggleArchive: (m: MasterResponse) => void;
  onDelete: (m: MasterResponse) => void;
}): ((row: MasterResponse) => RowAction<MasterResponse>[]) => {
  return (row: MasterResponse): RowAction<MasterResponse>[] => [
    { label: row.archived ? 'Восстановить' : 'В архив', onClick: () => cbs.onToggleArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
