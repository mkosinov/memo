'use client';

import { useState } from 'react';
import type { PaymentResponse } from '@memo/api-client';
import { RecordTable, type Column } from '@/app/components/shared/record/RecordTable';

// ── Column definitions ────────────────────────────────────────────────────────

const PAYMENT_COLUMNS: Column[] = [
  { key: 'date', label: 'Дата', width: 'w-32 shrink-0' },
  { key: 'amount', label: 'Сумма', width: 'flex-1', align: 'right' },
  { key: 'method', label: 'Метод', width: 'w-24 shrink-0' },
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
  onDelete: (paymentId: string) => void;
  onAdd: (payment: { amount: number; method: string; date?: string }) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordPaymentsTable({
  payments,
  isReadOnly,
  onDelete,
  onAdd,
}: RecordPaymentsTableProps) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('card');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 16));
  const [showForm, setShowForm] = useState(false);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;
    onAdd({ amount, method, date: payDate });
    setAmount(0);
    setPayDate(new Date().toISOString().slice(0, 16));
    setShowForm(false);
  };

  return (
    <div data-testid="record-payments-table">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-ink-mid">Оплаты</h4>
      </div>

      {/* Payment table */}
      <RecordTable testId="record-payments-table-table">
        {payments.length > 0 && <RecordTable.Header columns={PAYMENT_COLUMNS} isReadOnly={isReadOnly} />}

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

        {payments.length > 0 && (
          <RecordTable.TotalsRow
            testId="payments-total"
            columns={PAYMENT_COLUMNS}
            cells={{
              method: <span className="text-sm text-ink-mid">Итого:</span>,
              amount: <span className="text-sm font-semibold text-ink">{totalPaid.toLocaleString('ru-RU')} ₽</span>,
            }}
          />
        )}

        {!isReadOnly && (
          <RecordTable.AddRow testId="btn-add-payment-wrapper">
            {showForm ? (
              <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid="payment-form">
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-20 rounded border px-2 py-1"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="payment-amount"
                />
                <span className="text-ink-mid">₽</span>
                <input
                  type="datetime-local"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  step="60"
                  className="w-40 rounded border px-2 py-1 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="payment-date"
                />
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="rounded border px-2 py-1"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="payment-method"
                >
                  <option value="cash">Наличные</option>
                  <option value="card">Карта</option>
                  <option value="transfer">Перевод</option>
                  <option value="online">Онлайн</option>
                </select>
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700"
                  data-testid="payment-submit"
                >
                  Добавить
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-sm text-ink-mid hover:text-ink"
                >
                  Отмена
                </button>
              </form>
            ) : (
              <div className="px-3 py-2">
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand border border-brand/30 rounded px-2.5 py-1 hover:bg-brand/5 transition-colors"
                  data-testid="btn-add-payment"
                >
                  <span className="text-brand">+</span> Добавить оплату
                </button>
              </div>
            )}
          </RecordTable.AddRow>
        )}
      </RecordTable>
    </div>
  );
}
