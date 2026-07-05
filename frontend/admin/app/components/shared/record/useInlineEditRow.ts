'use client';

import { useCallback, useState } from 'react';

export interface UseInlineEditRowOptions<T extends { id: string | null }, F> {
  row: T;
  /** Factory for new-row defaults. Used by consumers when appending a new row; not called internally. */
  emptyData: () => F;
  /** T → F (form fields only) */
  pickFormData: (row: T) => F;
  /** POST; returns saved row with id */
  onAdd: (data: F) => Promise<T>;
  /** PATCH; returns updated row */
  onUpdate: (id: string, data: F) => Promise<T>;
  /** DELETE (saved rows only) */
  onDelete: (id: string) => Promise<void>;
  /** remove from consumer's array (new rows only) */
  onRemove: (row: T) => void;
}

export interface UseInlineEditRowResult<F> {
  formState: F;
  isNew: boolean;
  handleChange: <K extends keyof F>(field: K, value: F[K]) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  reset: () => void;
}

export function useInlineEditRow<T extends { id: string | null }, F>(
  opts: UseInlineEditRowOptions<T, F>,
): UseInlineEditRowResult<F> {
  const { row, pickFormData, onAdd, onUpdate, onDelete, onRemove } = opts;

  const [formState, setFormState] = useState<F>(() => pickFormData(row));

  const isNew = row.id === null;

  const handleChange = useCallback(<K extends keyof F>(field: K, value: F[K]) => {
    setFormState((s) => ({ ...s, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (isNew) {
      await onAdd(formState);
    } else {
      await onUpdate(row.id as string, formState);
    }
  }, [isNew, onAdd, onUpdate, row.id, formState]);

  const handleDelete = useCallback(async () => {
    if (isNew) {
      onRemove(row);
    } else {
      await onDelete(row.id as string);
    }
  }, [isNew, onRemove, onDelete, row]);

  const reset = useCallback(() => {
    setFormState(pickFormData(row));
  }, [pickFormData, row]);

  return { formState, isNew, handleChange, handleSave, handleDelete, reset };
}
