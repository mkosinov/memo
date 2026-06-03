'use client';

import React, { useState, useCallback } from 'react';
import { searchClientByPhone } from '@memo/api-client';
import type { TariffResponse } from '@memo/api-client';
import type { Activity } from '@memo/domain';

interface NewVisitor {
  tempId: string;
  name: string;
  age: string;
  tariffId: string;
}

interface NewBookingTabProps {
  activity: Activity;
  serviceTariffs: TariffResponse[];
  onSubmit: (data: {
    phone: string;
    name: string;
    visitors: NewVisitor[];
    notify: boolean;
    channel: string;
  }) => void;
  showToast: (message: string) => void;
}

export function NewBookingTab({ activity, serviceTariffs, onSubmit, showToast }: NewBookingTabProps) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(false);
  const [channel, setChannel] = useState('telegram');
  const [visitors, setVisitors] = useState<NewVisitor[]>([]);

  const handlePhoneBlur = useCallback(async () => {
    if (phone.length < 10) return;
    try {
      const client = await searchClientByPhone(phone);
      if (client) {
        setName(client.name);
      }
    } catch {
      // Client not found — leave name empty for manual entry
    }
  }, [phone]);

  const addVisitor = useCallback(() => {
    setVisitors((prev) => [
      ...prev,
      { tempId: `v_${Date.now()}`, name: '', age: '', tariffId: serviceTariffs[0]?.id || '' },
    ]);
  }, [serviceTariffs]);

  const removeVisitor = useCallback((tempId: string) => {
    setVisitors((prev) => prev.filter((v) => v.tempId !== tempId));
  }, []);

  const updateVisitor = useCallback((tempId: string, field: keyof NewVisitor, value: string) => {
    setVisitors((prev) =>
      prev.map((v) => (v.tempId === tempId ? { ...v, [field]: value } : v)),
    );
  }, []);

  const handleSubmit = useCallback(() => {
    // Name is required (phone is optional)
    if (!name) {
      showToast('Заполните имя');
      return;
    }

    // If there are visitors, validate tariff is selected
    if (visitors.length > 0) {
      const hasMissingTariff = visitors.some((v) => !v.tariffId);
      if (hasMissingTariff && serviceTariffs.length > 0) {
        showToast('Выберите тариф для каждого посетителя');
        return;
      }
    }

    onSubmit({ phone, name, visitors, notify, channel });
  }, [phone, name, visitors, notify, channel, onSubmit, showToast, serviceTariffs]);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="new-booking-tab">
      {/* Phone */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="booking-phone">
          Телефон
        </label>
        <input
          id="booking-phone"
          type="text"
          placeholder="+7 (___) ___-__-__"
          className={inputClass}
          style={inputStyle}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={handlePhoneBlur}
          data-testid="input-phone"
        />
      </div>

      {/* Name */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="booking-name">
          Имя
        </label>
        <input
          id="booking-name"
          type="text"
          className={inputClass}
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-client-name"
        />
      </div>

      {/* Visitors — starts empty, shown after "Добавить посетителя" click */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Посетители</h4>
        {visitors.map((visitor, index) => (
          <div key={visitor.tempId} className="flex items-center gap-2 mb-2" data-testid="visitor-form-row">
            <input
              type="text"
              placeholder={`Посетитель ${index + 1}`}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={inputStyle}
              value={visitor.name}
              onChange={(e) => updateVisitor(visitor.tempId, 'name', e.target.value)}
            />
            <input
              type="number"
              placeholder="Возраст"
              className="w-20 rounded-lg border px-3 py-2 text-sm"
              style={inputStyle}
              value={visitor.age}
              onChange={(e) => updateVisitor(visitor.tempId, 'age', e.target.value)}
            />
            <select
              className="w-28 rounded-lg border px-2 py-2 text-sm"
              style={inputStyle}
              value={visitor.tariffId}
              onChange={(e) => updateVisitor(visitor.tempId, 'tariffId', e.target.value)}
            >
              {serviceTariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeVisitor(visitor.tempId)}
              className="text-red-400 hover:text-red-500 text-sm"
              aria-label="Удалить посетителя"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={addVisitor}
          className="text-brand text-xs hover:underline"
        >
          + Добавить посетителя
        </button>
      </div>

      {/* Channel — always visible */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="booking-channel">
          Канал связи
        </label>
        <select
          id="booking-channel"
          className={inputClass}
          style={inputStyle}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          data-testid="select-channel"
        >
          <option value="telegram">Telegram</option>
          <option value="max">MAX</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
      </div>

      {/* Notifications */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="rounded"
            data-testid="checkbox-notifications"
          />
          отправлять оповещения
        </label>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        className="w-full py-2.5 text-sm font-medium text-white rounded-lg transition-colors"
        style={{ backgroundColor: 'var(--brand, #004D56)' }}
        data-testid="btn-create-record"
      >
        Создать запись
      </button>
    </div>
  );
}
