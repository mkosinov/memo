'use client';

import React from 'react';

interface MasterFiltersProps {
  search: string;
  status: string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
}

export function MasterFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
  onReset,
}: MasterFiltersProps) {
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
          placeholder="Имя или фамилия..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Поиск по имени или фамилии"
        />
      </div>
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
          <option value="">Все</option>
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
