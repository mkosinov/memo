'use client';

import React, { useState, useRef, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
}

interface ColumnPickerProps {
  columns: Column[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  storageKey: string;
}

export function ColumnPicker({
  columns,
  visibleKeys,
  onChange,
  storageKey,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (key: string) => {
    const next = visibleKeys.includes(key)
      ? visibleKeys.filter((k) => k !== key)
      : [...visibleKeys, key];
    onChange(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
        style={{ color: 'var(--ink-light)' }}
        aria-label="Настроить колонки"
      >
        ⚙️
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-10 rounded-lg border shadow-lg p-2 min-w-[180px]"
          style={{
            borderColor: 'var(--line)',
            backgroundColor: 'var(--white)',
          }}
        >
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-surface rounded"
            >
              <input
                type="checkbox"
                checked={visibleKeys.includes(col.key)}
                onChange={() => toggle(col.key)}
                className="rounded"
              />
              <span style={{ color: 'var(--ink)' }}>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
