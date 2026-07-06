'use client';

import { useState, useCallback, useEffect } from 'react';
import type { PaymentResponse } from '@memo/api-client';
import { RecordTable, type Column } from '@/app/components/shared/record/RecordTable';
import { InlineEditCell } from '../InlineEditCell';
import { InlineEditRow } from '../InlineEditRow';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentRow {
  id: string | null;
  /** Transient UUID for React key. Stripped before API send. */
  clientId: string;
  amount: number;
  method: string;
  created_at: string;
}

interface PaymentFormState {
  amount: number;
  method: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function transientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tid-${++_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function paymentResponseToRow(payment: PaymentResponse): PaymentRow {
  return {
    id: payment.id,
    clientId: transientId(),
    amount: payment.amount,
    method: payment.method ?? 'card',
    created_at: payment.created_at,
  };
}

function makeEmptyPaymentRow(defaultAmount: number = 0): PaymentRow {
  return {
    id: null,
    clientId: transientId(),
    amount: defaultAmount > 0 ? defaultAmount : 0,
    method: 'card',
    created_at: '',
  };
}

function pickFormData(row: PaymentRow): PaymentFormState {
  return {
    amount: row.amount,
    method: row.method,
  };
}

// ── Column definitions ────────────────────────────────────────────────────────

const PAYMENT_COLUMNS: Column[] = [
  { key: 'date', label: 'Дата', width: 'w-[168px] shrink-0' },
  { key: 'method', label: 'Метод', width: 'w-36 shrink-0', align: 'center' },
  { key: 'amount', label: 'Сумма', width: 'w-20 shrink-0', align: 'right' },
];

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'transfer', label: 'Перевод' },
  { value: 'online', label: 'Онлайн' },
];

const METHOD_LABELS: Record<string, string> = Object.fromEntries(
  METHOD_OPTIONS.map((o) => [o.value, o.label]),
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RecordPaymentsTableProps {
  payments: PaymentResponse[];
  isReadOnly?: boolean;
  /** Pre-fill amount when opening the add form (e.g. "К оплате" from RecordSummary) */
  defaultAmount?: number;
  /** POST new payment. Returns saved PaymentResponse. */
  onAddPayment: (amount: number, method: string) => Promise<PaymentResponse>;
  /** PATCH existing payment. Returns updated PaymentResponse. */
  onPatchPayment: (paymentId: string, data: { amount?: number; method?: string }) => Promise<PaymentResponse>;
  /** DELETE existing payment. */
  onDeletePayment: (paymentId: string) => Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordPaymentsTable({
  payments,
  isReadOnly,
  defaultAmount = 0,
  onAddPayment,
  onPatchPayment,
  onDeletePayment,
}: RecordPaymentsTableProps) {
  const [rows, setRows] = useState<PaymentRow[]>(() =>
    payments.map(paymentResponseToRow),
  );

  // Re-sync rows when payments changes (after invalidation/refetch).
  // Preserves new rows (id === null).
  useEffect(() => {
    setRows((prevRows) => {
      const newRows = prevRows.filter((r) => r.id === null);
      const updatedExisting = payments.map((payment) => {
        const existing = prevRows.find((r) => r.id === payment.id);
        if (existing) {
          return {
            ...existing,
            amount: payment.amount,
            method: payment.method ?? existing.method,
            created_at: payment.created_at,
          };
        }
        return paymentResponseToRow(payment);
      });
      return [...updatedExisting, ...newRows];
    });
  }, [payments]);

  // ── Row mutations ─────────────────────────────────────────────────────────

  const handleAddClick = useCallback(() => {
    setRows((prev) => [...prev, makeEmptyPaymentRow(defaultAmount)]);
  }, [defaultAmount]);

  /** Remove a new (unsaved) row from the array — no API call. */
  const handleRemove = useCallback((row: PaymentRow) => {
    setRows((prev) => prev.filter((r) => r !== row));
  }, []);

  /** DELETE a saved payment via API, then remove from array. */
  const handleDeleteRow = useCallback(async (id: string) => {
    await onDeletePayment(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, [onDeletePayment]);

  /** POST a new payment. Returns saved row. */
  const handleAdd = useCallback(async (data: PaymentFormState): Promise<PaymentRow> => {
    const saved = await onAddPayment(data.amount, data.method);
    return paymentResponseToRow(saved);
  }, [onAddPayment]);

  /** PATCH an existing payment. Returns updated row. */
  const handleUpdate = useCallback(async (id: string, data: PaymentFormState): Promise<PaymentRow> => {
    const updated = await onPatchPayment(id, { amount: data.amount, method: data.method });
    return paymentResponseToRow(updated);
  }, [onPatchPayment]);

  /** Replace a row in the array by its clientId (used after onAdd resolves). */
  const replaceRowByClientId = useCallback((rowClientId: string, savedRow: PaymentRow) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clientId === rowClientId ? { ...savedRow, clientId: r.clientId } : r,
      ),
    );
  }, []);

  /** Replace a row in the array by its id (used after onPatchPayment resolves). */
  const replaceRowById = useCallback((id: string, updatedRow: PaymentRow) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...updatedRow, clientId: r.clientId } : r)),
    );
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const totalPaid = rows
    .filter((r) => r.id !== null)
    .reduce((sum, r) => sum + r.amount, 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="record-payments-table">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-ink-mid">Оплаты</h4>
      </div>

      {/* Table */}
      <RecordTable testId="record-payments-table-table">
        {rows.length > 0 && <RecordTable.Header columns={PAYMENT_COLUMNS} isReadOnly={isReadOnly} />}

        {rows.map((row) => (
          <InlineEditRow<PaymentRow, PaymentFormState>
            key={row.id ?? row.clientId}
            row={row}
            testIdPrefix="payment"
            columns={PAYMENT_COLUMNS}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onDelete={handleDeleteRow}
            onRemove={handleRemove}
            emptyData={() => pickFormData(makeEmptyPaymentRow(defaultAmount))}
            pickFormData={pickFormData}
            isReadOnly={isReadOnly}
            renderCell={({ row: r, formState, isNew, handleChange }) => {
              return {
                date: (
                  <span className="whitespace-nowrap text-ink-mid">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                      : ''}
                  </span>
                ),

                method: isReadOnly ? (
                  <span className="text-ink-mid">{METHOD_LABELS[formState.method] ?? formState.method ?? '—'}</span>
                ) : (
                  <select
                    value={formState.method}
                    onChange={(e) => {
                      const method = e.target.value;
                      if (isNew) {
                        handleChange('method', method);
                      } else {
                        onPatchPayment(r.id!, { method }).then((updated) => {
                          replaceRowById(r.id!, paymentResponseToRow(updated));
                        });
                      }
                    }}
                    className="w-full rounded border px-2 py-0.5 text-sm bg-white text-center"
                    style={{ borderColor: 'var(--line)' }}
                    data-testid={isNew ? 'add-payment-method' : undefined}
                  >
                    {METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ),

                amount: isReadOnly ? (
                  <span className="font-medium text-ink">
                    {formState.amount.toLocaleString('ru-RU')} ₽
                  </span>
                ) : (
                  <InlineEditCell
                    type="number"
                    value={String(formState.amount)}
                    onCommit={(v) => {
                      const amount = Number(v) || 0;
                      if (isNew) {
                        handleChange('amount', amount);
                        // Trigger save for new rows on amount commit
                        const data: PaymentFormState = { ...formState, amount };
                        handleAdd(data).then((savedRow) => {
                          replaceRowByClientId(r.clientId, savedRow);
                        });
                      } else {
                        onPatchPayment(r.id!, { amount }).then((updated) => {
                          replaceRowById(r.id!, paymentResponseToRow(updated));
                        });
                      }
                    }}
                    className="text-right"
                    placeholder="0"
                    autoFocus={isNew}
                    data-testid={isNew ? 'add-payment-amount' : undefined}
                  />
                ),
              };
            }}
          />
        ))}

        {rows.length === 0 && (
          <RecordTable.EmptyState testId="payment-list-empty">
            Нет платежей
          </RecordTable.EmptyState>
        )}

        {!isReadOnly && (
          <RecordTable.TotalsRow
            testId="payments-total"
            columns={PAYMENT_COLUMNS}
            cells={{
              date: (
                <button
                  onClick={handleAddClick}
                  className="text-xs text-brand hover:underline transition-colors"
                  data-testid="btn-add-payment"
                >
                  + Добавить
                </button>
              ),
              method: <span className="text-sm text-ink-mid text-right block">Итого</span>,
              amount: <span className="text-sm font-semibold text-ink">{totalPaid.toLocaleString('ru-RU')} ₽</span>,
            }}
          />
        )}
      </RecordTable>
    </div>
  );
}
