'use client';

import type { TagResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Tags table (#139 T1). Single sortable key — matches
 * the backend tags sort whitelist (just `tag`).
 */
export const tagColumns = (): ColumnDef<TagResponse>[] => [
  { key: 'tag', label: 'Тег', defaultVisible: true, width: 'flex-1', accessor: (t) => t.tag },
];

/**
 * Action config factory. Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output). Rows also open the edit modal via
 * onRowClick; "Редактировать" stays in the menu (existing behaviour + the
 * unchanged tags-crud e2e and dropdown baseline). Delete keeps the §6.9
 * locked window.confirm path — the parent implements it in onDelete.
 */
export const tagActions = (cbs: {
  onEdit: (t: TagResponse) => void;
  onDelete: (t: TagResponse) => void;
}): ((row: TagResponse) => RowAction<TagResponse>[]) => {
  return (row: TagResponse): RowAction<TagResponse>[] => [
    { label: 'Редактировать', onClick: () => cbs.onEdit(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
