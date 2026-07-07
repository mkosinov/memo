'use client';

import { useCallback, useRef, useState } from 'react';

export interface UseInlineEditRowOptions<T extends { id: string | null }, F> {
  row: T;
  /** Factory for new-row defaults. Used by consumers when appending a new row; not called internally. */
  emptyData: () => F;
  /** T → F (form fields only) */
  pickFormData: (row: T) => F;
  /** POST; returns saved row with id, or undefined if save was blocked (e.g. validation guard) */
  onAdd: (data: F) => Promise<T | undefined>;
  /** PATCH; returns updated row */
  onUpdate: (id: string, data: F) => Promise<T>;
  /** DELETE (saved rows only) */
  onDelete: (id: string) => Promise<void>;
  /** remove from consumer's array (new rows only) */
  onRemove: (row: T) => void;
}

export interface UseInlineEditRowResult<T, F> {
  formState: F;
  isNew: boolean;
  handleChange: <K extends keyof F>(field: K, value: F[K]) => void;
  handleSave: () => Promise<T | undefined>;
  handleDelete: () => Promise<void>;
  reset: () => void;
}

export function useInlineEditRow<T extends { id: string | null }, F>(
  opts: UseInlineEditRowOptions<T, F>,
): UseInlineEditRowResult<T, F> {
  const { row, pickFormData, onAdd, onUpdate, onDelete, onRemove } = opts;

  const [formState, setFormState] = useState<F>(() => pickFormData(row));

  /**
   * Ref mirror of formState — updated synchronously in handleChange so that
   * handleSave (called from blur/Enter handlers in the SAME event tick) always
   * reads the latest values, even before React re-renders.
   */
  const formStateRef = useRef<F>(formState);

  const isNew = row.id === null;

  const handleChange = useCallback(<K extends keyof F>(field: K, value: F[K]) => {
    setFormState((s) => ({ ...s, [field]: value }));
    // Update ref synchronously so handleSave (called from blur/Enter in the
    // same event tick) always reads the latest values — even before React
    // re-renders and runs the state updater.
    formStateRef.current = { ...formStateRef.current, [field]: value };
  }, []);

  const handleSave = useCallback(async (): Promise<T | undefined> => {
    if (isNew) {
      return await onAdd(formStateRef.current);
    } else {
      return await onUpdate(row.id as string, formStateRef.current);
    }
  }, [isNew, onAdd, onUpdate, row.id]);

  const handleDelete = useCallback(async () => {
    if (isNew) {
      onRemove(row);
    } else {
      await onDelete(row.id as string);
    }
  }, [isNew, onRemove, onDelete, row]);

  const reset = useCallback(() => {
    const fresh = pickFormData(row);
    setFormState(fresh);
    formStateRef.current = fresh;
  }, [pickFormData, row]);

  return { formState, isNew, handleChange, handleSave, handleDelete, reset };
}
