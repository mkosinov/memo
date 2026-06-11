'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface MultiSelectProps<T> {
  items: T[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  label: string;
  icon?: React.ReactNode;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
}

/**
 * MultiSelect dropdown with checkbox list and select-all / clear-all buttons.
 * Closes on outside click. Shows label + selected count as trigger text.
 */
export function MultiSelect<T>({
  items,
  selectedIds,
  onSelectionChange,
  label,
  icon,
  getId,
  getLabel,
}: MultiSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const handleToggle = useCallback(() => setIsOpen(prev => !prev), []);

  const handleToggleItem = useCallback(
    (id: string) => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter(i => i !== id)
        : [...selectedIds, id];
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const handleSelectAll = useCallback(() => {
    onSelectionChange(items.map(item => getId(item)));
  }, [items, getId, onSelectionChange]);

  const handleClearAll = useCallback(() => {
    onSelectionChange([]);
  }, [onSelectionChange]);

  const count = selectedIds.length;
  const total = items.length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50"
        style={{
          borderColor: 'var(--line)',
          color: count > 0 ? 'var(--brand)' : 'var(--ink-mid)',
          backgroundColor: 'var(--white)',
        }}
        aria-label={label}
        aria-expanded={isOpen}
      >
        {icon}
        <span>
          {label} ({count}/{total})
        </span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 mt-1 min-w-[200px] bg-white border rounded-lg shadow-lg"
          style={{ borderColor: 'var(--line, #e5e7eb)' }}
          data-testid="multiselect-dropdown"
        >
          {/* Select all / Clear all */}
          <div className="flex items-center justify-between border-b px-3 py-1.5" style={{ borderColor: 'var(--line, #e5e7eb)' }}>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[11px] font-medium transition-colors hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[11px] font-medium transition-colors hover:underline"
              style={{ color: 'var(--ink-light, #9ca3af)' }}
            >
              Снять все
            </button>
          </div>

          {/* Checkbox list */}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {items.map(item => {
              const id = getId(item);
              const isChecked = selectedIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleToggleItem(id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                  data-testid={`multiselect-option-${id}`}
                >
                  <div
                    className={`flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0 ${
                      isChecked ? 'border-[var(--brand)] bg-[var(--brand)]' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {isChecked && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span style={{ color: 'var(--ink, #1a1a1a)' }}>{getLabel(item)}</span>
                </button>
              );
            })}
            {items.length === 0 && (
              <div className="px-3 py-2 text-xs text-center" style={{ color: 'var(--ink-light, #9ca3af)' }}>
                Нет элементов
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
