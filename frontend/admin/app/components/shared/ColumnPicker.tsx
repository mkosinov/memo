'use client';

import React, { Fragment, useId, useState, useRef, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
}

interface ColumnPickerProps {
  columns: Column[];
  visibleKeys: string[];
  /** Controlled presentational (#139 §6.5): parent owns state + persistence. */
  onToggle: (key: string) => void;
}

export function ColumnPicker({
  columns,
  visibleKeys,
  onToggle,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const uid = useId();
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
    onToggle(key);
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
          className="absolute right-0 top-full mt-1 z-[var(--z-base)] rounded-lg border shadow-lg p-2 min-w-[180px]"
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
              <Fragment key={col.key}>
                <label
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
                    aria-describedby={
                      disabled ? `${uid}-guard-${col.key}` : undefined
                    }
                    className="rounded"
                  />
                  <span style={{ color: 'var(--ink)' }}>{col.label}</span>
                </label>
                {disabled && (
                  <span id={`${uid}-guard-${col.key}`} className="sr-only">
                    Последняя видимая колонка — скрыть нельзя
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
