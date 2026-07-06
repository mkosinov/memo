/**
 * Tests for RecordPaymentsTable — prefilled amount save + preserve values.
 *
 * Verifies that a prefilled payment row can be saved without editing the amount,
 * and that the submitted values are preserved after save.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RecordPaymentsTable } from '../app/components/shared/record/blocks/RecordPaymentsTable';
import type { PaymentResponse } from '@memo/api-client';

// ─── Helper ──────────────────────────────────────────────────────────────────

function renderPaymentsTable(opts: {
  payments?: PaymentResponse[];
  defaultAmount?: number;
  onAddPayment?: (amount: number, method: string) => Promise<PaymentResponse>;
} = {}) {
  const onAddPayment = opts.onAddPayment ?? vi.fn().mockResolvedValue({
    id: 'p_new',
    record_id: 'r1',
    amount: opts.defaultAmount ?? 6000,
    method: 'card',
    created_at: '2026-07-06T12:00:00',
    updated_at: '2026-07-06T12:00:00',
    is_active: true,
  } as PaymentResponse);

  const onPatchPayment = vi.fn();
  const onDeletePayment = vi.fn().mockResolvedValue(undefined);

  render(
    <RecordPaymentsTable
      payments={opts.payments ?? []}
      defaultAmount={opts.defaultAmount ?? 0}
      onAddPayment={onAddPayment}
      onPatchPayment={onPatchPayment}
      onDeletePayment={onDeletePayment}
    />,
  );

  return { onAddPayment, onPatchPayment, onDeletePayment };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RecordPaymentsTable — new-row save + preserve values', () => {
  it('saves prefilled amount without editing (scenario 10)', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 6000 });

    // Click "+ Добавить" to add a new row (prefilled with 6000)
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(screen.getByTestId('payment-new')).toBeInTheDocument();

    // Press Enter WITHOUT changing the amount
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await waitFor(() => expect(onAddPayment).toHaveBeenCalledTimes(1));
    // Should be called with the prefilled amount (6000)
    expect(onAddPayment).toHaveBeenCalledWith(6000, 'card');
  });

  it('saves prefilled amount on blur leaving the row', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 6000 });

    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');

    // Focus the amount input, then blur to outside the row
    fireEvent.focus(amountInput);
    // We need a target outside the row — the "+ Добавить" button in totals row
    const addBtn = screen.getByTestId('btn-add-payment');
    fireEvent.blur(amountInput, { relatedTarget: addBtn });

    await waitFor(() => expect(onAddPayment).toHaveBeenCalledTimes(1));
    expect(onAddPayment).toHaveBeenCalledWith(6000, 'card');
  });

  it('after save, row shows the submitted amount (not blank)', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 6000 });

    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await waitFor(() => expect(onAddPayment).toHaveBeenCalledTimes(1));

    // After save, the row should display 6000 ₽
    await waitFor(() => {
      const savedRow = screen.getByTestId('payment-p_new');
      expect(savedRow).toBeInTheDocument();
      expect(savedRow.textContent).toContain('6');
    });
  });

  it('saves with changed amount and method', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 6000 });

    fireEvent.click(screen.getByTestId('btn-add-payment'));

    // Change the amount
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.change(amountInput, { target: { value: '3000' } });

    // Change the method
    const methodSelect = screen.getByTestId('add-payment-method');
    fireEvent.change(methodSelect, { target: { value: 'cash' } });

    // Press Enter to save
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await waitFor(() => expect(onAddPayment).toHaveBeenCalledTimes(1));
    expect(onAddPayment).toHaveBeenCalledWith(3000, 'cash');
  });
});
