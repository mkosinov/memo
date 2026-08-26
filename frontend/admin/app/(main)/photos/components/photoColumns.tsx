'use client';

import type { PhotoResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Photos table (#139 T7). Extracted VERBATIM from the
 * pre-#139 PhotosTable COLUMNS + cell JSX. All keys stay sortable — the old
 * table attached onClick-sort to EVERY header (preview sorts a no-op column,
 * parity preserved), and the client adapter only sorts when a user picks one.
 */
export const photoColumns = (): ColumnDef<PhotoResponse>[] => [
  {
    key: 'preview',
    label: 'Превью',
    defaultVisible: true,
    width: 'w-[80px]',
    render: (p) => (
      <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
        {p.filename ? (
          <img
            src={p.filename}
            alt={p.filename}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="text-gray-400 text-xs">Нет фото</span>
        )}
      </div>
    ),
  },
  {
    key: 'filename',
    label: 'Файл',
    defaultVisible: true,
    width: 'flex-1',
    render: (p) => <span className="font-medium">{p.filename}</span>,
  },
  {
    key: 'visitor',
    label: 'Посетитель',
    defaultVisible: true,
    width: 'w-[150px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{p.visitor_id || '—'}</span>,
  },
  {
    key: 'service',
    label: 'Услуга',
    defaultVisible: false,
    width: 'w-[150px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{p.service_id || '—'}</span>,
  },
  {
    key: 'activity',
    label: 'Активность',
    defaultVisible: false,
    width: 'w-[150px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{p.activity_id || '—'}</span>,
  },
  {
    key: 'is_public',
    label: 'Публичное',
    defaultVisible: true,
    width: 'w-[100px]',
    render: (p) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          p.is_public ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
        }`}
      >
        {p.is_public ? 'Да' : 'Нет'}
      </span>
    ),
  },
];

/**
 * Action config factory. Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output). Rows also open the edit modal via
 * onRowClick; "Редактировать" stays in the menu (existing behaviour + the
 * unchanged photos-crud e2e dropdown assertions). Delete keeps the §6.9
 * locked window.confirm('Удалить фото?') path — the parent implements it in
 * onDelete.
 */
export const photoActions = (cbs: {
  onEdit: (p: PhotoResponse) => void;
  onDelete: (p: PhotoResponse) => void;
}): ((row: PhotoResponse) => RowAction<PhotoResponse>[]) => {
  return (row: PhotoResponse): RowAction<PhotoResponse>[] => [
    { label: 'Редактировать', onClick: () => cbs.onEdit(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
