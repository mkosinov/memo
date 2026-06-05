'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecord, patchRecord, deleteRecord, createPayment, deletePayment,
  getClientVisitors, getActivity, getServices, getMasters, getLocations,
  getPayments, patchActivity, createVisitor,
} from '@memo/api-client';

interface ClientRecordTabProps {
  recordId: string;
  clientId: string;
  onClose: () => void;
}

// ─── Visit status icons ─────────────────────────────────────────────────────

const VISIT_STATUS_ORDER = ['waiting', 'visited', 'missed', 'cancelled'] as const;
type VisitStatus = (typeof VISIT_STATUS_ORDER)[number];

const STATUS_CONFIG: Record<VisitStatus, { label: string; color: string }> = {
  waiting: { label: 'Ожидает', color: '#F59E0B' },
  visited: { label: 'Пришла', color: '#10B981' },
  missed: { label: 'Пропущена', color: '#EF4444' },
  cancelled: { label: 'Отменена', color: '#6B7280' },
};

function StatusIcon({ status }: { status: VisitStatus }) {
  const cls = 'w-4 h-4';
  switch (status) {
    case 'waiting':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'visited':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'missed':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
  }
}

function cycleVisitStatus(current: VisitStatus): VisitStatus {
  const idx = VISIT_STATUS_ORDER.indexOf(current);
  return VISIT_STATUS_ORDER[(idx + 1) % VISIT_STATUS_ORDER.length];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ClientRecordTab({ recordId, clientId, onClose }: ClientRecordTabProps) {
  const queryClient = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────

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

  // ── Derived data ────────────────────────────────────────────────────────

  const visitorsMap = useMemo(() => {
    const map = new Map<string, { name: string; age: number | null }>();
    if (Array.isArray(visitors)) {
      visitors.forEach(v => map.set(v.id, { name: v.name, age: v.age }));
    }
    return map;
  }, [visitors]);

  const tariffs = useMemo(() => {
    if (!Array.isArray(services)) return [];
    const service = services.find(s => s.id === activity?.service_id);
    return service?.tariffs ?? [];
  }, [services, activity]);

  // ── Editable state ──────────────────────────────────────────────────────

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [comment, setComment] = useState('');
  const [visitStatuses, setVisitStatuses] = useState<Record<string, string>>({});
  const [visitPrices, setVisitPrices] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Add-visitor form state
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorAge, setNewVisitorAge] = useState('');
  const [newVisitorTariffId, setNewVisitorTariffId] = useState('');

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');

  // Initialize from data
  useEffect(() => {
    if (activity) {
      const startStr = activity.start;
      setDate(startStr.split('T')[0] || '');
      setTime(startStr.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
    }
  }, [activity]);

  useEffect(() => {
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
      const statuses: Record<string, string> = {};
      const prices: Record<string, string> = {};
      record.visits.forEach(v => {
        statuses[v.id] = v.status;
        prices[v.id] = String(v.price);
      });
      setVisitStatuses(statuses);
      setVisitPrices(prices);
    }
  }, [record]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const markChanged = useCallback(() => setHasChanges(true), []);

  const invalidateRecord = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    queryClient.invalidateQueries({ queryKey: ['records'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  }, [queryClient, recordId]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleStatusCycle = useCallback((visitId: string) => {
    setVisitStatuses(prev => {
      const current = (prev[visitId] || 'waiting') as VisitStatus;
      return { ...prev, [visitId]: cycleVisitStatus(current) };
    });
    markChanged();
  }, [markChanged]);

  const handleTariffChange = useCallback((visitId: string, tariffId: string) => {
    const tariff = tariffs.find(t => t.id === tariffId);
    if (tariff) {
      setVisitPrices(prev => ({ ...prev, [visitId]: String(tariff.price) }));
      markChanged();
    }
  }, [tariffs, markChanged]);

  const handleAddPayment = useCallback(async () => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      await createPayment({ record_id: recordId, amount, method: paymentMethod as 'card' | 'cash' | 'transfer' });
      setPaymentAmount('');
      invalidateRecord();
    }
  }, [recordId, paymentAmount, paymentMethod, invalidateRecord]);

  const handleDeletePayment = useCallback(async (paymentId: string) => {
    await deletePayment(paymentId);
    invalidateRecord();
  }, [invalidateRecord]);

  const handleDelete = useCallback(async () => {
    await deleteRecord(recordId);
    onClose();
    queryClient.invalidateQueries({ queryKey: ['records'] });
  }, [recordId, onClose, queryClient]);

  const handleSave = useCallback(async () => {
    if (!record || !activity) return;

    // 1. Patch activity if date/time/service changed
    const newStart = `${date}T${time}:00`;
    if (newStart !== activity.start || serviceId !== activity.service_id) {
      await patchActivity(activity.id, { start: newStart, service_id: serviceId });
    }

    // 2. Patch record with custom_price, comment, and visits
    const visits = record.visits.map(v => ({
      visitor_id: v.visitor_id,
      price: Number(visitPrices[v.id] ?? v.price),
      status: visitStatuses[v.id] ?? v.status,
    }));

    await patchRecord(recordId, {
      custom_price: customPrice.trim() !== '' ? Number(customPrice) : null,
      comment: comment || null,
      visits,
    });

    invalidateRecord();
    setHasChanges(false);
  }, [record, activity, date, time, serviceId, customPrice, comment, visitPrices, visitStatuses, recordId, invalidateRecord]);

  const handleCancel = useCallback(() => {
    if (activity) {
      setDate(activity.start.split('T')[0] || '');
      setTime(activity.start.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
    }
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
      const statuses: Record<string, string> = {};
      const prices: Record<string, string> = {};
      record.visits.forEach(v => {
        statuses[v.id] = v.status;
        prices[v.id] = String(v.price);
      });
      setVisitStatuses(statuses);
      setVisitPrices(prices);
    }
    setHasChanges(false);
  }, [activity, record]);

  const handleAddVisitor = useCallback(async () => {
    if (!newVisitorName.trim()) return;

    const age = newVisitorAge ? Number(newVisitorAge) : undefined;
    const visitor = await createVisitor({ client_id: clientId, name: newVisitorName.trim(), age });

    const existingVisits = record?.visits.map(v => ({
      visitor_id: v.visitor_id,
      price: Number(visitPrices[v.id] ?? v.price),
      status: visitStatuses[v.id] ?? v.status,
    })) || [];

    const newTariff = tariffs.length > 0 ? tariffs.find(t => t.id === newVisitorTariffId) ?? tariffs[0] : null;

    await patchRecord(recordId, {
      visits: [...existingVisits, { visitor_id: visitor.id, price: newTariff?.price ?? 0, status: 'waiting' }],
    });

    setNewVisitorName('');
    setNewVisitorAge('');
    setNewVisitorTariffId('');
    setShowVisitorForm(false);
    invalidateRecord();
    queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
  }, [clientId, newVisitorName, newVisitorAge, newVisitorTariffId, record, visitPrices, visitStatuses, tariffs, recordId, invalidateRecord, queryClient]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const visitsTotal = record.visits.reduce(
    (sum, v) => sum + (Number(visitPrices[v.id] ?? v.price) || 0), 0,
  );
  const displayTotal = customPrice.trim() !== '' ? Number(customPrice) : visitsTotal;
  const totalPaid = Array.isArray(payments) ? payments.reduce((sum, p) => sum + p.amount, 0) : 0;
  const remaining = displayTotal - totalPaid;

  const inputClass = 'rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  const methodLabel = (m: string | null) => {
    if (m === 'card') return 'карта';
    if (m === 'cash') return 'наличные';
    if (m === 'transfer') return 'перевод';
    return m ?? '—';
  };

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">

      {/* ── Row 1: Date / Time / Service ──────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-date">Дата</label>
          <input
            id="record-date"
            type="date"
            className={inputClass}
            style={inputStyle}
            value={date}
            onChange={e => { setDate(e.target.value); markChanged(); }}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-time">Время</label>
          <input
            id="record-time"
            type="time"
            className={inputClass}
            style={inputStyle}
            value={time}
            onChange={e => { setTime(e.target.value); markChanged(); }}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-service">Услуга</label>
          <select
            id="record-service"
            className={`${inputClass} appearance-none`}
            style={inputStyle}
            value={serviceId}
            onChange={e => { setServiceId(e.target.value); markChanged(); }}
          >
            <option value="">Не выбрана</option>
            {Array.isArray(services) && services.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Row 2: Master / Location / Status icon ────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-master">Мастер</label>
          <select
            id="record-master"
            className={`${inputClass} appearance-none`}
            style={inputStyle}
            value={activity?.master_id || ''}
            onChange={(e) => {
              setHasChanges(true);
              // Will be saved on Save button click
            }}
          >
            <option value="">Не выбран</option>
            {Array.isArray(masters) && masters.map(m => (
              <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-location">Локация</label>
          <select
            id="record-location"
            className={`${inputClass} appearance-none`}
            style={inputStyle}
            value={activity?.location_id || ''}
            onChange={(e) => {
              setHasChanges(true);
              // Will be saved on Save button click
            }}
          >
            <option value="">Не выбрана</option>
            {Array.isArray(locations) && locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        {/* Status icon — cycles first visit status */}
        {record.visits.length > 0 && (() => {
          const firstVisit = record.visits[0];
          const status = (visitStatuses[firstVisit.id] || 'waiting') as VisitStatus;
          const cfg = STATUS_CONFIG[status];
          return (
            <button
              type="button"
              onClick={() => handleStatusCycle(firstVisit.id)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              style={{ color: cfg?.color }}
              title={cfg?.label}
              data-testid="visit-status-icon"
            >
              <StatusIcon status={status} />
            </button>
          );
        })()}
      </div>

      {/* ── Visitors ──────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--line)' }}>
          {record.visits.length === 0 && !showVisitorForm && (
            <p className="text-xs text-ink-light">Нет посетителей</p>
          )}

          {record.visits.map(visit => {
            const visitor = visitorsMap.get(visit.visitor_id);
            const price = visitPrices[visit.id] ?? String(visit.price);
            return (
              <div
                key={visit.id}
                className="flex items-center gap-2 py-1.5 border-b text-sm"
                style={{ borderColor: 'var(--line)' }}
                data-testid="visit-row"
              >
                <span className="flex-1 truncate text-ink">
                  {visitor?.name ?? 'Неизвестный'}
                  {visitor?.age != null && (
                    <span className="text-xs text-ink-light ml-1">({visitor.age} лет)</span>
                  )}
                  {visitor?.age == null && (
                    <span className="text-xs text-ink-light ml-1">(взр.)</span>
                  )}
                </span>
                <select
                  className="text-xs rounded border px-2 py-1 bg-white"
                  style={{ borderColor: 'var(--line)' }}
                  value={tariffs.find(t => t.price === Number(price))?.id ?? ''}
                  onChange={e => handleTariffChange(visit.id, e.target.value)}
                  aria-label="Тариф посетителя"
                  data-testid="select-visit-tariff"
                >
                  <option value="">—</option>
                  {tariffs.map(t => (
                    <option key={t.id} value={t.id}>{t.title} {t.price}₽</option>
                  ))}
                </select>
                <span className="text-sm font-medium w-20 text-right" data-testid="visit-price">
                  {Number(price).toLocaleString('ru-RU')} ₽
                </span>
              </div>
            );
          })}

          {/* Add visitor */}
          {showVisitorForm ? (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Имя"
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  value={newVisitorName}
                  onChange={e => setNewVisitorName(e.target.value)}
                  data-testid="input-visitor-name"
                />
                <input
                  type="number"
                  placeholder="Возраст"
                  className={`w-20 ${inputClass}`}
                  style={inputStyle}
                  value={newVisitorAge}
                  onChange={e => setNewVisitorAge(e.target.value)}
                  data-testid="input-visitor-age"
                />
                <select
                  className={`${inputClass} appearance-none`}
                  style={inputStyle}
                  value={newVisitorTariffId}
                  onChange={e => setNewVisitorTariffId(e.target.value)}
                >
                  <option value="">Тариф</option>
                  {tariffs.map(t => (
                    <option key={t.id} value={t.id}>{t.title} {t.price}₽</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddVisitor}
                  className="px-3 py-1.5 text-xs text-white rounded-lg"
                  style={{ backgroundColor: 'var(--brand, #004D56)' }}
                  data-testid="btn-create-visitor"
                >
                  Добавить
                </button>
                <button
                  onClick={() => {
                    setShowVisitorForm(false);
                    setNewVisitorName('');
                    setNewVisitorAge('');
                    setNewVisitorTariffId('');
                  }}
                  className="px-3 py-1.5 text-xs text-ink-mid rounded-lg hover:bg-gray-100"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowVisitorForm(true)}
              className="text-brand text-xs hover:underline"
              data-testid="btn-add-visitor"
            >
              + Добавить посетителя
            </button>
          )}
        </div>
      </div>

      {/* ── Payments ──────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Оплата</h4>

        {/* Total / Paid / Remaining */}
        <div className="flex flex-wrap items-center gap-4 mb-2">
          <div className="flex items-center gap-1">
            <label className="text-xs text-ink-mid whitespace-nowrap" htmlFor="custom-price">Итого:</label>
            <input
              id="custom-price"
              type="number"
              className={`${inputClass} w-28`}
              style={inputStyle}
              value={customPrice}
              onChange={e => { setCustomPrice(e.target.value); markChanged(); }}
              data-testid="input-custom-price"
            />
            <span className="text-sm ml-0.5">₽</span>
          </div>
          <div className="text-sm">
            <span className="text-ink-mid">Оплачено: </span>
            <span className="font-medium">{totalPaid.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="text-sm">
            <span className="text-ink-mid">Остаток: </span>
            <span
              className="font-medium"
              style={{ color: remaining > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}
            >
              {remaining.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        </div>

        {/* Payment list */}
        {Array.isArray(payments) && payments.length > 0 && (
          <div className="rounded-lg border p-3 space-y-1 mb-3" style={{ borderColor: 'var(--line)' }} data-testid="payment-list">
            {payments.map(payment => (
              <div key={payment.id} className="flex items-center justify-between py-1 text-sm" data-testid="payment-row">
                <span>
                  {payment.amount.toLocaleString('ru-RU')} ₽ ({methodLabel(payment.method)})
                </span>
                <button
                  onClick={() => handleDeletePayment(payment.id)}
                  className="text-red-400 hover:text-red-500 text-xs"
                  aria-label="Удалить оплату"
                  data-testid="btn-delete-payment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add payment form */}
        <div className="flex gap-2">
          <select
            className={`${inputClass} appearance-none`}
            style={inputStyle}
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value)}
          >
            <option value="card">Карта</option>
            <option value="cash">Наличные</option>
            <option value="transfer">Перевод</option>
          </select>
          <input
            type="number"
            placeholder="Сумма"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
            value={paymentAmount}
            onChange={e => setPaymentAmount(e.target.value)}
          />
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

      {/* ── Comment ───────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Комментарий</h4>
        <textarea
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
          style={inputStyle}
          value={comment}
          onChange={e => { setComment(e.target.value); markChanged(); }}
          placeholder="Добавить комментарий..."
          rows={2}
          data-testid="input-comment"
        />
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={handleDelete}
          className="text-sm text-red-500 hover:text-red-600 transition-colors"
          data-testid="btn-delete-record"
        >
          Удалить запись
        </button>
        <div className="flex gap-2">
          <button
            disabled={!hasChanges}
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-ink-mid border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--line)' }}
          >
            Отмена
          </button>
          <button
            disabled={!hasChanges}
            onClick={handleSave}
            className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300"
            style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
            data-testid="btn-save-record"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
