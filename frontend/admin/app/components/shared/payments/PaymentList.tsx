'use client';

import type { PaymentResponse } from '@memo/api-client';

export interface PaymentListProps {
  payments: PaymentResponse[];
  isReadOnly?: boolean;
  onDelete: (paymentId: string) => void;
}

const METHOD_LABELS: Record<string, string> = {
  card: 'карта',
  cash: 'наличные',
  transfer: 'перевод',
};

export function PaymentList({ payments, isReadOnly, onDelete }: PaymentListProps) {
  if (payments.length === 0) {
    return (
      <p className="text-xs italic text-gray-500" data-testid="payment-list-empty">
        Нет платежей
      </p>
    );
  }

  return (
    <ul className="space-y-1" data-testid="payment-list">
      {payments.map((p) => (
        <li
          key={p.id}
          className="flex items-center justify-between gap-2 text-sm"
          data-testid={`payment-${p.id}`}
        >
          <span>
            {p.amount.toLocaleString('ru-RU')} ₽ · {METHOD_LABELS[p.method ?? ''] ?? p.method ?? '—'} ·{' '}
            {new Date(p.created_at).toLocaleDateString('ru-RU')}
          </span>
          {!isReadOnly && (
            <button
              onClick={() => onDelete(p.id)}
              data-testid={`payment-${p.id}-delete`}
              className="text-red-600 hover:text-red-800"
              aria-label="Удалить платёж"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
