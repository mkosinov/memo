'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CustomSelect, type CustomSelectOption } from '@/app/components/shared/CustomSelect';
import { MasterPicker } from '@/app/components/shared/MasterPicker';
import { TimePicker } from '@/app/components/shared/TimePicker';
import { RecordHeader } from '@/app/components/shared/records/RecordHeader';
import { RecordVisitRow } from '@/app/components/shared/records/RecordVisitRow';
import { PaymentList } from '@/app/components/shared/payments/PaymentList';
import { PaymentForm } from '@/app/components/shared/payments/PaymentForm';
import { PaymentTotals } from '@/app/components/shared/payments/PaymentTotals';
import { AddVisitorForm } from '@/app/components/shared/visitors/AddVisitorForm';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { VisitStatus } from '@memo/domain';

interface ClientRecordTabProps {
  recordId: string;
  clientId: string;
  onClose: () => void;
}

export function ClientRecordTab({ recordId, clientId, onClose }: ClientRecordTabProps) {
  const queryClient = useQueryClient();
  const { gridFrequency } = useSchedule();

  const { record, visitors, activity, services, masters, locations, payments, visitorsMap, tariffs, isLoading, recordData, status } =
    useRecordData(recordId, clientId);

  const { saveRecord, deleteRecord, addVisitor, deleteVisitor, addPayment, deletePayment, updateAnonymVisits } =
    useRecordMutations(record?.activity_id ?? '', recordId);

  // ── Surface-specific editable state ─────────────────────────────────────
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [comment, setComment] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [preciseTime, setPreciseTime] = useState(false);
  const [showVisitorForm, setShowVisitorForm] = useState(false);

  // Initialize from data
  useEffect(() => {
    if (activity) {
      setDate(activity.start.split('T')[0] || '');
      setTime(activity.start.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
      setMasterId(activity.master_id);
      setLocationId(activity.location_id);
    }
  }, [activity]);

  useEffect(() => {
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
    }
  }, [record]);

  const markChanged = useCallback(() => setHasChanges(true), []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!record || !activity) return;
    const existingVisits = (record.visits || []).map(v => ({
      visitor_id: v.visitor_id,
      price: v.custom_price ?? v.price,
      custom_price: v.custom_price,
      status: v.status,
    }));
    await saveRecord({
      activityId: serviceId !== activity.service_id || `${date}T${time}:00` !== activity.start ? activity.id : undefined,
      activityStart: `${date}T${time}:00`,
      activityServiceId: serviceId,
      customPrice,
      comment,
      visits: existingVisits,
    });
    setHasChanges(false);
  }, [saveRecord, record, activity, date, time, serviceId, customPrice, comment]);

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
    }
    setHasChanges(false);
  }, [activity, record]);

  const handleDelete = useCallback(async () => {
    if (window.confirm('Удалить запись?')) {
      await deleteRecord();
      queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
    }
  }, [clientId, deleteRecord, queryClient]);

  const handleAddVisitor = useCallback(async (data: { name: string; age: number | null; tariff_id: string }) => {
    const age = data.age ?? undefined;
    const visitor = await addVisitor({ client_id: clientId, name: data.name, age });
    const existingVisits = (record?.visits || []).map(v => ({
      visitor_id: v.visitor_id,
      price: v.custom_price ?? v.price,
      custom_price: v.custom_price,
      status: v.status,
    }));
    const tariff = tariffs.find(t => t.id === data.tariff_id) ?? tariffs[0];
    await saveRecord({
      visits: [...existingVisits, { visitor_id: visitor.id, price: tariff?.price ?? 0, status: 'waiting' }],
    });
    setShowVisitorForm(false);
    queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
  }, [clientId, addVisitor, saveRecord, record, tariffs, queryClient]);

  const handleDeleteVisitor = useCallback(async (visitId: string) => {
    if (!record) return;
    const visit = record.visits.find(v => v.id === visitId);
    if (visit?.visitor_id) {
      const remaining = record.visits.filter(v => v.visitor_id !== visit.visitor_id).map(v => ({
        visitor_id: v.visitor_id,
        price: v.custom_price ?? v.price,
        custom_price: v.custom_price,
        status: v.status,
      }));
      await saveRecord({ visits: remaining });
    }
    queryClient.invalidateQueries({ queryKey: ['visitors', clientId] });
  }, [record, saveRecord, queryClient, clientId]);

  const handleAddPayment = useCallback((p: { amount: number; method: string }) => {
    addPayment(p.amount, p.method);
  }, [addPayment]);

  const handleDeletePayment = useCallback((paymentId: string) => {
    deletePayment(paymentId);
  }, [deletePayment]);

  const handleAnonymChange = useCallback((value: number) => {
    updateAnonymVisits(recordId, value);
  }, [recordId, updateAnonymVisits]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const total = (record.visits || []).reduce((sum, v) => sum + (v.custom_price ?? v.price ?? 0), 0);
  const displayTotal = customPrice.trim() !== '' ? Number(customPrice) : total;
  const totalPaid = Array.isArray(payments) ? payments.reduce((sum, p) => sum + p.amount, 0) : 0;

  const inputClass = 'rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  const locationOptions: CustomSelectOption[] = [
    { value: '', label: 'Не выбрана' },
    ...(Array.isArray(locations) ? locations.map(l => ({ value: l.id, label: l.name })) : []),
  ];

  const serviceOptions: CustomSelectOption[] = [
    { value: '', label: 'Не выбрана' },
    ...(Array.isArray(services) ? services.map(s => ({ value: s.id, label: s.title })) : []),
  ];

  // Build RecordWithDerived for RecordHeader
  const headerData = recordData ? { ...recordData, client: null } : null;

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">
      {/* Record header with status badge + anonym_visits */}
      {headerData && (
        <RecordHeader data={headerData} onAnonymVisitsChange={handleAnonymChange} />
      )}

      {/* Row 1: Date / Time / Location */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-date">Дата</label>
          <input id="record-date" type="date" className={inputClass} style={inputStyle} value={date}
            onChange={e => { setDate(e.target.value); markChanged(); }} />
        </div>
        <div id="record-time">
          <TimePicker value={date && time ? `${date}T${time}:00` : ''}
            onChange={(isoValue) => { setTime(isoValue.split('T')[1]?.slice(0, 5) || ''); markChanged(); }}
            gridFrequency={gridFrequency} precise={preciseTime} label="Время" />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <label className="flex items-center gap-1.5 text-xs text-ink-mid cursor-pointer">
            <input type="checkbox" checked={preciseTime} onChange={(e) => setPreciseTime(e.target.checked)}
              className="rounded" data-testid="checkbox-precise-time" />
            Точное время
          </label>
        </div>
        <div data-testid="select-location">
          <label className="text-xs font-medium text-ink-mid block mb-1">Локация</label>
          <CustomSelect value={locationId} options={locationOptions}
            onChange={(v) => { setLocationId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
      </div>

      {/* Row 2: Service / Master */}
      <div className="flex flex-wrap gap-3">
        <div data-testid="select-service">
          <label className="text-xs font-medium text-ink-mid block mb-1">Услуга</label>
          <CustomSelect value={serviceId} options={serviceOptions}
            onChange={(v) => { setServiceId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
        <div data-testid="select-master">
          <label className="text-xs font-medium text-ink-mid block mb-1">Мастер</label>
          <MasterPicker masters={masters} value={masterId}
            onChange={(v) => { setMasterId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
      </div>

      {/* Visitors — shared atom rows */}
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
              <span className="w-8" />
            </div>
          )}

          {record.visits.map(visit => {
            const visitor = visitorsMap.get(visit.visitor_id ?? '');
            return (
              <RecordVisitRow
                key={visit.id}
                visit={visit}
                visitorName={visitor?.name}
                visitorAge={visitor?.age}
                tariffId={visit.tariff_id ?? ''}
                tariffs={tariffs}
                onChange={(data) => {
                  if (data.status) {
                    // Status change goes through visit status update
                  }
                }}
                onDelete={() => handleDeleteVisitor(visit.id)}
              />
            );
          })}
        </div>

        {showVisitorForm ? (
          <AddVisitorForm tariffs={tariffs} onAdd={handleAddVisitor}
            onCancel={() => setShowVisitorForm(false)} />
        ) : (
          <button onClick={() => setShowVisitorForm(true)}
            className="text-brand text-xs hover:underline mt-2"
            data-testid="btn-add-visitor">
            + Добавить посетителя
          </button>
        )}

        {/* Итого */}
        {record.visits.length > 0 && (
          <div className="flex justify-end items-center gap-2 mt-2">
            <span className="text-sm text-ink-mid">Итого:</span>
            <input type="number" className="w-24 text-right rounded-lg border px-2 py-1 text-sm"
              style={inputStyle} value={customPrice !== '' ? customPrice : total}
              onChange={e => { setCustomPrice(e.target.value); markChanged(); }}
              data-testid="input-custom-price" />
            <span className="text-sm">₽</span>
          </div>
        )}
      </div>

      {/* Payment section — shared atoms */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Оплата</h4>
        <PaymentTotals total={displayTotal} paid={totalPaid} className="mb-2" />
        <PaymentList payments={Array.isArray(payments) ? payments : []} onDelete={handleDeletePayment} />
        <div className="mt-2">
          <PaymentForm total={displayTotal} paid={totalPaid} onSubmit={handleAddPayment} />
        </div>
      </div>

      {/* Comment */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Комментарий</h4>
        <textarea className="w-full rounded-lg border px-3 py-2 text-sm bg-white" style={inputStyle}
          value={comment} onChange={e => { setComment(e.target.value); markChanged(); }}
          placeholder="Добавить комментарий..." rows={2} data-testid="input-comment" />
      </div>

      {/* Dates */}
      <div className="text-xs text-ink-light" data-testid="record-dates">
        <span>Создан: {new Date(record.created_at).toLocaleDateString('ru-RU')} {new Date(record.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="mx-2">|</span>
        <span>Обновлён: {new Date(record.updated_at).toLocaleDateString('ru-RU')} {new Date(record.updated_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
        <button onClick={handleDelete} className="text-sm text-red-500 hover:text-red-600 transition-colors"
          data-testid="btn-delete-record">Удалить запись</button>
        <div className="flex gap-2">
          <button disabled={!hasChanges} onClick={handleCancel}
            className="px-4 py-2 text-sm text-ink-mid border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--line)' }}>Отмена</button>
          <button disabled={!hasChanges} onClick={handleSave}
            className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300"
            style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
            data-testid="btn-save-record">Сохранить</button>
        </div>
      </div>
    </div>
  );
}
