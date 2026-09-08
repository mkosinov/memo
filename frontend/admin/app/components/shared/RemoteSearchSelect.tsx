'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// Server-coupled typeahead (debounce 300ms; consumer-tuned search gate via
// minChars/canSearch, default min-2) — the remote counterpart of Combobox
// (GH #214).

/* ── Types ───────────────────────────────────────────────────────── */

/** What onSearch ultimately receives: the raw input (default) or the
 *  object built by buildParams (e.g. `{ phone, per_page }` — GH #221). */
type SearchQuery = string | Record<string, string | number>;

export interface RemoteSearchSelectProps<
  Q extends SearchQuery = string,
> {
  value: string | null;
  onChange: (uuid: string | null) => void;
  onSelectItem?: (item: SearchItem) => void;
  onSearch: (query: Q) => Promise<SearchItem[]>;
  label: string;
  placeholder?: string;
  required?: boolean;
  displayField: string;
  subtitleField?: string;
  /** Min input length before a search fires (default 2 — server `?q=` contract). */
  minChars?: number;
  /** Gate for firing a search; defaults to `q.length >= minChars`. */
  canSearch?: (input: string) => boolean;
  /** Builds what onSearch receives; defaults to passing the input through. */
  buildParams?: (input: string) => Q;
  /** Transforms the typed value before it lands in state (input mask — GH #221).
   *  Runs once per keystroke; the formatted value is what canSearch/buildParams
   *  and the debounced search see. Defaults to identity. */
  formatInput?: (raw: string) => string;
  /** Renders a dropdown/selected label for an item; defaults to
   *  `${displayField} — ${subtitleField}`. */
  getDisplayLabel?: (item: SearchItem) => string;
  /** Lifts the committed input value (post-formatInput) to the consumer on
   *  every change, INCLUDING pick (display label) and ×-clear ('') — it
   *  always mirrors what the input shows (GH #221 WYSIWYG). */
  onInputValueChange?: (value: string) => void;
  /** data-testid for the input element (consumer E2E anchors). */
  inputTestId?: string;
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

export default function RemoteSearchSelect<
  Q extends SearchQuery = string,
>({
  value,
  onChange,
  onSelectItem,
  onSearch,
  label,
  placeholder = 'Введите для поиска...',
  required = false,
  displayField,
  subtitleField,
  minChars = 2,
  canSearch,
  buildParams,
  formatInput,
  getDisplayLabel,
  onInputValueChange,
  inputTestId,
}: RemoteSearchSelectProps<Q>) {
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
      // GH #221: threshold/predicate/params are consumer props (defaults keep
      // today's behavior — min 2 chars, input passed through as-is).
      const allowed = canSearch ?? ((input: string) => input.length >= minChars);
      if (!allowed(q)) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      setIsLoading(true);
      try {
        // Invariant: default Q = string (input passed through); a record-shaped
        // Q is only reachable via buildParams. All current consumers are string.
        const data = await onSearch((buildParams ? buildParams(q) : q) as Q);
        setResults(data);
        setIsOpen(true);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [onSearch, canSearch, buildParams, minChars],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = formatInput ? formatInput(e.target.value) : e.target.value;
      setQuery(val);
      setSelectedLabel(null);
      onInputValueChange?.(val);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(val), DEBOUNCE_MS);
    },
    [search, formatInput, onInputValueChange],
  );

  const handleSelect = useCallback(
    (item: SearchItem) => {
      const displayLabel = getDisplayLabel
        ? getDisplayLabel(item)
        : getDisplayText(item, displayField, subtitleField);
      setSelectedLabel(displayLabel);
      setQuery('');
      setIsOpen(false);
      onInputValueChange?.(displayLabel);
      onChange(item.id);
      onSelectItem?.(item);
    },
    [displayField, subtitleField, getDisplayLabel, onInputValueChange, onChange, onSelectItem],
  );

  const handleClear = useCallback(() => {
    setSelectedLabel(null);
    setQuery('');
    onInputValueChange?.('');
    onChange(null);
  }, [onChange, onInputValueChange]);

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
          data-testid={inputTestId}
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
              {getDisplayLabel
                ? getDisplayLabel(item)
                : getDisplayText(item, displayField, subtitleField)}
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
