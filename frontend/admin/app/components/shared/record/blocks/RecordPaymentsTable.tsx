'use client';

import { useCallback, useState } from 'react';
import type { PaymentResponse } from '@memo/api-client';
import { RecordTable, type Column } from '@/app/components/shared/record/RecordTable';

// ── Column definitions ────────────────────────────────────────────────────────

const PAYMENT_COLUMNS: Column[] = [
  { key: 'date', label: 'Дата', width: 'w-[168px] shrink-0' },
  { key: 'method', label: 'Метод', width: 'w-36 shrink-0', align: 'center' },
  { key: 'amount', label: 'Сумма', width: 'w-20 shrink-0', align: 'right' },
];

const METHOD_LABELS: Record<string, string> = {
  card: 'Карта',
  cash: 'Наличные',
  transfer: 'Перевод',
  online: 'Онлайн',
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RecordPaymentsTableProps {
  payments: PaymentResponse[];
  isReadOnly?: boolean;
  /** Pre-fill amount when opening the add form (e.g. "К оплате" from RecordSummary) */
  defaultAmount?: number;
  onDelete: (paymentId: string) => void;
  onAdd: (payment: { amount: number; method: string; date?: string }) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordPaymentsTable({
  payments,
  isReadOnly,
  defaultAmount = 0,
  onDelete,
  onAdd,
}: RecordPaymentsTableProps) {
  const [showForm, setShowForm] = useState(false);

  // Inline add-row state (when showForm is true)
  const [newAmount, setNewAmount] = useState(0);
  const [newMethod, setNewMethod] = useState('card');
  const [newPayDate, setNewPayDate] = useState(new Date().toISOString().slice(0, 16));

  const resetNewPayment = useCallback(() => {
    setNewAmount(0);
    setNewMethod('card');
    setNewPayDate(new Date().toISOString().slice(0, 16));
  }, []);

  const handleSubmitPaymentInline = useCallback(() => {
    if (newAmount <= 0) return;
    onAdd({ amount: newAmount, method: newMethod, date: newPayDate });
    setShowForm(false);
    resetNewPayment();
  }, [newAmount, newMethod, newPayDate, onAdd, resetNewPayment]);

  const handleCancelAddPayment = useCallback(() => {
    setShowForm(false);
    resetNewPayment();
  }, [resetNewPayment]);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div data-testid="record-payments-table">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-ink-mid">Оплаты</h4>
      </div>

      {/* Payment table */}
      <RecordTable testId="record-payments-table-table">
        {(payments.length > 0 || showForm) && <RecordTable.Header columns={PAYMENT_COLUMNS} isReadOnly={isReadOnly} />}

        {payments.map((p) => (
          <RecordTable.Row
            key={p.id}
            columns={PAYMENT_COLUMNS}
            testId={`payment-${p.id}`}
            cells={{
              date: (
                <span className="whitespace-nowrap text-ink-mid">
                  {new Date(p.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              ),
              amount: <span className="font-medium text-ink">{p.amount.toLocaleString('ru-RU')} ₽</span>,
              method: <span className="text-ink-mid">{METHOD_LABELS[p.method ?? ''] ?? p.method ?? '—'}</span>,
              __actions: !isReadOnly ? (
                <button
                  onClick={() => onDelete(p.id)}
                  className="text-red-500 hover:text-red-600"
                  aria-label="Удалить платёж"
                  data-testid={`payment-${p.id}-delete`}
                >
                  ×
                </button>
              ) : null,
            }}
          />
        ))}

        {payments.length === 0 && !showForm && (
          <RecordTable.EmptyState testId="payment-list-empty">
            Нет платежей
          </RecordTable.EmptyState>
        )}

        {!isReadOnly && showForm && (
          <RecordTable.Row
            testId="add-payment-row"
            columns={PAYMENT_COLUMNS}
            cells={{
              date: (
                <input
                  type="datetime-local"
                  value={newPayDate}
                  onChange={(e) => setNewPayDate(e.target.value)}
                  step="60"
                  autoFocus
                  className="w-full rounded border px-2 py-0.5 text-sm bg-white"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-payment-date"
                />
              ),
              method: (
                <select
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value)}
                  className="w-full rounded border px-2 py-0.5 text-sm bg-white text-center"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-payment-method"
                >
                  <option value="cash">Наличные</option>
                  <option value="card">Карта</option>
                  <option value="transfer">Перевод</option>
                  <option value="online">Онлайн</option>
                </select>
              ),
              amount: (
                <input
                  type="number"
                  min={1}
                  value={newAmount || ''}
                  onChange={(e) => setNewAmount(Number(e.target.value) || 0)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmitPaymentInline();
                    }
                  }}
                  className="w-full rounded border px-2 py-0.5 text-sm text-right"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-payment-amount"
                />
              ),
              __actions: (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSubmitPaymentInline}
                    className="text-green-600 hover:text-green-700"
                    aria-label="Добавить"
                    data-testid="add-payment-submit"
                    title="Добавить"
                  >
                    ✓
                  </button>
                  <button
                    onClick={handleCancelAddPayment}
                    className="text-red-500 hover:text-red-600"
                    aria-label="Отменить"
                    data-testid="add-payment-cancel"
                  >
                    ×
                  </button>
                </div>
              ),
            }}
          />
        )}

        {!isReadOnly && (
          <RecordTable.TotalsRow
            testId="payments-total"
            columns={PAYMENT_COLUMNS}
            cells={{
              date: !showForm ? (
                <button
                  onClick={() => {
                    resetNewPayment();
                    // Pre-fill amount with "К оплате" (defaultAmount from parent)
                    if (defaultAmount > 0) {
                      setNewAmount(defaultAmount);
                    }
                    setShowForm(true);
                  }}
                  className="text-xs text-brand hover:underline transition-colors"
                  data-testid="btn-add-payment"
                >
                  + Добавить
                </button>
              ) : null,
              method: <span className="text-sm text-ink-mid text-right block">Итого</span>,
              amount: <span className="text-sm font-semibold text-ink">{totalPaid.toLocaleString('ru-RU')} ₽</span>,
            }}
          />
        )}
      </RecordTable>
    </div>
  );
}
