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
  /** Single-mode (edit combobox) value; ignored by the multi checkbox group. */
  locationId: string;
}

/**
 * GH #595 §4.1: the location field wiring branches by mode — edit keeps the
 * single-select Combobox (markup byte-identical), create renders a checkbox
 * group (fieldset/legend, one <label>+checkbox per directory row).
 */
export type LocationFieldBinding =
  | { mode: 'single'; onLocationChange: (locationId: string) => void }
  | { mode: 'multi'; ids: string[]; onToggle: (locationId: string) => void };

/** GH #595 §4.2: hint line rendered in place of the hidden capacity field. */
export interface CapacityHint {
  text: string;
  /** 'danger' — block reason (a hall without default); 'default' — policy note. */
  tone: 'default' | 'danger';
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
  /** GH #595: location field wiring — 'single' (edit) or 'multi' (create). */
  locationField: LocationFieldBinding;
  /**
   * GH #595 §4.2: 2+ selected locations hide the capacity input (each created
   * activity takes its own location default); `capacityHint` renders in its
   * place, aria-live="polite" (a disabled button does not announce its reason).
   */
  capacityHidden?: boolean;
  capacityHint?: CapacityHint;
  /** data-testid on the root wrapper (Task-1 pattern: `settings-tab` today). */
  containerTestId?: string;
  /**
   * GH #280 create-mode anchors: a set field replaces the edit-mode anchor on
   * that element (e.g. `create-datetime`); an unset field keeps the edit
   * default, so edit-mode DOM is byte-identical. `tariffs`, the combobox
   * containers and the capacity hint have NO edit default — the attribute
   * renders only when set.
   */
  testIds?: ActivityFormTestIds;
}

/** Optional per-element testid overrides (see {@link ActivityFormProps.testIds}). */
export interface ActivityFormTestIds {
  datetime?: string;           // default 'input-datetime'
  duration?: string;           // default 'input-duration'
  privateToggle?: string;      // default 'toggle-private'
  capacity?: string;           // default 'input-capacity'
  tariffs?: string;            // no default (edit renders no tariffs testid)
  serviceContainer?: string;   // no default (Combobox containerTestId)
  masterContainer?: string;    // no default (MasterPicker containerTestId)
  locationContainer?: string;  // no default (fieldset in multi mode / Combobox containerTestId)
  /** No default — rendered only in create multi-location mode (capacityHidden). */
  capacityHint?: string;
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
  locationField,
  capacityHidden,
  capacityHint,
  containerTestId,
  testIds,
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
            data-testid={testIds?.datetime ?? 'input-datetime'}
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
            data-testid={testIds?.duration ?? 'input-duration'}
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
            data-testid={testIds?.privateToggle ?? 'toggle-private'}
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
            containerTestId={testIds?.serviceContainer}
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
        {/* GH #595 §4.2: при 2+ локациях поле скрыто — умолчание берёт каждый зал */}
        {!capacityHidden && (
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
              data-testid={testIds?.capacity ?? 'input-capacity'}
            />
          </div>
        )}
      </div>

      {/* GH #595 §4.2: подсказка вместо скрытого поля вместимости; aria-live —
          задизейбленная кнопка не анонсирует причину скринридеру. */}
      {capacityHidden && capacityHint && (
        <p
          data-testid={testIds?.capacityHint}
          aria-live="polite"
          className="text-xs"
          style={{ color: capacityHint.tone === 'danger' ? 'var(--danger)' : 'var(--ink-light)' }}
        >
          {capacityHint.text}
        </p>
      )}

      {/* Tariffs */}
      {selectedService?.tariffs && selectedService.tariffs.length > 0 && (
        <div className="space-y-1" data-testid={testIds?.tariffs}>
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
            containerTestId={testIds?.masterContainer}
          />
        </div>
        <div className="flex-1" data-testid="select-location">
          {locationField.mode === 'multi' ? (
            /* GH #595 §4.1: create — группа чекбоксов; имя группы через
               <fieldset><legend>, каждая строка — настоящий <label> (без
               дублирующего aria-label); состав/порядок — справочник locations
               (как у комбобокса), пока не загружен — группа пуста. */
            <fieldset
              data-testid={testIds?.locationContainer}
              className="rounded-lg border border-line px-3 pb-2 pt-1.5"
            >
              <legend className="px-1 text-xs font-medium text-ink-mid">Локация</legend>
              <ul className="space-y-0.5">
                {locations.map((loc) => (
                  <li key={loc.id}>
                    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-ink">
                      <input
                        type="checkbox"
                        data-testid="create-location-check"
                        className="accent-brand"
                        checked={locationField.ids.includes(loc.id)}
                        onChange={() => locationField.onToggle(loc.id)}
                      />
                      <span className="truncate">{loc.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : (
            <>
              <label className="text-xs font-medium text-ink-mid block mb-1">
                Локация
              </label>
              <Combobox
                clearLabel="Выберите"
                value={values.locationId}
                options={locationOptions}
                onChange={(v) => locationField.onLocationChange(v)}
                className={inputClass}
                ariaLabel="Локация"
                containerTestId={testIds?.locationContainer}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
