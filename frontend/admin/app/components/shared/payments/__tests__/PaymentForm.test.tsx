import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PaymentForm } from '../PaymentForm';

describe('PaymentForm', () => {
  it('submits valid payment with amount and method', () => {
    const onSubmit = vi.fn();
    render(<PaymentForm total={5000} paid={2000} onSubmit={onSubmit} />);

    // defaultAmount = total - paid = 3000, which is valid (> 0)
    fireEvent.click(screen.getByTestId('payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({ amount: 3000, method: 'card' });
  });

  it('shows error when amount is 0 (total === paid)', () => {
    const onSubmit = vi.fn();
    // defaultAmount = total - paid = 0, triggers validation on submit
    render(<PaymentForm total={5000} paid={5000} onSubmit={onSubmit} />);

    act(() => {
      fireEvent.submit(screen.getByTestId('payment-form'));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/больше 0/i)).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <PaymentForm total={5000} paid={2000} onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText('Отмена'));
    expect(onCancel).toHaveBeenCalled();
  });
});
