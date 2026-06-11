'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

export interface MultiSelectProps<T> {
  items: T[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  label: string;
  icon?: React.ReactNode;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  /** When provided, items are grouped by this key in the dropdown. */
  getGroup?: (item: T) => string;
  /** Optional custom label renderer — receives the item and its checked state. */
  renderItemLabel?: (item: T, isChecked: boolean) => React.ReactNode;
}

interface GroupedSection<T> {
  group: string;
  items: T[];
}

function groupItems<T>(items: T[], getGroup: (item: T) => string): GroupedSection<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getGroup(item) || 'Прочее';
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([group, groupItems]) => ({ group, items: groupItems }));
}

/**
 * MultiSelect dropdown with checkbox list.
 * Closes on outside click. Shows label + selected count as trigger text.
 * Supports optional grouping via `getGroup` prop.
 *
 * - Grouped mode: each group header has a tri-state checkbox (checked/unchecked/indeterminate)
 * - Flat mode: a single "select all" checkbox at the top
 */
export function MultiSelect<T>({
  items,
  selectedIds,
  onSelectionChange,
  label,
  icon,
  getId,
  getLabel,
  getGroup,
  renderItemLabel,
}: MultiSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Measure vertical space when opening
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const DROPDOWN_HEIGHT = 280;
    setOpensUpward(spaceBelow < DROPDOWN_HEIGHT);
  }, [isOpen]);

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

  const count = selectedIds.length;
  const total = items.length;

  // Group items if getGroup is provided
  const sections = useMemo(() => {
    if (!getGroup) return null;
    return groupItems(items, getGroup);
  }, [items, getGroup]);

  // ── Group checkbox handlers ────────────────────────────────────────────────

  const handleToggleGroup = useCallback(
    (groupName: string) => {
      if (!getGroup) return;
      const groupIds = items
        .filter(item => (getGroup(item) || 'Прочее') === groupName)
        .map(item => getId(item));
      const allSelected = groupIds.every(id => selectedIds.includes(id));
      if (allSelected) {
        // Deselect all in group
        onSelectionChange(selectedIds.filter(id => !groupIds.includes(id)));
      } else {
        // Select all in group (add missing ones)
        const missing = groupIds.filter(id => !selectedIds.includes(id));
        onSelectionChange([...selectedIds, ...missing]);
      }
    },
    [items, getGroup, getId, selectedIds, onSelectionChange],
  );

  const handleSelectAll = useCallback(() => {
    onSelectionChange(items.map(item => getId(item)));
  }, [items, getId, onSelectionChange]);

  const handleDeselectAll = useCallback(() => {
    onSelectionChange([]);
  }, [onSelectionChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderCheckboxItem = (item: T) => {
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
        {renderItemLabel
          ? renderItemLabel(item, isChecked)
          : <span style={{ color: 'var(--ink, #1a1a1a)' }}>{getLabel(item)}</span>}
      </button>
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
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
          className={`absolute z-50 right-0 min-w-[200px] max-w-[calc(100vw-16px)] bg-white border rounded-lg shadow-lg ${
            opensUpward ? 'bottom-full mb-1' : 'mt-1 top-full'
          }`}
          style={{ borderColor: 'var(--line, #e5e7eb)' }}
          data-testid="multiselect-dropdown"
        >
          {/* Flat mode: single select-all checkbox at top */}
          {!getGroup && items.length > 0 && (
            <SelectAllCheckbox
              allIds={items.map(item => getId(item))}
              selectedIds={selectedIds}
              onToggleAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />
          )}

          {/* Checkbox list — grouped (horizontal columns) or flat (vertical) */}
          {sections ? (
            <div className="max-h-[240px] overflow-auto py-1">
              <div className="flex gap-0 min-w-max">
                {sections.map(section => (
                  <GroupSection
                    key={section.group}
                    section={section}
                    selectedIds={selectedIds}
                    getId={getId}
                    onToggleGroup={handleToggleGroup}
                    renderCheckboxItem={renderCheckboxItem}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto py-1">
              {items.map(renderCheckboxItem)}
              {items.length === 0 && (
                <div className="px-3 py-2 text-xs text-center" style={{ color: 'var(--ink-light, #9ca3af)' }}>
                  Нет элементов
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

/** Grouped section with a tri-state group checkbox in the header. */
function GroupSection<T>({
  section,
  selectedIds,
  getId,
  onToggleGroup,
  renderCheckboxItem,
}: {
  section: GroupedSection<T>;
  selectedIds: string[];
  getId: (item: T) => string;
  onToggleGroup: (groupName: string) => void;
  renderCheckboxItem: (item: T) => React.ReactNode;
}) {
  const groupIds = section.items.map(item => getId(item));
  const selectedCount = groupIds.filter(id => selectedIds.includes(id)).length;
  const allSelected = selectedCount === groupIds.length;
  const noneSelected = selectedCount === 0;
  const isIndeterminate = !allSelected && !noneSelected;

  const checkboxRef = useRef<HTMLInputElement>(null);
  // Sync indeterminate property (not an HTML attribute — must be set via JS)
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  return (
    <div
      className="min-w-[180px] shrink-0 last:border-r-0 border-r"
      style={{ borderColor: 'var(--line, #e5e7eb)' }}
    >
      <button
        type="button"
        onClick={() => onToggleGroup(section.group)}
        className="w-full flex items-center gap-2 px-3 pt-1.5 pb-0.5 hover:bg-gray-50 transition-colors"
      >
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allSelected}
          readOnly
          className="w-3.5 h-3.5 rounded border-gray-300 text-[var(--brand)] accent-[var(--brand)] cursor-pointer shrink-0"
          tabIndex={-1}
          data-testid={`group-checkbox-${section.group}`}
        />
        <span
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: 'var(--ink-light, #9ca3af)' }}
        >
          {section.group}
        </span>
      </button>
      <div>{section.items.map(renderCheckboxItem)}</div>
    </div>
  );
}

/** Flat-mode select-all checkbox row at top of list. */
function SelectAllCheckbox({
  allIds,
  selectedIds,
  onToggleAll,
  onDeselectAll,
}: {
  allIds: string[];
  selectedIds: string[];
  onToggleAll: () => void;
  onDeselectAll: () => void;
}) {
  const selectedCount = selectedIds.filter(id => allIds.includes(id)).length;
  const allSelected = selectedCount === allIds.length && allIds.length > 0;
  const noneSelected = selectedCount === 0;
  const isIndeterminate = !allSelected && !noneSelected;

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleClick = () => {
    if (allSelected) {
      onDeselectAll();
    } else {
      onToggleAll();
    }
  };

  return (
    <div className="border-b" style={{ borderColor: 'var(--line, #e5e7eb)' }}>
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors"
      >
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allSelected}
          readOnly
          className="w-3.5 h-3.5 rounded border-gray-300 text-[var(--brand)] accent-[var(--brand)] cursor-pointer shrink-0"
          tabIndex={-1}
          data-testid="select-all-checkbox"
        />
        <span
          className="text-[11px] font-medium"
          style={{ color: 'var(--ink, #1a1a1a)' }}
        >
          Выбрать все
        </span>
      </button>
    </div>
  );
}
