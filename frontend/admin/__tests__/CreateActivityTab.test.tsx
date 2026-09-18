/**
 * CreateActivityTab — форма создания занятия (GH #258/#259, spec §2.1).
 *
 * Тестируем чистую форму: префиллы из слота, авто-заполнение из услуги/локации,
 * гейт кнопки, callback-семантику addActivity (успех/ошибка/анти-даблклик).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMockScheduleData, createMockUIContext } from './helpers/mockContexts';

// 1. Mock context modules (before importing the component)
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { CreateActivityTab, type CreateDefaults } from '@/app/components/modal/ActivityDetailsModal/CreateActivityTab';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { parseApiError } from '@/app/lib/api/parseApiError';

const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseUI = vi.mocked(useUI);

// Форма потребляет только id у мастера (spec §2.1.4) — минимальный объект.
const masters = [{ id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' }];
const services = [{ id: 's1', name: 'Маникюр', durationMinutes: 60, minAge: '', tariffs: [] }];
const locations = [{ id: 'l1', title: 'Студия', defaultCapacity: 6 }];

const defaults: CreateDefaults = { dayIndex: 2, startMinutes: 540 };const onSavingChange = vi.fn();
const onSaved = vi.fn();

function renderTab(overrides?: { defaults?: CreateDefaults }) {
  return render(
    <CreateActivityTab
      defaults={overrides?.defaults ?? defaults}
      onSavingChange={onSavingChange}
      onSaved={onSaved}
    />,
  );
}

/** Выбрать мастер + услуга + локация через select-контролы (по testid). */
function chooseAllThree() {
  fireEvent.change(screen.getByTestId('create-master'), { target: { value: 'm1' } });
  fireEvent.change(screen.getByTestId('create-service'), { target: { value: 's1' } });
  fireEvent.change(screen.getByTestId('create-location'), { target: { value: 'l1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseScheduleData.mockReturnValue(
    createMockScheduleData({
      masters,
      services,
      locations,
      addActivity: vi.fn(),
    }),
  );
  mockUseUI.mockReturnValue(createMockUIContext());
});

describe('CreateActivityTab', () => {
  it('renders all fields and the create button', () => {
    renderTab();
    expect(screen.getByTestId('create-master')).toBeInTheDocument();
    expect(screen.getByTestId('create-service')).toBeInTheDocument();
    expect(screen.getByTestId('create-location')).toBeInTheDocument();
    expect(screen.getByTestId('create-day')).toBeInTheDocument();
    expect(screen.getByTestId('create-time')).toBeInTheDocument();
    expect(screen.getByTestId('create-duration')).toBeInTheDocument();
    expect(screen.getByTestId('create-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('create-private')).toBeInTheDocument();
    expect(screen.getByTestId('btn-create-activity')).toBeInTheDocument();
  });

  it('disables the create button until master+service+location chosen and time valid', () => {
    renderTab();
    const btn = screen.getByTestId('btn-create-activity');

    // только мастер → disabled
    fireEvent.change(screen.getByTestId('create-master'), { target: { value: 'm1' } });
    expect(btn).toBeDisabled();

    // + услуга → всё ещё disabled
    fireEvent.change(screen.getByTestId('create-service'), { target: { value: 's1' } });
    expect(btn).toBeDisabled();

    // все три + валидное время (префилл из слота 540 = 9.5) → enabled
    fireEvent.change(screen.getByTestId('create-location'), { target: { value: 'l1' } });
    expect(btn).toBeEnabled();
  });

  it('auto-fills duration from service and capacity from location', () => {
    renderTab();
    fireEvent.change(screen.getByTestId('create-service'), { target: { value: 's1' } });
    expect(screen.getByTestId('create-duration')).toHaveValue(60);

    fireEvent.change(screen.getByTestId('create-location'), { target: { value: 'l1' } });
    expect(screen.getByTestId('create-capacity')).toHaveValue(6);
  });

  it('prefills day and fractional-hours time from slot defaults (570 → 9.5, 540 → 9)', () => {
    const { unmount } = renderTab({ defaults: { dayIndex: 2, startMinutes: 570 } });
    expect(screen.getByTestId('create-day')).toHaveValue('2');
    expect(screen.getByTestId('create-time')).toHaveValue(9.5);
    unmount();
    // 540 минут (09:00) → целые 9
    renderTab({ defaults: { dayIndex: 0, startMinutes: 540 } });
    expect(screen.getByTestId('create-time')).toHaveValue(9);
  });

  it('submits exact payload and shows success toast with service name tail', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters, services, locations, addActivity }),
    );
    renderTab();
    chooseAllThree();
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    expect(addActivity).toHaveBeenCalledWith(
      {
        dayIndex: 2,
        masterId: 'm1',
        serviceId: 's1',
        locationId: 'l1',
        startMinutes: 540,
        durationMinutes: 60,
        capacity: 6,
        isPrivate: false,
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    // Хвост тоста как у штампа (WeekView.tsx:119) — имя услуги в тексте.
    // mutate fire-and-forget: тост рождается в onSuccess (симулируем settle мутации).
    const callbacks = addActivity.mock.calls[0][1] as { onSuccess: () => void; onError: () => void };
    callbacks.onSuccess();
    const { showToast } = mockUseUI();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Создано: Маникюр'));
  });

  it('on error: toast with parsed message and error kind, values kept, modal not closed', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters, services, locations, addActivity }),
    );
    renderTab();
    chooseAllThree();

    // заполняем время нестандартным, чтобы проверить «значения НЕ сброшены»
    fireEvent.change(screen.getByTestId('create-time'), { target: { value: '14' } });

    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const err = { code: 'VALIDATION_ERROR' };
    const callbacks = addActivity.mock.calls[0][1] as {
      onSuccess: () => void;
      onError: (e: unknown) => void;
    };
    callbacks.onError(err);

    const { showToast } = mockUseUI();
    expect(showToast).toHaveBeenCalledWith(parseApiError(err).message, 'error');
    expect(screen.getByTestId('create-time')).toHaveValue(14);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('button stays disabled while saving; onSavingChange toggles true→false via callbacks', () => {
    const addActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters, services, locations, addActivity }),
    );
    renderTab();
    chooseAllThree();

    const btn = screen.getByTestId('btn-create-activity');
    fireEvent.click(btn);

    // во время запроса: кнопка задизейблена, onSavingChange(true) вызван
    expect(btn).toBeDisabled();
    expect(onSavingChange).toHaveBeenCalledWith(true);

    // успех: onSavingChange(false)
    const callbacks = addActivity.mock.calls[0][1] as {
      onSuccess: () => void;
      onError: () => void;
    };
    callbacks.onSuccess();
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });
});
