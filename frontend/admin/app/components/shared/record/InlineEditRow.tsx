'use client';

import { useState, useCallback, useRef } from 'react';
import { RecordTable, type Column } from './RecordTable';
import { useInlineEditRow } from './useInlineEditRow';

export interface InlineEditRowProps<T extends { id: string | null }, F> {
  row: T;
  /** e.g. 'visit-row' → testId = 'visit-row-{id | "new"}' */
  testIdPrefix: string;
  /**
   * Renders the per-column cells for this row. Called with the SAME shape
   * regardless of whether the row is new or saved — `isNew` is the only
   * signal consumers should use to vary behaviour (e.g. autoFocus,
   * placeholders). There must be no separate "add form" JSX branch.
   *
   * autoFocus contract: THIS component does not set autoFocus itself (it
   * doesn't know which cell is "first" or which DOM node to focus). The
   * CONSUMER's renderCell is responsible for passing `autoFocus={isNew}`
   * to the first editable input. This keeps InlineEditRow agnostic of the
   * consumer's column layout.
   */
  renderCell: (params: {
    row: T;
    formState: F;
    isNew: boolean;
    handleChange: (field: keyof F, value: any) => void;
  }) => Record<string, React.ReactNode>;
  columns: Column[];
  onAdd: (data: F) => Promise<T | undefined>;
  onUpdate: (id: string, data: F) => Promise<T>;
  onDelete: (id: string) => Promise<void>;
  onRemove: (row: T) => void;
  /** Called after a successful new-row save with (oldRow, savedRow). Consumer uses this to replace-in-place. */
  onSaved?: (oldRow: T, savedRow: T) => void;
  emptyData: () => F;
  pickFormData: (row: T) => F;
  isReadOnly?: boolean;
}

/**
 * Renders ONE table row uniformly, whether `row.id === null` (unsaved,
 * "new" row) or `row.id !== null` (saved row). Wraps `RecordTable.Row` —
 * does not modify it.
 *
 * **Row-level save trigger (new rows):** for new rows (`id === null`),
 * saving fires on **Enter** keydown anywhere in the row OR on **blur
 * leaving the row** (focus moves outside the row div). This is
 * unconditional — not gated on any field having changed. A double-save
 * guard prevents concurrent Enter+blur from double-POSTing.
 *
 * `__actions` cell contract: this component OWNS the `__actions` cell
 * (the × delete button) so consumers don't have to repeat the delete
 * wiring in every `renderCell`. If the consumer's `renderCell` already
 * returns an `__actions` key, that value takes precedence (escape hatch
 * for tables that need a custom actions cell), but the default/expected
 * usage is for consumers to leave `__actions` out and let InlineEditRow
 * render the × button wired to `handleDelete`.
 */
export function InlineEditRow<T extends { id: string | null }, F>({
  row,
  testIdPrefix,
  renderCell,
  columns,
  onAdd,
  onUpdate,
  onDelete,
  onRemove,
  onSaved,
  emptyData,
  pickFormData,
  isReadOnly = false,
}: InlineEditRowProps<T, F>) {
  const { formState, isNew, handleChange, handleSave, handleDelete } = useInlineEditRow<T, F>({
    row,
    emptyData,
    pickFormData,
    onAdd,
    onUpdate,
    onDelete,
    onRemove,
  });

  // Double-delete guard: prevent firing handleDelete twice concurrently
  // (e.g. double-click on the × button before the first request settles).
  const [deleting, setDeleting] = useState(false);

  const guardedDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await handleDelete();
    } finally {
      setDeleting(false);
    }
  }, [deleting, handleDelete]);

  // ── Row-level save trigger (new rows only) ──────────────────────────────
  // Double-save guard: prevent Enter+blur from double-POSTing.
  const savingRef = useRef(false);

  const triggerSave = useCallback(async () => {
    if (!isNew || savingRef.current) return;
    savingRef.current = true;
    try {
      const saved = await handleSave();
      if (saved) {
        onSaved?.(row, saved);
      }
    } finally {
      savingRef.current = false;
    }
  }, [isNew, handleSave, row, onSaved]);

  /** Blur handler: fires save when focus leaves the entire row. */
  const handleRowBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (!isNew) return;
      // If focus moved to another element WITHIN the row, don't save
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      triggerSave();
    },
    [isNew, triggerSave],
  );

  /** Keydown handler: fires save on Enter anywhere in the row. */
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isNew) return;
      if (e.key === 'Enter') {
        triggerSave();
      }
    },
    [isNew, triggerSave],
  );

  const testId = `${testIdPrefix}-${row.id ?? 'new'}`;

  const cells = renderCell({ row, formState, isNew, handleChange });

  if (!isReadOnly && cells.__actions === undefined) {
    cells.__actions = (
      <button
        type="button"
        onClick={guardedDelete}
        disabled={deleting}
        data-testid={`${testId}-delete`}
        className="text-ink-light hover:text-red-600 disabled:opacity-50"
        aria-label="Удалить"
      >
        ×
      </button>
    );
  }

  return (
    <RecordTable.Row
      columns={columns}
      cells={cells}
      testId={testId}
      onBlur={handleRowBlur}
      onKeyDown={handleRowKeyDown}
    />
  );
}
