/**
 * Tests for InlineEditRow — row-level save trigger (Enter + blur-leaving-row).
 *
 * RED phase: these tests verify the NEW behavior (save on blur/Enter for new rows).
 * They should FAIL until the implementation is wired up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
// GH #247 §6-2: triggerSave toasts on save failure — mock the UI context
// (repo pattern: context mocks at module level, before component import).
vi.mock('../contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));
vi.mock('../app/lib/api/parseApiError', () => ({
  parseApiError: (err: unknown) => ({
    message: err instanceof Error ? err.message : 'Неизвестная ошибка',
  }),
}));
import { InlineEditRow } from '../app/components/shared/record/InlineEditRow';
import type { Column } from '../app/components/shared/record/RecordTable';

// ─── Test types ──────────────────────────────────────────────────────────────

interface TestRow {
  id: string | null;
  clientId: string;
  name: string;
}

interface TestForm {
  name: string;
}

const COLUMNS: Column[] = [{ key: 'name', label: 'Name' }];

function makeRow(overrides?: Partial<TestRow>): TestRow {
  return { id: null, clientId: 'cid-1', name: '', ...overrides };
}

function pickFormData(row: TestRow): TestForm {
  return { name: row.name };
}

// ─── Helper: render InlineEditRow with a simple input cell ───────────────────

function renderNewRow(opts: {
  onAdd?: (data: TestForm) => Promise<TestRow>;
  onSaved?: (oldRow: TestRow, savedRow: TestRow) => void;
  row?: TestRow;
} = {}) {
  const onAdd = opts.onAdd ?? vi.fn().mockResolvedValue({ id: 'saved-1', clientId: 'cid-1', name: '' });
  const onUpdate = vi.fn().mockResolvedValue({ id: 'saved-1', clientId: 'cid-1', name: '' });
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn();
  const onSaved = opts.onSaved;
  const row = opts.row ?? makeRow();

  render(
    <div>
      <InlineEditRow<TestRow, TestForm>
        row={row}
        testIdPrefix="test"
        columns={COLUMNS}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onRemove={onRemove}
        onSaved={onSaved}
        emptyData={() => ({ name: '' })}
        pickFormData={pickFormData}
        renderCell={({ formState, isNew, handleChange }) => ({
          name: (
            <input
              value={formState.name}
              onChange={(e) => handleChange('name', e.target.value)}
              data-testid="test-input"
              autoFocus={isNew}
            />
          ),
        })}
      />
      <button data-testid="outside">Outside</button>
    </div>,
  );

  return { onAdd, onUpdate, onDelete, onRemove, onSaved };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InlineEditRow — new-row save trigger', () => {
  it('Enter on a new row calls onAdd even when no field changed', async () => {
    const { onAdd } = renderNewRow();

    const input = screen.getByTestId('test-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    // Should be called with the initial (empty) formState
    expect(onAdd).toHaveBeenCalledWith({ name: '' });
  });

  it('Enter after typing calls onAdd with the typed value', async () => {
    const { onAdd } = renderNewRow();

    const input = screen.getByTestId('test-input');
    fireEvent.change(input, { target: { value: 'Анна' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Анна' });
  });

  it('blur leaving the row calls onAdd', async () => {
    const { onAdd } = renderNewRow();

    const input = screen.getByTestId('test-input');
    const outside = screen.getByTestId('outside');
    // Focus the input, then blur to outside
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: outside });

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  });

  it('blur moving between cells in the same row does NOT call onAdd', async () => {
    const { onAdd } = renderNewRow();

    const input = screen.getByTestId('test-input');
    // Blur with relatedTarget inside the row (the row div contains the input)
    // Since we only have one input, simulate blur staying in the row by
    // setting relatedTarget to the row's container
    const rowDiv = screen.getByTestId('test-new');
    fireEvent.blur(input, { relatedTarget: rowDiv });

    // Give it a moment to ensure no call happens
    await new Promise((r) => setTimeout(r, 50));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('double-trigger (Enter then blur) does NOT double-call onAdd', async () => {
    let resolveAdd: (row: TestRow) => void;
    const onAdd = vi.fn().mockImplementation(
      () => new Promise<TestRow>((resolve) => { resolveAdd = resolve; }),
    );
    renderNewRow({ onAdd });

    const input = screen.getByTestId('test-input');
    // Enter triggers save (starts async)
    fireEvent.keyDown(input, { key: 'Enter' });
    // Blur also triggers save (should be blocked by guard)
    const outside = screen.getByTestId('outside');
    fireEvent.blur(input, { relatedTarget: outside });

    // Even though both fired, onAdd should only be called once
    await new Promise((r) => setTimeout(r, 50));
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Resolve the promise to clean up
    resolveAdd!({ id: 'saved-1', clientId: 'cid-1', name: '' });
  });

  it('does NOT trigger save for saved rows (id !== null)', async () => {
    const onAdd = vi.fn();
    const savedRow = makeRow({ id: 'existing-1', name: 'Test' });
    renderNewRow({ onAdd, row: savedRow });

    const input = screen.getByTestId('test-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    await new Promise((r) => setTimeout(r, 50));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calls onSaved with old row and saved row after successful save', async () => {
    const savedRow: TestRow = { id: 'saved-1', clientId: 'cid-1', name: 'Анна' };
    const onAdd = vi.fn().mockResolvedValue(savedRow);
    const onSaved = vi.fn();
    renderNewRow({ onAdd, onSaved });

    const input = screen.getByTestId('test-input');
    fireEvent.change(input, { target: { value: 'Анна' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, clientId: 'cid-1' }),
        savedRow,
      );
    });
  });
});

describe('InlineEditRow — delete contract', () => {
  it('unsaved row (id === null) × calls onRemove, not onDelete', async () => {
    const { onDelete, onRemove } = renderNewRow();

    const deleteBtn = screen.getByTestId('test-new-delete');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('saved row (id !== null) × calls onDelete, not onRemove', async () => {
    const savedRow = makeRow({ id: 'existing-1', name: 'Test' });
    const { onDelete, onRemove } = renderNewRow({ row: savedRow });

    const deleteBtn = screen.getByTestId('test-existing-1-delete');
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith('existing-1');
    expect(onRemove).not.toHaveBeenCalled();
  });
});
