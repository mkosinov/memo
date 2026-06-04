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
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Нет клиентов</p>
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={`text-left text-xs font-semibold uppercase tracking-wider py-3 px-4 ${col.sortable ? 'cursor-pointer hover:text-brand select-none' : ''}`}
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
            className="border-b hover:bg-gray-50 cursor-pointer group"
            style={{ borderColor: 'var(--line)' }}
          >
            <td className="py-3 px-4">
              {client.name || 'Дорогой гость'}
            </td>
            <td className="py-3 px-4">
              {client.phone || 'Не указан'}
            </td>
            <td className="py-3 px-4">{client.visits_count}</td>
            <td className="py-3 px-4">
              {client.last_visit
                ? new Date(client.last_visit).toLocaleDateString('ru-RU')
                : '—'}
            </td>
            <td className="py-3 px-4">
              {client.total_paid.toLocaleString('ru-RU')} ₽
            </td>
            <td className="py-3 px-4">
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
