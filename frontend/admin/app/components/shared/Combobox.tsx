'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  value: string;              // entity id; '' reserved for the clear option
  label: string;
  searchText?: string;        // filter haystack; default: label
  color?: string;             // renders the 3×3 swatch
}

export interface ComboboxProps {
  value: string;              // '' = cleared (codebase sentinel convention)
  options: ComboboxOption[];
  onChange: (value: string) => void;  // '' emitted only via the clear option
  clearLabel: string;         // required — pinned clear option's label
  className?: string;         // applied to the trigger
  ariaLabel?: string;         // accessible name for the trigger
}

export function Combobox({ value, options, onChange, clearLabel, className = '', ariaLabel }: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => (o.searchText ?? o.label).toLowerCase().includes(q));
  }, [options, query]);

  const visible: ComboboxOption[] = [{ value: '', label: clearLabel }, ...filtered];

  const optionDomId = (v: string) => `${listboxId}-opt-${v || 'clear'}`;

  const closeDropdown = useCallback((refocusTrigger = true) => {
    setIsOpen(false);
    setQuery('');
    if (refocusTrigger) triggerRef.current?.focus();
  }, []);

  // Close on outside mousedown (listener attached only while open)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // On open: focus the search input
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  // Clamp highlight when the visible list shrinks (typing / options refetch)
  useEffect(() => {
    setHighlightedIndex(prev => (prev < visible.length ? prev : 0));
  }, [visible.length]);

  const openDropdown = () => {
    setIsOpen(true);
    setQuery('');
    // Highlight the first REAL option (clear option excluded)
    setHighlightedIndex(visible.length > 1 ? 1 : 0);
  };

  const select = (v: string) => {
    onChange(v);
    closeDropdown(false);
  };

  const handleQueryChange = (v: string) => {
    setQuery(v);
    setHighlightedIndex(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const len = visible.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => (prev + 1) % len);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => (prev - 1 + len) % len);
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(len - 1);
        break;
      case 'Enter':
        if (e.nativeEvent.isComposing) return; // IME guard
        e.preventDefault();
        e.stopPropagation();
        if (visible[highlightedIndex]) select(visible[highlightedIndex].value);
        break;
      case 'Escape':
        // Host modals (e.g. PhotoModal) listen for Esc at window level — must not receive it
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        break;
      case 'Tab': {
        // Commit the highlighted option, then let Tab continue its native focus flow
        e.stopPropagation();
        const highlighted = visible[highlightedIndex];
        if (highlighted && highlighted.value !== value) {
          select(highlighted.value);
        } else {
          closeDropdown(false);
        }
        break;
      }
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        data-testid="combobox-trigger"
        className={`${className} flex items-center gap-2 w-full`}
      >
        {selected?.color && (
          <span
            data-color={selected.color}
            className="inline-block w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: selected.color }}
          />
        )}
        <span className="truncate">{selected?.label ?? (value === '' ? clearLabel : '—')}</span>
        <svg className="w-4 h-4 shrink-0 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg"
          style={{ borderColor: 'var(--line, #e5e7eb)' }}
          data-testid="combobox-dropdown"
        >
          <div className="px-3 py-2 border-b">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              data-testid="combobox-search"
              placeholder="Поиск..."
              aria-label="Поиск"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={optionDomId(visible[highlightedIndex]?.value ?? '')}
              className="w-full text-sm outline-none bg-transparent"
            />
          </div>
          <div className="max-h-60 overflow-y-auto" role="listbox" id={listboxId} aria-label={clearLabel}>
            {visible.map((o, i) => (
              <button
                key={o.value || 'clear'}
                type="button"
                role="option"
                id={optionDomId(o.value)}
                aria-selected={i === highlightedIndex}
                data-testid={`combobox-option-${o.value || 'clear'}`}
                onClick={() => select(o.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left ${
                  o.value === value ? 'bg-gray-100' : ''
                } ${i === highlightedIndex ? 'bg-gray-100' : ''}`}
              >
                {o.color && (
                  <span
                    data-color={o.color}
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: o.color }}
                  />
                )}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400" role="status" data-testid="combobox-empty">
              Ничего не найдено
            </div>
          )}
        </div>
      )}
    </div>
  );
}
