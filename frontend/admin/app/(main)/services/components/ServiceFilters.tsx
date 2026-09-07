'use client';

import React from 'react';
import type { MaterialResponse } from '@memo/api-client';

interface ServiceFiltersProps {
  search: string;
  status: string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
  /**
   * Material filter (GH #223 T7, spec §8) — optional so the shared bar keeps
   * serving MaterialsTable (no material filter there). Options come from the
   * ACTIVE materials list (useMaterialsRaw → /all?status=active); '' = «все»
   * and omits material_id from the server query.
   */
  materials?: MaterialResponse[];
  materialFilter?: string;
  onMaterialFilterChange?: (v: string) => void;
}

export function ServiceFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
  onReset,
  materials,
  materialFilter,
  onMaterialFilterChange,
}: ServiceFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          className="text-xs font-medium"
          style={{ color: 'var(--ink-light)' }}
        >
          Поиск
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Название..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Поиск по названию"
        />
      </div>
      {onMaterialFilterChange && (
        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium"
            style={{ color: 'var(--ink-light)' }}
          >
            Материал
          </label>
          <select
            value={materialFilter ?? ''}
            onChange={(e) => onMaterialFilterChange(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-xs"
            style={{
              borderColor: 'var(--line)',
              color: 'var(--ink-mid)',
              backgroundColor: 'var(--white)',
            }}
            aria-label="Фильтр по материалу"
          >
            <option value="">все</option>
            {(materials ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label
          className="text-xs font-medium"
          style={{ color: 'var(--ink-light)' }}
        >
          Статус
        </label>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Фильтр по статусу"
        >
          <option value="active">Активные</option>
          <option value="all">Все</option>
          <option value="archived">Архив</option>
        </select>
      </div>
      <button
        onClick={onReset}
        className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
        style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
      >
        Сбросить
      </button>
    </div>
  );
}
