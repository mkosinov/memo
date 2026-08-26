'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveFilter } from '../../../contexts/createPagedListContext';
import type { ColumnDef, DataTableProps, RowAction } from './tableTypes';
import { ColumnPicker } from './ColumnPicker';
import { ErrorState } from '@/app/components/error';

// ─── Column visibility (LS-backed, spec §6.11) ───────────────────────────

const SKELETON_ROWS = 10;

/**
 * Reads the persisted visible-column keys for `storageKey`. Validation per
 * §6.11: the stored value must parse to a NON-empty array whose keys are a
 * subset of the current column keys — anything else (missing, unparseable,
 * empty, unknown keys) falls back to the `defaultVisible` set.
 */
function readVisibleKeys<R>(storageKey: string, columns: readonly ColumnDef<R>[]): string[] {
  const defaults = columns.filter((c) => c.defaultVisible).map((c) => c.key);
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const known = new Set(columns.map((c) => c.key));
        const allKnown =
          parsed.length > 0 && parsed.every((k) => typeof k === 'string' && known.has(k));
        if (allKnown) return parsed as string[];
      }
    }
  } catch {
    // corrupted value → defaults below
  }
  return defaults;
}

// ─── Component ───────────────────────────────────────────────────────────

export function DataTable<T>({
  storageKey,
  columns,
  tableState,
  actions,
  onRowClick,
  emptyLabel,
  toolbarExtras,
  toolbarLead,
  withStatus = false,
  withSearch = false,
  searchPlaceholder = 'Поиск...',
  rowClassName,
  rowKey,
  rowTestId,
  actionCellExtra,
}: DataTableProps<T>) {
  // ─── Column visibility (owned here; ColumnPicker is controlled) ────────
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() =>
    readVisibleKeys(storageKey, columns),
  );

  const toggleVisibility = useCallback(
    (key: string) => {
      setVisibleKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey],
  );

  const visibleColumns = columns.filter((c) => visibleKeys.includes(c.key));

  // ─── Search (spec §6.7): local draft + 300ms debounce; Enter submits ───
  const [draft, setDraft] = useState(() => tableState.search ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // No stale setSearch after unmount.
  useEffect(() => () => cancelTimer(), [cancelTimer]);

  const handleSearchChange = (value: string) => {
    setDraft(value);
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      tableState.setSearch?.(value);
    }, 300);
  };

  const submitSearch = (value: string) => {
    cancelTimer();
    tableState.setSearch?.(value);
  };

  const clearSearch = () => {
    setDraft('');
    submitSearch('');
  };

  // ─── Action dropdown (spec §6.3, APG menu-button, roving tabindex) ─────
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const openContainerRef = useRef<HTMLDivElement | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);

  // Outside mousedown closes the open menu (independent of ColumnPicker's).
  useEffect(() => {
    if (!openRowKey) return;
    const handler = (e: MouseEvent) => {
      if (openContainerRef.current && openContainerRef.current.contains(e.target as Node)) {
        return;
      }
      setOpenRowKey(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openRowKey]);

  // Focus the first menu item right after a menu opens.
  useEffect(() => {
    if (!openRowKey) return;
    setFocusedIdx(0);
    openMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [openRowKey]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, keyValue: string) => {
    const menu = openMenuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const moveTo = (i: number) => {
      setFocusedIdx(i);
      items[i]?.focus();
    };
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpenRowKey(null);
        triggerRefs.current.get(keyValue)?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveTo((idx + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(idx <= 0 ? items.length - 1 : idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(items.length - 1);
        break;
    }
  };

  // ─── Rendering state (spec §6.8) ──────────────────────────────────────
  const rows = tableState.visibleItems ?? tableState.items;
  const { isPending, error } = tableState;
  const colSpan = visibleColumns.length + 1;

  const alignClass = (align?: ColumnDef<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  const totalPages = Math.max(1, Math.ceil(tableState.total / tableState.perPage));

  return (
    <div>
      {/* Toolbar: search / status (left) + toolbarExtras + ColumnPicker (right) */}
      <div
        className="p-4 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3">
          {/* Addendum #9: dict *Filters bars ride in the toolbar's left group,
              before search/status — single-row toolbar preserved (§6.1). */}
          {toolbarLead}
          {withSearch && (
            <>
              <input
                type="text"
                value={draft}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSearch(draft);
                }}
                placeholder={searchPlaceholder}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: 'var(--white)',
                  color: 'var(--ink)',
                }}
              />
              {draft !== '' && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--ink-light)' }}
                  aria-label="Очистить поиск"
                >
                  ✕
                </button>
              )}
            </>
          )}
          {withStatus && (
            <select
              aria-label="Статус"
              value={tableState.status ?? 'active'}
              onChange={(e) => tableState.setStatus?.(e.target.value as ArchiveFilter)}
              className="border rounded px-2 py-2 text-sm"
              style={{
                borderColor: 'var(--line)',
                backgroundColor: 'var(--white)',
                color: 'var(--ink)',
              }}
            >
              <option value="active">Активные</option>
              <option value="all">Все</option>
              <option value="archived">Архив</option>
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={columns.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleKeys}
            onToggle={toggleVisibility}
          />
          {toolbarExtras}
        </div>
      </div>

      {/* Table. The overflow-x-auto wrapper restores pre-#139 markup (all 8
          tables had it): it lets a last-row action dropdown open BELOW the
          table without the pager intercepting clicks (the wrapper grows a
          scroll area instead of the pager overlaying the menu). */}
      <div className="overflow-x-auto">
      <table className="w-full" aria-busy={isPending}>
        <thead>
          <tr
            className="border-b"
            style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
          >
            {visibleColumns.map((col) => {
              const sortable = col.sortable !== false;
              const field = col.sortField ?? col.key;
              const active = tableState.sortBy === field;
              if (!sortable) {
                return (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider select-none ${alignClass(col.align)} ${col.width ?? ''}`}
                    style={{ color: 'var(--ink-light)' }}
                  >
                    {col.label}
                  </th>
                );
              }
              const glyph = active
                ? tableState.sortOrder === 'asc'
                  ? ' ↑'
                  : ' ↓'
                : ' ↕';
              return (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider select-none ${alignClass(col.align)} ${col.width ?? ''}`}
                  style={{ color: 'var(--ink-light)' }}
                  aria-sort={
                    active ? (tableState.sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      const next: 'asc' | 'desc' =
                        active && tableState.sortOrder === 'asc' ? 'desc' : 'asc';
                      tableState.setSort(field, next);
                    }}
                    // w-full block: the WHOLE header cell stays the click target,
                    // matching the pre-#139 <th onClick> behavior (e2e clicks
                    // the th center) while remaining a focusable sort control.
                    className="w-full block text-left font-semibold uppercase tracking-wider cursor-pointer"
                    style={{ color: 'inherit', fontSize: 'inherit' }}
                  >
                    {col.label}
                    {glyph}
                  </button>
                </th>
              );
            })}
            <th className="w-[60px]" style={{ color: 'var(--ink-light)' }} />
          </tr>
        </thead>
        <tbody>
          {isPending ? (
            // §6.8 initial load — 10 skeleton rows, visible columns only.
            Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={`skeleton-${i}`} style={{ borderColor: 'var(--line)' }}>
                {visibleColumns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 ${alignClass(col.align)}`}>
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : error && rows.length === 0 ? (
            // §6.8 query failure with nothing to show — unified error row.
            <tr>
              <td colSpan={colSpan}>
                <ErrorState
                  title={`Ошибка загрузки: ${error.message}`}
                  error={error}
                  onRetry={tableState.refetch}
                />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            // §6.8 empty — per-entity copy via emptyLabel.
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-12 text-center text-sm"
                style={{ color: 'var(--ink-light)' }}
              >
                {emptyLabel ?? 'Нет записей'}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const keyValue = rowKey ? rowKey(row) : String(i);
              const rowActions: RowAction<T>[] = actions(row).filter((a) => !a.hidden?.(row));
              const menuOpen = openRowKey === keyValue;
              const menuId = `dropdown-${keyValue}`;
              return (
                <tr
                  key={keyValue}
                  onClick={(e) => {
                    if (
                      onRowClick &&
                      (e.target as HTMLElement).closest('button, a, [role="button"], input')
                    ) {
                      return;
                    }
                    onRowClick?.(row);
                  }}
                  className={`border-b ${onRowClick ? 'cursor-pointer ' : ''}transition-colors ${rowClassName?.(row) ?? ''}`}
                  style={{ borderColor: 'var(--line)' }}
                  data-testid={rowTestId ? rowTestId(row) : undefined}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-sm ${alignClass(col.align)} ${col.width ?? ''}`}
                      style={{ color: 'var(--ink)' }}
                    >
                      {col.render?.(row) ?? col.accessor?.(row) ?? ''}
                    </td>
                  ))}
                  {/* Action menu — last column (§6.3 / plan Task 8 guard).
                      px-4 text-center + justify-end mirrors the pre-#139 cells. */}
                  <td className="px-4 py-3 text-center relative">
                    <div
                      className="flex items-center justify-end gap-2"
                      ref={(el) => {
                        if (menuOpen) openContainerRef.current = el;
                      }}
                    >
                      {/* Addendum #10: per-row actions-cell extra before the
                          trigger (Locations 🗺 Карта link). On-row-click guard
                          covers `a`/`button` elements inside it (§6.1). */}
                      {actionCellExtra?.(row)}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenRowKey(menuOpen ? null : keyValue);
                          }}
                          ref={(el) => {
                            if (el) triggerRefs.current.set(keyValue, el);
                            else triggerRefs.current.delete(keyValue);
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors"
                          style={{ color: 'var(--ink-light)' }}
                          aria-label={`Действия — строка ${keyValue}`}
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-controls={menuId}
                        >
                          ⋯
                        </button>
                        {menuOpen && (
                          <div
                            ref={openMenuRef}
                            id={menuId}
                            role="menu"
                            data-testid={`dropdown-${keyValue}`}
                            onKeyDown={(e) => handleMenuKeyDown(e, keyValue)}
                            className="absolute right-0 top-full mt-1 z-10 border rounded-lg shadow-lg py-1 min-w-[160px]"
                            style={{
                              borderColor: 'var(--line)',
                              backgroundColor: 'var(--white)',
                            }}
                          >
                            {rowActions.map((action, ai) => (
                              <button
                                key={`${keyValue}-${ai}`}
                                type="button"
                                role="menuitem"
                                tabIndex={ai === focusedIdx ? 0 : -1}
                                onClick={() => {
                                  action.onClick(row);
                                  setOpenRowKey(null);
                                }}
                                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
                                style={{
                                  color: action.danger ? 'var(--danger, #dc2626)' : 'var(--ink)',
                                }}
                              >
                                {action.icon}
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>

      {/* Pager (pattern extracted from MastersTable/ServicesTable + a11y labels) */}
      <div
        className="flex items-center justify-between px-4 py-3 border-t"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-light)' }}>
          <span>Строк:</span>
          <select
            value={tableState.perPage}
            onChange={(e) => tableState.setPerPage(Number(e.target.value) || 10)}
            className="border rounded px-2 py-1 text-xs"
            style={{
              borderColor: 'var(--line)',
              backgroundColor: 'var(--white)',
              color: 'var(--ink)',
            }}
            data-testid="page-size-select"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span>{tableState.total} всего</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => tableState.setPage(Math.max(1, tableState.page - 1))}
            disabled={tableState.page <= 1}
            aria-label="Предыдущая страница"
            className="px-3 py-1 text-sm rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            ←
          </button>
          {Array.from({ length: totalPages }, (_, p) => p + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => tableState.setPage(p)}
              aria-current={p === tableState.page ? 'page' : undefined}
              className={`px-3 py-1 text-sm rounded border ${p === tableState.page ? 'font-bold' : ''}`}
              style={{
                borderColor: 'var(--line)',
                backgroundColor: p === tableState.page ? 'var(--brand)' : 'transparent',
                color: p === tableState.page ? 'white' : 'var(--ink)',
              }}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => tableState.setPage(Math.min(totalPages, tableState.page + 1))}
            disabled={tableState.page >= totalPages}
            aria-label="Следующая страница"
            className="px-3 py-1 text-sm rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
