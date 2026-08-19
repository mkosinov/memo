'use client';

import React, { useState, useRef, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
}

interface ColumnPickerProps {
  columns: Column[];
  visibleKeys: string[];
  /** Controlled presentational (#139 §6.5): parent owns state + persistence. */
  onToggle?: (key: string) => void;
  /**
   * LEGACY SHIM (#139 T1→T8): tables T2–T8 still call the old onChange/storageKey
   * API until their migration task switches them to `<DataTable>` (which owns the
   * persistence). Deleted entirely once all 8 tables are migrated.
   */
  onChange?: (keys: string[]) => void;
  storageKey?: string;
}

export function ColumnPicker({
  columns,
  visibleKeys,
  onToggle,
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

  // The last visible column can never be unchecked (§6.5 — prevents an
  // unrecoverable empty table from the UI side).
  const lastVisible = visibleKeys.length === 1;

  const toggle = (key: string) => {
    const isChecked = visibleKeys.includes(key);
    // Guard: never allow unchecking the sole remaining visible column.
    if (isChecked && lastVisible) return;

    if (onToggle) {
      onToggle(key);
      return;
    }
    if (onChange) {
      const next = visibleKeys.includes(key)
        ? visibleKeys.filter((k) => k !== key)
        : [...visibleKeys, key];
      onChange(next);
      // LEGACY SHIM: pre-#139 tables persist here until their migration task
      // switches them to <DataTable> (which owns persistence).
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    }
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
          {columns.map((col) => {
            const checked = visibleKeys.includes(col.key);
            const disabled = checked && lastVisible;
            // §6.5 — the last visible column stays checked ("prevents an empty
            // table with no way back"). The protection is a NO-OP toggle guard
            // (above) + muted style — NOT an HTML `disabled` attribute and NOT
            // `aria-disabled`: Playwright treats an element inside a <label>
            // bound to a disabled/aria-disabled control as unactionable, which
            // breaks the unchanged tags-crud picker e2e (Tags has exactly one
            // column ⇒ it is always the "last visible" one, yet the spec must
            // still be able to click its label and have the attempt no-op).
            return (
              <label
                key={col.key}
                className="flex items-center gap-2 px-2 py-1 text-sm rounded"
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(col.key)}
                  className="rounded"
                />
                <span style={{ color: 'var(--ink)' }}>{col.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
