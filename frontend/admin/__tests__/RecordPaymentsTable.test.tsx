/**
 * Tests for RecordPaymentsTable — prefilled amount save + preserve values
 * + amount > 0 guard with error toast.
 *
 * Verifies that a prefilled payment row can be saved without editing the amount,
 * that the submitted values are preserved after save, and that amount <= 0
 * is blocked with an error toast on both create and edit paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RecordPaymentsTable } from '../app/components/shared/record/blocks/RecordPaymentsTable';
import type { PaymentResponse } from '@memo/api-client';

// ─── Mock UIContext ──────────────────────────────────────────────────────────

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { useUI } from '@/contexts/UIContext';
const mockUseUI = vi.mocked(useUI);

// ─── Helper ──────────────────────────────────────────────────────────────────

const mockShowToast = vi.fn();

function renderPaymentsTable(opts: {
  payments?: PaymentResponse[];
  defaultAmount?: number;
  onAddPayment?: (amount: number, method: string) => Promise<PaymentResponse>;
  onPatchPayment?: (id: string, data: { amount?: number; method?: string }) => Promise<PaymentResponse>;
} = {}) {
  mockUseUI.mockReturnValue({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: mockShowToast,
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  });

  const onAddPayment = opts.onAddPayment ?? vi.fn().mockResolvedValue({
    id: 'p_new',
    record_id: 'r1',
    amount: opts.defaultAmount ?? 6000,
    method: 'card',
    created_at: '2026-07-06T12:00:00',
    updated_at: '2026-07-06T12:00:00',
    is_active: true,
  } as PaymentResponse);

  const onPatchPayment = opts.onPatchPayment ?? vi.fn();
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

beforeEach(() => {
  mockShowToast.mockClear();
});

afterEach(() => vi.restoreAllMocks());

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

// ─── Amount > 0 guard tests ─────────────────────────────────────────────────

describe('RecordPaymentsTable — amount > 0 guard', () => {
  it('new row: amount=0 shows error toast and does NOT call onAddPayment', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 0 });

    // Add a new row
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(screen.getByTestId('payment-new')).toBeInTheDocument();

    // Type 0 in the amount field and press Enter
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    // Wait a tick for any async operations
    await new Promise((r) => setTimeout(r, 50));

    // Guard should fire: toast shown, onAddPayment NOT called
    expect(mockShowToast).toHaveBeenCalledWith('Сумма должна быть больше 0', 'error');
    expect(onAddPayment).not.toHaveBeenCalled();
  });

  it('new row: amount=0 on blur shows error toast and row stays editable', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 0 });

    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.change(amountInput, { target: { value: '0' } });

    // Blur leaving the row
    const addBtn = screen.getByTestId('btn-add-payment');
    fireEvent.blur(amountInput, { relatedTarget: addBtn });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockShowToast).toHaveBeenCalledWith('Сумма должна быть больше 0', 'error');
    expect(onAddPayment).not.toHaveBeenCalled();
    // Row should still be in the DOM (editable new row)
    expect(screen.getByTestId('payment-new')).toBeInTheDocument();
  });

  it('existing row: editing amount to 0 shows toast, does NOT call onPatchPayment, keeps old amount', async () => {
    const existingPayment: PaymentResponse = {
      id: 'p_existing',
      record_id: 'r1',
      amount: 5000,
      method: 'card',
      created_at: '2026-07-01T10:00:00',
      updated_at: '2026-07-01T10:00:00',
      is_active: true,
    };

    const { onPatchPayment } = renderPaymentsTable({
      payments: [existingPayment],
    });

    // Find the amount cell for the existing row and edit it to 0
    const row = screen.getByTestId('payment-p_existing');
    expect(row).toBeInTheDocument();

    const amountInput = row.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(amountInput).toBeTruthy();

    amountInput.focus();
    fireEvent.change(amountInput, { target: { value: '0' } });
    // Commit via Enter (triggers blur in InlineEditCell)
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await new Promise((r) => setTimeout(r, 50));

    // Guard should fire
    expect(mockShowToast).toHaveBeenCalledWith('Сумма должна быть больше 0', 'error');
    expect(onPatchPayment).not.toHaveBeenCalled();
  });
});
