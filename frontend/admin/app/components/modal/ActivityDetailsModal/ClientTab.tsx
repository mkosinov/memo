'use client';

import React, { useState, useCallback, useRef } from 'react';
import type { RecordResponse, ClientResponse, VisitorResponse, PaymentResponse, TariffResponse } from '@memo/api-client';
import type { RecordStatus } from '@memo/domain';
import { updateVisitStatus } from '@memo/api-client';
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

const STATUS_CONFIG: Record<RecordStatus, { label: string; color: string }> = {
  pending: { label: 'Ожидает', color: '#F59E0B' },
  confirmed: { label: 'Подтверждена', color: '#10B981' },
  cancelled: { label: 'Отменена', color: '#EF4444' },
  no_show: { label: 'Неявка', color: '#6B7280' },
};

function StatusIcon({ status }: { status: RecordStatus }) {
  const iconClass = 'w-3.5 h-3.5';
  switch (status) {
    case 'pending':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'confirmed':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'no_show':
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
  }
}

const VISIT_STATUS_LABELS: Record<string, string> = {
  waiting: 'Ожидает',
  visited: 'Посещено',
  missed: 'Неявка',
  cancelled: 'Отменено',
};

export function ClientTab({
  record,
  client,
  visitors,
  payments,
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
  const isDeletingRef = useRef(false);

  // Calculate totals from visits
  const totalCost = record.visits.reduce((sum, v) => sum + v.price, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = totalCost - totalPaid;

  const handleDelete = useCallback(() => {
    isDeletingRef.current = true;
    showToast('Запись удалена через 5 секунд', () => {
      isDeletingRef.current = false;
    });
    setTimeout(() => {
      if (isDeletingRef.current) {
        onDeleteRecord(record.id);
      }
    }, 5000);
  }, [onDeleteRecord, record.id, showToast]);

  const handleAddPayment = useCallback(() => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      onAddPayment(record.id, amount, paymentMethod);
      setPaymentAmount('');
    }
  }, [paymentAmount, paymentMethod, onAddPayment, record.id]);

  const handleDeletePayment = useCallback(async (paymentId: string) => {
    try {
      const { deletePayment } = await import('@memo/api-client');
      await deletePayment(paymentId);
      showToast('Оплата удалена');
    } catch {
      showToast('Ошибка удаления оплаты');
    }
  }, [showToast]);

  const handleVisitStatusChange = useCallback(async (visitId: string, newStatus: string) => {
    try {
      await updateVisitStatus(visitId, newStatus);
      showToast('Статус визита обновлён');
    } catch {
      showToast('Ошибка обновления статуса');
    }
  }, [showToast]);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="client-tab">
      {/* Row 1: Phone + Name + Status */}
      <div className="flex gap-3 items-end" data-testid="client-info-row">
        <div className="flex-1">
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
        <div className="flex-1">
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
        <div className="w-40">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-status">
            Статус
          </label>
          <div className="relative">
            <select
              id="record-status"
              className={`${inputClass} appearance-none pr-8`}
              style={inputStyle}
              value={status}
              onChange={(e) => setStatus(e.target.value as RecordStatus)}
              data-testid="select-record-status"
            >
              {(Object.entries(STATUS_CONFIG) as [RecordStatus, { label: string; color: string }][]).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: STATUS_CONFIG[status]?.color }}>
              <StatusIcon status={status} />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Client link */}
      {client && (
        <div>
          <Link
            href={`/clients/${client.id}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-brand text-xs hover:underline"
            data-testid="client-link"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Открыть профиль
          </Link>
        </div>
      )}

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

      {/* Visit statuses */}
      {record.visits.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-ink-mid mb-2">Статусы визитов</h4>
          {record.visits.map((visit) => (
            <div key={visit.id} className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-ink-light flex-1 truncate">
                {visitors.find((v) => v.id === visit.visitor_id)?.name || visit.visitor_id}
              </span>
              <select
                className="text-xs rounded border px-2 py-1"
                style={inputStyle}
                value={visit.status}
                onChange={(e) => handleVisitStatusChange(visit.id, e.target.value)}
                aria-label="Статус визита"
              >
                {Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

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

        {/* Existing payments with delete button */}
        {payments.length > 0 && (
          <div className="mt-2 space-y-1">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs px-2 py-1 bg-surface rounded">
                <span className="text-ink-mid">{p.amount.toLocaleString('ru-RU')} ₽ ({p.method || '—'})</span>
                <button
                  onClick={() => handleDeletePayment(p.id)}
                  className="text-red-400 hover:text-red-500 ml-2 shrink-0"
                  aria-label="Удалить оплату"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

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
