'use client';

import type { LocationResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Locations table (#139 T2). Extracted VERBATIM from
 * the pre-#139 LocationsTable COLUMNS + cell JSX; custom cells use `render`.
 * Keys match the backend locations sort whitelist (domain-rules/locations.md
 * §"List contract (GH #205)": name, short_title, capacity, address,
 * location_hint, description, archived, yandex_map_url, created_at), so every
 * column sorts server-side without a `sortField` mapping.
 */
export const locationColumns = (): ColumnDef<LocationResponse>[] => [
  {
    key: 'name',
    label: 'Название',
    width: 'flex-1',
    defaultVisible: true,
    // Pre-#139: name cell carried `font-medium` (all other cells default).
    render: (l) => <span className="font-medium">{l.name}</span>,
  },
  {
    key: 'short_title',
    label: 'Короткое название',
    defaultVisible: false,
    // Pre-#139 cells carried `--ink-mid`; the DataTable base td uses `--ink`.
    render: (l) => <span style={{ color: 'var(--ink-mid)' }}>{l.short_title ?? '—'}</span>,
  },
  {
    key: 'capacity',
    label: 'Вместимость',
    width: 'w-[100px]',
    defaultVisible: true,
    render: (l) => <span style={{ color: 'var(--ink-mid)' }}>{l.capacity}</span>,
  },
  {
    key: 'address',
    label: 'Адрес',
    width: 'flex-1',
    defaultVisible: true,
    render: (l) => <span style={{ color: 'var(--ink-mid)' }}>{l.address ?? '—'}</span>,
  },
  {
    key: 'location_hint',
    label: 'Подсказка',
    width: 'w-[150px]',
    defaultVisible: true,
    render: (l) => <span style={{ color: 'var(--ink-light)' }}>{l.location_hint ?? '—'}</span>,
  },
  {
    key: 'description',
    label: 'Описание',
    defaultVisible: false,
    // Pre-#139 description cell carried `max-w-[200px] truncate`.
    render: (l) => (
      <span className="max-w-[200px] truncate inline-block" style={{ color: 'var(--ink-mid)' }}>
        {l.description ?? '—'}
      </span>
    ),
  },
  {
    key: 'archived',
    label: 'Статус',
    defaultVisible: false,
    // Badge verbatim from the pre-#139 cell (inverted `archived` field, #207).
    render: (l) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          l.archived ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {l.archived ? 'Архив' : 'Активен'}
      </span>
    ),
  },
  {
    key: 'yandex_map_url',
    label: 'Карта',
    defaultVisible: false,
    render: (l) =>
      l.yandex_map_url ? (
        <a
          href={l.yandex_map_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs"
          style={{ color: 'var(--brand)' }}
        >
          🗺
        </a>
      ) : (
        '—'
      ),
  },
  {
    key: 'created_at',
    label: 'Создано',
    defaultVisible: false,
    render: (l) => (
      <span style={{ color: 'var(--ink-light)' }}>
        {new Date(l.created_at).toLocaleDateString('ru-RU')}
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
export const locationActions = (cbs: {
  onToggleArchive: (l: LocationResponse) => void;
  onDelete: (l: LocationResponse) => void;
}): ((row: LocationResponse) => RowAction<LocationResponse>[]) => {
  return (row: LocationResponse): RowAction<LocationResponse>[] => [
    { label: row.archived ? 'Восстановить' : 'В архив', onClick: () => cbs.onToggleArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
