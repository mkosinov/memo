'use client';

import { MasterPicker } from '@/app/components/shared/MasterPicker';
import { Combobox, type ComboboxOption } from '@/app/components/shared/Combobox';
import type { Master, Service, Location } from '@memo/domain';

/**
 * Controlled field values shared by both wirings (GH #280): edit feeds them
 * from the activity-prop-synced state, create from a local draft.
 */
export interface ActivityFormValues {
  /** datetime-local value 'YYYY-MM-DDTHH:MM'. */
  startDateTime: string;
  /** Duration display string «ЧЧ:ММ». */
  durationStr: string;
  isPrivate: boolean;
  serviceId: string;
  /** Create draft may be empty until autofilled from the service/location. */
  capacity: number | '';
  masterId: string;
  locationId: string;
}

interface ActivityFormProps {
  values: ActivityFormValues;
  services: Service[];
  masters: Master[];
  locations: Location[];
  /** Raw-value callbacks — mode semantics (instant patch vs local draft) live in the wrapper. */
  onDateTimeChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onPrivateToggle: () => void;
  onServiceChange: (serviceId: string) => void;
  onCapacityChange: (value: string) => void;
  onMasterChange: (masterId: string) => void;
  onLocationChange: (locationId: string) => void;
  /** data-testid on the root wrapper (Task-1 pattern: `settings-tab` today). */
  containerTestId?: string;
}

/**
 * Shared rows 1–3 of the activity settings form (GH #280): datetime + duration
 * + private toggle; service + age (read-only) + capacity + tariffs; master +
 * location. Markup extracted verbatim from SettingsTab (the эталон) — the
 * edit/create difference is entirely in the props wiring, never in markup.
 */
export function ActivityForm({
  values,
  services,
  masters,
  locations,
  onDateTimeChange,
  onDurationChange,
  onPrivateToggle,
  onServiceChange,
  onCapacityChange,
  onMasterChange,
  onLocationChange,
  containerTestId,
}: ActivityFormProps) {
  const serviceOptions: ComboboxOption[] = services.map((s) => ({ value: s.id, label: s.name }));
  const locationOptions: ComboboxOption[] = locations.map((l) => ({
    value: l.id,
    label: l.title,
    searchText: l.shortTitle ? `${l.title} ${l.shortTitle}` : l.title,
  }));

  // Selected service for display (domain Service carries tariffs, GH #142)
  const selectedService = services.find((s) => s.id === values.serviceId);

  // Age display: if maxAge > 0 → "{minAge}–{maxAge}", else → "{minAge}+"
  const ageDisplay = selectedService
    ? Number(selectedService.maxAge) > 0
      ? `${selectedService.minAge}–${selectedService.maxAge}`
      : `${selectedService.minAge}+`
    : null;

  const inputClass =
    'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid={containerTestId}>
      {/* Row 1: Date/Time + Duration + Private toggle */}
      <div className="flex gap-3 items-start" data-testid="settings-row-datetime-duration">
        <div className="flex-none">
          <label className="text-xs font-medium text-ink-mid block mb-1">
            Дата и время
          </label>
          <input
            id="settings-datetime"
            type="datetime-local"
            className={inputClass}
            style={inputStyle}
            value={values.startDateTime}
            onChange={(e) => onDateTimeChange(e.target.value)}
            data-testid="input-datetime"
          />
        </div>
        <div className="w-20">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-duration">
            Длительность
          </label>
          <input
            id="settings-duration"
            type="text"
            placeholder="ЧЧ:ММ"
            className={inputClass}
            style={inputStyle}
            value={values.durationStr}
            onChange={(e) => onDurationChange(e.target.value)}
            data-testid="input-duration"
          />
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5 pb-0.5">
          <span className="text-xs text-ink-mid">Приватное</span>
          <button
            type="button"
            role="switch"
            aria-checked={values.isPrivate}
            onClick={onPrivateToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              values.isPrivate ? 'bg-brand' : 'bg-ink-faint'
            }`}
            data-testid="toggle-private"
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                values.isPrivate ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Row 2: Service + Age (read-only) + Capacity */}
      <div className="flex gap-3" data-testid="settings-row-service-age-capacity">
        <div className="flex-1" data-testid="select-service">
          <label className="text-xs font-medium text-ink-mid block mb-1">
            Услуга
          </label>
          <Combobox
            clearLabel="Выберите"
            value={values.serviceId}
            options={serviceOptions}
            onChange={(v) => onServiceChange(v)}
            className={inputClass}
            ariaLabel="Услуга"
          />
        </div>
        <div className="w-20">
          <label className="text-xs font-medium text-ink-mid block mb-1">
            Возраст
          </label>
          <div
            className="w-full rounded-lg border px-3 py-2 text-sm bg-surface text-ink-light"
            style={inputStyle}
            data-testid="age-display"
          >
            {ageDisplay || '—'}
          </div>
        </div>
        <div className="w-20">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-capacity">
            Вместимость
          </label>
          <input
            id="settings-capacity"
            type="number"
            min={1}
            className={inputClass}
            style={inputStyle}
            value={values.capacity}
            onChange={(e) => onCapacityChange(e.target.value)}
            data-testid="input-capacity"
          />
        </div>
      </div>

      {/* Tariffs */}
      {selectedService?.tariffs && selectedService.tariffs.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-mid">Тарифы:</span>
          {selectedService.tariffs.map((tariff) => (
            <div key={tariff.id} className="flex items-center justify-between text-sm px-2 py-1 bg-surface rounded">
              <span className="text-ink-mid">{tariff.title}</span>
              <span className="font-medium text-ink">{tariff.price.toLocaleString('ru-RU')} ₽</span>
            </div>
          ))}
        </div>
      )}

      {/* Row 3: Master + Location */}
      <div className="flex gap-3" data-testid="settings-row-master-location">
        <div className="flex-1">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-master">
            Мастер
          </label>
          <MasterPicker
            masters={masters}
            value={values.masterId}
            onChange={(value) => onMasterChange(value)}
            className={`${inputClass} appearance-none`}
          />
        </div>
        <div className="flex-1" data-testid="select-location">
          <label className="text-xs font-medium text-ink-mid block mb-1">
            Локация
          </label>
          <Combobox
            clearLabel="Выберите"
            value={values.locationId}
            options={locationOptions}
            onChange={(v) => onLocationChange(v)}
            className={inputClass}
            ariaLabel="Локация"
          />
        </div>
      </div>
    </div>
  );
}
