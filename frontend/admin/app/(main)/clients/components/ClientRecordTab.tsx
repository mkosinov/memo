'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CustomSelect, type CustomSelectOption } from '@/app/components/shared/CustomSelect';
import { MasterPicker } from '@/app/components/shared/MasterPicker';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';

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

function StatusIcon({ status, size = 16 }: { status: VisitStatus; size?: number }) {
  const s = `0 0 ${size} ${size}`;
  switch (status) {
    case 'waiting':
      return (
        <svg className="w-4 h-4" viewBox={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} />
          <polyline points={`${size / 2} ${size * 0.25} ${size / 2} ${size / 2} ${size * 0.67} ${size * 0.58}`} />
        </svg>
      );
    case 'visited':
      return (
        <svg className="w-4 h-4" viewBox={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M${size * 0.92} ${size * 0.46}V${size * 0.5}a${size / 2} ${size / 2} 0 1 1-${size * 0.25}-${size * 0.38}`} />
          <polyline points={`${size * 0.92} ${size * 0.17} ${size / 2} ${size * 0.58} ${size * 0.38} ${size * 0.46}`} />
        </svg>
      );
    case 'missed':
      return (
        <svg className="w-4 h-4" viewBox={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M${size * 0.43} ${size * 0.16}L${size * 0.08} ${size * 0.75}a${size * 0.08} ${size * 0.08} 0 0 0 ${size * 0.07} ${size * 0.12}h${size * 0.7}a${size * 0.08} ${size * 0.08} 0 0 0 ${size * 0.07}-${size * 0.12}L${size * 0.57} ${size * 0.16}a${size * 0.08} ${size * 0.08} 0 0 0-${size * 0.14} 0z`} />
          <line x1={size / 2} y1={size * 0.38} x2={size / 2} y2={size * 0.54} />
          <line x1={size / 2} y1={size * 0.71} x2={size / 2 + 0.01} y2={size * 0.71} />
        </svg>
      );
    case 'cancelled':
      return (
        <svg className="w-4 h-4" viewBox={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} />
          <line x1={size * 0.63} y1={size * 0.38} x2={size * 0.38} y2={size * 0.63} />
          <line x1={size * 0.38} y1={size * 0.38} x2={size * 0.63} y2={size * 0.63} />
        </svg>
      );
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ClientRecordTab({ recordId, clientId, onClose }: ClientRecordTabProps) {
  const queryClient = useQueryClient();

  // ── Data queries via hook ──────────────────────────────────────────────

  const { record, visitors, activity, services, masters, locations, payments, visitorsMap, tariffs, isLoading } =
    useRecordData(recordId, clientId);

  // ── Mutations via hook ────────────────────────────────────────────────

  const { saveRecord, deleteRecord, addVisitor, deleteVisitor, addPayment, deletePayment } =
    useRecordMutations(recordId);

  // ── Editable state ──────────────────────────────────────────────────────

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [comment, setComment] = useState('');
  const [visitStatuses, setVisitStatuses] = useState<Record<string, string>>({});
  const [visitPrices, setVisitPrices] = useState<Record<string, string>>({});
  const [visitCustomPrices, setVisitCustomPrices] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Add-visitor form state
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorAge, setNewVisitorAge] = useState('');
  const [newVisitorTariffId, setNewVisitorTariffId] = useState('');
  const [selectedVisitor, setSelectedVisitor] = useState<{ id: string; name: string } | null>(null);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');

  // Filtered visitors for combobox dropdown
  const filteredVisitors = useMemo(() => {
    if (!newVisitorName || selectedVisitor) return [];
    const searchLower = newVisitorName.toLowerCase();
    return Array.isArray(visitors)
      ? visitors.filter(v => v.name.toLowerCase().includes(searchLower))
      : [];
  }, [visitors, newVisitorName, selectedVisitor]);

  // Initialize from data
  useEffect(() => {
    if (activity) {
      const startStr = activity.start;
      setDate(startStr.split('T')[0] || '');
      setTime(startStr.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
      setMasterId(activity.master_id);
      setLocationId(activity.location_id);
    }
  }, [activity]);

  useEffect(() => {
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
      const statuses: Record<string, string> = {};
      const prices: Record<string, string> = {};
      const customPrices: Record<string, string> = {};
      record.visits.forEach(v => {
        statuses[v.id] = v.status;
        prices[v.id] = String(v.price);
        customPrices[v.id] = v.custom_price != null ? String(v.custom_price) : '';
      });
      setVisitStatuses(statuses);
      setVisitPrices(prices);
      setVisitCustomPrices(customPrices);
    }
  }, [record]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const markChanged = useCallback(() => setHasChanges(true), []);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleStatusChange = useCallback((visitId: string, newStatus: string) => {
    setVisitStatuses(prev => ({ ...prev, [visitId]: newStatus }));
    markChanged();
  }, [markChanged]);

  const handleTariffChange = useCallback((visitId: string, tariffId: string) => {
    const tariff = tariffs.find(t => t.id === tariffId);
    if (tariff) {
      setVisitPrices(prev => ({ ...prev, [visitId]: String(tariff.price) }));
      markChanged();
    }
  }, [tariffs, markChanged]);

  const handleCustomPriceChange = useCallback((visitId: string, value: string) => {
    setVisitCustomPrices(prev => ({ ...prev, [visitId]: value }));
    markChanged();
  }, [markChanged]);

  const handleAddPayment = useCallback(async () => {
    const amount = Number(paymentAmount);
    if (amount > 0) {
      await addPayment(amount, paymentMethod);
      setPaymentAmount('');
    }
  }, [paymentAmount, paymentMethod, addPayment]);

  const handleDeletePayment = useCallback(async (paymentId: string) => {
    await deletePayment(paymentId);
  }, [deletePayment]);

  const handleDelete = useCallback(async () => {
    if (window.confirm('Удалить запись?')) {
      await deleteRecord();
      queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
    }
  }, [clientId, deleteRecord, queryClient]);

  const handleSave = useCallback(async () => {
    if (!record || !activity) return;

    // Use the hook's saveRecord method
    await saveRecord({
      activityId: serviceId !== activity.service_id || `${date}T${time}:00` !== activity.start
        ? activity.id : undefined,
      activityStart: `${date}T${time}:00`,
      activityServiceId: serviceId,
      customPrice,
      comment,
      visits: record.visits.map(v => ({
        visitor_id: v.visitor_id,
        price: Number(visitPrices[v.id] ?? v.price),
        custom_price: visitCustomPrices[v.id] !== '' && visitCustomPrices[v.id] != null
          ? Number(visitCustomPrices[v.id]) : null,
        status: visitStatuses[v.id] ?? v.status,
      })),
    });

    setHasChanges(false);
  }, [saveRecord, record, activity, date, time, serviceId, customPrice, comment, visitPrices, visitCustomPrices, visitStatuses]);

  const handleCancel = useCallback(() => {
    if (activity) {
      setDate(activity.start.split('T')[0] || '');
      setTime(activity.start.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
      setMasterId(activity.master_id);
      setLocationId(activity.location_id);
    }
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
      const statuses: Record<string, string> = {};
      const prices: Record<string, string> = {};
      const customPrices: Record<string, string> = {};
      record.visits.forEach(v => {
        statuses[v.id] = v.status;
        prices[v.id] = String(v.price);
        customPrices[v.id] = v.custom_price != null ? String(v.custom_price) : '';
      });
      setVisitStatuses(statuses);
      setVisitPrices(prices);
      setVisitCustomPrices(customPrices);
    }
    setHasChanges(false);
  }, [activity, record]);

  const handleAddVisitor = useCallback(async () => {
    if (!newVisitorName.trim()) return;

    let visitorId: string;
    if (selectedVisitor) {
      // Use existing visitor
      visitorId = selectedVisitor.id;
    } else {
      // Create new visitor using the hook
      const age = newVisitorAge ? Number(newVisitorAge) : undefined;
      const visitor = await addVisitor({ client_id: clientId, name: newVisitorName.trim(), age });
      visitorId = visitor.id;
    }

    const existingVisits = record?.visits.map(v => {
      const cp = visitCustomPrices[v.id];
      return {
        visitor_id: v.visitor_id,
        price: Number(visitPrices[v.id] ?? v.price),
        custom_price: cp !== '' && cp != null ? Number(cp) : null,
        status: visitStatuses[v.id] ?? v.status,
      };
    }) || [];

    const newTariff = tariffs.length > 0 ? tariffs.find(t => t.id === newVisitorTariffId) ?? tariffs[0] : null;

    // Use saveRecord to update the record with the new visitor
    await saveRecord({
      visits: [...existingVisits, { visitor_id: visitorId, price: newTariff?.price ?? 0, status: 'waiting' }],
    });

    setNewVisitorName('');
    setNewVisitorAge('');
    setNewVisitorTariffId('');
    setSelectedVisitor(null);
    setShowVisitorForm(false);
    queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
  }, [clientId, newVisitorName, newVisitorAge, newVisitorTariffId, selectedVisitor, record, visitPrices, visitCustomPrices, visitStatuses, tariffs, addVisitor, saveRecord, queryClient]);

  const handleDeleteVisitor = useCallback(async (visitorId: string) => {
    if (!record) return;
    // Use the hook's deleteVisitor method
    // The hook handles deleting the visitor and updating the record
    const currentVisits = record.visits.map(v => ({
      visitor_id: v.visitor_id,
      price: Number(visitPrices[v.id] ?? v.price),
      custom_price: visitCustomPrices[v.id] !== '' && visitCustomPrices[v.id] != null ? Number(visitCustomPrices[v.id]) : null,
      status: visitStatuses[v.id] ?? v.status,
    }));
    await deleteVisitor(visitorId, currentVisits);
    queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
  }, [record, deleteVisitor, visitPrices, visitCustomPrices, visitStatuses, queryClient, clientId]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const visitsTotal = record.visits.reduce(
    (sum, v) => {
      const cp = visitCustomPrices[v.id];
      const price = cp !== '' && cp != null ? Number(cp) : Number(visitPrices[v.id] ?? v.price);
      return sum + (price || 0);
    }, 0,
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

  // ── Select options ──────────────────────────────────────────────────────

  const statusOptions: CustomSelectOption[] = VISIT_STATUS_ORDER.map(key => ({
    value: key,
    label: STATUS_CONFIG[key].label,
    color: STATUS_CONFIG[key].color,
    icon: <StatusIcon status={key} />,
  }));

  const locationOptions: CustomSelectOption[] = [
    { value: '', label: 'Не выбрана' },
    ...(Array.isArray(locations) ? locations.map(l => ({
      value: l.id,
      label: l.name,
    })) : []),
  ];

  const serviceOptions: CustomSelectOption[] = [
    { value: '', label: 'Не выбрана' },
    ...(Array.isArray(services) ? services.map(s => ({
      value: s.id,
      label: s.title,
    })) : []),
  ];

  const paymentMethodOptions: CustomSelectOption[] = [
    { value: 'card', label: 'Карта' },
    { value: 'cash', label: 'Наличные' },
    { value: 'transfer', label: 'Перевод' },
  ];

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">

      {/* ── Row 1: Date / Time / Location / Status — all 4 in one row ─── */}
      <div className="flex flex-wrap gap-3 items-end">
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
        <div data-testid="select-location">
          <label className="text-xs font-medium text-ink-mid block mb-1">Локация</label>
          <CustomSelect
            value={locationId}
            options={locationOptions}
            onChange={(v) => { setLocationId(v); markChanged(); }}
            className={`${inputClass} appearance-none`}
          />
        </div>
        <div data-testid="visit-status-select">
          <label className="text-xs font-medium text-ink-mid block mb-1">Статус</label>
          {record.visits.length > 0 && (() => {
            const firstVisit = record.visits[0];
            const status = (visitStatuses[firstVisit.id] || 'waiting') as VisitStatus;
            return (
              <CustomSelect
                value={status}
                options={statusOptions}
                onChange={(v) => handleStatusChange(firstVisit.id, v)}
                className={`${inputClass} appearance-none text-xs`}
                iconOnly
              />
            );
          })()}
        </div>
      </div>

      {/* ── Row 2: Service / Master ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div data-testid="select-service">
          <label className="text-xs font-medium text-ink-mid block mb-1">Услуга</label>
          <CustomSelect
            value={serviceId}
            options={serviceOptions}
            onChange={(v) => { setServiceId(v); markChanged(); }}
            className={`${inputClass} appearance-none`}
          />
        </div>
        <div data-testid="select-master">
          <label className="text-xs font-medium text-ink-mid block mb-1">Мастер</label>
          <MasterPicker
            masters={masters}
            value={masterId}
            onChange={(v) => { setMasterId(v); markChanged(); }}
            className={`${inputClass} appearance-none`}
          />
        </div>
      </div>

      {/* ── Visitors ──────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--line)' }}>
          {record.visits.length === 0 && !showVisitorForm && (
            <p className="text-xs text-ink-light">Нет посетителей</p>
          )}

          {/* Table header */}
          {record.visits.length > 0 && (
            <div className="flex items-center gap-2 py-1 text-xs font-medium text-ink-mid border-b" style={{ borderColor: 'var(--line)' }}>
              <span className="flex-1">Имя</span>
              <span className="min-w-[120px]">Тариф</span>
              <span className="w-20 text-right">Стоимость</span>
              <span className="w-8" />
            </div>
          )}

          {record.visits.map(visit => {
            const visitor = visitorsMap.get(visit.visitor_id);
            const price = visitPrices[visit.id] ?? String(visit.price);
            const cp = visitCustomPrices[visit.id] ?? '';

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
                    <span className="text-xs text-ink-light ml-1">({visitor.age} л.)</span>
                  )}
                  {visitor?.age == null && (
                    <span className="text-xs text-ink-light ml-1">(взр.)</span>
                  )}
                </span>
                <select
                  className="min-w-[120px] text-xs rounded border px-2 py-1 bg-white"
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
                <div className="flex items-center gap-1 w-20">
                  <input
                    type="number"
                    className="w-full text-right text-sm rounded border px-1 py-0.5"
                    style={{ borderColor: 'var(--line)' }}
                    value={cp !== '' ? cp : price}
                    onChange={e => handleCustomPriceChange(visit.id, e.target.value)}
                    data-testid="input-visit-price"
                  />
                </div>
                <span className="text-sm">₽</span>
                <button
                  onClick={() => handleDeleteVisitor(visit.visitor_id)}
                  className="text-red-400 hover:text-red-500 text-xs w-8 text-center"
                  aria-label="Удалить посетителя"
                  data-testid="btn-delete-visitor"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Add visitor form (below box) ──────────────────────────────── */}
        {showVisitorForm && (
          <div className="space-y-2 pt-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Введите имя или выберите из списка"
                  className={`w-full ${inputClass}`}
                  style={inputStyle}
                  value={newVisitorName}
                  onChange={e => {
                    setNewVisitorName(e.target.value);
                    setSelectedVisitor(null);
                  }}
                  data-testid="input-visitor-name"
                />
                {filteredVisitors.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-auto" style={{ borderColor: 'var(--line)' }}>
                    {filteredVisitors.map(visitor => (
                      <button
                        key={visitor.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        data-testid={`visitor-option-${visitor.id}`}
                        onClick={() => {
                          setSelectedVisitor({ id: visitor.id, name: visitor.name });
                          setNewVisitorName(visitor.name);
                        }}
                      >
                        {visitor.name} {visitor.age != null && `(${visitor.age} лет)`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                className={`${inputClass} appearance-none min-w-[120px]`}
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
                  setSelectedVisitor(null);
                }}
                className="px-3 py-1.5 text-xs text-ink-mid rounded-lg hover:bg-gray-100"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {/* "+ Добавить посетителя" button */}
        {!showVisitorForm && (
          <button
            onClick={() => setShowVisitorForm(true)}
            className="text-brand text-xs hover:underline mt-2"
            data-testid="btn-add-visitor"
          >
            + Добавить посетителя
          </button>
        )}

        {/* ── Итого — right-aligned, outside visitors box ────────────── */}
        {record.visits.length > 0 && (
          <div className="flex justify-end items-center gap-2 mt-2">
            <span className="text-sm text-ink-mid">Итого:</span>
            <input
              type="number"
              className="w-24 text-right rounded-lg border px-2 py-1 text-sm"
              style={{ borderColor: 'var(--line)' }}
              value={customPrice !== '' ? customPrice : visitsTotal}
              onChange={e => { setCustomPrice(e.target.value); markChanged(); }}
              data-testid="input-custom-price"
            />
            <span className="text-sm">₽</span>
          </div>
        )}
      </div>

      {/* ── Оплата ──────────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Оплата</h4>

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
        <div className="flex gap-2" data-testid="payment-form">
          <CustomSelect
            value={paymentMethod}
            options={paymentMethodOptions}
            onChange={setPaymentMethod}
            className={`${inputClass} appearance-none`}
          />
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

        {/* Totals at the end of payment block — right-aligned */}
        <div className="flex justify-end items-center gap-4 mt-2">
          <div className="text-sm">
            <span className="text-ink-mid">Оплачено: </span>
            <span className="font-medium">{totalPaid.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="text-sm">
            <span className="text-ink-mid">Осталось: </span>
            <span
              className="font-medium"
              style={{ color: remaining > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}
            >
              {remaining.toLocaleString('ru-RU')} ₽
            </span>
          </div>
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

      {/* ── Dates with time ────────────────────────────────────────────── */}
      <div className="text-xs text-ink-light" data-testid="record-dates">
        <span>Создан: {new Date(record.created_at).toLocaleDateString('ru-RU')} {new Date(record.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="mx-2">|</span>
        <span>Обновлён: {new Date(record.updated_at).toLocaleDateString('ru-RU')} {new Date(record.updated_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
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
