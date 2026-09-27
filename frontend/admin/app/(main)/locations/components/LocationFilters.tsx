'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

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

  // No stale setSearch after unmount.
  useEffect(() => cancel, [cancel]);

  return { debounced, cancel };
}

interface LocationFiltersProps {
  search: string;
  status: string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
}

/**
 * Locations filters bar. #349 Task 5: q/status live in the URL, and every
 * commit of `search` is a history step — so the bar owns a LOCAL draft with
 * the 300ms debounce (the typing burst = ONE write, spec §2 «черновик поля
 * поиска»). The render-adjust pattern (react.dev, ClientsFilters precedent):
 * when the committed search changes externally (back/forward, opening a
 * link, reset) and the user has NOT typed since our last send, the draft
 * resyncs to it; if the user typed ahead (dirty), the armed send wins.
 */
export function LocationFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
  onReset,
}: LocationFiltersProps) {
  // dirtyRef is declared BEFORE the debounce hook that closes over it.
  const dirtyRef = useRef(false);
  const { debounced: debouncedSearch, cancel: cancelSearch } = useDebouncedCallback(
    (value: string) => {
      dirtyRef.current = false; // our send fired — the landing commit is expected
      onSearchChange(value);
    },
    300,
  );

  const [prevCommitted, setPrevCommitted] = useState(search);
  const [draft, setDraft] = useState(search);

  if (search !== prevCommitted) {
    setPrevCommitted(search);
    if (!dirtyRef.current) {
      setDraft(search);
      cancelSearch();
    }
  }

  const handleReset = useCallback(() => {
    cancelSearch();
    dirtyRef.current = false;
    setDraft('');
    onReset();
  }, [cancelSearch, onReset]);

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
          value={draft}
          onChange={(e) => {
            dirtyRef.current = true;
            setDraft(e.target.value);
            debouncedSearch(e.target.value);
          }}
          placeholder="Название или адрес..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Поиск по названию или адресу"
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
          <option value="all">Все</option>
          <option value="archived">Архив</option>
        </select>
      </div>
      <button
        onClick={handleReset}
        className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
        style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
      >
        Сбросить
      </button>
    </div>
  );
}
