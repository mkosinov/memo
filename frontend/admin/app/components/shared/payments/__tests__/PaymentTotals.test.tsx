import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentTotals } from '../PaymentTotals';

describe('PaymentTotals', () => {
  it('shows remaining in red when unpaid (remaining > 0)', () => {
    render(<PaymentTotals total={5000} paid={2000} />);
    const remaining = screen.getByText('3 000 ₽');
    expect(remaining).toBeInTheDocument();
    expect(remaining.className).toContain('text-red-600');
  });

  it('shows remaining in green when fully paid (remaining = 0)', () => {
    render(<PaymentTotals total={5000} paid={5000} />);
    const remaining = screen.getByText('0 ₽');
    expect(remaining).toBeInTheDocument();
    expect(remaining.className).toContain('text-emerald-600');
  });

  it('formats all values with ₽ and displays labels', () => {
    render(<PaymentTotals total={7500} paid={3000} />);
    expect(screen.getByText('Стоимость')).toBeInTheDocument();
    expect(screen.getByText('7 500 ₽')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('3 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('К оплате')).toBeInTheDocument();
    expect(screen.getByText('4 500 ₽')).toBeInTheDocument();
  });
});
