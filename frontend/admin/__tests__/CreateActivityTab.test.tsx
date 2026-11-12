/**
 * CreateActivityTab — режим create общего ActivityForm (GH #280, унификация
 * с формой редактирования; GH #595 — чекбокс-группа локаций и правила
 * вместимости §4.1–§4.2). Тестируем обёртку: префилл даты-времени из слота
 * (со снапом к сетке), автозаполнение длительности/вместимости из справочников,
 * гейты «Создать» (дата-время непусто, ЧЧ:ММ > 0, вместимость ≥ 1),
 * мультивыбор локаций (автозаполнение при ровно 1, скрытие поля и подсказки
 * aria-live при 2+, блок зала без умолчания), отбрасывание отсутствующих id
 * при рефетче, префилл-ид по прибытии списка, callback-семантику addActivity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { createMockScheduleData, createMockGridSettings, createMockUIContext } from './helpers/mockContexts';
import { mockMasters, mockServices } from './helpers/mockData';

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
import { parseApiError } from '@/app/lib/api/parseApiError';

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
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    fillValidForm();

    const toggle = screen.getByTestId('create-private');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('btn-create-activity'));
    expect(addActivity.mock.calls[0][0]).toMatchObject({ isPrivate: true });
  });

  it('submits exact payload: field datetime → start (snapped local ISO), ЧЧ:ММ → minutes', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    fillValidForm();
    // Ручной выбор даты другой недели + несетевой слот: уходит ВЫБОР поля,
    // не «открытая неделя + день недели» (поведение GH #280).
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:17' } });
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '01:15' } });
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    expect(addActivity).toHaveBeenCalledTimes(1);
    expect(addActivity).toHaveBeenCalledWith(
      {
        masterId: 'm1',
        serviceId: 's1',
        locationId: 'l1',
        start: '2026-10-28T15:30:00', // снап 15:17 → 15:30, канонические секунды
        durationMinutes: 75,
        capacity: 4,
        isPrivate: false,
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('transitional (Task 2): 2+ checked submits single addActivity for the FIRST location by checkbox order', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    // Отмечены в порядке Лофт → Студия; по порядку чекбоксов первая — Студия.
    toggleLocation('Лофт');
    toggleLocation('Студия');
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    expect(addActivity).toHaveBeenCalledTimes(1);
    expect(addActivity.mock.calls[0][0]).toMatchObject({
      locationId: 'l1',
      capacity: 6, // умолчание локации отправки (§4.2: поле скрыто при 2+)
    });
  });

  it('success toast names the chosen calendar date: «Создано: … среда, 21 октября, 14:00»', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    fillValidForm();
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    // mutate fire-and-forget: тост рождается в onSuccess (симулируем settle мутации)
    const callbacks = addActivity.mock.calls[0][1] as { onSuccess: () => void; onError: () => void };
    callbacks.onSuccess();

    const { showToast } = mockUseUI();
    expect(showToast).toHaveBeenCalledWith('Создано: Картина маслом — среда, 21 октября, 14:00');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('on error: toast with parsed message and error kind, values kept, modal not closed', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    fillValidForm();
    // меняем дату-время, чтобы проверить «значения НЕ сброшены»
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:00' } });

    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const err = { code: 'VALIDATION_ERROR' };
    const callbacks = addActivity.mock.calls[0][1] as {
      onSuccess: () => void;
      onError: (e: unknown) => void;
    };
    callbacks.onError(err);

    const { showToast } = mockUseUI();
    expect(showToast).toHaveBeenCalledWith(parseApiError(err).message, 'error');
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-28T15:00');
    expect(screen.getByLabelText('Студия')).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('button stays disabled while saving; no double submit; onSavingChange toggles true→false', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivity }),
    );
    renderTab();
    fillValidForm();

    const btn = screen.getByTestId('btn-create-activity');
    fireEvent.click(btn);

    // во время запроса: кнопка задизейблена, повторный клик не отправляет
    expect(btn).toBeDisabled();
    expect(onSavingChange).toHaveBeenCalledWith(true);
    fireEvent.click(btn);
    expect(addActivity).toHaveBeenCalledTimes(1);

    // успех: onSavingChange(false), кнопка снова активна (act — колбэк мутации
    // вызван вручную, состояние должно сброситься в DOM)
    const callbacks = addActivity.mock.calls[0][1] as {
      onSuccess: () => void;
      onError: () => void;
    };
    act(() => {
      callbacks.onSuccess();
    });
    expect(onSavingChange).toHaveBeenCalledWith(false);
    expect(btn).toBeEnabled();
  });
});
