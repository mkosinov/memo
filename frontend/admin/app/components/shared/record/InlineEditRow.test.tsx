import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
// GH #247 §6-2: triggerSave toasts on save failure — mock the UI context
// (repo pattern: context mocks at module level, before component import).
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/app/lib/api/parseApiError', () => ({
  parseApiError: (err: unknown) => ({
    message: err instanceof Error ? err.message : 'Неизвестная ошибка',
  }),
}));
import { InlineEditRow, type InlineEditRowProps } from './InlineEditRow';
import type { Column } from './RecordTable';

type Row = { id: string | null; name: string; age: number };
type FormData = { name: string; age: number };

const columns: Column[] = [
  { key: 'name', label: 'Имя' },
  { key: 'age', label: 'Возраст' },
];

const emptyData = (): FormData => ({ name: '', age: 0 });
const pickFormData = (row: Row): FormData => ({ name: row.name, age: row.age });

// Shared renderCell — SAME function used for both new and saved rows, per the
// spec's "no separate JSX branch" invariant. The `isNew` flag (passed through
// from useInlineEditRow) is the ONLY thing consumers use to vary behavior
// (e.g. autoFocus, placeholders) — never a separate render path.
const renderCell = ({
  row,
  formState,
  isNew,
  handleChange,
}: {
  row: Row;
  formState: FormData;
  isNew: boolean;
  handleChange: (field: keyof FormData, value: any) => void;
}) => ({
  name: (
    <input
      data-testid="name-input"
      autoFocus={isNew}
      value={formState.name}
      onChange={(e) => handleChange('name', e.target.value)}
    />
  ),
  age: <span data-testid="age-value">{formState.age}</span>,
});

function renderRow(row: Row, overrides: Partial<InlineEditRowProps<Row, FormData>> = {}) {
  const onAdd = vi.fn().mockResolvedValue({ id: 'new-id', name: 'x', age: 0 });
  const onUpdate = vi.fn().mockResolvedValue({ id: row.id, name: 'x', age: 0 });
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn();

  const utils = render(
    <InlineEditRow<Row, FormData>
      row={row}
      testIdPrefix="visit-row"
      renderCell={renderCell}
      columns={columns}
      onAdd={onAdd}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onRemove={onRemove}
      emptyData={emptyData}
      pickFormData={pickFormData}
      {...overrides}
    />,
  );

  return { ...utils, onAdd, onUpdate, onDelete, onRemove };
}

describe('InlineEditRow', () => {
  it('renders a new row (id: null) and a saved row using the same renderCell output', () => {
    const { unmount } = renderRow({ id: null, name: '', age: 0 });
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
    expect(screen.getByTestId('age-value')).toBeInTheDocument();
    unmount();

    renderRow({ id: 'v1', name: 'Анна', age: 30 });
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
    // Same cell keys/testids as the new row — no separate JSX branch.
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
    expect(screen.getByTestId('age-value')).toBeInTheDocument();
  });

  it('× button calls onRemove (via handleDelete) for a new row, not onDelete', async () => {
    const { onDelete, onRemove } = renderRow({ id: null, name: '', age: 0 });
    const btn = screen.getByTestId('visit-row-new-delete');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('× button calls onDelete (via handleDelete) for a saved row, not onRemove', async () => {
    const { onDelete, onRemove } = renderRow({ id: 'v1', name: 'Анна', age: 30 });
    const btn = screen.getByTestId('visit-row-v1-delete');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('v1');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('first input has autoFocus only when isNew', () => {
    const { unmount } = renderRow({ id: null, name: '', age: 0 });
    expect(screen.getByTestId('name-input')).toHaveFocus();
    unmount();

    renderRow({ id: 'v1', name: 'Анна', age: 30 });
    expect(screen.getByTestId('name-input')).not.toHaveFocus();
  });

  it('does not render × button when isReadOnly', () => {
    renderRow({ id: 'v1', name: 'Анна', age: 30 }, { isReadOnly: true });
    expect(screen.queryByTestId('visit-row-v1-delete')).not.toBeInTheDocument();
  });
});
