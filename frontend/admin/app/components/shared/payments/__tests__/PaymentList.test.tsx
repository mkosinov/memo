import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentList } from '../PaymentList';
import type { PaymentResponse } from '@memo/api-client';

const mockPayments: PaymentResponse[] = [
  {
    id: 'p1',
    record_id: 'r1',
    amount: 3500,
    method: 'card',
    created_at: '2026-05-10T10:00:00',
    updated_at: '2026-05-10T10:00:00',
  },
  {
    id: 'p2',
    record_id: 'r1',
    amount: 1500,
    method: 'cash',
    created_at: '2026-05-11T12:00:00',
    updated_at: '2026-05-11T12:00:00',
  },
];

describe('PaymentList', () => {
  it('shows "Нет платежей" when payments is empty', () => {
    render(<PaymentList payments={[]} onDelete={vi.fn()} />);
    expect(screen.getByText('Нет платежей')).toBeInTheDocument();
  });

  it('renders list of payments with amount and method', () => {
    render(<PaymentList payments={mockPayments} onDelete={vi.fn()} />);
    expect(screen.getByText(/3 500/)).toBeInTheDocument();
    expect(screen.getByText(/1 500/)).toBeInTheDocument();
    expect(screen.getByTestId('payment-list')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<PaymentList payments={mockPayments} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('payment-p1-delete'));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });
});
