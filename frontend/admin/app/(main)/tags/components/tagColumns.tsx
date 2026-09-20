'use client';

import type { TagResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Tags table (#139 T1). Single sortable key — matches
 * the backend tags sort whitelist (just `title`).
 */
export const tagColumns = (): ColumnDef<TagResponse>[] => [
  { key: 'title', label: 'Тег', defaultVisible: true, width: 'flex-1', accessor: (t) => t.title },
];

/**
 * Action config factory. Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output). Rows also open the edit modal via
 * onRowClick; "Редактировать" stays in the menu (existing behaviour + the
 * unchanged tags-crud e2e and dropdown baseline). Delete is the deferred
 * GH #318 flow — the parent's onDelete runs the dry-run/deferred hook.
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
