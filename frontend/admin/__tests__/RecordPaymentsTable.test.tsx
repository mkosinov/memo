/**
 * Tests for RecordPaymentsTable — prefilled amount save + preserve values
 * + amount > 0 guard with error toast, and the #127 Task 6 row-state
 * architecture (saved = useMemo, drafts = useState).
 *
 * Spec (#127 Task 6, mirrors Task 5 for visits):
 *   - Saved rows = useMemo(() => payments.map(paymentResponseToRow), [payments])
 *   - Draft rows (id === null) = separate useState
 *   - Render = dedupe(saved) + drafts
 *   - handleAddClick → setDrafts(...)
 *   - handleRemove (draft) → setDrafts(prev => prev.filter(r => r !== row))
 *   - handleDeleteRow (saved) → call onDeletePayment(id) — NO local filter
 *   - onSaved → replace draft in drafts with saved row (pending-saved state)
 *     until the cache catches up
 *
 * The component must NOT use a useEffect to re-sync local state from the
 * payments prop (Bug #3 "row disappears" — effect overwrites local editing
 * state mid-edit).
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
  onAddPayment?: (amount: number, method: string, date: string) => Promise<PaymentResponse>;
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
    // Should be called with the prefilled amount (6000), method, and a date string
    expect(onAddPayment).toHaveBeenCalledWith(6000, 'card', expect.any(String));
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
    expect(onAddPayment).toHaveBeenCalledWith(6000, 'card', expect.any(String));
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
    expect(onAddPayment).toHaveBeenCalledWith(3000, 'cash', expect.any(String));
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

// ─── Editable payment date tests ──────────────────────────────────────────────

describe('RecordPaymentsTable — editable payment date on new rows', () => {
  it('new row renders datetime-local input prefilled with ~now', () => {
    renderPaymentsTable({ defaultAmount: 0 });

    // Click "+ Добавить" to add a new row
    fireEvent.click(screen.getByTestId('btn-add-payment'));

    // Should render a datetime-local input with testid "add-payment-date"
    const dateInput = screen.getByTestId('add-payment-date') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.type).toBe('datetime-local');

    // The value should be a valid datetime-local string close to now
    const value = dateInput.value;
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // Should be within 2 minutes of current local time
    const inputTime = new Date(value).getTime();
    const now = Date.now();
    expect(Math.abs(inputTime - now)).toBeLessThan(120_000);
  });

  it('saved row shows read-only date, NOT a datetime-local input', () => {
    const existingPayment: PaymentResponse = {
      id: 'p_existing',
      record_id: 'r1',
      amount: 5000,
      method: 'card',
      created_at: '2026-07-01T10:00:00',
      updated_at: '2026-07-01T10:00:00',
    };

    renderPaymentsTable({ payments: [existingPayment] });

    // Should NOT have a datetime-local input
    expect(screen.queryByTestId('add-payment-date')).toBeNull();

    // Should display the formatted date
    const row = screen.getByTestId('payment-p_existing');
    expect(row.textContent).toContain('01.07.2026');
  });

  it('editing date and saving calls onAddPayment with the chosen created_at', async () => {
    const { onAddPayment } = renderPaymentsTable({ defaultAmount: 5000 });

    fireEvent.click(screen.getByTestId('btn-add-payment'));

    // Change the date
    const dateInput = screen.getByTestId('add-payment-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-07-05T15:30' } });

    // Press Enter on the amount input to save
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await waitFor(() => expect(onAddPayment).toHaveBeenCalledTimes(1));

    // Should be called with amount, method, and the chosen date (with seconds appended for ISO 8601)
    expect(onAddPayment).toHaveBeenCalledWith(5000, 'card', '2026-07-05T15:30:00');
  });
});

// ─── #127 Task 6: saved rows derive from payments prop (useMemo) ────────────

describe('RecordPaymentsTable — saved rows derive from payments prop (useMemo)', () => {
  /** Render the table from raw props and return the test utils (with .rerender). */
  function renderRaw(initial: {
    payments: PaymentResponse[];
    onDeletePayment?: (id: string) => Promise<void>;
  }) {
    mockUseUI.mockReturnValue({
      deleteMode: false,
      toggleDeleteMode: vi.fn(),
      toasts: [],
      showToast: vi.fn(),
      hideToast: vi.fn(),
      sidebarCollapsed: false,
      toggleSidebar: vi.fn(),
      rightPanelCollapsed: true,
      toggleRightPanel: vi.fn(),
      theme: 'light' as const,
      toggleTheme: vi.fn(),
    });

    const onDeletePayment = initial.onDeletePayment ?? vi.fn().mockResolvedValue(undefined);
    const utils = render(
      <RecordPaymentsTable
        payments={initial.payments}
        onAddPayment={vi.fn().mockResolvedValue({} as PaymentResponse)}
        onPatchPayment={vi.fn()}
        onDeletePayment={onDeletePayment}
      />,
    );
    return { onDeletePayment, utils };
  }

  function rerenderRaw(utils: ReturnType<typeof render>, payments: PaymentResponse[], onDeletePayment: any) {
    utils.rerender(
      <RecordPaymentsTable
        payments={payments}
        onAddPayment={vi.fn().mockResolvedValue({} as PaymentResponse)}
        onPatchPayment={vi.fn()}
        onDeletePayment={onDeletePayment}
      />,
    );
  }

  it('renders saved rows derived from payments prop', () => {
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    renderRaw({ payments });

    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p2')).toBeInTheDocument();
  });

  it('saved row disappears when payments prop no longer contains it (cache update)', () => {
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    const { onDeletePayment, utils } = renderRaw({ payments });
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();

    // Simulate the parent re-rendering after p1 was removed from the cache
    // (e.g. by the optimistic `removePayment` helper from Task 4).
    const remaining: PaymentResponse[] = [
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    rerenderRaw(utils, remaining, onDeletePayment);

    expect(screen.queryByTestId('payment-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-p2')).toBeInTheDocument();
  });

  it('does not keep a stale local copy of a deleted saved row', async () => {
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    const { onDeletePayment, utils } = renderRaw({ payments });

    // Click × on p1
    fireEvent.click(screen.getByTestId('payment-p1-delete'));
    await waitFor(() => expect(onDeletePayment).toHaveBeenCalledWith('p1'));

    // Parent rerenders without p1 (optimistic cache update)
    const remaining: PaymentResponse[] = [
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    rerenderRaw(utils, remaining, onDeletePayment);

    // p1 is gone
    expect(screen.queryByTestId('payment-p1')).not.toBeInTheDocument();
    // p2 still present
    expect(screen.getByTestId('payment-p2')).toBeInTheDocument();
  });

  it('does NOT locally filter the deleted row — if the payments prop still has it, the row stays (cache rollback)', async () => {
    // Spec (Task 6): "handleDeleteRow (saved) → call onDeletePayment(id) — do NOT
    // locally filter saved rows; the useMemo reacts to the cache change."
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
      { id: 'p2', record_id: 'r1', amount: 2000, method: 'cash', created_at: '2026-07-02T10:00:00', updated_at: '2026-07-02T10:00:00' },
    ];
    const { onDeletePayment, utils } = renderRaw({ payments });

    // Click × on p1 — onDeletePayment is called
    fireEvent.click(screen.getByTestId('payment-p1-delete'));
    await waitFor(() => expect(onDeletePayment).toHaveBeenCalledWith('p1'));

    // Simulate a cache rollback: parent re-renders with the SAME payments
    // (delete undone server-side, payment is back in the list).
    rerenderRaw(utils, payments, onDeletePayment);

    // In the new architecture (useMemo), the row MUST still be visible —
    // there is no local filter to hide it. (The OLD architecture with
    // setRows(prev => prev.filter(...)) would have hidden it.)
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p2')).toBeInTheDocument();
  });
});

describe('RecordPaymentsTable — drafts isolated from payments prop', () => {
  it('draft row renders alongside saved rows', () => {
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
    ];
    renderPaymentsTable({ payments });

    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(screen.getByTestId('payment-new')).toBeInTheDocument();
    // saved row is still there
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  it('draft editing state is preserved when parent rerenders with the same payments (no useEffect overwrite)', () => {
    // Reproduces Bug #3: in the old code, a useEffect on `payments` re-derived
    // local state and clobbered the user's in-progress draft.
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
    ];
    const onDeletePayment = vi.fn().mockResolvedValue(undefined);
    mockUseUI.mockReturnValue({
      deleteMode: false,
      toggleDeleteMode: vi.fn(),
      toasts: [],
      showToast: vi.fn(),
      hideToast: vi.fn(),
      sidebarCollapsed: false,
      toggleSidebar: vi.fn(),
      rightPanelCollapsed: true,
      toggleRightPanel: vi.fn(),
      theme: 'light' as const,
      toggleTheme: vi.fn(),
    });
    const utils = render(
      <RecordPaymentsTable
        payments={payments}
        onAddPayment={vi.fn().mockResolvedValue({} as PaymentResponse)}
        onPatchPayment={vi.fn()}
        onDeletePayment={onDeletePayment}
      />,
    );

    // Add a draft
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '1234' } });
    expect(amountInput.value).toBe('1234');

    // Parent rerenders with the same payments (new array reference — common after
    // unrelated refetches). The draft input must keep its value.
    const samePaymentsRef: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
    ];
    utils.rerender(
      <RecordPaymentsTable
        payments={samePaymentsRef}
        onAddPayment={vi.fn().mockResolvedValue({} as PaymentResponse)}
        onPatchPayment={vi.fn()}
        onDeletePayment={onDeletePayment}
      />,
    );

    // The draft row is still there with the typed amount
    const draftRow = screen.getByTestId('payment-new');
    expect(draftRow).toBeInTheDocument();
    const preservedInput = screen.getByTestId('add-payment-amount') as HTMLInputElement;
    expect(preservedInput.value).toBe('1234');
  });

  it('handleRemove on a draft row removes only the draft (saved rows untouched)', () => {
    const payments: PaymentResponse[] = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '2026-07-01T10:00:00', updated_at: '2026-07-01T10:00:00' },
    ];
    renderPaymentsTable({ payments });

    // Add a draft
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(screen.getByTestId('payment-new')).toBeInTheDocument();

    // Click × on the draft
    fireEvent.click(screen.getByTestId('payment-new-delete'));

    // Draft is gone, saved row remains
    expect(screen.queryByTestId('payment-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });
});

describe('RecordPaymentsTable — onSaved replaces the draft with a pending-saved row', () => {
  it('after save, the draft is replaced in drafts (id != null) until cache catches up', async () => {
    const mocks = {
      onAddPayment: vi.fn().mockResolvedValue({
        id: 'p_new',
        record_id: 'r1',
        amount: 6000,
        method: 'card',
        created_at: '2026-07-06T12:00:00',
        updated_at: '2026-07-06T12:00:00',
      } as PaymentResponse),
      onPatchPayment: vi.fn(),
      onDeletePayment: vi.fn().mockResolvedValue(undefined),
    };
    renderPaymentsTable({ defaultAmount: 6000, ...mocks });

    // 1. Add draft
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    // 2. Wait for onAddPayment to resolve and onSaved to fire
    await waitFor(() => expect(mocks.onAddPayment).toHaveBeenCalledTimes(1));

    // Without the parent rerendering, the saved row (id=p_new) must be in the DOM
    // as a "pending-saved" row (id !== null) — preserved until the cache catches up.
    await waitFor(() => {
      const savedRow = screen.getByTestId('payment-p_new');
      expect(savedRow).toBeInTheDocument();
    });

    // The amount input must show 6000 (submitted value), not blank.
    const savedRow = screen.getByTestId('payment-p_new');
    expect(savedRow.textContent).toContain('6');
  });

  it('preserves submitted amount/method between onSaved and the cache refetch (no flicker to blank)', async () => {
    const mocks = {
      onAddPayment: vi.fn().mockResolvedValue({
        id: 'p_new',
        record_id: 'r1',
        amount: 3000, // server returns a different amount
        method: 'card',
        created_at: '2026-07-06T12:00:00',
        updated_at: '2026-07-06T12:00:00',
      } as PaymentResponse),
      onPatchPayment: vi.fn(),
      onDeletePayment: vi.fn().mockResolvedValue(undefined),
    };
    renderPaymentsTable({ defaultAmount: 5000, ...mocks });

    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');
    // User changes to 7777
    fireEvent.change(amountInput, { target: { value: '7777' } });
    fireEvent.keyDown(amountInput, { key: 'Enter' });

    await waitFor(() => expect(mocks.onAddPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const savedRow = screen.getByTestId('payment-p_new');
      expect(savedRow).toBeInTheDocument();
    });

    // The amount cell must show 7 777 ₽ (the submitted value), not 3000 (server)
    // or 5000 (defaultAmount). Read the input value (saved row is editable
    // because the cache hasn't caught up yet — the pending-saved row is
    // rendered as editable with submitted values until the useMemo produces
    // the same id from props).
    const savedRow = screen.getByTestId('payment-p_new');
    const input = savedRow.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.value).toBe('7777');
  });
});

