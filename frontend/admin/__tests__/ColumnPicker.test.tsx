import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// No mocks needed — ColumnPicker is a pure UI component.
// #139 T1 (B2 cat 8): ColumnPicker is now a controlLED presentational —
// props { columns, visibleKeys, onToggle }; it owns NO localStorage writes.

import { ColumnPicker } from '@/app/components/shared/ColumnPicker';

const COLUMNS = [
  { key: 'name', label: 'Название' },
  { key: 'capacity', label: 'Вместимость' },
  { key: 'address', label: 'Адрес' },
];

describe('ColumnPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders the settings button', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity', 'address']}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('opens dropdown when button clicked', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name']}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    expect(screen.getByText('Название')).toBeInTheDocument();
    expect(screen.getByText('Вместимость')).toBeInTheDocument();
    expect(screen.getByText('Адрес')).toBeInTheDocument();
  });

  it('checks checkboxes for visible columns', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'address']}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    const nameCheckbox = screen.getByLabelText('Название') as HTMLInputElement;
    const capacityCheckbox = screen.getByLabelText('Вместимость') as HTMLInputElement;
    const addressCheckbox = screen.getByLabelText('Адрес') as HTMLInputElement;

    expect(nameCheckbox.checked).toBe(true);
    expect(capacityCheckbox.checked).toBe(false);
    expect(addressCheckbox.checked).toBe(true);
  });

  it('calls onToggle with the toggled column key (not the keys array)', () => {
    const onToggle = vi.fn();
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity']}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Название" → onToggle receives the KEY, parent computes next array
    fireEvent.click(screen.getByLabelText('Название'));
    expect(onToggle).toHaveBeenCalledWith('name');

    // Check "Адрес" → onToggle receives the KEY too
    fireEvent.click(screen.getByLabelText('Адрес'));
    expect(onToggle).toHaveBeenCalledWith('address');
  });

  it('does NOT write to localStorage (persistence moved up to DataTable)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity']}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    fireEvent.click(screen.getByLabelText('Вместимость'));

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('my-columns')).toBeNull();
  });

  it('last-visible column is muted and guarded: clicking it is a no-op', () => {
    const onToggle = vi.fn();
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['capacity']}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    const capacityCheckbox = screen.getByLabelText('Вместимость') as HTMLInputElement;
    expect(capacityCheckbox.checked).toBe(true);
    // §6.5 protection is behavioral (no-op guard) + muted style — NOT native
    // `disabled`/`aria-disabled` (see component note: they make the e2e click
    // unactionable, breaking the unchanged tags-crud picker test).
    expect(capacityCheckbox.disabled).toBe(false);

    // Clicking the last-visible checkbox does nothing (guarded)
    fireEvent.click(capacityCheckbox);
    expect(onToggle).not.toHaveBeenCalled();
    expect(capacityCheckbox.checked).toBe(true);

    // Unchecked columns stay clickable
    fireEvent.click(screen.getByLabelText('Название'));
    expect(onToggle).toHaveBeenCalledWith('name');
  });

  it('calls onToggle freely when more than one column is visible', () => {
    const onToggle = vi.fn();
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity']}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    fireEvent.click(screen.getByLabelText('Название'));
    expect(onToggle).toHaveBeenCalledWith('name');
  });

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <span data-testid="outside">Outside</span>
        <ColumnPicker
          columns={COLUMNS}
          visibleKeys={['name']}
          onToggle={vi.fn()}
        />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    expect(screen.getByText('Название')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Название')).not.toBeInTheDocument();
  });
});
