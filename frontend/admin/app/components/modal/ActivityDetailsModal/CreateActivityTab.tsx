'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUI } from '@/contexts/UIContext';
import { ActivityForm, type CapacityHint } from './ActivityForm';
import type { Location } from '@memo/domain';
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
 * колонка дня сетки) плюс минуты от полуночи. Дату передаёт родительская
 * модалка (WeekView/DayView), шаг сетки вкладка берёт из настроек сама.
 * GH #595 §4.4: опциональный locationId — клик по пустому слоту DayView
 * (режим колонок-по-локациям) предотмечает чекбокс этой локации по прибытии
 * справочника (источник-проводка — DayView, отдельная задача).
 */
export interface CreateDefaults {
  date: string;
  startMinutes: number;
  locationId?: string;
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
  capacityHint: 'create-capacity-hint',
} as const;

/** §4.2: умолчание считается незаданным, если поле отсутствует ИЛИ равно 0. */
function hasDefault(loc: Location): boolean {
  return !!loc.defaultCapacity && loc.defaultCapacity >= 1;
}

/**
 * Единственная вкладка модалки в режиме создания (GH #258/#259, spec §2.1;
 * GH #280 — общий ActivityForm с формой редактирования; GH #595 — мультивыбор
 * локаций чекбоксами и правила вместимости §4.1–§4.2). Локальный черновик
 * (никаких instant-patch), отправка кнопкой «Создать» → addActivity с готовым
 * `start` из значения поля. Услуга/набор локаций авто-заполняют длительность/
 * вместимость (domain-rules/activities.md); вместимость ≥ 1 — путь «пустое
 * поле → 0 в payload» исчез. Конфликт-валидации нет (D8).
 */
export function CreateActivityTab({ defaults, onSavingChange, onSaved }: Props) {
  const { masters, services, locations, addActivity } = useScheduleData();
  const { gridFrequency } = useGridSettings();
  const { showToast } = useUI();

  const [masterId, setMasterId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);
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

  // §4.1: порядок набора — порядок чекбоксов (= справочник), не клика.
  const checkedLocations = locations.filter((l) => locationIds.includes(l.id));
  const capacityHidden = checkedLocations.length >= 2;
  // §4.2: при 2+ первая по порядку чекбоксов отмеченная локация без умолчания
  // блокирует «Создать» и называется в подсказке.
  const firstWithoutDefault = capacityHidden
    ? checkedLocations.find((l) => !hasDefault(l))
    : undefined;

  // Валидация (GH #280 spec §52 + GH #595 §4.1–§4.2): дата-время непусто;
  // «ЧЧ:ММ» разбирается и > 0; ≥1 отмеченной локации; вместимость — при
  // ровно 1 поле ≥ 1 (Number('') = 0 — пустое поле блокирует), при 2+ у
  // каждой отмеченной есть умолчание.
  const durationMinutes = hhmmToMinutes(durationStr);
  const durationValid = Number.isFinite(durationMinutes) && durationMinutes > 0;
  const canSave =
    !!masterId &&
    !!serviceId &&
    checkedLocations.length >= 1 &&
    !!startDateTime &&
    durationValid &&
    (capacityHidden ? firstWithoutDefault === undefined : Number(capacity) >= 1);

  const capacityHint: CapacityHint | undefined = capacityHidden
    ? firstWithoutDefault
      ? { text: `У зала «${firstWithoutDefault.title}» не задана вместимость`, tone: 'danger' }
      : { text: 'Вместимость — по умолчанию каждого зала', tone: 'default' }
    : undefined;

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

  // Единое правило §4.2: ЛЮБОЙ переход набора к ровно 1 (клик, рефетч,
  // префилл) автозаполняет вместимость умолчанием оставшейся локации —
  // повторная смена набора до ровно 1 перезаписывает ручный ввод; нет
  // умолчания → 0 → блокировка до ручного ввода (канон #280).
  const applyLocationSet = useCallback(
    (next: string[]) => {
      setLocationIds(next);
      if (next.length === 1) {
        const loc = locations.find((l) => l.id === next[0]);
        setCapacity(loc?.defaultCapacity ?? 0);
      }
    },
    [locations],
  );

  const handleLocationToggle = useCallback(
    (id: string) => {
      const next = locationIds.includes(id)
        ? locationIds.filter((x) => x !== id)
        : [...locationIds, id];
      applyLocationSet(next);
    },
    [locationIds, applyLocationSet],
  );

  // §4.1: при рефетче справочника выбранные id, которых больше нет,
  // отбрасываются из набора (переход к ровно 1 — тем же единым правилом).
  useEffect(() => {
    const next = locationIds.filter((id) => locations.some((l) => l.id === id));
    if (next.length === locationIds.length) return;
    applyLocationSet(next);
  }, [locations, locationIds, applyLocationSet]);

  // §4.4: предзаполненный префилл-ид живёт до прибытия справочника и
  // отмечается по его приходу; id нет в справочнике → префилл тихо гаснет
  // (однократно — снятое пользователем не возвращается).
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    const prefillId = defaults.locationId;
    if (!prefillId || prefillAppliedRef.current || locations.length === 0) return;
    prefillAppliedRef.current = true;
    if (locations.some((l) => l.id === prefillId) && !locationIds.includes(prefillId)) {
      applyLocationSet([...locationIds, prefillId]);
    }
  }, [locations, defaults.locationId, locationIds, applyLocationSet]);

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
    // Переходный путь (задача 2): отправка ещё одиночная — уходит первая
    // отмеченная по порядку чекбоксов локация; при 2+ поле скрыто, вместимость
    // каждой локации — её умолчание (§4.2). Мульти-отправка addActivities —
    // следующая задача.
    const firstChecked = checkedLocations[0];
    const effectiveCapacity = capacityHidden
      ? (firstChecked.defaultCapacity ?? 0)
      : Number(capacity);
    setSaving(true);
    onSavingChange(true);
    addActivity(
      {
        masterId,
        serviceId,
        locationId: firstChecked.id,
        start,
        durationMinutes,
        capacity: effectiveCapacity,
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
          locationId: '',
        }}
        onDateTimeChange={handleDateTimeChange}
        onDurationChange={setDurationStr}
        onPrivateToggle={() => setIsPrivate(!isPrivate)}
        onServiceChange={handleServiceChange}
        onCapacityChange={handleCapacityChange}
        onMasterChange={setMasterId}
        locationField={{ mode: 'multi', ids: locationIds, onToggle: handleLocationToggle }}
        capacityHidden={capacityHidden}
        capacityHint={capacityHint}
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
