'use client';

import React, { useState, useCallback } from 'react';
import type { RecordResponse, ClientResponse, VisitorResponse, PaymentResponse, TariffResponse } from '@memo/api-client';
import type { RecordStatus } from '@memo/domain';
import Link from 'next/link';

interface ClientTabProps {
  record: RecordResponse;
  client: ClientResponse | undefined;
  visitors: VisitorResponse[];
  visits: RecordResponse['visits'];
  payments: PaymentResponse[];
  serviceTariffs: TariffResponse[];
  onUpdateRecord: (id: string, data: RecordResponse) => void;
  onDeleteRecord: (id: string) => void;
  onAddPayment: (recordId: string, amount: number, method: string) => void;
  showToast: (message: string, undo?: () => void) => void;
}

const STATUS_LABELS: Record<RecordStatus, string> = {
  pending: 'Ожидает',
  confirmed: 'Подтверждена',
  cancelled: 'Отменена',
  no_show: 'Неявка',
};

export function ClientTab({
  record,
  client,
  visitors,
  payments: _payments,
  serviceTariffs,
  onUpdateRecord: _onUpdateRecord,
  onDeleteRecord,
  onAddPayment,
  showToast,
}: ClientTabProps) {
  const [name, setName] = useState(client?.name || '');
  const [status, setStatus] = useState<RecordStatus>(record.status as RecordStatus);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [isDeleting, setIsDeleting] = useState(false);

  // Calculate totals from visits
  const totalCost = record.visits.reduce((sum, v) => sum + v.price, 0);
  const totalPaid = _payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = totalCost - totalPaid;

  const handleDelete = useCallback(() => {
    setIsDeleting(true);
    showToast('Запись будет удалена через 5 секунд', () => {
      setIsDeleting(false);
    });
    setTimeout(() => {
      if (isDeleting) {
        onDeleteRecord(record.id);
      }
    }, 5000);
  }, [isDeleting, onDeleteRecord, record.id, showToast]);

  const handleAddPayment = useCallback(() => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      onAddPayment(record.id, amount, paymentMethod);
      setPaymentAmount('');
    }
  }, [paymentAmount, paymentMethod, onAddPayment, record.id]);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="client-tab">
      {/* Client info */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="client-name">
            Имя
          </label>
          <input
            id="client-name"
            type="text"
            className={inputClass}
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="client-name"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="client-phone">
            Телефон
          </label>
          <input
            id="client-phone"
            type="text"
            className={inputClass}
            style={inputStyle}
            value={client?.phone || ''}
            disabled
            data-testid="client-phone"
          />
        </div>

        {client && (
          <Link
            href={`/clients/${client.id}`}
            target="_blank"
            className="text-brand text-sm hover:underline inline-block"
            data-testid="client-link"
          >
            → /client/{client.id}
          </Link>
        )}
      </div>

      {/* Visitors */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        {visitors.length === 0 && (
          <p className="text-xs text-ink-light">Нет посетителей</p>
        )}
        {visitors.map((visitor) => (
          <div
            key={visitor.id}
            className="flex items-center gap-2 py-1.5 border-b text-sm"
            style={{ borderColor: 'var(--line)' }}
            data-testid="visitor-row"
          >
            <span className="flex-1 truncate text-ink">{visitor.name}</span>
            {visitor.age && <span className="text-xs text-ink-light">{visitor.age} лет</span>}
          </div>
        ))}
        <button className="mt-2 text-brand text-xs hover:underline" data-testid="btn-add-visitor">+ Добавить посетителя</button>
      </div>

      {/* Status */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-status">
          Статус записи
        </label>
        <select
          id="record-status"
          className={inputClass}
          style={inputStyle}
          value={status}
          onChange={(e) => setStatus(e.target.value as RecordStatus)}
          data-testid="select-record-status"
        >
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Payment summary */}
      <div className="space-y-2" data-testid="payment-summary">
        <h4 className="text-xs font-medium text-ink-mid">Оплата</h4>
        <div className="flex justify-between text-sm">
          <span className="text-ink-mid">Стоимость:</span>
          <span className="text-ink font-medium">{totalCost.toLocaleString('ru-RU')} ₽</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-ink-mid">Оплачено:</span>
          <span className="text-ink font-medium">{totalPaid.toLocaleString('ru-RU')} ₽</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-ink-mid">Остаток:</span>
          <span
            className="font-medium"
            style={{ color: remaining > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}
          >
            {remaining.toLocaleString('ru-RU')} ₽
          </span>
        </div>

        {/* Tariffs for display */}
        {serviceTariffs.length > 0 && (
          <div className="mt-2 space-y-1">
            {serviceTariffs.map((tariff) => (
              <div key={tariff.id} className="flex items-center justify-between text-xs px-2 py-1 bg-surface rounded">
                <span className="text-ink-light">{tariff.title}</span>
                <span className="text-ink">{tariff.price.toLocaleString('ru-RU')} ₽</span>
              </div>
            ))}
          </div>
        )}

        {/* Add payment form */}
        <div className="flex gap-2 mt-2">
          <input
            type="number"
            placeholder="Сумма"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
          />
          <select
            className="rounded-lg border px-2 py-2 text-sm"
            style={inputStyle}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="card">Карта</option>
            <option value="cash">Наличные</option>
            <option value="transfer">Перевод</option>
          </select>
          <button
            onClick={handleAddPayment}
            className="px-3 py-2 text-sm text-white rounded-lg shrink-0"
            style={{ backgroundColor: 'var(--brand, #004D56)' }}
            data-testid="btn-add-payment"
          >
            Добавить оплату
          </button>
        </div>
      </div>

      {/* Delete button */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={handleDelete}
          className="text-sm text-red-500 hover:text-red-600 transition-colors"
          data-testid="btn-delete-record"
        >
          Удалить запись
        </button>
      </div>
    </div>
  );
}
