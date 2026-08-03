'use client';

import { useCallback, useRef } from 'react';
import { useClients } from '@/contexts/ClientsContext';
import type { ClientFilters } from '@/contexts/ClientsContext';

function useDebouncedCallback(callback: (value: string) => void, delay: number): (value: string) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback(
    (value: string) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => callback(value), delay);
    },
    [callback, delay],
  );

  return debounced;
}

export function ClientsFilters() {
  const { filters, setFilters, resetFilters } = useClients();
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setFilters({ search: value });
  }, 300);

  const inputClass = 'rounded-lg border px-2 py-1.5 text-xs';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="🔍 Поиск по имени или телефону"
        className={`w-full ${inputClass}`}
        style={inputStyle}
        onChange={(e) => debouncedSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="text-xs text-ink-mid block mb-1">Статус</label>
          <select
            className={inputClass}
            style={inputStyle}
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value as ClientFilters['status'] })}
          >
            <option value="all">Все</option>
            <option value="active">Активные</option>
            <option value="archived">Неактивные</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Записи</label>
          <div className="flex gap-1">
            <input type="number" placeholder="от" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ min_records: e.target.value ? Number(e.target.value) : null })} />
            <input type="number" placeholder="до" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ max_records: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Пропущенные</label>
          <div className="flex gap-1">
            <input type="number" placeholder="от" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ missed_from: e.target.value ? Number(e.target.value) : null })} />
            <input type="number" placeholder="до" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ missed_to: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Создан</label>
          <div className="flex gap-1">
            <input type="date" className={inputClass} style={inputStyle}
              onChange={(e) => setFilters({ created_from: e.target.value })} />
            <input type="date" className={inputClass} style={inputStyle}
              onChange={(e) => setFilters({ created_to: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Оплата</label>
          <div className="flex gap-1">
            <input type="number" placeholder="от" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ min_paid: e.target.value ? Number(e.target.value) : null })} />
            <input type="number" placeholder="до" className={`w-20 ${inputClass}`} style={inputStyle}
              onChange={(e) => setFilters({ max_paid: e.target.value ? Number(e.target.value) : null })} />
          </div>
        </div>
      </div>
      <button onClick={resetFilters} className="text-xs text-brand hover:underline">
        Сбросить фильтры
      </button>
    </div>
  );
}
