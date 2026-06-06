import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// No mocks needed — ColumnPicker is a pure UI component

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
  });

  it('renders the settings button', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity', 'address']}
        onChange={vi.fn()}
        storageKey="test-columns"
      />,
    );
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('opens dropdown when button clicked', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name']}
        onChange={vi.fn()}
        storageKey="test-columns"
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
        onChange={vi.fn()}
        storageKey="test-columns"
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

  it('calls onChange with updated keys when a column toggled', () => {
    const onChange = vi.fn();
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity']}
        onChange={onChange}
        storageKey="test-columns"
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Название"
    fireEvent.click(screen.getByLabelText('Название'));

    expect(onChange).toHaveBeenCalledWith(['capacity']);
  });

  it('adds column when unchecked column clicked', () => {
    const onChange = vi.fn();
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name']}
        onChange={onChange}
        storageKey="test-columns"
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Check "Адрес"
    fireEvent.click(screen.getByLabelText('Адрес'));

    expect(onChange).toHaveBeenCalledWith(['name', 'address']);
  });

  it('persists to localStorage when toggling', () => {
    render(
      <ColumnPicker
        columns={COLUMNS}
        visibleKeys={['name', 'capacity']}
        onChange={vi.fn()}
        storageKey="my-columns"
      />,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    fireEvent.click(screen.getByLabelText('Вместимость'));

    expect(JSON.parse(localStorage.getItem('my-columns')!)).toEqual(['name']);
  });

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <span data-testid="outside">Outside</span>
        <ColumnPicker
          columns={COLUMNS}
          visibleKeys={['name']}
          onChange={vi.fn()}
          storageKey="test-columns"
        />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    expect(screen.getByText('Название')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Название')).not.toBeInTheDocument();
  });
});
