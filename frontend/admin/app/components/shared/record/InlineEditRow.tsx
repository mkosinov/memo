'use client';

import { useState, useCallback } from 'react';
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
  onAdd: (data: F) => Promise<T>;
  onUpdate: (id: string, data: F) => Promise<T>;
  onDelete: (id: string) => Promise<void>;
  onRemove: (row: T) => void;
  emptyData: () => F;
  pickFormData: (row: T) => F;
  isReadOnly?: boolean;
}

/**
 * Renders ONE table row uniformly, whether `row.id === null` (unsaved,
 * "new" row) or `row.id !== null` (saved row). Wraps `RecordTable.Row` —
 * does not modify it.
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
  emptyData,
  pickFormData,
  isReadOnly = false,
}: InlineEditRowProps<T, F>) {
  const { formState, isNew, handleChange, handleDelete } = useInlineEditRow<T, F>({
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

  return <RecordTable.Row columns={columns} cells={cells} testId={testId} />;
}
