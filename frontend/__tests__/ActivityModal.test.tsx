import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ActivityModal } from '../app/components/modal/ActivityModal';
import type { Activity } from '../lib/types';

// ─── Mock Data ─────────────────────────────────────────────────────────────

const mockArtists = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

const mockServices = [
  { id: 's1', name: 'Картина маслом', duration: 2.5, maxCapacity: 8, minAge: '12+', defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000 },
  { id: 's2', name: 'Картина акрилом', duration: 2, maxCapacity: 10, minAge: '6+', defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
];

const mockStudios = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

const mockActivity: Activity = {
  id: 'ev_1',
  day: 0,
  masterId: 'm1',
  startTime: 10,
  duration: 2,
  serviceId: 's1',
  serviceName: 'Картина маслом',
  minAge: '12+',
  locationId: 'grand',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

// ─── Context Mock ──────────────────────────────────────────────────────────

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
}));

import { useSchedule } from '@/contexts/ScheduleContext';

const mockUseSchedule = vi.mocked(useSchedule);

beforeEach(() => {
  mockUseSchedule.mockReturnValue({
    artists: mockArtists,
    services: mockServices,
    studios: mockStudios,
    activities: [],
    currentWeek: new Date(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ActivityModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <ActivityModal isOpen={false} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal with create title when isOpen is true', () => {
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Новое событие')).toBeInTheDocument();
  });

  it('renders modal with edit title when initialActivity is provided', () => {
    render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialActivity={mockActivity}
      />,
    );
    expect(screen.getByText('Редактировать событие')).toBeInTheDocument();
  });

  it('shows "Создать" button in create mode', () => {
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  });

  it('shows "Сохранить" button in edit mode', () => {
    render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialActivity={mockActivity}
      />,
    );
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('renders all required form fields', () => {
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    // Check for select dropdowns
    expect(screen.getByLabelText('Мастер')).toBeInTheDocument();
    expect(screen.getByLabelText('Услуга')).toBeInTheDocument();
    expect(screen.getByLabelText('Локация')).toBeInTheDocument();
    // Check for number inputs
    expect(screen.getByLabelText('Начало')).toBeInTheDocument();
    expect(screen.getByLabelText('Длительность')).toBeInTheDocument();
    expect(screen.getByLabelText('Занято')).toBeInTheDocument();
    expect(screen.getByLabelText('Вместимость')).toBeInTheDocument();
  });

  it('renders private checkbox', () => {
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByLabelText('Приватное событие')).toBeInTheDocument();
  });

  it('closes modal on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <ActivityModal isOpen={true} onClose={onClose} onSave={vi.fn()} />,
    );
    // Click on the backdrop (the overlay behind the modal)
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes modal on × button click', () => {
    const onClose = vi.fn();
    render(
      <ActivityModal isOpen={true} onClose={onClose} onSave={vi.fn()} />,
    );
    const closeBtn = screen.getByRole('button', { name: 'Закрыть' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-fills form fields in edit mode', () => {
    render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialActivity={mockActivity}
      />,
    );
    expect(screen.getByLabelText('Мастер')).toHaveValue('m1');
    expect(screen.getByLabelText('Услуга')).toHaveValue('s1');
    expect(screen.getByLabelText('Локация')).toHaveValue('grand');
    expect(screen.getByLabelText('Начало')).toHaveValue(10);
    expect(screen.getByLabelText('Длительность')).toHaveValue(2);
    expect(screen.getByLabelText('Занято')).toHaveValue(3);
    expect(screen.getByLabelText('Вместимость')).toHaveValue(8);
  });

  it('auto-fills duration and capacity when service is selected in create mode', () => {
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    const serviceSelect = screen.getByLabelText('Услуга');
    fireEvent.change(serviceSelect, { target: { value: 's1' } });
    // s1 has duration: 2.5, maxCapacity: 8
    expect(screen.getByLabelText('Длительность')).toHaveValue(2.5);
    expect(screen.getByLabelText('Вместимость')).toHaveValue(8);
  });

  it('calls onSave with correct data on form submit', () => {
    const onSave = vi.fn();
    render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        defaultDay={2}
        defaultStartTime={14}
      />,
    );
    // Fill required fields
    fireEvent.change(screen.getByLabelText('Мастер'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('Услуга'), { target: { value: 's2' } });
    fireEvent.change(screen.getByLabelText('Локация'), { target: { value: 'alpika' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        day: 2,
        masterId: 'm1',
        startTime: 14,
        serviceId: 's2',
        serviceName: 'Картина акрилом',
        locationId: 'alpika',
      }),
    );
  });

  it('does not submit if required fields are empty', () => {
    const onSave = vi.fn();
    render(
      <ActivityModal isOpen={true} onClose={vi.fn()} onSave={onSave} />,
    );
    // Try to submit without filling required fields
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('uses defaultDay and defaultStartTime in create mode', () => {
    render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        defaultDay={3}
        defaultStartTime={15.5}
      />,
    );
    expect(screen.getByLabelText('День')).toHaveValue('3');
    expect(screen.getByLabelText('Начало')).toHaveValue(15.5);
  });

  it('resets form when switching from edit to create mode', () => {
    const { rerender } = render(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialActivity={mockActivity}
      />,
    );
    // Verify edit mode values
    expect(screen.getByLabelText('Мастер')).toHaveValue('m1');

    // Switch to create mode
    rerender(
      <ActivityModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialActivity={null}
        defaultDay={0}
        defaultStartTime={9}
      />,
    );
    // Form should be reset
    expect(screen.getByLabelText('Мастер')).toHaveValue('');
    expect(screen.getByLabelText('Услуга')).toHaveValue('');
  });
});
