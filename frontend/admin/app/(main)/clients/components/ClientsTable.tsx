'use client';

import { useClients } from '@/contexts/ClientsContext';
import type { ClientWithStats } from '@memo/api-client';

const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'name', label: 'Имя', sortable: true },
  { key: 'phone', label: 'Телефон', sortable: true },
  { key: 'visits_count', label: 'Кол-во визитов', sortable: true },
  { key: 'last_visit', label: 'Последний визит', sortable: true },
  { key: 'total_paid', label: 'Сумма оплат', sortable: true },
];

interface ClientsTableProps {
  onClientClick: (client: ClientWithStats) => void;
}

export function ClientsTable({ onClientClick }: ClientsTableProps) {
  const { clients, isLoading, sortBy, sortOrder, setSort } = useClients();

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
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--ink-light)' }}>Нет клиентов</p>
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b" style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}>
          {COLUMNS.map((col) => (
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
            className="border-b cursor-pointer transition-colors"
            style={{ borderColor: 'var(--line)' }}
          >
            <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {client.name || 'Дорогой гость'}
            </td>
            <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
              {client.phone || 'Не указан'}
            </td>
            <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
              {client.visits_count}
            </td>
            <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
              {client.last_visit
                ? new Date(client.last_visit).toLocaleDateString('ru-RU')
                : '—'}
            </td>
            <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {client.total_paid.toLocaleString('ru-RU')} ₽
            </td>
            <td className="px-4 py-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
