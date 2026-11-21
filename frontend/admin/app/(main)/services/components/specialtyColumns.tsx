'use client';

import type { SpecialtyResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Specialties dictionary table (GH #599 Task 8.1,
 * the positionColumns precedent minus the is_system machinery — every row
 * is user-defined).
 *
 * Every column is `sortable: false`: GET /api/v1/specialties accepts
 * pagination only (no sort whitelist — the backend order is fixed at
 * `title ASC, id ASC`).
 */
export const specialtyColumns = (): ColumnDef<SpecialtyResponse>[] => [
  {
    key: 'title',
    label: 'Название',
    defaultVisible: true,
    width: 'flex-1',
    sortable: false,
    render: (s) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {s.title}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). «Переименовать» and «Удалить» are offered
 * on every row — the server, not the client, decides whether the row is
 * deletable (occupied by services → 409 with the «Услуги: N» tree from the
 * dry-run, surfaced as the blocked DeleteDialog). The parent wrapper
 * implements onDelete (the #324 deferred pipeline: clean → ring;
 * staff-held → dialog «потеряют направление»; service-held → blocked
 * dialog «Понятно»).
 */
export const specialtyActions = (cbs: {
  onEdit: (s: SpecialtyResponse) => void;
  onDelete: (s: SpecialtyResponse) => void;
}): ((row: SpecialtyResponse) => RowAction<SpecialtyResponse>[]) => {
  return (row: SpecialtyResponse): RowAction<SpecialtyResponse>[] => [
    { label: 'Переименовать', onClick: () => cbs.onEdit(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
