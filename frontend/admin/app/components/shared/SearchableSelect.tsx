'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ── Types ───────────────────────────────────────────────────────── */

export interface SearchableSelectProps {
  value: string | null;
  onChange: (uuid: string | null) => void;
  onSelectItem?: (item: SearchItem) => void;
  onSearch: (query: string) => Promise<SearchItem[]>;
  label: string;
  placeholder?: string;
  required?: boolean;
  displayField: string;
  subtitleField?: string;
}

interface SearchItem {
  id: string;
  [key: string]: unknown;
}

/* ── Static styles (outside component, no re-creation) ──────────── */

const INPUT_CLASSES =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand)]';

const INPUT_STYLE = {
  borderColor: 'var(--line, #e5e7eb)',
  backgroundColor: 'var(--white, #fff)',
  color: 'var(--ink, #1a1a1a)',
} as const;

const DROPDOWN_STYLE = {
  backgroundColor: 'var(--white, #fff)',
  border: '1px solid var(--line, #e5e7eb)',
} as const;

const LABEL_COLOR = { color: 'var(--ink-light, #6b7280)' } as const;

const EMPTY_STYLE = {
  ...DROPDOWN_STYLE,
  color: 'var(--ink-light, #6b7280)',
} as const;

const DEBOUNCE_MS = 300;

/* ── Helpers ─────────────────────────────────────────────────────── */

function getDisplayText(
  item: SearchItem,
  displayField: string,
  subtitleField?: string,
): string {
  const main = String(item[displayField] || '');
  const sub = subtitleField ? ` — ${item[subtitleField]}` : '';
  return `${main}${sub}`;
}

/* ── Component ───────────────────────────────────────────────────── */

export default function SearchableSelect({
  value,
  onChange,
  onSelectItem,
  onSearch,
  label,
  placeholder = 'Введите для поиска...',
  required = false,
  displayField,
  subtitleField,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = useCallback(
    async (q: string) => {
      // GH #212: server-side ?q= is min-2-char; do not fire below the threshold.
      if (q.length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      setIsLoading(true);
      try {
        const data = await onSearch(q);
        setResults(data);
        setIsOpen(true);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [onSearch],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      setSelectedLabel(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(val), DEBOUNCE_MS);
    },
    [search],
  );

  const handleSelect = useCallback(
    (item: SearchItem) => {
      const displayLabel = getDisplayText(item, displayField, subtitleField);
      setSelectedLabel(displayLabel);
      setQuery('');
      setIsOpen(false);
      onChange(item.id);
      onSelectItem?.(item);
    },
    [displayField, subtitleField, onChange, onSelectItem],
  );

  const handleClear = useCallback(() => {
    setSelectedLabel(null);
    setQuery('');
    onChange(null);
  }, [onChange]);

  const handleFocus = useCallback(() => {
    if (results.length > 0 && !selectedLabel) setIsOpen(true);
  }, [results.length, selectedLabel]);

  return (
    <div ref={containerRef} className="relative">
      <label
        className="block text-xs font-medium mb-1"
        style={LABEL_COLOR}
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          value={selectedLabel || query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={selectedLabel ? '' : placeholder}
          className={INPUT_CLASSES}
          style={INPUT_STYLE}
          readOnly={!!selectedLabel}
          aria-label={label}
        />
        {selectedLabel && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="clear"
          >
            ×
          </button>
        )}
        {isLoading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-500 rounded-full" />
          </div>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full rounded-lg shadow-lg max-h-60 overflow-auto"
          style={DROPDOWN_STYLE}
          role="listbox"
        >
          {results.map((item) => (
            <li
              key={item.id}
              onClick={() => handleSelect(item)}
              className="px-3 py-2 cursor-pointer hover:bg-gray-100 text-sm"
              role="option"
              aria-selected={false}
            >
              {getDisplayText(item, displayField, subtitleField)}
            </li>
          ))}
        </ul>
      )}
      {isOpen && results.length === 0 && !isLoading && query.length > 0 && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg shadow-lg px-3 py-2 text-sm"
          style={EMPTY_STYLE}
        >
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
