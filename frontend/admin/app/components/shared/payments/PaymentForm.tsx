'use client';

import { useState } from 'react';

export interface PaymentFormValues {
  amount: number;
  method: 'cash' | 'card' | 'transfer';
}

export interface PaymentFormProps {
  total: number;
  paid: number;
  isReadOnly?: boolean;
  onSubmit: (payment: PaymentFormValues) => void;
  onCancel?: () => void;
}

export function PaymentForm({ total, paid, isReadOnly, onSubmit, onCancel }: PaymentFormProps) {
  const defaultAmount = Math.max(0, total - paid);
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [method, setMethod] = useState<PaymentFormValues['method']>('card');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Сумма должна быть больше 0');
      return;
    }
    if (!method) {
      setError('Выберите способ оплаты');
      return;
    }
    setError(null);
    onSubmit({ amount, method });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 text-sm" data-testid="payment-form">
      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        disabled={isReadOnly}
        className="w-20 rounded border px-2 py-1"
        data-testid="payment-amount"
      />
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentFormValues['method'])}
        disabled={isReadOnly}
        className="rounded border px-2 py-1"
        data-testid="payment-method"
      >
        <option value="cash">Наличные</option>
        <option value="card">Карта</option>
        <option value="transfer">Перевод</option>
        <option value="online">Онлайн</option>
      </select>
      <button
        type="submit"
        disabled={isReadOnly}
        className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700"
        data-testid="payment-submit"
      >
        Добавить
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-gray-600 hover:text-gray-800"
        >
          Отмена
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
