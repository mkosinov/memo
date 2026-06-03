import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ActivityDetailsModal } from '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal';
import { TabNav } from '../app/components/modal/ActivityDetailsModal/TabNav';
import { ModalFooter } from '../app/components/modal/ActivityDetailsModal/ModalFooter';
import { SettingsTab } from '../app/components/modal/ActivityDetailsModal/SettingsTab';
import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';
import { NewBookingTab } from '../app/components/modal/ActivityDetailsModal/NewBookingTab';
import type { RecordResponse, ClientResponse, VisitorResponse, PaymentResponse } from '@memo/api-client';
import type { Activity } from '@memo/domain';

// ─── Mock Data ──────────────────────────────────────────────────────────────

const mockArtists = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

const mockServices = [
  {
    id: 's1', name: 'Картина маслом', duration: 2.5, maxCapacity: 8, minAge: '12', maxAge: '99',
    defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000,
    tariffs: [
      { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
      { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
    ],
  },
  {
    id: 's2', name: 'Картина акрилом', duration: 2, maxCapacity: 10, minAge: '6', maxAge: '99',
    defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000,
    tariffs: [
      { id: 't3', service_id: 's2', title: 'Взрослый', price: 2800, description: null },
    ],
  },
];

const mockLocations = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

const mockActivity: Activity = {
  id: 'ev_1',
  day: 5,
  masterId: 'm1',
  startTime: 14,
  duration: 2.5,
  serviceId: 's1',
  serviceName: 'Картина маслом',
  minAge: '12+',
  locationId: 'grand',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

// ─── Context Mocks ──────────────────────────────────────────────────────────

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
}));

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);

beforeEach(() => {
  mockUseSchedule.mockReturnValue({
    artists: mockArtists,
    services: mockServices,
    locations: mockLocations,
    activities: [],
    scheduleIndex: { byId: new Map(), byDate: new Map(), byMasterId: new Map(), byLocation: { all: { byDate: new Map(), byServiceId: new Map() } } },
    currentWeek: new Date(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
    loading: false,
    error: null,
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
  });

  mockUseRecords.mockReturnValue({
    records: [],
    clients: new Map(),
    payments: new Map(),
    activities: new Map(),
    masters: new Map(),
    services: new Map(),
    locations: new Map(),
    loading: false,
    error: null,
  });

  mockUseUI.mockReturnValue({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── TabNav Tests ───────────────────────────────────────────────────────────

describe('TabNav', () => {
  const defaultTabs = [
    { id: 'settings', label: 'Настройка' },
    { id: 'client-1', label: 'Анна Иванова' },
  ];

  it('renders the settings tab', () => {
    render(<TabNav tabs={defaultTabs} activeTab="settings" onTabChange={vi.fn()} onAddClick={vi.fn()} />);
    expect(screen.getByText('Настройка')).toBeInTheDocument();
  });

  it('renders client tabs', () => {
    render(<TabNav tabs={defaultTabs} activeTab="settings" onTabChange={vi.fn()} onAddClick={vi.fn()} />);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('renders the add button', () => {
    render(<TabNav tabs={defaultTabs} activeTab="settings" onTabChange={vi.fn()} onAddClick={vi.fn()} />);
    expect(screen.getByLabelText('Добавить запись')).toBeInTheDocument();
  });

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<TabNav tabs={defaultTabs} activeTab="settings" onTabChange={onTabChange} onAddClick={vi.fn()} />);
    fireEvent.click(screen.getByText('Анна Иванова'));
    expect(onTabChange).toHaveBeenCalledWith('client-1');
  });

  it('calls onAddClick when the + button is clicked', () => {
    const onAddClick = vi.fn();
    render(<TabNav tabs={defaultTabs} activeTab="settings" onTabChange={vi.fn()} onAddClick={onAddClick} />);
    fireEvent.click(screen.getByLabelText('Добавить запись'));
    expect(onAddClick).toHaveBeenCalled();
  });

  it('highlights the active tab', () => {
    render(<TabNav tabs={defaultTabs} activeTab="client-1" onTabChange={vi.fn()} onAddClick={vi.fn()} />);
    const clientTab = screen.getByText('Анна Иванова');
    expect(clientTab.closest('button')).toHaveClass('bg-brand');
  });
});

// ─── ModalFooter Tests ──────────────────────────────────────────────────────

describe('ModalFooter', () => {
  it('renders cost and owed amounts', () => {
    render(<ModalFooter totalCost={7000} totalOwed={3500} />);
    expect(screen.getByText(/Стоимость/)).toBeInTheDocument();
    expect(screen.getByText(/7[\s]?000\s?₽/)).toBeInTheDocument();
    expect(screen.getByText(/К оплате/)).toBeInTheDocument();
    expect(screen.getByText(/3[\s]?500\s?₽/)).toBeInTheDocument();
  });

  it('renders zero amounts', () => {
    render(<ModalFooter totalCost={0} totalOwed={0} />);
    expect(screen.getByText(/Стоимость/)).toBeInTheDocument();
    expect(screen.getByText(/К оплате/)).toBeInTheDocument();
  });
});

// ─── SettingsTab Tests ──────────────────────────────────────────────────────

describe('SettingsTab', () => {
  const defaultProps = {
    activity: mockActivity,
    onUpdate: vi.fn(),
  };

  it('renders datetime input', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText(/Дата и время/)).toBeInTheDocument();
  });

  it('renders service select', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText('Услуга')).toBeInTheDocument();
  });

  it('renders master select with artist names', () => {
    render(<SettingsTab {...defaultProps} />);
    const masterSelect = screen.getByLabelText('Мастер');
    expect(masterSelect).toBeInTheDocument();
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
  });

  it('renders location select', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText('Локация')).toBeInTheDocument();
  });

  it('renders capacity input', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText('Вместимость')).toBeInTheDocument();
  });

  it('renders duration input', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText('Длительность')).toBeInTheDocument();
  });

  it('renders private toggle', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByText('Приватное')).toBeInTheDocument();
  });

  it('displays age range from service', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('displays tariffs from selected service', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByText('Взрослый')).toBeInTheDocument();
    expect(screen.getByText(/3[\s]?500/)).toBeInTheDocument();
  });
});

// ─── ClientTab Tests ────────────────────────────────────────────────────────

describe('ClientTab', () => {
  const mockClient: ClientResponse = {
    id: 'c1',
    name: 'Анна Иванова',
    phone: '+7 (900) 123-45-67',
    email: null,
    channel: 'telegram',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    is_active: true,
  };

  const mockRecord: RecordResponse = {
    id: 'r1',
    activity_id: 'ev_1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    comment: null,
    created_at: '2026-05-10T10:00:00',
    updated_at: '2026-05-10T10:00:00',
    is_active: true,
    visits: [
      { id: 'v1', record_id: 'r1', visitor_id: 'vis1', price: 3500, status: 'waiting', created_at: '', updated_at: '', is_active: true },
    ],
  };

  const mockVisitors: VisitorResponse[] = [
    { id: 'vis1', client_id: 'c1', name: 'Анна Иванова', age: 30, created_at: '', updated_at: '', is_active: true },
  ];

  const defaultProps = {
    record: mockRecord,
    client: mockClient,
    visitors: mockVisitors,
    visits: mockRecord.visits,
    payments: [],
    serviceTariffs: mockServices[0].tariffs,
    onUpdateRecord: vi.fn(),
    onDeleteRecord: vi.fn(),
    onAddPayment: vi.fn(),
    showToast: vi.fn(),
  };

  it('renders client name', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByDisplayValue('Анна Иванова')).toBeInTheDocument();
  });

  it('renders client phone as read-only', () => {
    render(<ClientTab {...defaultProps} />);
    const phoneInput = screen.getByDisplayValue('+7 (900) 123-45-67');
    expect(phoneInput).toBeDisabled();
  });

  it('renders client link', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByText(/\/client\/c1/)).toBeInTheDocument();
  });

  it('renders record status dropdown', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByLabelText('Статус записи')).toBeInTheDocument();
  });

  it('renders delete button', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
  });

  it('renders payment summary', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByText(/Оплачено/)).toBeInTheDocument();
  });
});

// ─── NewBookingTab Tests ────────────────────────────────────────────────────

describe('NewBookingTab', () => {
  const defaultProps = {
    activity: mockActivity,
    serviceTariffs: mockServices[0].tariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  it('renders phone input', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByLabelText(/Телефон/)).toBeInTheDocument();
  });

  it('renders name input', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByLabelText(/Имя/)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByText('Создать запись')).toBeInTheDocument();
  });

  it('renders add visitor button', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByText(/Добавить посетителя/)).toBeInTheDocument();
  });

  it('renders notifications checkbox', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByText(/отправлять оповещения/)).toBeInTheDocument();
  });
});

// ─── ActivityDetailsModal Tests ─────────────────────────────────────────────

describe('ActivityDetailsModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <ActivityDetailsModal isOpen={false} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when isOpen is true', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders activity context header', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    // The header h2 should contain the service name
    const header = screen.getByRole('heading', { level: 2 });
    expect(header.textContent).toBe('Картина маслом');
  });

  it('renders settings tab by default', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByText('Настройка')).toBeInTheDocument();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );
    const backdrop = screen.getByTestId('details-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders close button', () => {
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the + tab for new booking', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByLabelText('Добавить запись')).toBeInTheDocument();
  });
});
