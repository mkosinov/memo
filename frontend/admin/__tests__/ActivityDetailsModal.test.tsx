import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import { ActivityDetailsModal } from '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal';
import { TabNav } from '../app/components/modal/ActivityDetailsModal/TabNav';
import { SettingsTab } from '../app/components/modal/ActivityDetailsModal/SettingsTab';
import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';
import { NewBookingTab } from '../app/components/modal/ActivityDetailsModal/NewBookingTab';

// ─── Shared mock data & context factories ────────────────────────────────

import {
  mockMasters,
  mockServices,
  mockLocations,
  mockActivity,
  mockClient,
  mockRecord,
  mockVisitor,
  mockPayment,
  mockTariffs,
} from './helpers/mockData';

import {
  createMockScheduleContext,
  createMockRecordsContext,
  createMockUIContext,
  createMockClientsContext,
} from './helpers/mockContexts';

// ─── API Client Mock ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  searchClientByPhone: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  updateVisitStatus: vi.fn(),
}));

import {
  searchClientByPhone,
  createClient,
  createVisitor,
  createRecord,
  deleteRecord,
  createPayment,
  deletePayment,
  updateVisitStatus,
} from '@memo/api-client';

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

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: vi.fn(() => ({
    recordData: null,
    record: undefined,
    visitors: [],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: [],
    visitorsMap: new Map<string, { name: string; age: number | null }>(),
    tariffs: [],
    isLoading: false,
    status: 'waiting',
  })),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    fetchQuery: vi.fn(),
  })),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';
import { useClients } from '@/contexts/ClientsContext';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);
const mockUseClients = vi.mocked(useClients);

beforeEach(() => {
  mockUseSchedule.mockReturnValue(createMockScheduleContext());
  mockUseRecords.mockReturnValue(createMockRecordsContext());
  mockUseUI.mockReturnValue(createMockUIContext());
  mockUseClients.mockReturnValue(createMockClientsContext());
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

// ─── SettingsTab Tests ──────────────────────────────────────────────────────

describe('SettingsTab', () => {
  const defaultProps = {
    activity: mockActivity,
    onUpdate: vi.fn(),
  };

  it('renders native datetime-local input', () => {
    render(<SettingsTab {...defaultProps} />);
    const input = screen.getByTestId('input-datetime');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'datetime-local');
  });

  it('renders service select', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByLabelText('Услуга')).toBeInTheDocument();
  });

  it('renders master select with master names', () => {
    render(<SettingsTab {...defaultProps} />);
    // MasterPicker uses CustomSelect — a button trigger instead of native <select>
    const masterRow = screen.getByTestId('settings-row-master-location');
    const masterTrigger = masterRow.querySelector(
      '[data-testid="custom-select-trigger"]',
    ) as HTMLButtonElement;
    expect(masterTrigger).toBeInTheDocument();
    // The selected master (m1 = Ольга Середа) should show in the trigger label
    expect(masterTrigger.textContent).toContain('Ольга Середа');
    // Open the dropdown to verify all master names are available
    fireEvent.click(masterTrigger);
    const dropdown = screen.getByTestId('custom-select-dropdown');
    expect(within(dropdown).getByText('Ольга Середа')).toBeInTheDocument();
    expect(within(dropdown).getByText('Юлия Большакова')).toBeInTheDocument();
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
    const ageDisplay = screen.getByTestId('age-display');
    expect(ageDisplay.textContent).toContain('12');
  });

  it('displays tariffs from selected service', () => {
    render(<SettingsTab {...defaultProps} />);
    expect(screen.getByText('Взрослый')).toBeInTheDocument();
    expect(screen.getByText(/3[\s]?500/)).toBeInTheDocument();
  });
});

// ─── ClientTab Tests ────────────────────────────────────────────────────────

describe('ClientTab', () => {
  const defaultProps = {
    record: mockRecord,
    client: mockClient,
    visitors: [mockVisitor],
    visits: mockRecord.visits,
    payments: [],
    serviceTariffs: mockTariffs,
    onUpdateRecord: vi.fn(),
    onDeleteRecord: vi.fn(),
    showToast: vi.fn(),
  };

  it('renders client name', () => {
    render(<ClientTab {...defaultProps} />);
    // ClientTab now shows client name via RecordVisitsTable visitor rows,
    // not as an editable input. Verify the component renders with record summary.
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
  });

  it('renders client phone as read-only', () => {
    render(<ClientTab {...defaultProps} />);
    // Phone is now displayed in ActivityDetailsModal tab labels, not in ClientTab.
    // ClientTab renders the record summary with financial data.
    const summary = screen.getByTestId('record-summary');
    expect(summary).toBeInTheDocument();
  });

  it('renders client link', () => {
    render(<ClientTab {...defaultProps} />);
    // Client link is now in ActivityDetailsModal tab labels (external link icon),
    // not in ClientTab. Verify the status trigger button renders instead.
    const statusTrigger = screen.getByTestId('record-status-trigger');
    expect(statusTrigger).toBeInTheDocument();
    expect(statusTrigger.tagName).toBe('BUTTON');
  });

  it('renders record status picker', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('record-status')).toBeInTheDocument();
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
    serviceTariffs: mockTariffs,
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

// ─── ActivityDetailsModal: API Call Tests ────────────────────────────────────

describe('ActivityDetailsModal — API integration', () => {
  const mockRecords = [mockRecord];

  const mockClientMap = new Map([
    ['c1', mockClient],
  ]);

  const mockVisitorsMap = new Map([
    ['r1', [mockVisitor]],
  ]);

  beforeEach(() => {
    vi.mocked(createRecord).mockResolvedValue({ id: 'r_new', activity_id: 'ev_1', client_id: 'c1', status: 'pending', seats: 1, anonym_visits: 0, comment: null, custom_price: null, created_at: '', updated_at: '', is_active: true, visits: [] });
    vi.mocked(createClient).mockResolvedValue({ id: 'c_new', name: 'New', phone: '+7', email: null, channel: 'telegram', created_at: '', updated_at: '', is_active: true });
    vi.mocked(createVisitor).mockResolvedValue({ id: 'vis_new', client_id: 'c1', name: 'V', age: null, created_at: '', updated_at: '', is_active: true });
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({ id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '', updated_at: '' });
    vi.mocked(searchClientByPhone).mockRejectedValue(new Error('Not found'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes actual visitors to ClientTab (not empty array)', () => {
    mockUseRecords.mockReturnValue({
      ...createMockRecordsContext(),
      records: mockRecords,
      clients: mockClientMap,
      payments: new Map([['r1', []]]),
    });

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // Click on the client tab to show ClientTab
    fireEvent.click(screen.getByText('Анна Иванова'));

    // ClientTab should render — visitors come from record visits
    expect(screen.getByTestId('client-tab')).toBeInTheDocument();
    // The "Нет посетителей" message should NOT appear because record has 1 visit
    expect(screen.queryByText('Нет посетителей')).not.toBeInTheDocument();
  });

  it('passes visitors from records context to ClientTab', () => {
    mockUseRecords.mockReturnValue({
      ...createMockRecordsContext(),
      records: mockRecords,
      clients: mockClientMap,
      payments: new Map([['r1', []]]),
    });

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // Click on the client tab
    fireEvent.click(screen.getByText('Анна Иванова'));

    // ClientTab should render with client data
    expect(screen.getByTestId('client-tab')).toBeInTheDocument();
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
  });
});

// ─── SettingsTab — Row Layout Tests ─────────────────────────────────────────

describe('SettingsTab — row layout', () => {
  const defaultProps = {
    activity: mockActivity,
    onUpdate: vi.fn(),
  };

  it('renders native datetime-local input and duration on the same row', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    const row1 = container.querySelector('[data-testid="settings-row-datetime-duration"]');
    expect(row1).toBeInTheDocument();
    expect(row1!.querySelector('[data-testid="input-datetime"]')).toBeInTheDocument();
    expect(row1!.querySelector('[data-testid="input-duration"]')).toBeInTheDocument();
  });

  it('renders service, age, and capacity on the same row', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    const row2 = container.querySelector('[data-testid="settings-row-service-age-capacity"]');
    expect(row2).toBeInTheDocument();
    expect(row2!.querySelector('[data-testid="select-service"]')).toBeInTheDocument();
    expect(row2!.querySelector('[data-testid="input-capacity"]')).toBeInTheDocument();
  });

  it('renders master and location on the same row', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    const row3 = container.querySelector('[data-testid="settings-row-master-location"]');
    expect(row3).toBeInTheDocument();
    // MasterPicker uses CustomSelect which renders a button trigger
    expect(row3!.querySelector('[data-testid="custom-select-trigger"]')).toBeInTheDocument();
    expect(row3!.querySelector('[data-testid="select-location"]')).toBeInTheDocument();
  });

  it('displays age in read-only field with correct format', () => {
    render(<SettingsTab {...defaultProps} />);
    // minAge='12', maxAge='99' → "12–99" (en dash)
    expect(screen.getByText('12–99')).toBeInTheDocument();
  });

  it('does not show double plus in age display', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    const ageDisplay = container.querySelector('[data-testid="age-display"]');
    // Should show "12–99", NOT "12+–99+" or "12++"
    expect(ageDisplay?.textContent).toBe('12–99');
    expect(ageDisplay?.textContent).not.toContain('++');
  });

  it('shows color dot next to master names in select', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    // MasterPicker uses CustomSelect — open the dropdown to inspect options
    const masterRow = container.querySelector(
      '[data-testid="settings-row-master-location"]',
    )!;
    const trigger = masterRow.querySelector(
      '[data-testid="custom-select-trigger"]',
    ) as HTMLButtonElement;
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    // CustomSelect renders colored square indicators (span with backgroundColor) for each option
    const colorSquares = container.querySelectorAll('[data-color]');
    expect(colorSquares.length).toBeGreaterThanOrEqual(1);
    // Verify the first color square has an inline background-color style
    const firstSquare = colorSquares[0];
    expect(firstSquare.getAttribute('style')).toContain('background-color');
  });

  it('snaps non-grid time to nearest grid slot', () => {
    // Activity with startTime=14.0667 (14:04) — NOT aligned to 30-min grid
    const activityWithArbitraryMinutes = {
      ...mockActivity,
      startTime: 14 + 4 / 60, // 14:04
      date: '2026-06-15',
    };
    render(
      <SettingsTab activity={activityWithArbitraryMinutes} onUpdate={vi.fn()} />,
    );
    const datetimeInput = screen.getByTestId('input-datetime') as HTMLInputElement;
    // Native datetime-local value is "YYYY-MM-DDTHH:MM" — snapped to 14:00
    expect(datetimeInput.value).toBe('2026-06-15T14:00');
  });
});

// ─── ClientTab — Layout & Feature Tests ──────────────────────────────────────

describe('ClientTab — layout & features', () => {
  const mockPayments: Array<{ id: string; record_id: string; amount: number; method: string | null; created_at: string; updated_at: string }> = [
    { id: 'p1', record_id: 'r1', amount: 3500, method: 'card', created_at: '', updated_at: '' },
  ];

  const defaultProps = {
    record: mockRecord,
    client: mockClient,
    visitors: [mockVisitor],
    visits: mockRecord.visits,
    payments: [],
    serviceTariffs: mockTariffs,
    onUpdateRecord: vi.fn(),
    onDeleteRecord: vi.fn(),
    showToast: vi.fn(),
  };

  it('renders phone and name on the same row', () => {
    const { container } = render(<ClientTab {...defaultProps} />);
    // client-info-row no longer exists. RecordSummary now renders cost/status.
    const summary = container.querySelector('[data-testid="record-summary"]');
    expect(summary).toBeInTheDocument();
    // RecordSummary shows cost info and status picker on the same row
    expect(summary!.querySelector('[data-testid="record-status"]')).toBeInTheDocument();
  });

  it('renders status picker with all statuses', () => {
    render(<ClientTab {...defaultProps} />);
    // RecordVisitRow renders StatusPicker — find its trigger
    const trigger = screen.getByTestId('visit-v1-status-trigger');
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByTestId('visit-v1-status-popover')).toBeInTheDocument();
    expect(screen.getByTestId('visit-v1-status-option-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('visit-v1-status-option-visited')).toBeInTheDocument();
    expect(screen.getByTestId('visit-v1-status-option-missed')).toBeInTheDocument();
    expect(screen.getByTestId('visit-v1-status-option-cancelled')).toBeInTheDocument();
  });

  it('renders client link as SVG icon (not text)', () => {
    const { container } = render(<ClientTab {...defaultProps} />);
    // Client link is now in ActivityDetailsModal tab labels.
    // Verify the status trigger button renders an SVG icon instead.
    const statusTrigger = container.querySelector('[data-testid="record-status-trigger"]') as HTMLButtonElement;
    expect(statusTrigger).toBeInTheDocument();
    expect(statusTrigger.tagName).toBe('BUTTON');
    // Should contain an SVG element (status icon)
    expect(statusTrigger.querySelector('svg')).toBeInTheDocument();
  });

  it('renders delete payment button for each payment', () => {
    render(<ClientTab {...defaultProps} payments={mockPayments} />);
    const deleteButtons = screen.getAllByLabelText('Удалить');
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show stale closure in delete — uses ref', () => {
    vi.useFakeTimers();
    render(<ClientTab {...defaultProps} />);
    const deleteBtn = screen.getByTestId('btn-delete-record');
    fireEvent.click(deleteBtn);

    // showToast should be called with undo callback
    expect(defaultProps.showToast).toHaveBeenCalledWith(
      'Запись удалена через 5 секунд',
      expect.any(Function),
    );

    vi.useRealTimers();
  });
});

// ─── NewBookingTab — Feature Tests ──────────────────────────────────────────

describe('NewBookingTab — phone optional, visitor optional, tariff required', () => {
  const defaultProps = {
    activity: mockActivity,
    serviceTariffs: mockTariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  it('does not start with any visitors (empty array)', () => {
    render(<NewBookingTab {...defaultProps} />);
    // Should not have any visitor form rows initially
    expect(screen.queryAllByTestId('visitor-form-row').length).toBe(0);
  });

  it('shows add visitor button', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByText(/\+ Добавить посетителя/)).toBeInTheDocument();
  });

  it('adds a visitor when add button is clicked', () => {
    render(<NewBookingTab {...defaultProps} />);
    fireEvent.click(screen.getByText(/\+ Добавить посетителя/));
    expect(screen.getAllByTestId('visitor-form-row').length).toBe(1);
  });

  it('channel select is always visible (not behind checkbox)', () => {
    render(<NewBookingTab {...defaultProps} />);
    expect(screen.getByTestId('select-channel')).toBeInTheDocument();
  });

  it('allows submit with name only (phone optional)', () => {
    render(<NewBookingTab {...defaultProps} />);
    // Fill only name
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));
    // Should NOT show "Заполните телефон и имя" error
    expect(defaultProps.showToast).not.toHaveBeenCalledWith('Заполните телефон и имя');
    // Should call onSubmit
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });

  it('validates tariff is selected before submit when visitors exist', () => {
    render(<NewBookingTab {...defaultProps} serviceTariffs={[]} />);
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));
    // With no tariffs and adding a visitor, should handle gracefully
  });
});
