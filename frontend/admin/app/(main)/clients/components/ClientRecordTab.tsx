'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRecord, updateRecord, deleteRecord, createPayment, getClientVisitors } from '@memo/api-client';
import type { RecordStatus } from '@memo/domain';

interface ClientRecordTabProps {
  recordId: string;
  clientId: string;
  onClose: () => void;
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

export function ClientRecordTab({ recordId, clientId, onClose }: ClientRecordTabProps) {
  const queryClient = useQueryClient();
  const { data: record, isLoading } = useQuery({
    queryKey: ['record', recordId],
    queryFn: () => getRecord(recordId),
  });

  const { data: visitors = [] } = useQuery({
    queryKey: ['visitors', clientId],
    queryFn: () => getClientVisitors(clientId),
    enabled: !!clientId,
  });

  const visitorsMap = useMemo(() => {
    const map = new Map<string, { name: string; age: number | null }>();
    if (Array.isArray(visitors)) {
      visitors.forEach(v => map.set(v.id, { name: v.name, age: v.age }));
    }
    return map;
  }, [visitors]);

  const [status, setStatus] = useState<RecordStatus>('pending');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');

  useEffect(() => {
    if (record) setStatus(record.status as RecordStatus);
  }, [record]);

  const handleStatusChange = useCallback(async (newStatus: RecordStatus) => {
    setStatus(newStatus);
    if (record) {
      await updateRecord(recordId, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['records'] });
    }
  }, [recordId, record, queryClient]);

  const handleAddPayment = useCallback(async () => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      await createPayment({ record_id: recordId, amount, method: paymentMethod as 'card' | 'cash' | 'transfer' });
      setPaymentAmount('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    }
  }, [recordId, paymentAmount, paymentMethod, queryClient]);

  const handleDelete = useCallback(async () => {
    await deleteRecord(recordId);
    onClose();
    queryClient.invalidateQueries({ queryKey: ['records'] });
  }, [recordId, onClose, queryClient]);

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const totalCost = record.visits.reduce((sum, v) => sum + v.price, 0);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">
      {/* Event info group */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Мероприятие</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-status">
              Статус
            </label>
            <div className="relative">
              <select
                id="record-status"
                className={`${inputClass} appearance-none pr-8`}
                style={inputStyle}
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as RecordStatus)}
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
      </div>

      {/* Visitors */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        {record.visits.length === 0 && (
          <p className="text-xs text-ink-light">Нет посетителей</p>
        )}
        {record.visits.map((visit) => {
          const visitor = visitorsMap.get(visit.visitor_id);
          return (
            <div
              key={visit.id}
              className="flex items-center gap-2 py-1.5 border-b text-sm"
              style={{ borderColor: 'var(--line)' }}
              data-testid="visit-row"
            >
              <span className="flex-1 truncate text-ink">
                {visitor?.name ?? 'Неизвестный'}
                {visitor?.age && <span className="text-xs text-ink-light ml-1">({visitor.age} лет)</span>}
              </span>
              <span className="text-xs text-ink-light">{visit.status === 'visited' ? 'Пришла' : visit.status === 'missed' ? 'Пропущена' : visit.status}</span>
              <span className="text-sm">{visit.price.toLocaleString('ru-RU')} ₽</span>
            </div>
          );
        })}
      </div>

      {/* Payment summary */}
      <div className="space-y-2" data-testid="payment-summary">
        <h4 className="text-xs font-medium text-ink-mid">Оплата</h4>
        <div className="flex justify-between text-sm">
          <span className="text-ink-mid">Итого:</span>
          <span className="text-ink font-medium">{totalCost.toLocaleString('ru-RU')} ₽</span>
        </div>

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
            Добавить
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
