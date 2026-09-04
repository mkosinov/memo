# GH #214 Searchable Combobox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all dictionary dropdowns (masters/services/locations) across forms and filter bars with a new shared searchable `Combobox` (client-side instant filter over `/all` arrays), rename `SearchableSelect` → `RemoteSearchSelect`, delete `CustomSelect`, unify master labels to «Фамилия Имя».

**Architecture:** One new presentational client component (`app/components/shared/Combobox.tsx`) with an always-visible search input inside the dropdown; 5 surfaces (7 components) migrate to it; `MasterPicker` becomes a thin pass-through wrapper; the server-coupled typeahead gets a clarifying rename; `CustomSelect` and its suite are deleted after its last consumer leaves. No backend, api-client, or query-key changes.

**Tech Stack:** React 18 / Next.js App Router (frontend/admin), TanStack Query v5 (unchanged usage), vitest + @testing-library/react, Playwright e2e.

**Spec:** `docs/specs/2026-09-03-searchable-combobox-design.md` (authoritative — read fully before Task 1; G1b-approved incl. rows 13-14 and the minimal `''`-contract).

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Dictionary dropdowns become searchable:** every master/service/location dropdown in forms (client record tab, activity settings, stamps panel, photo modal) and filter bars (records, photos) now has a search field at the top of the open list; typing instantly narrows the list (case-insensitive, matches anywhere in the name — surname or first name both work).
- **Masters display uniformly as «Фамилия Имя»** in every dropdown (was: mixed «Имя Фамилия» / first-name-only / short first name), with the color swatch preserved.
- **Empty-state feedback:** a search with no matches shows «Ничего не найдено» (announced to screen readers); Esc closes the dropdown and keeps the previous value; the list scrolls internally after ~240px instead of growing unbounded.
- **Clearing stays familiar:** each dropdown keeps its current empty-option copy («Не выбран» / «Выберите» / «Все …» / «Без локации») as a pinned first row.
- **Keyboard support:** arrows/Home/End navigate, Enter selects, Tab commits the highlighted row, Esc closes and returns focus to the trigger — and Esc inside a dropdown no longer closes the surrounding modal.
- **Nothing else changes:** data fetched, archived filtering, form save flows, tariffs, statuses, table search, and server typeaheads (clients/activities/tags) behave exactly as before; the typeahead component is only renamed.

---

## Task 1: Combobox component + unit suite (TDD)
### Classification: standard
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §5 contract (props, filtering, dropdown behavior, rendering parity, a11y, testids), §8.1 test cases
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — component unit-test conventions
- `frontend/admin/app/components/shared/CustomSelect.tsx` — visual language to absorb (will be deleted in Task 10)

### Task Description
Create `frontend/admin/app/components/shared/Combobox.tsx` and `frontend/admin/__tests__/Combobox.test.tsx`. RED first: the full suite fails against a nonexistent component, then implement to GREEN.

**Component contract (exact, from spec §5):**

```ts
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
  ariaLabel?: string;         // accessible name for the trigger (booking/photo filter bars rely on getByLabel)
}
```

> **Contract addendum vs spec §5** (flagged for G2): `ariaLabel` is added beyond the G1b-approved minimal props because BookingFilters/PhotosFilters e2e + unit suites locate the controls via `getByLabelText('Фильтр по …')` — preserving that is cheaper than rewriting locator strategies. One optional prop, spread onto the trigger button as `aria-label`.

**Reference implementation** (implementer may adjust internals; contract, behavior, testids, and class names are fixed):

```tsx
'use client';

import { useState, useRef, useEffect, useMemo, useId } from 'react';

export interface ComboboxOption { /* as above */ }
export interface ComboboxProps { /* as above */ }

export function Combobox({ value, options, onChange, clearLabel, className = '', ariaLabel }: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.searchText ?? o.label).toLowerCase().includes(q));
  }, [options, query]);

  // Visible rows: pinned clear option first, then filtered matches.
  const visible = useMemo<ComboboxOption[]>(
    () => [{ value: '', label: clearLabel }, ...filtered],
    [filtered, clearLabel],
  );

  // Close on outside mousedown (CustomSelect pattern).
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

  // Focus the search input on open.
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  // Clamp highlight when the visible list changes (refetch, typing, clear).
  useEffect(() => {
    setHighlightedIndex((prev) => (prev < visible.length ? prev : 0));
  }, [visible]);

  const openDropdown = () => {
    setIsOpen(true);
    setQuery('');
    setHighlightedIndex(0);
  };

  const closeDropdown = (focusTrigger = true) => {
    setIsOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  const select = (v: string) => {
    onChange(v);
    closeDropdown(false);
  };

  const handleQueryChange = (v: string) => {
    setQuery(v);
    // Highlight resets to the first FILTERED match (clear option excluded → index 1);
    // the clamp effect drops it to the clear option when nothing matches.
    setHighlightedIndex(1);
  };

  const optionDomId = (v: string) => `${listboxId}-opt-${v || 'clear'}`;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = visible.length;
      if (!n) return;
      setHighlightedIndex((prev) => (e.key === 'ArrowDown' ? (prev + 1) % n : (prev - 1 + n) % n));
    } else if (e.key === 'Home') {
      e.preventDefault(); e.stopPropagation();
      setHighlightedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault(); e.stopPropagation();
      setHighlightedIndex(Math.max(0, visible.length - 1));
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return; // IME guard (spec §5.4)
      e.preventDefault(); e.stopPropagation();
      if (visible[highlightedIndex]) select(visible[highlightedIndex].value);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); // host modals listen at window level (PhotoModal)
      closeDropdown();
    } else if (e.key === 'Tab') {
      // Commit the highlighted option, then let Tab continue native focus flow.
      e.stopPropagation();
      if (visible[highlightedIndex] && visible[highlightedIndex].value !== value) {
        onChange(visible[highlightedIndex].value);
      }
      closeDropdown(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => (isOpen ? closeDropdown(false) : openDropdown())}
        className={`${className} flex items-center gap-2 w-full`}
        data-testid="combobox-trigger"
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
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full text-sm outline-none bg-transparent"
              placeholder="Поиск..."
              aria-label="Поиск"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={
                visible[highlightedIndex] ? optionDomId(visible[highlightedIndex].value) : undefined
              }
              data-testid="combobox-search"
            />
          </div>
          <div className="max-h-60 overflow-y-auto" role="listbox" id={listboxId} aria-label={clearLabel}>
            {visible.map((o, i) => (
              <button
                key={o.value || 'clear'}
                type="button"
                role="option"
                aria-selected={i === highlightedIndex}
                id={optionDomId(o.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left ${
                  o.value === value ? 'bg-gray-100' : ''
                } ${i === highlightedIndex ? 'bg-gray-100' : ''}`}
                onClick={() => select(o.value)}
                data-testid={`combobox-option-${o.value || 'clear'}`}
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
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-400" role="status" data-testid="combobox-empty">
                Ничего не найдено
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

(Export both `ComboboxOption` and `ComboboxProps` from `Combobox.tsx` — consumers import the types from there.)

**Unit suite** — `frontend/admin/__tests__/Combobox.test.tsx`, all 8 cases from spec §8.1, NO fake timers. Extend case 1 with the ariaLabel assertion (`getByLabelText('Мастер')` resolves to the trigger when `ariaLabel="Мастер"` is passed):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Combobox } from '../app/components/shared/Combobox';

const MASTERS = [
  { value: 'm1', label: 'Иванова Анна', color: '#FF6B6B' },
  { value: 'm2', label: 'Петров Пётр', color: '#4ECDC4' },
  { value: 'm3', label: 'Сидорова Мария', searchText: 'Сидорова Мария Марья', color: '#45B7D1' },
];

function renderCombobox(props = {}) {
  return render(
    <Combobox value="m1" options={MASTERS} onChange={vi.fn()} clearLabel="Не выбран" {...props} />,
  );
}

describe('Combobox', () => {
  it('1. renders trigger with selected label; clearLabel when value=""; — when value not in options', () => {
    renderCombobox();
    expect(screen.getByTestId('combobox-trigger')).toHaveTextContent('Иванова Анна');
    renderCombobox({ value: '' });
    expect(screen.getAllByTestId('combobox-trigger')[1]).toHaveTextContent('Не выбран');
    renderCombobox({ value: 'ghost' });
    expect(screen.getAllByTestId('combobox-trigger')[2]).toHaveTextContent('—');
  });

  it('2. renders color swatch with data-color on trigger and options', () => {
    renderCombobox();
    const swatch = screen.getByTestId('combobox-trigger').querySelector('[data-color="#FF6B6B"]');
    expect(swatch).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-option-m2').querySelector('[data-color="#4ECDC4"]')).toBeInTheDocument();
  });

  it('3. opens on click listing all options + pinned clear first; closes on outside mousedown and on select', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-search')).toBeInTheDocument();
    expect(screen.getByTestId('combobox-search')).toHaveFocus();
    const clear = screen.getByTestId('combobox-option-clear');
    expect(clear).toBeInTheDocument();
    // clear option is the FIRST row
    expect(clear.compareDocumentPosition(screen.getByTestId('combobox-option-m1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-m2'));
    expect(onChange).toHaveBeenCalledWith('m2');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
  });

  it('4. filters instantly case-insensitive substring; searchText wins; whitespace-only = no filter; query resets on close+reopen', () => {
    renderCombobox();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'ИВА' } });
    expect(screen.getByTestId('combobox-option-m1')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'марья' } });
    expect(screen.getByTestId('combobox-option-m3')).toBeInTheDocument(); // via searchText
    expect(screen.queryByTestId('combobox-option-m1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: '   ' } });
    expect(screen.getByTestId('combobox-option-m1')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-search')).toHaveValue('');
    expect(screen.getByTestId('combobox-option-m2')).toBeInTheDocument();
  });

  it('5. empty result shows combobox-empty and keeps the clear option', () => {
    renderCombobox();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('combobox-empty')).toHaveTextContent('Ничего не найдено');
    expect(screen.getByTestId('combobox-option-clear')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m1')).not.toBeInTheDocument();
  });

  it('6. selecting the clear option emits onChange("") and closes', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-clear'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
  });

  it('7. keyboard: arrows wrap incl. clear first; Home/End; Enter selects; Tab commits; Esc closes, focuses trigger, value unchanged, no propagation', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    const trigger = screen.getByTestId('combobox-trigger');
    fireEvent.click(trigger);
    const search = screen.getByTestId('combobox-search');
    // ArrowDown from reset position (first filtered = m1) → m2
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('m2');
    // reopen: Home → clear option; Enter on clear emits ''
    fireEvent.click(trigger);
    fireEvent.keyDown(search, { key: 'Home' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');
    // reopen: type to narrow, ArrowUp wraps to last match, Tab commits it
    fireEvent.click(trigger);
    fireEvent.change(search, { target: { value: 'пет' } });
    fireEvent.keyDown(search, { key: 'ArrowUp' }); // only m2 visible (+clear): wraps to last = m2
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('m2');
    // Esc: no onChange, dropdown closed, focus back on trigger
    fireEvent.click(trigger);
    const propagated: string[] = [];
    window.addEventListener('keydown', (e) => propagated.push(e.key));
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalledWith(expect.anything());
    expect(propagated).not.toContain('Escape');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    // End → last option
    fireEvent.click(trigger);
    fireEvent.keyDown(search, { key: 'End' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(expect.any(String));
  });

  it('8. works as a plain dropdown without typing (click-only path)', () => {
    const onChange = vi.fn();
    renderCombobox({ value: '', onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-m3'));
    expect(onChange).toHaveBeenCalledWith('m3');
  });
});
```

(The suite above is the reference — implementer verifies it compiles and asserts sanely, adjusting query helpers if `Node` needs importing from the test env per project convention.)

### Steps
- [ ] Write `__tests__/Combobox.test.tsx` (full suite above)
- [ ] Run `npx vitest run __tests__/Combobox.test.tsx` → all FAIL (module not found) — RED confirmed
- [ ] Implement `app/components/shared/Combobox.tsx` (reference implementation above)
- [ ] Run `npx vitest run __tests__/Combobox.test.tsx` → 8/8 PASS
- [ ] Run `npx vitest run && npm run type-check` → full suite green, tsc clean
- [ ] Commit: `feat(#214): shared Combobox component with client-side instant filter`

---

## Task 2: MasterPicker internals → Combobox
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6.1 label unification, §6.2 haystack matrix, §7 MasterPicker shape
- `frontend/admin/app/components/shared/MasterPicker.tsx` — current implementation (read fully)

### Task Description
Swap `CustomSelect` for `Combobox` inside `MasterPicker`; public API byte-identical; raw-shape label becomes `displayMasterName`.

**Exact new body** (replace lines 28-46; imports: drop CustomSelect, add Combobox + `displayMasterName` from `@/lib/utils`):

```tsx
export function MasterPicker({ masters, value, onChange, className, ariaLabel }: MasterPickerProps) {
  const options: ComboboxOption[] = (Array.isArray(masters) ? masters : []).map((m) => ({
    value: m.id,
    label: getMasterLabel(m),
    color: m.color,
    searchText: m.shortName ? `${getMasterLabel(m)} ${m.shortName}` : undefined,
  }));

  return (
    <Combobox
      value={value}
      options={options}
      onChange={onChange}
      clearLabel="Не выбран"
      className={className}
      ariaLabel={ariaLabel}
    />
  );
}
```

(`MasterPickerProps` gains `ariaLabel?: string` — a forward-only passthrough; its public data API is otherwise byte-identical. First consumed by StampPanel in Task 6; ClientRecordTab/SettingsTab pass nothing — unchanged rendering.)

With `getMasterLabel` updated (the ONLY behavior change — spec §6.1):

```tsx
function getMasterLabel(m: MasterBase): string {
  if (m.first_name != null || m.last_name != null) {
    return displayMasterName({ first_name: m.first_name ?? '', last_name: m.last_name ?? '' });
  }
  return m.name ?? '';
}
```

Note: `displayMasterName` in `lib/utils.ts` takes `{ first_name, last_name }` — for domain-shape masters `m.name` already IS «Фамилия Имя» (transformers). The `searchText` line covers domain `shortName` (first name) so either word finds the master (spec §6.2 row 2); raw shape needs no searchText («Фамилия Имя» contains both).

**Update `__tests__/MasterPicker.test.tsx`:** replace every `custom-select-` testid with `combobox-`; raw-fixture label expectations «Имя Фамилия» → «Фамилия Имя»; the «Не выбран» selection test now targets `combobox-option-clear` and asserts `onChange('')`; ADD one search test (raw shape): open, type the LAST name fragment, assert only the matching option visible, select it. Keep both raw and domain fixture cases.

### Steps
- [ ] Update `MasterPicker.test.tsx` first (RED: testids/labels/search case fail)
- [ ] Run `npx vitest run __tests__/MasterPicker.test.tsx` → FAIL
- [ ] Rewrite `MasterPicker.tsx` as above (incl. `ariaLabel` passthrough)
- [ ] Run `npx vitest run __tests__/MasterPicker.test.tsx` → PASS
- [ ] Run `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): MasterPicker renders via Combobox, raw label → «Фамилия Имя»`

---

## Task 3: ClientRecordTab migration (rows 1-3)
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 rows 1-3, §6.2, §7 ClientRecordTab
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` — lines 1-260 region

### Task Description
Replace the two `CustomSelect` usages; MasterPicker call is untouched (Task 2 made it a Combobox already).

Option builders (replace lines 196-204 — drop the manual clear heads):

```tsx
const locationOptions: ComboboxOption[] = (Array.isArray(locations) ? locations : []).map((l) => ({
  value: l.id,
  label: l.name,
  searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
}));

const serviceOptions: ComboboxOption[] = (Array.isArray(services) ? services : []).map((s) => ({
  value: s.id,
  label: s.title,
}));
```

JSX (both fields, spec §7):

```tsx
<Combobox clearLabel="Не выбрана" value={locationId} options={locationOptions}
  onChange={(v) => { setLocationId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
```

```tsx
<Combobox clearLabel="Не выбрана" value={serviceId} options={serviceOptions}
  onChange={(v) => { setServiceId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
```

Import update: `CustomSelect`/`CustomSelectOption` → `Combobox`/`ComboboxOption` from `@/app/components/shared/Combobox`.

**Update `__tests__/ClientRecordTab.layout.test.tsx`:** `getAllByTestId('custom-select-trigger')` → `combobox-trigger`; `custom-select-dropdown` → `combobox-dropdown`; ADD one case: open service dropdown, type a service-title fragment from fixtures, assert the non-matching option disappears. Also fix the test name at `:282` («displays activity service name in CustomSelect» → «…in Combobox»).
**Update `__tests__/ClientsIntegration.test.tsx:417-418`:** comment + `getAllByTestId('custom-select-trigger')` → `combobox-trigger`.

### Steps
- [ ] Update both test files (RED)
- [ ] Run `npx vitest run __tests__/ClientRecordTab.layout.test.tsx __tests__/ClientsIntegration.test.tsx` → FAIL
- [ ] Apply the component changes
- [ ] Re-run → PASS; `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): ClientRecordTab loc/service → Combobox`

---

## Task 4: Rename SearchableSelect → RemoteSearchSelect
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §4.2 (exact file inventory)
- `frontend/admin/app/components/shared/SearchableSelect.tsx` — read the export/props names only

### Task Description
Pure rename, zero behavior diff:

- [ ] `git mv frontend/admin/app/components/shared/SearchableSelect.tsx frontend/admin/app/components/shared/RemoteSearchSelect.tsx`
- [ ] In the moved file: `SearchableSelectProps` → `RemoteSearchSelectProps`; default export function `SearchableSelect` → `RemoteSearchSelect`. Header comment: add one line "Server-coupled typeahead (debounce 300ms + min-2 clamp) — the remote counterpart of Combobox (GH #214)."
- [ ] `git mv frontend/admin/__tests__/SearchableSelect.test.tsx frontend/admin/__tests__/RemoteSearchSelect.test.tsx`; update the import path + component name inside
- [ ] `frontend/admin/app/(main)/photos/components/PhotoModal.tsx`: import + 2 JSX tags (`:104` tags typeahead, `:151` searchable-field typeahead)
- [ ] `frontend/admin/app/(main)/photos/components/PhotosFilters.tsx`: import + 3 JSX tags (`:76`, `:93`, `:168`)
- [ ] `frontend/admin/__tests__/photos/PhotosFilters.test.tsx`: header comment references (`:6-7`, `:122`, `:165`)
- [ ] Verify nothing else references the old name: `grep -rn "SearchableSelect" frontend/admin --include="*.ts" --include="*.tsx"` → only `RemoteSearchSelect` hits remain
- [ ] `npx vitest run && npm run type-check` → green (RemoteSearchSelect suite passes unedited apart from names)
- [ ] Commit: `refactor(#214): rename SearchableSelect → RemoteSearchSelect (server typeahead)`

---

## Task 5: SettingsTab migration (rows 4-6)
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 rows 4-6, §6.2, §7 SettingsTab
- `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` — lines 180-288

### Task Description
Replace the two native selects. Data: domain `useSchedule()` arrays (`services`, `locations`).

Option builders (near the top of the component):

```tsx
const serviceOptions: ComboboxOption[] = services.map((s) => ({ value: s.id, label: s.name }));
const locationOptions: ComboboxOption[] = locations.map((l) => ({
  value: l.id,
  label: l.name,
  searchText: l.shortTitle ? `${l.name} ${l.shortTitle}` : l.name,
}));
```

Service JSX (replaces the `<select data-testid="select-service">` block `:184-198`):

```tsx
<Combobox
  clearLabel="Выберите"
  value={serviceId}
  options={serviceOptions}
  onChange={(v) => handleServiceChange(v)}
  className={inputClass}
/>
```

Location JSX (replaces `:266-283`):

```tsx
<Combobox
  clearLabel="Выберите"
  value={locationId}
  options={locationOptions}
  onChange={(v) => {
    setLocationId(v);
    onUpdate({ locationId: v });
  }}
  className={inputClass}
/>
```

Keep the wrapper `<div data-testid=...>`/labels as-is. Check `handleServiceChange('')` behaves like today's empty `<option value="">` (it already receives `''` from the native select — no change needed; verify in code and adjust only if the current handler skips `''`).

**Update `__tests__/ActivityDetailsModal.test.tsx`:** MasterPicker-related locators `custom-select-*` → `combobox-*` (`:250`, `:257`, `:723-757` block); swatch assertions via `[data-color]` keep passing unchanged; service/location select interactions (`getByTestId('select-service')` + `selectOption`-style or change-event patterns) → Combobox open/type/click flow. Master labels in expectations: «Фамилия Имя» where raw fixtures were «Имя Фамилия».

### Steps
- [ ] Update test file (RED) → run `npx vitest run __tests__/ActivityDetailsModal.test.tsx` → FAIL
- [ ] Apply component changes → re-run → PASS
- [ ] `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): ActivityDetailsModal SettingsTab svc/loc → Combobox`

---

## Task 6: StampPanel migration (rows 7-8)
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 rows 7-8 + notes (copy change), §7 StampPanel
- `frontend/admin/app/components/stamp/StampPanel.tsx` — lines 78-128
- `frontend/admin/__tests__/StampPanel.test.tsx` — current expectations (`:70`, `:95` use `getByLabelText(/мастер/i)`)

### Task Description
Master select (`:87-101`) → MasterPicker; service select (`:113-127`) → Combobox.

```tsx
<MasterPicker
  masters={masters}
  value={stamp.masterId}
  onChange={handleMasterChange}
  className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
  ariaLabel="Мастер"
/>
```

(MasterPicker must forward the new optional `ariaLabel?: string` prop to its internal Combobox trigger — add it to `MasterPickerProps` in Task 2 with a passthrough; this Task 6 note is the first consumer.)

```tsx
<Combobox
  clearLabel="Выберите услугу"
  value={stamp.serviceId}
  options={services.map((s) => ({ value: s.id, label: s.name }))}
  onChange={handleServiceChange}
  className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
  ariaLabel="Услуга"
/>
```

Imports: `MasterPicker` from `@/app/components/shared/MasterPicker`, `Combobox` from `@/app/components/shared/Combobox`. Remove the two native `<select>`s. Keep the surrounding labels (visible text); drop their `htmlFor`/`id` pairing (`htmlFor="stamp-master"` etc. has no native target anymore — the triggers' `aria-label`s provide the accessible names). Add `data-testid="stamp-master-picker"` on the master wrapper div (stable hook for US-5). The summary line `:164` (`selectedMaster?.shortName`) keeps working unchanged. Verify `handleMasterChange`/`handleServiceChange` accept `''` (they already do — native selects emitted `''`).

**Update `__tests__/StampPanel.test.tsx`:** the two `getByLabelText(/мастер/i)` interactions (`:70`, `:95`) keep working via the trigger `ariaLabel="Мастер"` — the interaction becomes open trigger → (type) → click `combobox-option-*`. Master option labels in expectations: `shortName` («Анна») → «Фамилия Имя». Service flow: open/type/select via `combobox-*` testids; empty-option copy «Выберите мастера» → «Не выбран».

### Steps
- [ ] Update `StampPanel.test.tsx` (RED) → FAIL
- [ ] Apply component changes → PASS
- [ ] `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): StampPanel master → MasterPicker, service → Combobox`

---

## Task 7: PhotoModal location field (row 9)
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 row 9, §7 PhotoModal
- `frontend/admin/app/(main)/photos/components/PhotoModal.tsx` — `field.type === 'select'` renderer (`:166-195`), `locationOptions` (`:266-269`)

### Task Description

`locationOptions` gains searchText (spec §6.2):

```tsx
const locationOptions = useMemo(
  () => locations.map((l) => ({ value: l.id, label: l.name, searchText: `${l.name} ${l.short_title ?? ''}`.trim() })),
  [locations],
);
```

The generic select renderer (`:177-191`) becomes:

```tsx
<Combobox
  clearLabel={field.emptyLabel}
  value={(value as string) ?? ''}
  options={selectOptions ?? []}
  onChange={(v) => onChange(field.key, v || null)}
  className={baseInputClasses}
/>
```

(keeps today's exact `'' → null` boundary mapping; `selectOptions` already has `{value,label}` shape). Keep the label/error plumbing untouched.

**Update `__tests__/PhotoModal.test.tsx`:** the location-field interaction (`:215` region asserting `getByText('Без локации')`) — the text now appears in the **trigger** when `value === ''`; interaction becomes open/type/select via `combobox-*` testids. Add one search case (type a location-name fragment from fixtures → non-matching option hidden).

### Steps
- [ ] Update `PhotoModal.test.tsx` (RED) → FAIL
- [ ] Apply component changes → PASS
- [ ] `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): PhotoModal location select → Combobox`

---

## Task 8: BookingFilters migration (rows 10-12)
### Classification: standard
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 rows 10-12 + notes, §6.1 (master label), §6.2, §7 BookingFilters
- `frontend/admin/app/(main)/records/components/BookingFilters.tsx` — lines 55-219
- `frontend/admin/__tests__/BookingFilters.test.tsx` — existing mock/fixture patterns (raw fetchers, archived variant, `findByRole('option')`)

### Task Description
Replace the three native selects (`:154-197`). Queries/keys/`!archived` untouched. Option builders (after the `!archived` filters `:71-73`):

```tsx
import { displayMasterName } from '@/lib/utils';

const locationOptions = locationList.map((l) => ({
  value: l.id,
  label: l.name,
  searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
}));

const serviceOptions = serviceList.map((s) => ({ value: s.id, label: s.title }));

const masterOptions = masterList.map((m) => ({
  value: m.id,
  label: displayMasterName(m),
  color: m.color,
}));
```

JSX (location shown; service/master identical shape):

```tsx
<Combobox
  clearLabel="Все локации"
  value={locationId}
  options={locationOptions}
  onChange={(v) => onLocationChange(v)}
  className="rounded-lg border px-2 py-1.5 text-xs"
  ariaLabel="Фильтр по локации"
/>
```

`ariaLabel` is the Task 1 contract addendum (prop name camelCase → `aria-label` on the trigger) — it preserves `getByLabelText('Фильтр по …')` for the unit + e2e suites. Apply the same prop on PhotosFilters (Task 9) and StampPanel (Task 6: `ariaLabel="Мастер"` / `ariaLabel="Услуга"` on the two triggers — with it, `getByLabelText(/мастер/i)` resolves and the wrapper-testid workaround becomes unnecessary; add `data-testid="stamp-master-picker"` on the wrapper div anyway as a stable hook for US-5).

Service: `clearLabel="Все услуги"`, `options={serviceOptions}`, `onChange={(v) => onServiceChange(v)}`, `ariaLabel="Фильтр по услуге"`.
Master: `clearLabel="Все мастера"`, `options={masterOptions}`, `onChange={(v) => onMasterChange(v)}`, `ariaLabel="Фильтр по мастеру"`.
Common className for all three: `rounded-lg border px-2 py-1.5 text-xs` (matches the native selects' footprint exactly — BookingFilters used `px-2 py-1.5 text-xs`).

**Update `__tests__/BookingFilters.test.tsx`:** replace native-select interactions (`userEvent.selectOptions` / `fireEvent.change` on `getByLabelText('Фильтр по …')`) with open-trigger → type-search → click-option flow; master option expectations `first_name` → `displayMasterName` («Фамилия Имя»); keep the raw-fetcher mocks, archived-exclusion assertions, and `findByRole('option')` 10s-window pattern (Combobox rows carry `role="option"`). Keep the «Все …» clear expectations via `combobox-option-clear` where they asserted the empty `<option>`.

- [ ] Update `BookingFilters.test.tsx` (RED) → FAIL
- [ ] Apply component changes (`ariaLabel` prop already exists from Task 1) → PASS
- [ ] `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): BookingFilters loc/svc/master → Combobox, master labels «Фамилия Имя»`

---

## Task 9: PhotosFilters migration (rows 13-14)
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6 rows 13-14 (G1b-approved), §7 PhotosFilters
- `frontend/admin/app/(main)/photos/components/PhotosFilters.tsx` — lines 108-140
- `frontend/admin/__tests__/photos/PhotosFilters.test.tsx` — existing patterns (`:193`, `:203`, `:213` target the two selects)

### Task Description

```tsx
const serviceOptions = Array.from(servicesMap.values()).map((s) => ({ value: s.id, label: s.title }));
const locationOptions = Array.from(locationsMap.values()).map((l) => ({
  value: l.id,
  label: l.name,
  searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
}));
```

```tsx
<Combobox
  clearLabel="Все услуги"
  value={filters.service_id ?? ''}
  options={serviceOptions}
  onChange={(v) => setFilters({ service_id: v || undefined })}
  className={selectClass}
  ariaLabel="Фильтр по услуге"
/>
```

```tsx
<Combobox
  clearLabel="Все локации"
  value={filters.location_id ?? ''}
  options={locationOptions}
  onChange={(v) => setFilters({ location_id: v || undefined })}
  className={selectClass}
  ariaLabel="Фильтр по локации"
/>
```

(`selectClass` = the existing shared className string used by the native selects in this file — reuse the same variable.)

**Update `__tests__/photos/PhotosFilters.test.tsx`:** `:193`, `:203`, `:213` select interactions → Combobox open/type/click flow via `getByLabelText` (trigger carries the aria-label) + `combobox-*` testids. Typeahead cases (client/activity/tags) untouched apart from the Task 4 rename already applied.

### Steps
- [ ] Update `PhotosFilters.test.tsx` (RED) → FAIL
- [ ] Apply component changes → PASS
- [ ] `npx vitest run && npm run type-check` → green
- [ ] Commit: `feat(#214): PhotosFilters svc/loc → Combobox (G1b rows 13-14)`

---

## Task 10: Delete CustomSelect + residual sweep
### Classification: small
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §4.3 (inventory + the wave6 exception)

### Task Description
- [ ] `git rm frontend/admin/app/components/shared/CustomSelect.tsx frontend/admin/__tests__/CustomSelect.test.tsx`
- [ ] Sweep: `grep -rn "CustomSelect\|custom-select" frontend/admin --include="*.ts" --include="*.tsx"` → the ONLY permitted remaining hit is `e2e/wave6-status-snapshots.spec.ts:75` (self-contained inline HTML). Fix every other hit (comments included: `e2e/wave6-record-status-derived.spec.ts:33`, `e2e/clients.spec.ts:472-484` testids — the latter is updated in Task 11; if Task 11 runs after, update the comment lines now and leave locator rewrites to Task 11 — NO: task order is fixed, Task 11 follows; here only ensure no SOURCE imports remain and comments in non-e2e files are clean).
- [ ] `npx vitest run && npm run type-check` → green (proves no import survives)
- [ ] Commit: `chore(#214): delete CustomSelect (absorbed by Combobox)`

---

## Task 11: Update existing e2e specs
### Classification: large
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §8.3 (full inventory)
- `frontend/admin/e2e/records.spec.ts`, `frontend/admin/e2e/records-view.spec.ts`, `frontend/admin/e2e/clients.spec.ts`, `frontend/admin/e2e/activity-details-modal.spec.ts`, `frontend/admin/e2e/photos-crud.spec.ts` — mirror their helper/convention patterns
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — e2e Full Cycle conventions

### Task Description
All native-select interactions with the migrated fields become the Combobox flow. Introduce a shared helper INSIDE each touched spec (or a tiny `e2e/helpers/combobox.ts` if more than 3 specs need it — preferred):

```ts
// e2e/helpers/combobox.ts
import { expect, type Page } from '@playwright/test';

/** Opens a Combobox via its trigger and returns the dropdown locator. */
export async function openCombobox(page: Page, trigger: ReturnType<Page['locator']>) {
  await trigger.click();
  const dropdown = page.locator('[data-testid="combobox-dropdown"]');
  await expect(dropdown).toBeVisible();
  return dropdown;
}

/** Types a query into the open Combobox search and clicks the option with the given value. */
export async function searchAndSelect(
  page: Page,
  trigger: ReturnType<Page['locator']>,
  query: string,
  optionValue: string,
) {
  await openCombobox(page, trigger);
  const search = page.locator('[data-testid="combobox-search"]');
  await search.fill(query);
  await page.locator(`[data-testid="combobox-option-${optionValue}"]`).click();
  await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
}
```

Per-spec rewrites ( locator-by-locator; every native select/option locators in these files for the migrated fields):

- **records.spec.ts** — `:91-93`, `:106-108` (`.toHaveValue('')` → trigger text «Все …»), `:118-130` (option counts → open trigger + count `[data-testid^="combobox-option-"]` minus clear), `:215-217`, `:598`, `:648`, `:707`, `:961` (`.selectOption(...)` → `searchAndSelect(page, page.getByLabel('Фильтр по мастеру'), surnameFragment, masterId)`; empty reset clicks `combobox-option-clear`). Master option labels «Фамилия Имя» where options text is asserted.
- **records-view.spec.ts** — `:198-216` (option-count assertions via opened dropdown), `:517` (`.selectOption(masterA.id)` → `searchAndSelect`).
- **clients.spec.ts** — `:472-484`: `[data-testid="select-service"] [data-testid="custom-select-trigger"]` → `[data-testid="select-service"] [data-testid="combobox-trigger"]` (same for master/location wrappers).
- **activity-details-modal.spec.ts** — `:258-260` (`.selectOption()` on `select-service` → searchAndSelect with the settings-tab-scoped trigger), `:339-341` (`custom-select-trigger` → `combobox-trigger` in `settings-tab`).
- **photos-crud.spec.ts** — `:246`, `:275` (native filter selects → searchAndSelect via `getByLabel('Фильтр по услуге'/'Фильтр по локации')`).
- **wave6-record-status-derived.spec.ts:33** — comment only.

Run e2e serially per project convention (`npm run test:e2e -- <spec>`), each rewritten spec green before moving on. If visual baselines capture open dropdowns of migrated surfaces, regenerate via the CI `update-snapshots` workflow (project standard) — do NOT hand-edit snapshots.

### Steps
- [ ] Add `e2e/helpers/combobox.ts`
- [ ] Rewrite the five specs (comment fix in the sixth) — one spec at a time, run it, green, next
- [ ] Run the full rewritten set: `npm run test:e2e -- e2e/records.spec.ts e2e/records-view.spec.ts e2e/clients.spec.ts e2e/activity-details-modal.spec.ts e2e/photos-crud.spec.ts`
- [ ] Commit: `test(#214): e2e migrations to Combobox flow`

---

## Task 12: New e2e — User Scenarios US-1..US-6
### Classification: standard
### Required Docs
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §10 (US table, exact steps)
- `frontend/admin/e2e/records.spec.ts`, `frontend/admin/e2e/clients.spec.ts` — navigation/seed conventions, `waitForRecordsReady`-style helpers
- `e2e/helpers/combobox.ts` (Task 11)

### Task Description
Create `frontend/admin/e2e/combobox-dictionaries.spec.ts` covering US-1…US-6 (spec §10). RED-GREEN per scenario where feasible (US-1 written first against the migrated UI; all six land in this task since the component already exists — the RED phase here is "spec file absent/failing assertions", verified by running once before finalizing helpers).

Test skeletons (adapt navigation helpers to the neighboring specs' actual imports/fixtures):

```ts
import { test, expect } from '@playwright/test';
import { searchAndSelect, openCombobox } from './helpers/combobox';

// US-1: create record → find master by typing (clients page → client record tab)
test('US-1: record tab master found by surname fragment', async ({ page }) => {
  // navigate + open a client's record tab per clients.spec.ts conventions
  const trigger = page.locator('[data-testid="select-master"] [data-testid="combobox-trigger"]');
  await searchAndSelect(page, trigger, <surname fragment of a seeded master>, <masterId>);
  await expect(trigger).toContainText(<«Фамилия Имя» of that master>);
});

// US-2: activity settings → find service
test('US-2: activity settings service found by title fragment', async ({ page }) => {
  // open an activity's Settings tab per activity-details-modal.spec.ts conventions
  const trigger = page.locator('[data-testid="settings-tab"] [data-testid="select-service"] [data-testid="combobox-trigger"]');
  await searchAndSelect(page, trigger, <title fragment>, <serviceId>);
  // age/capacity recalculation still renders (existing assertions in that spec)
});

// US-3: records filter bar → location then master (with swatch), reset restores «Все …»
test('US-3: BookingFilters location+master search', async ({ page }) => {
  // records page per records.spec.ts conventions
  await searchAndSelect(page, page.getByLabel('Фильтр по локации'), <fragment>, <locationId>);
  const masterTrigger = page.getByLabel('Фильтр по мастеру');
  await openCombobox(page, masterTrigger);
  const swatch = page.locator('[data-testid^="combobox-option-"] [data-color]').first();
  await expect(swatch).toBeVisible();
  await searchAndSelect(page, masterTrigger, <surname fragment>, <masterId>);
  // reset
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.getByLabel('Фильтр по локации')).toContainText('Все локации');
  await expect(masterTrigger).toContainText('Все мастера');
});

// US-4: PhotoModal location
test('US-4: photo modal location searchable', async ({ page }) => {
  // open photo modal per photos-crud.spec.ts conventions
  await searchAndSelect(page, page.locator('[data-testid="combobox-trigger"]').filter({ hasText: /локаци/i }).first(), <fragment>, <locationId>);
});

// US-5: stamps master (now MasterPicker)
test('US-5: stamps panel master found by surname', async ({ page }) => {
  // open stamps panel per existing schedule/stamps navigation
  const trigger = page.locator('[data-testid="stamp-master-picker"] [data-testid="combobox-trigger"]');
  await searchAndSelect(page, trigger, <surname fragment>, <masterId>);
  await expect(trigger).toContainText(<«Фамилия Имя»>);
});

// US-6: no-match empty state + Esc preserves value + reopen clears query
test('US-6: empty state, Esc preserves selection, reopen resets query', async ({ page }) => {
  // reuse US-1 navigation; select a master first
  const trigger = page.locator('[data-testid="select-master"] [data-testid="combobox-trigger"]');
  await searchAndSelect(page, trigger, <fragment>, <masterId>);
  await openCombobox(page, trigger);
  await page.locator('[data-testid="combobox-search"]').fill('zzzz');
  await expect(page.locator('[data-testid="combobox-empty"]')).toHaveText('Ничего не найдено');
  await page.locator('[data-testid="combobox-search"]').press('Escape');
  await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
  await expect(trigger).toContainText(<selected «Фамилия Имя»>); // value preserved
  await trigger.click();
  await expect(page.locator('[data-testid="combobox-search"]')).toHaveValue('');
});
```

Fill every `<...>` placeholder with real seeded-data constants (backend/src/seed/seed.py masters/services/locations — same ids the neighboring specs already use; read them first). The DoD per scenario: E2E test for scenario N passes (RED-GREEN-REFACTOR — run the new spec once before final polish to confirm it fails without the helpers' behaviors, then green).

### Steps
- [ ] Read seed data + neighboring specs; write the six tests with real constants
- [ ] Run `npm run test:e2e -- e2e/combobox-dictionaries.spec.ts` → iterate to 6/6 green
- [ ] Run the full e2e suite for the touched areas + `npx vitest run` → green
- [ ] Commit: `test(#214): e2e user scenarios US-1..US-6 for dictionary comboboxes`

---

## Task 13: Domain-rules addendum + docs
### Classification: trivial
### Required Docs
- `docs/domain-rules/masters.md` — §"Search matrix" (line ~47)
- `docs/specs/2026-09-03-searchable-combobox-design.md` — §6.1

### Task Description
- [ ] In `docs/domain-rules/masters.md`, extend the search-matrix bullet (the one already mentioning "#214 combobox") with: "; form/filter dropdowns (GH #214 Combobox) display masters as `displayMasterName` — «Фамилия Имя» — with client-side instant filter over the bare `/all` array (substring, case-insensitive, either word matches)"
- [ ] Verify no other domain-rules file contradicts the dropdown display convention (`grep -rn "Не выбран\|first_name" docs/domain-rules/` — only field-schema mentions should remain)
- [ ] Commit: `docs(#214): masters domain rules — combobox display convention`

---

## Final Verification (all tasks done)

- [ ] `cd frontend/admin && npm run test && npm run type-check && npm run lint` → all green
- [ ] Full e2e suite via CI (authoritative merge gate per scratchpad policy)
- [ ] Visual compliance check per spec §11 (dropdown search row, swatches, «Ничего не найдено», «Все …» copies) — via `scripts/visual-compliance-check.sh` or browserMCP fallback
- [ ] Spec §12 acceptance criteria 1-7 walkthrough — confirm each

## Task Classification Summary

| Task | Name | Class |
|---|---|---|
| 1 | Combobox component + unit suite | standard |
| 2 | MasterPicker → Combobox | small |
| 3 | ClientRecordTab | small |
| 4 | Rename → RemoteSearchSelect | small |
| 5 | SettingsTab | small |
| 6 | StampPanel | small |
| 7 | PhotoModal location | small |
| 8 | BookingFilters | standard |
| 9 | PhotosFilters | small |
| 10 | Delete CustomSelect | small |
| 11 | Existing e2e updates | large |
| 12 | New e2e US-1..6 | standard |
| 13 | Domain-rules addendum | trivial |
