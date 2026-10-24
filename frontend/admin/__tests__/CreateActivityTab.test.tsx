/**
 * CreateActivityTab — режим create общего ActivityForm (GH #280, унификация
 * с формой редактирования). Тестируем обёртку: префилл даты-времени из слота
 * (со снапом к сетке), автозаполнение длительности/вместимости из справочников,
 * гейты «Создать» (дата-время непусто, ЧЧ:ММ > 0, вместимость ≥ 1), тумблер
 * приватности, callback-семантику addActivity (успех/ошибка/анти-даблклик),
 * тост с выбранной календарной датой.
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
// defaultCapacity (в shared mockLocations этого поля нет).
const locations = [
  { id: 'l1', title: 'Студия', defaultCapacity: 6 },
  { id: 'l2', title: 'Лофт', defaultCapacity: 10 },
];

// Слот: среда 2026-10-21, 14:00 (840 минут — на 30-минутной сетке).
const defaults = { date: '2026-10-21', startMinutes: 840 };
const onSavingChange = vi.fn();
const onSaved = vi.fn();

function renderTab(overrides?: { defaults?: { date: string; startMinutes: number } }) {
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

/** Валидная форма: мастер m1 + услуга s1 (длит. 150) + локация l1 (вмест. 6). */
function fillValidForm() {
  pickInCombobox('create-master', 'm1');
  pickInCombobox('create-service', 's1');
  pickInCombobox('create-location', 'l1');
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
  it('renders the эталон rows: datetime/duration/toggle + comboboxes, no create-day/create-time', () => {
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
    for (const id of ['create-service', 'create-master', 'create-location']) {
      expect(within(screen.getByTestId(id)).getByTestId('combobox-trigger')).toBeInTheDocument();
    }
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

  it('auto-fills capacity from location.defaultCapacity; re-selection overwrites', () => {
    renderTab();
    pickInCombobox('create-location', 'l1');
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);
    pickInCombobox('create-location', 'l2');
    expect(screen.getByTestId('create-capacity')).toHaveValue(10);
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

  it('gates «Создать» until master+service+location chosen (slot prefill alone is not enough)', () => {
    renderTab();
    const btn = screen.getByTestId('btn-create-activity');
    expect(btn).toBeDisabled(); // дата-время префиллита, справочники не выбраны

    pickInCombobox('create-master', 'm1');
    expect(btn).toBeDisabled();
    pickInCombobox('create-service', 's1'); // длительность заполнится сама
    expect(btn).toBeDisabled(); // нет локации → нет вместимости
    pickInCombobox('create-location', 'l1');
    expect(btn).toBeEnabled();
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
