/**
 * CreateActivityTab — режим create общего ActivityForm (GH #280, унификация
 * с формой редактирования; GH #595 — чекбокс-группа локаций и правила
 * вместимости §4.1–§4.2, мульти-отправка §4.3). Тестируем обёртку: префилл
 * даты-времени из слота (со снапом к сетке), автозаполнение
 * длительности/вместимости из справочников, гейты «Создать» (дата-время
 * непусто, ЧЧ:ММ > 0, вместимость ≥ 1), мультивыбор локаций (автозаполнение
 * при ровно 1, скрытие поля и подсказки aria-live при 2+, блок зала без
 * умолчания), отбрасывание отсутствующих id при рефетче, префилл-ид по
 * прибытии списка, мульти-отправку addActivities: порядок входов = порядок
 * чекбоксов, вместимость по правилу §4.2, полный/частичный/нулевой успех,
 * порядок сообщения ошибки, disabled полей на время полёта.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { createMockScheduleData, createMockGridSettings, createMockUIContext } from './helpers/mockContexts';
import { mockMasters, mockServices } from './helpers/mockData';
import type { AddActivityInput, AddActivityOutcome } from '@/contexts/schedule/ScheduleDataContext';
import type { ActivityResponse } from '@memo/api-client';
import { ApiError } from '@memo/api-client';

// 1. Mock context modules (before importing the component)
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));
vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(),
}));
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { CreateActivityTab } from '@/app/components/modal/ActivityDetailsModal/CreateActivityTab';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUI } from '@/contexts/UIContext';

const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseGridSettings = vi.mocked(useGridSettings);
const mockUseUI = vi.mocked(useUI);

// Справочники: shared мастера/услуги (s1 «Картина маслом» 150 мин с двумя
// тарифами, s2 «Картина акрилом» 120 мин); локации — локальный фиксстур с
// defaultCapacity (в shared mockLocations этого поля нет). l0/l3 — залы
// БЕЗ умолчания (поле отсутствует / равно 0 — §4.2), l0 стоит первым по
// порядку чекбоксов.
const locations = [
  { id: 'l0', title: 'Мансарда' },
  { id: 'l1', title: 'Студия', defaultCapacity: 6 },
  { id: 'l2', title: 'Лофт', defaultCapacity: 10 },
  { id: 'l3', title: 'Ангар', defaultCapacity: 0 },
];

// Слот: среда 2026-10-21, 14:00 (840 минут — на 30-минутной сетке).
const defaults = { date: '2026-10-21', startMinutes: 840 };
const onSavingChange = vi.fn();
const onSaved = vi.fn();

// ── §4.3 исходы addActivities ────────────────────────────────────────────

/** Минимальный ActivityResponse — вкладка читает только status/locationId. */
function createdOutcome(locationId: string): AddActivityOutcome {
  const activity = {
    id: `created-${locationId}`,
    master_id: 'm1',
    service_id: 's1',
    location_id: locationId,
    start: '2026-10-21T14:00:00',
    duration: 150,
    capacity: 6,
    is_private: false,
    comment: null,
    record_info: null,
    created_at: '',
    updated_at: '',
    occupied: 0,
  } as unknown as ActivityResponse;
  return { locationId, status: 'fulfilled', activity };
}

function rejectedOutcome(locationId: string, error: unknown): AddActivityOutcome {
  return { locationId, status: 'rejected', error };
}

function renderTab(overrides?: {
  defaults?: { date: string; startMinutes: number; locationId?: string };
}) {
  return render(
    <CreateActivityTab
      defaults={overrides?.defaults ?? defaults}
      onSavingChange={onSavingChange}
      onSaved={onSaved}
    />,
  );
}

/** Выбор в комбобоксе по тестиду контейнера: клик по триггеру → клик по опции. */
function pickInCombobox(containerTestId: string, optionValue: string) {
  fireEvent.click(within(screen.getByTestId(containerTestId)).getByTestId('combobox-trigger'));
  fireEvent.click(screen.getByTestId(`combobox-option-${optionValue}`));
}

/** Клик по чекбоксу локации (§4.1: каждая строка — настоящий <label>). */
function toggleLocation(title: string) {
  fireEvent.click(screen.getByLabelText(title));
}

/** Валидная форма: мастер m1 + услуга s1 (длит. 150) + локация l1 (вмест. 6). */
function fillValidForm() {
  pickInCombobox('create-master', 'm1');
  pickInCombobox('create-service', 's1');
  toggleLocation('Студия');
}

/** Перерисовать вкладку с новым значением контекста (рефетч справочника). */
function rerenderWithLocations(view: ReturnType<typeof renderTab>, nextLocations: typeof locations, defs = defaults) {
  mockUseScheduleData.mockReturnValue(
    createMockScheduleData({
      masters: mockMasters,
      services: mockServices,
      locations: nextLocations,
      addActivity: vi.fn(),
    }),
  );
  view.rerender(
    <CreateActivityTab defaults={defs} onSavingChange={onSavingChange} onSaved={onSaved} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseScheduleData.mockReturnValue(
    createMockScheduleData({
      masters: mockMasters,
      services: mockServices,
      locations,
      addActivity: vi.fn(),
    }),
  );
  // gridFrequency = 30 (сетка по умолчанию)
  mockUseGridSettings.mockReturnValue(createMockGridSettings());
  mockUseUI.mockReturnValue(createMockUIContext());
});

describe('CreateActivityTab (create-режим общего ActivityForm, GH #280)', () => {
  it('renders the location field as a checkbox group: fieldset/legend, one labelled check per directory row', () => {
    renderTab();
    expect(screen.getByTestId('create-datetime')).toBeInTheDocument();
    expect(screen.getByTestId('create-duration')).toBeInTheDocument();
    expect(screen.getByTestId('create-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('btn-create-activity')).toBeInTheDocument();

    // Приватность — тумблер role="switch", не чекбокс (spec VCC, US-4)
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('data-testid', 'create-private');

    // Старые контролы «день недели»/«время начала» исчезли вместе с полями
    expect(screen.queryByTestId('create-day')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-time')).not.toBeInTheDocument();

    // Комбобоксы: триггер живёт внутри create-* контейнера
    for (const id of ['create-service', 'create-master']) {
      expect(within(screen.getByTestId(id)).getByTestId('combobox-trigger')).toBeInTheDocument();
    }

    // GH #595 §4.1: локация — группа чекбоксов <fieldset><legend> «Локация»
    // (имя группы через legend), состав/порядок — справочник локаций.
    const group = screen.getByRole('group', { name: 'Локация' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group).toHaveAttribute('data-testid', 'create-location');
    const checks = within(group).getAllByTestId('create-location-check');
    expect(checks).toHaveLength(locations.length);
    for (const loc of locations) {
      expect(within(group).getByLabelText(loc.title)).toBeInTheDocument();
    }
    // комбобокса локации больше нет
    expect(within(group).queryByTestId('combobox-trigger')).not.toBeInTheDocument();
  });

  it('renders an empty group while the locations directory has not loaded', () => {
    const view = renderTab();
    rerenderWithLocations(view, []);
    const group = screen.getByRole('group', { name: 'Локация' });
    expect(within(group).queryAllByTestId('create-location-check')).toHaveLength(0);
  });

  it('prefills datetime from the clicked slot, snapped to grid (845 → 14:00)', () => {
    renderTab({ defaults: { date: '2026-10-21', startMinutes: 845 } });
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-21T14:00');
  });

  it('re-snaps and rebuilds the value on every manual change (15:17 → 15:30)', () => {
    renderTab();
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:17' } });
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-28T15:30');
  });

  it('auto-fills duration «ЧЧ:ММ» from the service; re-selection overwrites', () => {
    renderTab();
    pickInCombobox('create-service', 's1'); // 150 мин
    expect(screen.getByTestId('create-duration')).toHaveValue('02:30');
    pickInCombobox('create-service', 's2'); // 120 мин
    expect(screen.getByTestId('create-duration')).toHaveValue('02:00');
  });

  it('§4.2 exactly 1: auto-fills capacity from the checked location; manual edit; set re-transition overwrites', () => {
    renderTab();
    toggleLocation('Студия'); // defaultCapacity 6
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);

    // ручная правка работает, пока набор остаётся ровно 1
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '4' } });
    expect(screen.getByTestId('create-capacity')).toHaveValue(4);

    // 2+ → поле скрыто; возврат к ровно 1 перезаписывает умолчанием (§4.2)
    toggleLocation('Лофт');
    expect(screen.queryByTestId('create-capacity')).not.toBeInTheDocument();
    toggleLocation('Лофт');
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);

    // зал без умолчания при ровно 1 → 0 → блок до ручного ввода (#280), поля видны
    toggleLocation('Студия');
    toggleLocation('Мансарда');
    expect(screen.getByTestId('create-capacity')).toHaveValue(0);
    expect(screen.queryByTestId('create-capacity-hint')).not.toBeInTheDocument();
  });

  it('shows the selected service tariffs under the create-service-tariffs anchor', () => {
    renderTab();
    expect(screen.queryByTestId('create-service-tariffs')).not.toBeInTheDocument();
    pickInCombobox('create-service', 's1');
    const tariffs = screen.getByTestId('create-service-tariffs');
    expect(within(tariffs).getByText('Взрослый')).toBeInTheDocument();
    expect(within(tariffs).getByText('Детский')).toBeInTheDocument();
  });

  it('gates «Создать»: empty datetime, bad duration, capacity < 1 each block the button', () => {
    renderTab();
    const btn = screen.getByTestId('btn-create-activity');
    fillValidForm();
    expect(btn).toBeEnabled();

    // Дата-время очищено → блок («значение даты-времени непусто»)
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-21T14:00' } });
    expect(btn).toBeEnabled();

    // Длительность: некорректный формат и 00:00 → блок
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '99' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '00:00' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '01:30' } });
    expect(btn).toBeEnabled();

    // Вместимость: пусто / 0 / -1 → блок; 1 → ок (GH #280: путь «пусто → 0» исчез)
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '0' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '-1' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '1' } });
    expect(btn).toBeEnabled();
  });

  it('gates «Создать» until master+service+location chosen; 0 checked locations block', () => {
    renderTab();
    const btn = screen.getByTestId('btn-create-activity');
    expect(btn).toBeDisabled(); // дата-время префиллита, справочники не выбраны

    pickInCombobox('create-master', 'm1');
    expect(btn).toBeDisabled();
    pickInCombobox('create-service', 's1'); // длительность заполнится сама
    expect(btn).toBeDisabled(); // 0 локаций → блок (§4.1: ≥1 отмеченной)
    toggleLocation('Студия');
    expect(btn).toBeEnabled();
    toggleLocation('Студия'); // сняли единственную → снова блок
    expect(btn).toBeDisabled();
  });

  it('§4.2 2+: hides the capacity field, shows the policy hint aria-live=polite; defaults allow saving', () => {
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');

    toggleLocation('Студия');
    toggleLocation('Лофт'); // оба зала с умолчаниями

    expect(screen.queryByTestId('create-capacity')).not.toBeInTheDocument();
    const hint = screen.getByTestId('create-capacity-hint');
    expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(hint).toHaveTextContent('Вместимость — по умолчанию каждого зала');
    expect(screen.getByTestId('btn-create-activity')).toBeEnabled();
  });

  it('§4.2 2+: a checked hall without default blocks «Создать»; hint names the FIRST such by checkbox order', () => {
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');

    // «Мансарда» (без умолчания) стоит первой по порядку чекбоксов, но
    // отмечается второй — подсказка называет её, не «Лофт».
    toggleLocation('Лофт');
    toggleLocation('Мансарда');
    const btn = screen.getByTestId('btn-create-activity');
    expect(btn).toBeDisabled();
    const hint = screen.getByTestId('create-capacity-hint');
    expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(hint).toHaveTextContent('У зала «Мансарда» не задана вместимость');

    // снятие зала-нарушителя возвращает набор к ровно 1 → поле вместимости
    // снова видно с умолчанием оставшейся локации (§4.2), кнопка разблокирована
    toggleLocation('Мансарда');
    expect(screen.queryByTestId('create-capacity-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-capacity')).toHaveValue(10);
    expect(btn).toBeEnabled();
  });

  it('§4.2 2+: defaultCapacity = 0 counts as «no default» and blocks', () => {
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');

    toggleLocation('Студия'); // умолчание 6
    toggleLocation('Ангар'); // умолчание 0 → незаданное
    expect(screen.getByTestId('btn-create-activity')).toBeDisabled();
    expect(screen.getByTestId('create-capacity-hint')).toHaveTextContent(
      'У зала «Ангар» не задана вместимость',
    );
  });

  it('§4.1 refetch drops selected ids missing from the directory; transition back to exactly 1 auto-fills', () => {
    const view = renderTab();
    toggleLocation('Студия');
    toggleLocation('Лофт');

    // Рефетч без «Лофта»: id отброшен, набор стал ровно 1 → вместимость
    // появляется заполненной умолчанием оставшейся локации (§4.2 единое правило).
    rerenderWithLocations(view, [locations[0], locations[1]]); // Мансарда + Студия
    const group = screen.getByTestId('create-location');
    expect(within(group).queryByLabelText('Лофт')).not.toBeInTheDocument();
    expect(within(group).getByLabelText('Студия')).toBeChecked();
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);
    expect(screen.getByTestId('btn-create-activity')).toBeDisabled(); // мастер/услуга не выбраны

    // Рефетч без «Студии»: набор пуст → блок (0 локаций)
    rerenderWithLocations(view, [locations[2]]); // только Лофт
    expect(within(group).getByLabelText('Лофт')).not.toBeChecked();
    expect(screen.getByTestId('btn-create-activity')).toBeDisabled();
  });

  it('§4.4 prefill: prefilled location id is checked when the list arrives, capacity auto-filled', () => {
    const defs = { ...defaults, locationId: 'l1' };
    // список ещё не загружен при маунте — группа пуста, ничего не отмечено
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        masters: mockMasters,
        services: mockServices,
        locations: [],
        addActivity: vi.fn(),
      }),
    );
    const view = renderTab({ defaults: defs });
    expect(screen.getByTestId('create-location').querySelectorAll('input')).toHaveLength(0);

    // список прибыл → префилл-ид отмечается, ровно 1 → вместимость умолчанием
    rerenderWithLocations(view, locations, defs);
    expect(screen.getByLabelText('Студия')).toBeChecked();
    expect(screen.getByLabelText('Лофт')).not.toBeChecked();
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);
  });

  it('§4.4 prefill: id absent from the arrived list checks nothing', () => {
    const defs = { ...defaults, locationId: 'l1' };
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        masters: mockMasters,
        services: mockServices,
        locations: [],
        addActivity: vi.fn(),
      }),
    );
    const view = renderTab({ defaults: defs });
    // прибыл справочник без l1 → префилл тихо гаснет, ни один чекбокс не отмечен
    rerenderWithLocations(view, [locations[0], locations[3]], defs); // Мансарда + Ангар
    expect(screen.getByLabelText('Мансарда')).not.toBeChecked();
    expect(screen.getByLabelText('Ангар')).not.toBeChecked();
  });

  it('private toggle flips role="switch" and submits isPrivate: true (US-4)', () => {
    const addActivities = vi.fn((inputs: AddActivityInput[]) =>
      Promise.resolve(inputs.map((i) => createdOutcome(i.locationId))),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    fillValidForm();

    const toggle = screen.getByTestId('create-private');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('btn-create-activity'));
    expect(addActivities.mock.calls[0][0][0]).toMatchObject({ isPrivate: true });
  });

  it('§4.3 exactly 1: submits a single-element array; field datetime → start (snapped local ISO), ЧЧ:ММ → minutes, capacity = field value', () => {
    const addActivities = vi.fn(() => Promise.resolve([createdOutcome('l1')]));
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    fillValidForm();
    // Ручной выбор даты другой недели + несетевой слот: уходит ВЫБОР поля,
    // не «открытая неделя + день недели» (поведение GH #280).
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:17' } });
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '01:15' } });
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    expect(addActivities).toHaveBeenCalledTimes(1);
    expect(addActivities).toHaveBeenCalledWith([
      {
        masterId: 'm1',
        serviceId: 's1',
        locationId: 'l1',
        start: '2026-10-28T15:30:00', // снап 15:17 → 15:30, канонические секунды
        durationMinutes: 75,
        capacity: 4,
        isPrivate: false,
      },
    ]);
  });

  it('§4.3 2+: one addActivities call, inputs in CHECKBOX order (not click order), per-location default capacity', () => {
    const addActivities = vi.fn((inputs: AddActivityInput[]) =>
      Promise.resolve(inputs.map((i) => createdOutcome(i.locationId))),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1'); // 150 мин
    // Отмечены в порядке Лофт → Студия; порядок входов — порядок чекбоксов
    // (Студия l1 первая в справочнике), вместимость каждого — его умолчание (§4.2).
    toggleLocation('Лофт');
    toggleLocation('Студия');
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    expect(addActivities).toHaveBeenCalledTimes(1);
    const inputs = addActivities.mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.locationId)).toEqual(['l1', 'l2']);
    // общие поля идентичны, различие — только locationId и вместимость
    for (const input of inputs) {
      expect(input).toMatchObject({
        masterId: 'm1',
        serviceId: 's1',
        start: '2026-10-21T14:00:00',
        durationMinutes: 150,
        isPrivate: false,
      });
    }
    expect(inputs[0].capacity).toBe(6); // Студия
    expect(inputs[1].capacity).toBe(10); // Лофт
  });

  it('§4.3 full success N=1: closes the form, toast «Создано: {услуга} — {дата}, {время}» (прежний текст)', async () => {
    const addActivities = vi.fn(() => Promise.resolve([createdOutcome('l1')]));
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    fillValidForm();
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Создано: Картина маслом — среда, 21 октября, 14:00'),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('§4.3 full success N=2: closes the form, toast «Создано занятий: 2 ({услуга} — {дата}, {время})»', async () => {
    const addActivities = vi.fn(() =>
      Promise.resolve([createdOutcome('l1'), createdOutcome('l2')]),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    toggleLocation('Студия');
    toggleLocation('Лофт');
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Создано занятий: 2 (Картина маслом — среда, 21 октября, 14:00)',
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('§4.3 full failure N=1: parsed-message error toast, values kept, form not closed', async () => {
    const addActivities = vi.fn(() =>
      Promise.resolve([rejectedOutcome('l1', new ApiError(422, 'бэк', 'VALIDATION_ERROR'))]),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    fillValidForm();
    // меняем дату-время, чтобы проверить «значения НЕ сброшены»
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:00' } });

    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    // N=1 — прежний error-тост без счётчика (parseApiError → код VALIDATION_ERROR)
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Проверьте правильность заполнения полей', 'error'),
    );
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-28T15:00');
    expect(screen.getByLabelText('Студия')).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('§4.3 partial 1 of 2: form open, successful location auto-unchecked, capacity reappears with the remaining default, counted toast via parseApiError (network fallback)', async () => {
    // Студия создана, Лофт отказал с сетевой ошибкой (без ответа) —
    // сообщение тоста проходит parseApiError → «Ошибка сети».
    const addActivities = vi.fn(() =>
      Promise.resolve([createdOutcome('l1'), rejectedOutcome('l2', new TypeError('fetch failed'))]),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    toggleLocation('Студия');
    toggleLocation('Лофт');
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-21T16:00' } });
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Создано 1 из 2 (Картина маслом): Ошибка сети', 'error'),
    );

    // Форма открыта, прочие поля не сброшены (§4.3)
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-21T16:00');

    // Успешная локация снята; набор стал ровно 1 → поле вместимости
    // появляется с умолчанием ОСТАВШЕЙСЯ локации (§4.2 единое правило).
    expect(screen.getByLabelText('Студия')).not.toBeChecked();
    expect(screen.getByLabelText('Лофт')).toBeChecked();
    expect(screen.getByTestId('create-capacity')).toHaveValue(10);
  });

  it('§4.3 error ORDER: 2 failures settling in REVERSE checkbox order → toast carries the first-by-checkbox-order message', async () => {
    // Оба отказа завершаются в обратном порядке чекбоксов (Лофт раньше
    // Студии); исходы приходят в порядке входов (контракт Task 1) — тост
    // несёт сообщение ПЕРВОЙ по порядку чекбоксов (Студия), не последней
    // завершившейся.
    const errByLocation = [new ApiError(500, 'Отказ: Студия'), new ApiError(500, 'Отказ: Лофт')];
    const addActivities = vi.fn((inputs: AddActivityInput[]) => {
      const flights = inputs.map(
        (_, i) => new Promise<number>((resolve) => setTimeout(() => resolve(i), inputs.length - i)),
      );
      return Promise.all(flights).then(() =>
        inputs.map((input, i) => rejectedOutcome(input.locationId, errByLocation[i])),
      );
    });
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    toggleLocation('Лофт'); // завершится ПЕРВЫМ (обратный порядок)
    toggleLocation('Студия'); // первая по порядку чекбоксов, завершится последней
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Создано 0 из 2 (Картина маслом): Отказ: Студия',
        'error',
      ),
    );
  });

  it('§4.3 full failure 0 of 2: nothing unchecked, counted toast, unlock after the flight', async () => {
    const addActivities = vi.fn(() =>
      Promise.resolve([
        rejectedOutcome('l1', new ApiError(500, 'Отказ: Студия')),
        rejectedOutcome('l2', new ApiError(500, 'Отказ: Лофт')),
      ]),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    toggleLocation('Студия');
    toggleLocation('Лофт');
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Создано 0 из 2 (Картина маслом): Отказ: Студия', 'error'),
    );

    // Полный сбой: ничего не снимается, форма открыта, лок снят — поля
    // и кнопка снова доступны (§4.3).
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Студия')).toBeChecked();
    expect(screen.getByLabelText('Лофт')).toBeChecked();
    await waitFor(() => expect(screen.getByTestId('btn-create-activity')).toBeEnabled());
    expect(screen.getByTestId('create-datetime')).toBeEnabled();
  });

  it('§4.3 saving lock: fields and checkboxes disabled in flight, no double submit, onSavingChange true→false', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const addActivities = vi.fn(() => gate.then(() => [createdOutcome('l1')]));
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    renderTab();
    fillValidForm();

    const btn = screen.getByTestId('btn-create-activity');
    fireEvent.click(btn);
    expect(onSavingChange).toHaveBeenCalledWith(true);

    // В полёте заблокированы кнопка, поля и чекбоксы локаций (§4.3)
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('create-datetime')).toBeDisabled();
    expect(screen.getByTestId('create-duration')).toBeDisabled();
    expect(screen.getByTestId('create-capacity')).toBeDisabled();
    expect(screen.getByTestId('create-private')).toBeDisabled();
    expect(
      within(screen.getByTestId('create-service')).getByTestId('combobox-trigger'),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('create-master')).getByTestId('combobox-trigger'),
    ).toBeDisabled();
    expect(screen.getByLabelText('Студия')).toBeDisabled();
    expect(screen.getByLabelText('Лофт')).toBeDisabled();

    // Повторный клик по заблокированной кнопке не отправляет
    fireEvent.click(btn);
    expect(addActivities).toHaveBeenCalledTimes(1);

    // Завершение полёта: лок снят, поля разблокированы
    await act(async () => {
      release();
    });
    await waitFor(() => expect(btn).toBeEnabled());
    await waitFor(() => expect(screen.getByTestId('create-datetime')).toBeEnabled());
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });
});
