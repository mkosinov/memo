'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClientsTable } from '@/contexts/ClientsContext';
import type { ClientFilters } from '@/contexts/ClientsContext';

function useDebouncedCallback(
  callback: (value: string) => void,
  delay: number,
): { debounced: (value: string) => void; cancel: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback(
    (value: string) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(value);
        timeoutRef.current = null; // fired id must not linger
      }, delay);
    },
    [callback, delay],
  );

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // GH #216: no setState-after-unmount from an armed timer
  useEffect(() => cancel, [cancel]);

  return { debounced, cancel };
}

export function ClientsFilters() {
  const { filters, setFilters, resetFilters } = useClientsTable();
  // dirtyRef is declared BEFORE the debounce hook that closes over it
  const dirtyRef = useRef(false);
  const { debounced: debouncedSearch, cancel: cancelSearch } = useDebouncedCallback(
    (value: string) => {
      dirtyRef.current = false; // our send fired — the landing commit is expected
      setFilters({ search: value });
    },
    300,
  );

  // GH #216: controlled search input. Render-adjust pattern (react.dev
  // "adjust state during render", no effect): when the committed search
  // changes externally (deep-link ?clientId= pre-fill, reset) and the user
  // has NOT typed since our last send, sync the draft and cancel any armed
  // timer. If the user typed ahead (dirty), the armed send is authoritative.
  // Purity caveat: cancelSearch() during render is safe ONLY under the
  // "timer armed ⟺ dirty" invariant (keep the invariant if touching
  // onChange ordering).
  const [prevCommitted, setPrevCommitted] = useState(filters.search);
  const [draft, setDraft] = useState(filters.search);

  if (filters.search !== prevCommitted) {
    setPrevCommitted(filters.search);
    if (!dirtyRef.current) {
      setDraft(filters.search);
      cancelSearch();
    }
  }

  const handleReset = useCallback(() => {
    cancelSearch();
    dirtyRef.current = false;
    setDraft('');
    resetFilters();
  }, [cancelSearch, resetFilters]);

  const inputClass = 'rounded-lg border px-2 py-1.5 text-xs';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="🔍 Поиск по имени или телефону"
        className={`w-full ${inputClass}`}
        style={inputStyle}
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          dirtyRef.current = true;
          debouncedSearch(value);
        }}
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
      <button onClick={handleReset} className="text-xs text-brand hover:underline">
        Сбросить фильтры
      </button>
    </div>
  );
}
