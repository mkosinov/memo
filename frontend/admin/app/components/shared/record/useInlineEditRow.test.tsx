import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineEditRow } from './useInlineEditRow';

type Row = { id: string | null; name: string; age: number };
type FormData = { name: string; age: number };

const emptyData = (): FormData => ({ name: '', age: 0 });
const pickFormData = (row: Row): FormData => ({ name: row.name, age: row.age });

describe('useInlineEditRow', () => {
  it('isNew is true when row.id is null', () => {
    const row: Row = { id: null, name: '', age: 0 };
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(result.current.isNew).toBe(true);
  });

  it('isNew is false when row.id is a string', () => {
    const row: Row = { id: 'abc-123', name: 'Anna', age: 30 };
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(result.current.isNew).toBe(false);
  });

  it('handleSave calls onAdd(formState) and not onUpdate when isNew', async () => {
    const row: Row = { id: null, name: '', age: 0 };
    const onAdd = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Anna', age: 30 });
    const onUpdate = vi.fn();
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd,
        onUpdate,
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleChange('name', 'Anna');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ name: 'Anna', age: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('handleSave calls onUpdate(row.id, formState) and not onAdd when not isNew', async () => {
    const row: Row = { id: 'abc-123', name: 'Anna', age: 30 };
    const onAdd = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue({ id: 'abc-123', name: 'Maria', age: 30 });
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd,
        onUpdate,
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleChange('name', 'Maria');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('abc-123', { name: 'Maria', age: 30 });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('handleDelete calls onRemove(row) and not onDelete when isNew', async () => {
    const row: Row = { id: null, name: '', age: 0 };
    const onDelete = vi.fn();
    const onRemove = vi.fn();
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete,
        onRemove,
      }),
    );

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(row);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('handleDelete calls onDelete(row.id) and not onRemove when not isNew', async () => {
    const row: Row = { id: 'abc-123', name: 'Anna', age: 30 };
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn();
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete,
        onRemove,
      }),
    );

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('abc-123');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('reset restores formState to pickFormData(row) after handleChange mutated it', () => {
    const row: Row = { id: 'abc-123', name: 'Anna', age: 30 };
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleChange('name', 'Maria');
      result.current.handleChange('age', 99);
    });

    expect(result.current.formState).toEqual({ name: 'Maria', age: 99 });

    act(() => {
      result.current.reset();
    });

    expect(result.current.formState).toEqual({ name: 'Anna', age: 30 });
  });

  it('handleChange updates formState[field]', () => {
    const row: Row = { id: null, name: '', age: 0 };
    const { result } = renderHook(() =>
      useInlineEditRow<Row, FormData>({
        row,
        emptyData,
        pickFormData,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleChange('name', 'Anna');
    });

    expect(result.current.formState.name).toBe('Anna');
  });
});
