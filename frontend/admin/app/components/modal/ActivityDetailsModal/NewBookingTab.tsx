'use client';

import React, { useState, useCallback } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import PhoneInput, { type PickedClient } from '@/app/components/shared/PhoneInput';
import { getClientsPaged } from '@memo/api-client';
import type { Tariff } from '@memo/domain';
import type { ScheduleAdminDTO } from '@memo/domain';
import type { CreateRecordInput } from '@/hooks/useRecordMutations';

interface NewVisitor {
  tempId: string;
  name: string;
  age: string;
  tariffId: string;
}

/** Booking submit payload — disjoint pick/unpicked union, defined once by
 *  the mutations hook (single source of truth for the save contract). */
export type NewBookingSubmitData = CreateRecordInput;

interface NewBookingTabProps {
  activity: ScheduleAdminDTO;
  serviceTariffs: Tariff[];
  onSubmit: (data: NewBookingSubmitData) => void;
  showToast: (message: string) => void;
}

export function NewBookingTab({ activity, serviceTariffs, onSubmit, showToast }: NewBookingTabProps) {
  const [pickedClient, setPickedClient] = useState<PickedClient | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(false);
  const [channel, setChannel] = useState('telegram');
  const [visitors, setVisitors] = useState<NewVisitor[]>([]);
  const [seatsCount, setSeatsCount] = useState(1);

  // GH #221: picking a suggestion binds the record to that client by id —
  // phone + name freeze read-only (decision 10: editing a client's name
  // belongs to the client card). × detaches the pick and restores typing.
  const handlePick = useCallback((client: PickedClient) => {
    setPickedClient(client);
  }, []);

  const handleClearPick = useCallback(() => {
    setPickedClient(null);
    setPhone('');
    setName('');
  }, []);

  // Visible formatted string (WYSIWYG): the unpicked save payload sends it
  // verbatim, exactly as rendered in the field.
  const handlePhoneInput = useCallback((value: string) => {
    setPhone(value);
  }, []);

  // Stable search identity (RemoteSearchSelect memoizes `search` on it) —
  // an inline lambda here would churn the debounce closure every render.
  const searchClients = useCallback(
    ({ phone: digits, per_page }: { phone: string; per_page: number }) =>
      getClientsPaged({ phone: digits, per_page }).then((r) => r.items),
    [],
  );

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
    // If there are visitors, validate tariff is selected
    if (visitors.length > 0) {
      const hasMissingTariff = visitors.some((v) => !v.tariffId);
      if (hasMissingTariff && serviceTariffs.length > 0) {
        showToast('Выберите тариф для каждого посетителя');
        return;
      }
    }

    // Picked → bind by id; unpicked → the visible formatted string + typed
    // name name the (possibly new) client (spec §5). The `kind` tag makes
    // the two branches disjoint payloads, not placeholder empties.
    if (pickedClient) {
      onSubmit({
        kind: 'picked',
        client_id: pickedClient.id,
        visitors,
        notify,
        channel,
        seats: seatsCount,
      });
    } else {
      // Completeness guard (GH #221 spec §2 decision 11, §6 step 2): the
      // visible value must be a complete valid number before anything is
      // fetched or created. Picked clients are never validated (stored data).
      // Same library + same RU default as the AsYouType mask.
      // An EMPTY phone is NOT guarded: the phone-less quick-add predates
      // #221 (spec §10 — write paths untouched) and must keep working; the
      // guard targets TYPED-BUT-INCOMPLETE numbers only (its message says
      // «возможно, он введён не полностью»).
      if (phone.trim() && !parsePhoneNumberFromString(phone, 'RU')?.isValid()) {
        showToast('Проверьте номер телефона — возможно, он введён не полностью');
        return; // nothing fetched, nothing created
      }
      onSubmit({
        kind: 'unpicked',
        phone,
        name,
        client_id: null,
        visitors,
        notify,
        channel,
        seats: seatsCount,
      });
    }
  }, [phone, name, pickedClient, visitors, notify, channel, seatsCount, onSubmit, showToast, serviceTariffs]);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="new-booking-tab">
      {/* Phone — adaptive-mask typeahead (GH #221) */}
      <PhoneInput
        onSearch={searchClients}
        onPick={handlePick}
        onClear={handleClearPick}
        picked={pickedClient}
        onInputValueChange={handlePhoneInput}
      />

      {/* Name — editable only for an unpicked (new) client; when a client is
          picked it displays the stored name read-only */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="booking-name">
          Имя
        </label>
        <input
          id="booking-name"
          type="text"
          className={inputClass}
          style={inputStyle}
          value={pickedClient ? pickedClient.name || '' : name}
          onChange={(e) => setName(e.target.value)}
          readOnly={pickedClient !== null}
          data-testid="input-client-name"
        />
      </div>

      {/* Seats */}
      <div>
        <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="booking-seats">
          Мест
        </label>
        <input
          id="booking-seats"
          type="number"
          min={1}
          max={10}
          value={seatsCount}
          onChange={(e) => setSeatsCount(Number(e.target.value))}
          className={inputClass}
          style={inputStyle}
          data-testid="input-seats"
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
