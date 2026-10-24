'use client';

import { useState, useCallback } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUI } from '@/contexts/UIContext';
import { ActivityForm } from './ActivityForm';
import {
  formatTime,
  hhmmToMinutes,
  snapMinutes,
  buildDateTimeLocal,
  composeLocalISO,
  formatDateRu,
} from '@/lib/datetime';
import { parseApiError } from '@/app/lib/api/parseApiError';

/**
 * Слот-префиллы (GH #280): календарная дата слота (ISO-ключ 'YYYY-MM-DD' —
 * колонка дня сетки) плюс минуты от полуноча. Дату передаёт родительская
 * модалка (WeekView/DayView), шаг сетки вкладка берёт из настроек сама.
 */
export interface CreateDefaults {
  date: string;
  startMinutes: number;
}

interface Props {
  defaults: CreateDefaults;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => void;
}

// Create-mode anchors (GH #280 spec §55): same elements as the edit эталон,
// create-* testids instead of input-*/toggle-private.
const createTestIds = {
  datetime: 'create-datetime',
  duration: 'create-duration',
  privateToggle: 'create-private',
  capacity: 'create-capacity',
  tariffs: 'create-service-tariffs',
  serviceContainer: 'create-service',
  masterContainer: 'create-master',
  locationContainer: 'create-location',
} as const;

/**
 * Единственная вкладка модалки в режиме создания (GH #258/#259, spec §2.1;
 * GH #280 — общий ActivityForm с формой редактирования). Локальный черновик
 * (никаких instant-patch), отправка одной кнопкой «Создать» → addActivity с
 * готовым `start` из значения поля (занятие создаётся на ВЫБРАННУЮ дату, не
 * на «открытую неделю + день недели»). Услуга/локация авто-заполняют
 * длительность/вместимость (domain-rules/activities.md); вместимость ≥ 1 —
 * путь «пустое поле → 0 в payload» исчез. Конфликт-валидации нет (D8).
 */
export function CreateActivityTab({ defaults, onSavingChange, onSaved }: Props) {
  const { masters, services, locations, addActivity } = useScheduleData();
  const { gridFrequency } = useGridSettings();
  const { showToast } = useUI();

  const [masterId, setMasterId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startDateTime, setStartDateTime] = useState(() =>
    buildDateTimeLocal(
      defaults.date,
      snapMinutes(defaults.startMinutes, gridFrequency),
      gridFrequency,
    ),
  );
  const [durationStr, setDurationStr] = useState('');
  const [capacity, setCapacity] = useState<number | ''>('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);

  // Валидация (GH #280 spec §52): дата-время непусто; «ЧЧ:ММ» разбирается и > 0;
  // вместимость ≥ 1 (Number('') = 0 — пустое поле блокирует, в payload ноль не уходит).
  const durationMinutes = hhmmToMinutes(durationStr);
  const durationValid = Number.isFinite(durationMinutes) && durationMinutes > 0;
  const canSave =
    !!masterId &&
    !!serviceId &&
    !!locationId &&
    !!startDateTime &&
    durationValid &&
    Number(capacity) >= 1;

  // Снап и пересборка значения при каждом ручном изменении — как в эталоне
  // (SettingsTab.handleDateTimeChange); пустое значение честно опустошает поле.
  const handleDateTimeChange = useCallback(
    (value: string) => {
      if (!value) {
        setStartDateTime('');
        return;
      }
      const [datePart, timePart] = value.split('T');
      setStartDateTime(buildDateTimeLocal(datePart, hhmmToMinutes(timePart), gridFrequency));
    },
    [gridFrequency],
  );

  // Автозаполнение длительности из услуги; повторный выбор перезаписывает.
  const handleServiceChange = useCallback(
    (newServiceId: string) => {
      setServiceId(newServiceId);
      const svc = services.find((s) => s.id === newServiceId);
      if (svc) {
        setDurationStr(formatTime(svc.durationMinutes));
      }
    },
    [services],
  );

  // Автозаполнение вместимости из defaultCapacity локации; повторный выбор
  // перезаписывает. Нет дефолта → 0 → «Создать» блокируется до ручного ввода.
  const handleLocationChange = useCallback(
    (newLocationId: string) => {
      setLocationId(newLocationId);
      const loc = locations.find((l) => l.id === newLocationId);
      if (loc) {
        setCapacity(loc.defaultCapacity ?? 0);
      }
    },
    [locations],
  );

  const handleCapacityChange = useCallback((value: string) => {
    // '' остаётся '' (пустое поле блокирует «Создать», не «молча 0 в payload»).
    setCapacity(value === '' ? '' : Number(value));
  }, []);

  const submit = () => {
    if (!canSave || saving) return;
    // Значение поля всегда снапнуто (префилл и каждый ручной ввод) — берём его
    // как есть; composeLocalISO добавляет канонические секунды ':00'.
    const [datePart, timePart] = startDateTime.split('T');
    const start = composeLocalISO(datePart, hhmmToMinutes(timePart));
    setSaving(true);
    onSavingChange(true);
    addActivity(
      {
        masterId,
        serviceId,
        locationId,
        start,
        durationMinutes,
        capacity: Number(capacity),
        isPrivate,
      },
      {
        onSuccess: () => {
          setSaving(false);
          onSavingChange(false);
          // Дата — из значения поля (занятие могло уйти в чужую неделю — тост
          // называет выбранную дату, не день недели; spec §50).
          showToast(`Создано: ${service?.name} — ${formatDateRu(datePart)}, ${timePart}`);
          onSaved();
        },
        onError: (err) => {
          setSaving(false);
          onSavingChange(false);
          // Форма остаётся открытой с введённым (spec §2.1.7).
          showToast(parseApiError(err).message, 'error');
        },
      },
    );
    // IMPORTANT: mutate() — fire-and-forget; NO synchronous setSaving(false) here.
    // saving=true lives until a callback — modal must not close, button must not press (spec §2.1.7).
  };

  return (
    <div className="p-4 space-y-3">
      <ActivityForm
        services={services}
        masters={masters}
        locations={locations}
        testIds={createTestIds}
        values={{
          startDateTime,
          durationStr,
          isPrivate,
          serviceId,
          capacity,
          masterId,
          locationId,
        }}
        onDateTimeChange={handleDateTimeChange}
        onDurationChange={setDurationStr}
        onPrivateToggle={() => setIsPrivate(!isPrivate)}
        onServiceChange={handleServiceChange}
        onCapacityChange={handleCapacityChange}
        onMasterChange={setMasterId}
        onLocationChange={handleLocationChange}
      />

      <button
        type="button"
        data-testid="btn-create-activity"
        onClick={submit}
        disabled={!canSave || saving}
        className="w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        Создать
      </button>

    </div>
  );
}
