import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordVisitRow } from '../RecordVisitRow';
import type { VisitResponse, TariffResponse } from '@memo/api-client';

const mockTariffs: TariffResponse[] = [
  { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 3500 },
  { id: 't2', service_id: 's1', title: 'Детский', description: null, price: 2500 },
];

const mockVisit: VisitResponse = {
  id: 'v1',
  record_id: 'r1',
  visitor_id: 'vis1',
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
  is_active: true,
};

describe('RecordVisitRow', () => {
  it('renders visitor name and age', () => {
    render(
      <RecordVisitRow
        visit={mockVisit}
        visitorName="Анна"
        visitorAge={30}
        tariffs={mockTariffs}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Анна')).toBeInTheDocument();
    expect(screen.getByDisplayValue(30)).toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    render(
      <RecordVisitRow
        visit={mockVisit}
        visitorName="Анна"
        visitorAge={30}
        tariffs={mockTariffs}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /удалить посетителя/i }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('calls onChange when name is edited', () => {
    const onChange = vi.fn();
    render(
      <RecordVisitRow
        visit={mockVisit}
        visitorName="Анна"
        visitorAge={30}
        tariffs={mockTariffs}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Анна'), { target: { value: 'Мария' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders tariff select with options', () => {
    render(
      <RecordVisitRow
        visit={mockVisit}
        visitorName="Анна"
        visitorAge={30}
        tariffId="t1"
        tariffs={mockTariffs}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue(/Взрослый/)).toBeInTheDocument();
  });
});
