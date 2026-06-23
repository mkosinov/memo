import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddVisitorForm } from '../AddVisitorForm';
import type { TariffResponse } from '@memo/api-client';

const mockTariffs: TariffResponse[] = [
  { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 3500 },
  { id: 't2', service_id: 's1', title: 'Детский', description: null, price: 2500 },
];

describe('AddVisitorForm', () => {
  it('renders name input, age input, tariff select, and buttons', () => {
    render(
      <AddVisitorForm tariffs={mockTariffs} onAdd={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('add-visitor-name')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-submit')).toBeInTheDocument();
    expect(screen.getByText('Отмена')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-tariff')).toBeInTheDocument();
    expect(screen.getByText(/Взрослый/)).toBeInTheDocument();
  });

  it('calls onAdd with visitor data when form is submitted', () => {
    const onAdd = vi.fn();
    render(
      <AddVisitorForm tariffs={mockTariffs} onAdd={onAdd} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByTestId('add-visitor-name'), {
      target: { value: 'Мария' },
    });
    fireEvent.change(screen.getByTestId('add-visitor-age'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByTestId('add-visitor-tariff'), {
      target: { value: 't2' },
    });

    fireEvent.submit(screen.getByTestId('add-visitor-form'));

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Мария',
      age: 8,
      tariff_id: 't2',
    });
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <AddVisitorForm tariffs={mockTariffs} onAdd={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText('Отмена'));
    expect(onCancel).toHaveBeenCalled();
  });
});
