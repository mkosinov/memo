'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRecord, patchRecord, deleteRecord, createPayment, getClientVisitors, getActivity, getServices, getMasters, getLocations, getPayments, updateVisitStatus } from '@memo/api-client';
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

  const { data: activity } = useQuery({
    queryKey: ['activity', record?.activity_id],
    queryFn: () => getActivity(record!.activity_id),
    enabled: !!record?.activity_id,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => getServices(),
  });

  const { data: masters = [] } = useQuery({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', recordId],
    queryFn: () => getPayments({ record_id: recordId }),
    enabled: !!recordId,
  });

  const serviceName = useMemo(() => {
    if (!activity || !Array.isArray(services)) return null;
    const service = services.find(s => s.id === activity.service_id);
    return service?.title ?? null;
  }, [activity, services]);

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
  const [customPrice, setCustomPrice] = useState<string>('');
  const [editPrices, setEditPrices] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (record) {
      setStatus(record.status as RecordStatus);
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
    }
  }, [record]);

  const invalidateRecord = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    queryClient.invalidateQueries({ queryKey: ['records'] });
  }, [queryClient, recordId]);

  const handleStatusChange = useCallback(async (newStatus: RecordStatus) => {
    setStatus(newStatus);
    await patchRecord(recordId, { status: newStatus });
    invalidateRecord();
  }, [recordId, invalidateRecord]);

  const handleAddPayment = useCallback(async () => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      await createPayment({ record_id: recordId, amount, method: paymentMethod as 'card' | 'cash' | 'transfer' });
      setPaymentAmount('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      invalidateRecord();
    }
  }, [recordId, paymentAmount, paymentMethod, queryClient, invalidateRecord]);

  const handleDelete = useCallback(async () => {
    await deleteRecord(recordId);
    onClose();
    queryClient.invalidateQueries({ queryKey: ['records'] });
  }, [recordId, onClose, queryClient]);

  const handleCustomPriceSave = useCallback(async () => {
    if (!record) return;
    const value = customPrice.trim() === '' ? null : Number(customPrice);
    await patchRecord(recordId, { custom_price: value });
    invalidateRecord();
  }, [recordId, record, customPrice, invalidateRecord]);

  const handleVisitPriceChange = useCallback(async (visitId: string, newPrice: number) => {
    if (!record) return;
    const updatedVisits = record.visits.map(v =>
      v.id === visitId
        ? { visitor_id: v.visitor_id, price: newPrice, status: v.status }
        : { visitor_id: v.visitor_id, price: v.price, status: v.status }
    );
    await patchRecord(recordId, { visits: updatedVisits });
    setEditPrices(prev => {
      const next = { ...prev };
      delete next[visitId];
      return next;
    });
    invalidateRecord();
  }, [recordId, record, invalidateRecord]);

  const handleCommentSave = useCallback(async () => {
    if (!record) return;
    if (comment === (record.comment || '')) return;
    await patchRecord(recordId, { comment: comment || null });
    invalidateRecord();
  }, [recordId, record, comment, invalidateRecord]);

  const handleVisitStatusChange = useCallback(async (visitId: string, newStatus: string) => {
    await updateVisitStatus(visitId, newStatus);
    invalidateRecord();
  }, [invalidateRecord]);

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const totalCost = record.visits.reduce((sum, v) => sum + v.price, 0);
  const displayTotal = customPrice.trim() !== '' ? Number(customPrice) : totalCost;
  const totalPaid = Array.isArray(payments) ? payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0) : 0;
  const remaining = displayTotal - totalPaid;

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  const activityDate = activity?.start
    ? new Date(activity.start).toLocaleDateString('ru-RU')
    : '—';
  const activityTime = activity?.start
    ? new Date(activity.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">
      {/* Event info group */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Мероприятие</h4>
        {serviceName && (
          <div className="text-sm text-ink mb-2">{serviceName}</div>
        )}

        {/* Master, Activity, Location dropdowns */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-master">
              Мастер
            </label>
            <select
              id="record-master"
              className={inputClass}
              style={inputStyle}
              value={activity?.master_id || ''}
              disabled
            >
              <option value="">Не выбран</option>
              {Array.isArray(masters) && masters.map((m) => (
                <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-activity">
              Активность
            </label>
            <select
              id="record-activity"
              className={inputClass}
              style={inputStyle}
              value={activity?.service_id || ''}
              disabled
            >
              <option value="">Не выбрана</option>
              {Array.isArray(services) && services.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-location">
              Место
            </label>
            <select
              id="record-location"
              className={inputClass}
              style={inputStyle}
              value={activity?.location_id || ''}
              disabled
            >
              <option value="">Не выбрано</option>
              {Array.isArray(locations) && locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date + Time */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1">Дата</label>
            <div className="text-sm">{activityDate}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-mid block mb-1">Время</label>
            <div className="text-sm">{activityTime}</div>
          </div>
        </div>

        {/* Record status */}
        <div className="mt-4">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-status">
            Статус записи
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

      {/* Visitors */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        {record.visits.length === 0 && (
          <p className="text-xs text-ink-light">Нет посетителей</p>
        )}
        {record.visits.map((visit) => {
          const visitor = visitorsMap.get(visit.visitor_id);
          const isEditingPrice = visit.id in editPrices;
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
              <select
                className="text-xs rounded border px-2 py-1 bg-white"
                style={{ borderColor: 'var(--line)' }}
                value={visit.status}
                onChange={(e) => handleVisitStatusChange(visit.id, e.target.value)}
                aria-label="Статус посетителя"
                data-testid="select-visit-status"
              >
                <option value="waiting">Ожидает</option>
                <option value="visited">Пришла</option>
                <option value="missed">Пропущена</option>
                <option value="cancelled">Отменена</option>
              </select>
              {isEditingPrice ? (
                <input
                  type="number"
                  className="w-20 text-right rounded border px-1 py-0.5 text-sm"
                  style={inputStyle}
                  value={editPrices[visit.id] ?? String(visit.price)}
                  onChange={(e) => setEditPrices(prev => ({ ...prev, [visit.id]: e.target.value }))}
                  onBlur={() => {
                    const val = Number(editPrices[visit.id]);
                    if (val > 0 && val !== visit.price) {
                      handleVisitPriceChange(visit.id, val);
                    } else {
                      setEditPrices(prev => {
                        const next = { ...prev };
                        delete next[visit.id];
                        return next;
                      });
                    }
                  }}
                  autoFocus
                  data-testid="visit-price-input"
                />
              ) : (
                <span
                  className="text-sm cursor-pointer hover:underline"
                  onClick={() => setEditPrices(prev => ({ ...prev, [visit.id]: String(visit.price) }))}
                  data-testid="visit-price-input"
                >
                  {visit.price.toLocaleString('ru-RU')} ₽
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment summary */}
      <div className="space-y-2" data-testid="payment-summary">
        <h4 className="text-xs font-medium text-ink-mid">Оплата</h4>

        {/* Custom price override */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-mid whitespace-nowrap" htmlFor="custom-price">
            Ручная стоимость
          </label>
          <input
            id="custom-price"
            type="number"
            placeholder="Авто"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            onBlur={handleCustomPriceSave}
            data-testid="input-custom-price"
          />
        </div>

        {/* Payment breakdown: Итого / Оплачено / Остаток */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-surface rounded-lg">
          <div className="text-center">
            <div className="text-lg font-semibold">{displayTotal.toLocaleString('ru-RU')} ₽</div>
            <div className="text-xs text-ink-light">Итого</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">{totalPaid.toLocaleString('ru-RU')} ₽</div>
            <div className="text-xs text-ink-light">Оплачено</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold" style={{ color: remaining > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}>
              {remaining.toLocaleString('ru-RU')} ₽
            </div>
            <div className="text-xs text-ink-light">Остаток</div>
          </div>
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

      {/* Comment field */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Комментарий</h4>
        <textarea
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
          style={inputStyle}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onBlur={handleCommentSave}
          placeholder="Добавить комментарий..."
          rows={2}
          data-testid="input-comment"
        />
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
