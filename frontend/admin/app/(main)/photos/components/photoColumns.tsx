'use client';

import React from 'react';
import type { LocationResponse, PhotoResponse, ServiceResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

/**
 * Columns config for the Photos table (GH #211 Task 9). Eight columns — the
 * four owner slots render from the list response itself («Клиент» via the
 * denormalized client_name; «Услуга»/«Локация» resolved through the /all
 * dictionaries) and «Активность» stays a raw id until #213 links it.
 *
 * Sortable ONLY filename/is_public/created_at — the server PhotoSortBy
 * whitelist (domain-rules/photos.md); every other column is sortable:false so
 * the header click is a no-op (preview/client/service/location/activity).
 */

export interface PhotoColumnLookup {
  servicesMap: Map<string, ServiceResponse>;
  locationsMap: Map<string, LocationResponse>;
}

/** «07.06.2026» — clientColumns' formatDate precedent (date-first, ru-RU). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

export const photoColumns = ({ servicesMap, locationsMap }: PhotoColumnLookup): ColumnDef<PhotoResponse>[] => [
  {
    key: 'preview',
    label: 'Превью',
    defaultVisible: true,
    sortable: false,
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
    sortField: 'filename',
    width: 'flex-1',
    render: (p) => <span className="font-medium">{p.filename}</span>,
  },
  {
    key: 'client',
    label: 'Клиент',
    defaultVisible: true,
    sortable: false,
    width: 'w-[150px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{p.client_name ?? '—'}</span>,
  },
  {
    key: 'service',
    label: 'Услуга',
    defaultVisible: true,
    sortable: false,
    width: 'w-[150px]',
    render: (p) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {servicesMap.get(p.service_id ?? '')?.title ?? '—'}
      </span>
    ),
  },
  {
    key: 'location',
    label: 'Локация',
    defaultVisible: true,
    sortable: false,
    width: 'w-[150px]',
    render: (p) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {locationsMap.get(p.location_id ?? '')?.name ?? '—'}
      </span>
    ),
  },
  {
    key: 'activity',
    label: 'Активность',
    defaultVisible: false, // raw id until #213 links it (plan Task 9)
    sortable: false,
    width: 'w-[150px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{p.activity_id ?? '—'}</span>,
  },
  {
    key: 'is_public',
    label: 'Публичное',
    defaultVisible: true,
    sortField: 'is_public',
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
  {
    key: 'created_at',
    label: 'Дата',
    defaultVisible: true,
    sortField: 'created_at',
    width: 'w-[110px]',
    render: (p) => <span style={{ color: 'var(--ink-mid)' }}>{formatDate(p.created_at)}</span>,
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
