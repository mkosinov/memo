'use client';

import React, { useState } from 'react';
import { useClients } from '@/contexts/ClientsContext';
import { useUI } from '@/contexts/UIContext';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';
import type { ClientWithStats } from '@memo/api-client';

const COLUMNS: { key: string; label: string; sortable: boolean; defaultVisible: boolean }[] = [
  { key: 'name', label: 'Имя', sortable: true, defaultVisible: true },
  { key: 'phone', label: 'Телефон', sortable: true, defaultVisible: true },
  { key: 'visits_count', label: 'Кол-во визитов', sortable: true, defaultVisible: true },
  { key: 'last_visit', label: 'Последний визит', sortable: true, defaultVisible: true },
  { key: 'total_paid', label: 'Сумма оплат', sortable: true, defaultVisible: true },
];

interface ClientsTableProps {
  onClientClick: (client: ClientWithStats) => void;
}

export function ClientsTable({ onClientClick }: ClientsTableProps) {
  const { clients, isLoading, error, refetch, filters, sortBy, sortOrder, setSort, resetFilters, deleteClient } = useClients();
  const { showToast } = useUI();

  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('clients-columns');
      if (stored) return JSON.parse(stored);
    } catch {}
    return COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
  });

  const visibleColumns = COLUMNS.filter((c) => visibleKeys.includes(c.key));

  const hasActiveFilters =
    filters.search ||
    filters.is_active !== null ||
    filters.min_visits !== null ||
    filters.max_visits !== null ||
    filters.min_paid !== null ||
    filters.max_paid !== null;

  if (error) {
    return (
      <ErrorState
        error={new Error(error)}
        onRetry={refetch}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (clients.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="text-center py-12">
          <p style={{ color: 'var(--ink-light)' }}>Ничего не найдено</p>
          <button onClick={resetFilters} className="text-sm mt-2 hover:underline" style={{ color: 'var(--brand)' }}>
            Сбросить фильтры
          </button>
        </div>
      );
    }
    return (
      <div className="text-center py-12">
        <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 010-8 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
        <p style={{ color: 'var(--ink-light)' }}>Нет клиентов</p>
      </div>
    );
  }

  return (
    <div>
      {/* Column picker */}
      <div className="flex items-center justify-end px-4 py-2 border-b" style={{ borderColor: 'var(--line)' }}>
        <ColumnPicker
          columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
          visibleKeys={visibleKeys}
          onChange={setVisibleKeys}
          storageKey="clients-columns"
        />
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider select-none ${col.sortable ? 'cursor-pointer' : ''}`}
                style={{ color: 'var(--ink-light)' }}
                onClick={() =>
                  col.sortable &&
                  setSort(col.key, sortOrder === 'asc' ? 'desc' : 'asc')
                }
              >
                {col.label}
                {sortBy === col.key && (
                  <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr
              key={client.id}
              onClick={() => onClientClick(client)}
              className="border-b hover:bg-gray-50 cursor-pointer group transition-colors"
              style={{ borderColor: 'var(--line)' }}
            >
              {visibleKeys.includes('name') && (
              <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {client.name || 'Дорогой гость'}
              </td>
              )}
              {visibleKeys.includes('phone') && (
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                {client.phone || 'Не указан'}
              </td>
              )}
              {visibleKeys.includes('visits_count') && (
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                {client.visits_count}
              </td>
              )}
              {visibleKeys.includes('last_visit') && (
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                {client.last_visit
                  ? new Date(client.last_visit).toLocaleDateString('ru-RU')
                  : '—'}
              </td>
              )}
              {visibleKeys.includes('total_paid') && (
              <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {client.total_paid.toLocaleString('ru-RU')} ₽
              </td>
              )}
              <td className="py-3 px-4">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm(`Удалить ${client.name ?? 'клиента'}?`)) {
                      try {
                        await deleteClient(client.id);
                      } catch (err) {
                        showToast(parseApiError(err).message, 'error');
                      }
                    }
                  }}
                  className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
