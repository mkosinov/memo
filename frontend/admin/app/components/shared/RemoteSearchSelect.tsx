'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';

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
  onChange?: (uuid: string | null) => void;
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
  /**
   * id for the input element — lets the consumer's own visible label bind to
   * the input via htmlFor (used when the consumer renders the label itself,
   * e.g. the tags multi-pickers; GH #328 spec §6.2).
   */
  inputId?: string;
  /**
   * Adornment rendered inside the field frame, BEFORE the input — a generic
   * slot (e.g. the phone country selector, GH #414), not phone logic. Clicks
   * on it are stopped at the slot boundary and never open the suggestions
   * dropdown. Without the prop the markup and behavior are unchanged.
   */
  prefix?: ReactNode;
}

interface SearchItem {
  id: string;
  [key: string]: unknown;
}

/* ── Static styles (outside component, no re-creation) ──────────── */

const INPUT_CLASSES =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand)]';

// Prefix mode (GH #414): the frame moves from the input onto a flex row so a
// consumer-supplied adornment can sit inside the border, before the input.
const FRAME_CLASSES =
  'flex w-full items-center rounded-lg border transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-[var(--brand)]';

const PREFIXED_INPUT_CLASSES =
  'min-w-0 flex-1 bg-transparent border-0 pl-2 pr-3 py-2 text-sm focus:outline-none';

const PREFIX_SLOT_CLASSES = 'flex shrink-0 items-center py-2 pl-3';

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
  inputId,
  prefix,
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
      onChange?.(item.id);
      onSelectItem?.(item);
    },
    [displayField, subtitleField, getDisplayLabel, onInputValueChange, onChange, onSelectItem],
  );

  const handleClear = useCallback(() => {
    setSelectedLabel(null);
    setQuery('');
    onInputValueChange?.('');
    onChange?.(null);
  }, [onChange, onInputValueChange]);

  const handleFocus = useCallback(() => {
    if (results.length > 0 && !selectedLabel) setIsOpen(true);
  }, [results.length, selectedLabel]);

  // Shared between both field layouts so they can never drift apart.
  const inputProps = {
    type: 'text',
    value: selectedLabel || query,
    onChange: handleInputChange,
    onFocus: handleFocus,
    placeholder: selectedLabel ? '' : placeholder,
    readOnly: !!selectedLabel,
    id: inputId,
    'aria-label': label,
    'data-testid': inputTestId,
  } as const;

  return (
    <div ref={containerRef} className="relative">
      <label
        className="block text-xs font-medium mb-1"
        style={LABEL_COLOR}
      >
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        {prefix ? (
          <div className={FRAME_CLASSES} style={INPUT_STYLE}>
            {/* Stop the click at the slot boundary: prefix interactions (e.g.
                opening the country selector) must not reach the typeahead —
                in particular, never open the suggestions dropdown. */}
            <div
              className={PREFIX_SLOT_CLASSES}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {prefix}
            </div>
            <input {...inputProps} className={PREFIXED_INPUT_CLASSES} />
          </div>
        ) : (
          <input {...inputProps} className={INPUT_CLASSES} style={INPUT_STYLE} />
        )}
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
          className="absolute z-[var(--z-popover)] mt-1 w-full rounded-lg shadow-lg max-h-60 overflow-auto"
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
          className="absolute z-[var(--z-popover)] mt-1 w-full rounded-lg shadow-lg px-3 py-2 text-sm"
          style={EMPTY_STYLE}
        >
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
