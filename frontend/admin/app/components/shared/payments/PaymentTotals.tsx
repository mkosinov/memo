export interface PaymentTotalsProps {
  total: number;
  paid: number;
  className?: string;
}

export function PaymentTotals({ total, paid, className = '' }: PaymentTotalsProps) {
  const remaining = total - paid;
  return (
    <dl className={`flex gap-4 text-sm ${className}`} data-testid="payment-totals">
      <div>
        <dt className="text-xs text-gray-500">Стоимость</dt>
        <dd className="font-medium">{total.toLocaleString('ru-RU')} ₽</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-500">Оплачено</dt>
        <dd className="font-medium text-emerald-600">{paid.toLocaleString('ru-RU')} ₽</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-500">К оплате</dt>
        <dd className={`font-medium ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {remaining.toLocaleString('ru-RU')} ₽
        </dd>
      </div>
    </dl>
  );
}
