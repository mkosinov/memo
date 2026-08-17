'use client';

import React, { useState } from 'react';
import { useClients } from '@/contexts/ClientsContext';
import { useUI } from '@/contexts/UIContext';
import { ColumnPicker } from '@/app/components/shared/ColumnPicker';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { ErrorState } from '@/app/components/error';
import { parseApiError } from '@/app/lib/api/parseApiError';
import type { ClientWithStats, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';

const COLUMNS: { key: string; label: string; sortable: boolean; defaultVisible: boolean }[] = [
  { key: 'name', label: 'Имя', sortable: true, defaultVisible: true },
  { key: 'phone', label: 'Телефон', sortable: true, defaultVisible: true },
  { key: 'records_count', label: 'Всего записей', sortable: true, defaultVisible: true },
  { key: 'last_record', label: 'Последняя запись', sortable: true, defaultVisible: true },
  { key: 'total_paid', label: 'Сумма оплат', sortable: true, defaultVisible: true },
];

interface ClientsTableProps {
  onClientClick: (client: ClientWithStats) => void;
}

export function ClientsTable({ onClientClick }: ClientsTableProps) {
  const {
    clients, isLoading, error, refetch, filters, sortBy, sortOrder, setSort, resetFilters,
    deleteClient, archiveClient, restoreClient, resolveDeleteClient, dependencies,
  } = useClients();
  const { showToast } = useUI();

  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('clients-columns');
      if (stored) return JSON.parse(stored);
    } catch {}
    return COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
  });

  // ─── Action dropdown state ───────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // ─── Delete dialog state (§7.3: parent owns dry-run + open/close) ────
  // `dependencies` (the 409 tree parked by ClientsContext) is read on conflict:
  // the context keeps it for the dialog; the open/close state stays local.
  const [deleteTarget, setDeleteTarget] = useState<{
    client: ClientWithStats;
    dependencies: DependencyNode[];
  } | null>(null);

  const visibleColumns = COLUMNS.filter((c) => visibleKeys.includes(c.key));

  const hasActiveFilters =
    filters.search ||
    filters.status !== 'active' ||
    filters.min_records !== null ||
    filters.max_records !== null ||
    filters.min_paid !== null ||
    filters.max_paid !== null;

  // ─── Archive / Restore (#198 parity) ─────────────────────────────────
  // Dedicated POST endpoints; label + action drive off `row.archived`.

  const handleArchiveToggle = async (client: ClientWithStats) => {
    setOpenDropdownId(null);
    try {
      if (client.archived) {
        await restoreClient(client.id);
        showToast('Клиент восстановлен');
      } else {
        await archiveClient(client.id);
        showToast('Клиент в архиве');
      }
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  };

  // ─── Delete — §7.3 dry-run flow ───────────────────────────────────────
  // No-body DELETE → 204 (instant delete, no deps) or 409 + tree → dialog.

  const handleDelete = async (client: ClientWithStats) => {
    setOpenDropdownId(null);
    try {
      await deleteClient(client.id);
      // 204 — already deleted (zero deps): refresh handled by the context.
      showToast('Клиент удалён');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Prefer the tree on the failing 409 response itself (always fresh);
        // the context-parked `dependencies` is only a fallback.
        const deps = err.dependencies ?? dependencies ?? [];
        if (deps.length > 0) {
          setDeleteTarget({ client, dependencies: deps });
          return;
        }
      }
      showToast(parseApiError(err).message, 'error');
    }
  };

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
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 010-8 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
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
              {visibleKeys.includes('records_count') && (
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                {client.records_count}
              </td>
              )}
              {visibleKeys.includes('last_record') && (
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-mid)' }}>
                {client.last_record
                  ? new Date(client.last_record).toLocaleDateString('ru-RU')
                  : '—'}
              </td>
              )}
              {visibleKeys.includes('total_paid') && (
              <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {client.total_paid.toLocaleString('ru-RU')} ₽
              </td>
              )}
              <td className="py-3 px-4">
                {/* Actions dropdown — #207: archive/restore parity + delete dialog */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setOpenDropdownId(openDropdownId === client.id ? null : client.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors opacity-0 group-hover:opacity-100"
                    style={{ color: 'var(--ink-light)' }}
                    aria-label="Действия"
                  >
                    ⋯
                  </button>
                  {openDropdownId === client.id && (
                    <div
                      className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                      style={{
                        borderColor: 'var(--line)',
                        backgroundColor: 'var(--white)',
                      }}
                      data-testid={`dropdown-${client.id}`}
                    >
                      <button
                        onClick={() => handleArchiveToggle(client)}
                        className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        {client.archived ? 'Восстановить' : 'В архив'}
                      </button>
                      <button
                        onClick={() => handleDelete(client)}
                        className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--danger, #dc2626)' }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Delete dialog — §7.3: opened on dry-run 409, closed on done/cancel */}
      {deleteTarget && (
        <DeleteDialog
          entityName={deleteTarget.client.name || 'Дорогой гость'}
          entityType="client"
          entityId={deleteTarget.client.id}
          dependencies={deleteTarget.dependencies}
          onResolve={async (id, resolutions) => {
            await resolveDeleteClient(id, resolutions);
            showToast('Клиент удалён');
          }}
          onArchive={(id) => archiveClient(id)}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
