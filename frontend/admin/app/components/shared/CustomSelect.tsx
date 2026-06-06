'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface CustomSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  /** When true, only the icon is shown in the trigger — no label text */
  iconOnly?: boolean;
}

export function CustomSelect({ value, options, onChange, className = '', iconOnly = false }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

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

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
    },
    [onChange],
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        className={`${className} flex items-center gap-2`}
        data-testid="custom-select-trigger"
      >
        {selected?.icon && (
          <span style={{ color: selected?.color }}>{selected.icon}</span>
        )}
        {selected?.color && (
          <span
            data-color={selected.color}
            className="inline-block w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: selected.color }}
          />
        )}
        {!iconOnly && <span>{selected?.label ?? '—'}</span>}
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg"
          style={{ borderColor: 'var(--line, #e5e7eb)' }}
          data-testid="custom-select-dropdown"
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left ${
                option.value === value ? 'bg-gray-100' : ''
              }`}
              onClick={() => handleSelect(option.value)}
              data-testid={`custom-select-option-${option.value}`}
            >
              {option.icon && (
                <span style={{ color: option.color }}>{option.icon}</span>
              )}
              {option.color && (
                <span
                  data-color={option.color}
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: option.color }}
                />
              )}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
