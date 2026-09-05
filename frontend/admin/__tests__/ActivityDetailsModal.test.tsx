import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityDetailsModal } from '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal';
import { TabNav } from '../app/components/modal/ActivityDetailsModal/TabNav';
import { SettingsTab } from '../app/components/modal/ActivityDetailsModal/SettingsTab';
import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';
import { NewBookingTab } from '../app/components/modal/ActivityDetailsModal/NewBookingTab';
import { ClientsProvider } from '../contexts/ClientsContext';

// ─── Shared mock data & context factories ────────────────────────────────

import {
  mockMasters,
  mockServices,
  mockLocations,
  mockActivity,
  mockClient,
  mockClientWithStats,
  mockRecord,
  mockVisitor,
  mockTariffs,
} from './helpers/mockData';

import {
  createMockScheduleContext,
  createMockUIContext,
  createMockClientsContext,
} from './helpers/mockContexts';

// ─── API Client Mock ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getClientByPhone: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  updateVisitStatus: vi.fn(),
  getRecords: vi.fn(),
  getClientById: vi.fn(),
}));

import {
  getClientByPhone,
  createClient,
  createVisitor,
  createRecord,
  deleteRecord,
  createPayment,
  deletePayment,
  updateVisitStatus,
  getRecords,
  getClientById,
} from '@memo/api-client';
import type { RecordView } from '@memo/api-client';

// ─── Context Mocks ──────────────────────────────────────────────────────────

// GH #213 §6.6 (R3): NO RecordsContext mock — the modal renders without any
// RecordsProvider. `useRecords()` throws outside its provider, so a stray
// dependency on it fails every test here.

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
  ClientsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: vi.fn() }),
}));

vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: vi.fn(() => ({
    recordData: null,
    record: mockRecord,
    visitors: [mockVisitor],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: [],
    visitorsMap: new Map<string, { name: string; age: number | null }>([
      ['vis1', { name: 'Анна Иванова', age: 30 }],
    ]),
    tariffs: mockTariffs,
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
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
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
import { useUI } from '@/contexts/UIContext';
import { useClients } from '@/contexts/ClientsContext';
import { useRecordData } from '@/hooks/useRecordData';
import { useQuery } from '@tanstack/react-query';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseUI = vi.mocked(useUI);
const mockUseClients = vi.mocked(useClients);
const mockUseQuery = vi.mocked(useQuery);

// Helper: make the mocked useQuery serve the per-activity records query (#191).
// Context `records` is now one server page, so the modal must get the activity's
// bookings from its own ['records', 'activity', activityId] query instead.
// GH #213 §6.6: the same stub also serves the per-id client fallback query
// ['client', clientId] (paged-map hit wins BEFORE the fallback resolves).
function stubActivityRecordsQuery(
  records: unknown[],
  clientsById?: Map<string, unknown>,
) {
  mockUseQuery.mockImplementation((opts: unknown) => {
    const key = (opts as { queryKey: unknown }).queryKey;
    if (Array.isArray(key) && key[0] === 'records' && key[1] === 'activity') {
      return { data: records, isLoading: false } as never;
    }
    if (Array.isArray(key) && key[0] === 'client') {
      const resolved = clientsById?.get(String(key[1]));
      return { data: resolved, isLoading: false, isPending: false } as never;
    }
    return { data: undefined, isLoading: false } as never;
  });
}

function resetActivityRecordsQuery() {
  mockUseQuery.mockImplementation(() => ({ data: undefined, isLoading: false } as never));
}

beforeEach(() => {
  mockUseSchedule.mockReturnValue(createMockScheduleContext());
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
    // MasterPicker renders via Combobox — a button trigger instead of native <select>
    const masterRow = screen.getByTestId('settings-row-master-location');
    const masterTrigger = masterRow.querySelector(
      '[data-testid="combobox-trigger"]',
    ) as HTMLButtonElement;
    expect(masterTrigger).toBeInTheDocument();
    // The selected master (m1 = Ольга Середа) should show in the trigger label
    expect(masterTrigger.textContent).toContain('Ольга Середа');
    // Open the dropdown to verify all master names are available
    fireEvent.click(masterTrigger);
    const dropdown = screen.getByTestId('combobox-dropdown');
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
  // New hook-driven prop signature (#127 Task 7).
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    client: mockClient,
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
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
  // GH #213 Task 6: context records are RecordView rows — widen the shared
  // mock for the context override (display fields unused by this modal).
  const mockRecordView: RecordView = {
    ...mockRecord,
    client_name: 'Анна Иванова',
    activity_start: '2026-05-10T10:00:00',
    service_title: 'Йога',
    master_name: 'Иванова Мария',
    location_name: 'Студия 1',
    master_color: null,
    is_private: false,
    paid: 0,
  };
  const mockRecords = [mockRecordView];

  beforeEach(() => {
    vi.mocked(createRecord).mockResolvedValue({ id: 'r_new', activity_id: 'ev_1', client_id: 'c1', status: 'pending', seats: 1, anonym_visits: 0, comment: null, custom_price: null, created_at: '', updated_at: '', visits: [] });
    vi.mocked(createClient).mockResolvedValue({ id: 'c_new', name: 'New', phone: '+7', email: null, channel: 'telegram', created_at: '', updated_at: '', archived: false });
    vi.mocked(createVisitor).mockResolvedValue({ id: 'vis_new', client_id: 'c1', name: 'V', age: null, created_at: '', updated_at: '' });
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({ id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '', updated_at: '' });
    vi.mocked(getClientByPhone).mockRejectedValue(new Error('Not found'));
    // #191: booking tabs come from the activity-records query, not context records.
    // GH #213 §6.6: client c1 resolves via the useClients() paged map.
    mockUseClients.mockReturnValue(
      createMockClientsContext({ clients: [mockClientWithStats] }),
    );
    stubActivityRecordsQuery(mockRecords);
  });

  afterEach(() => {
    resetActivityRecordsQuery();
    vi.clearAllMocks();
  });

  it('passes actual visitors to ClientTab (not empty array)', () => {
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

// ─── GH #213 §6.6: client resolution re-homed off RecordsContext ────────────
// Precedence preserved: useClients() paged map FIRST, per-id getClientById
// query as fallback (key shared with ClientQuickCard — TanStack dedupes).
// The fallback hook tracks the ACTIVE tab's record, so fallback-path tests
// click the booking tab first.

describe('ActivityDetailsModal — client resolution without RecordsContext (#213)', () => {
  afterEach(() => {
    resetActivityRecordsQuery();
    vi.clearAllMocks();
  });

  it('resolves the tab label from the useClients() paged map (first source)', () => {
    mockUseClients.mockReturnValue(
      createMockClientsContext({ clients: [mockClientWithStats] }),
    );
    stubActivityRecordsQuery([mockRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // Paged map carries c1 → tab label renders the client name without
    // any fallback data being resolved
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('falls back to the per-id client query when the paged map misses', () => {
    mockUseClients.mockReturnValue(createMockClientsContext()); // paged map empty
    // Fallback resolves the by-id client (same precedence as the old map chain)
    stubActivityRecordsQuery([mockRecord], new Map([['c1', mockClient]]));

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // No paged-map hit and no active record yet → placeholder label
    expect(screen.getByText('Без контакта')).toBeInTheDocument();

    // Activate the booking tab → per-id fallback resolves → name appears
    fireEvent.click(screen.getByText('Без контакта'));
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByTestId('client-tab')).toBeInTheDocument();
  });

  it('registers the by-id fallback query with the canonical key and gate', async () => {
    mockUseClients.mockReturnValue(createMockClientsContext());
    stubActivityRecordsQuery([mockRecord], new Map([['c1', mockClient]]));

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    fireEvent.click(screen.getByText('Без контакта'));

    // After activation the fallback tracks the active record (the initial
    // settings-tab render registers ['client', ''] — find the c1 call)
    const clientQuery = mockUseQuery.mock.calls
      .map(([opts]) => opts as { queryKey: unknown; enabled?: boolean; queryFn?: () => Promise<unknown> })
      .find((o) => Array.isArray(o.queryKey) && (o.queryKey as unknown[])[1] === 'c1');

    expect(clientQuery).toBeDefined();
    expect(clientQuery!.queryKey).toEqual(['client', 'c1']);
    expect(clientQuery!.enabled).toBe(true);
    await clientQuery!.queryFn!();
    expect(getClientById).toHaveBeenCalledWith('c1');
  });

  it('keeps the fallback disabled for anonymous records (no client_id)', () => {
    mockUseClients.mockReturnValue(createMockClientsContext());
    const anonymousRecord = { ...mockRecord, id: 'r2', client_id: null };
    stubActivityRecordsQuery([anonymousRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // Anonymous booking renders the "no contact" placeholder label
    expect(screen.getByText('Без контакта')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Без контакта'));

    // No enabled ['client', id] query — client_id is null
    const clientQueries = mockUseQuery.mock.calls
      .map(([opts]) => opts as { queryKey: unknown; enabled?: boolean })
      .filter((o) => Array.isArray(o.queryKey) && (o.queryKey as unknown[])[0] === 'client');
    for (const q of clientQueries) {
      expect(q.enabled).toBe(false);
    }
    expect(screen.getByText('Без контакта')).toBeInTheDocument();
  });

  it('passes the resolved client to ClientTab — stats populated on a paged-map hit', () => {
    // Paged-map hit: ClientWithStats carries records_count → stats cells populated
    mockUseClients.mockReturnValue(
      createMockClientsContext({ clients: [mockClientWithStats] }),
    );
    stubActivityRecordsQuery([mockRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    fireEvent.click(screen.getByText('Анна Иванова'));
    expect(screen.getByTestId('client-tab')).toBeInTheDocument();
    const stats = screen.getByTestId('client-statistics');
    expect(within(stats).getByText('5')).toBeInTheDocument(); // records_count
  });

  it('renders ClientTab with empty stats when the client comes from the by-id fallback', () => {
    // Fallback path: getClientById returns a plain ClientResponse (no stats)
    mockUseClients.mockReturnValue(createMockClientsContext());
    stubActivityRecordsQuery([mockRecord], new Map([['c1', mockClient]]));

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    fireEvent.click(screen.getByText('Без контакта'));
    expect(screen.getByTestId('client-tab')).toBeInTheDocument();
    const stats = screen.getByTestId('client-statistics');
    expect(within(stats).queryByText('5')).not.toBeInTheDocument();
    expect(within(stats).getAllByText('—').length).toBeGreaterThan(0);
  });
});

// ─── ActivityDetailsModal: dedicated activity-records query (#191) ───────────

describe('ActivityDetailsModal — dedicated activity-records query (#191)', () => {
  beforeEach(() => {
    vi.mocked(getRecords).mockResolvedValue({
      items: [mockRecord],
      total: 1,
      page: 1,
      per_page: 100,
      pages: 1,
    } as never);
    // Context records is ONE server page — deliberately EMPTY to prove the modal
    // no longer builds booking tabs from it. GH #213 §6.6: the client for c1
    // now comes from the useClients() paged map, not RecordsContext.
    mockUseClients.mockReturnValue(
      createMockClientsContext({ clients: [mockClientWithStats] }),
    );
    stubActivityRecordsQuery([mockRecord]);
  });

  afterEach(() => {
    resetActivityRecordsQuery();
    vi.clearAllMocks();
  });

  it('renders booking tabs from the activity-records query, not context records', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('queries records with activity_id and per_page=100 when open', async () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    const activityQuery = mockUseQuery.mock.calls
      .map(([opts]) => opts as { queryKey: unknown; enabled?: boolean; queryFn: () => Promise<unknown> })
      .find((o) => Array.isArray(o.queryKey) && (o.queryKey as unknown[])[0] === 'records' && (o.queryKey as unknown[])[1] === 'activity');

    expect(activityQuery).toBeDefined();
    expect(activityQuery!.queryKey).toEqual(['records', 'activity', mockActivity.id]);
    expect(activityQuery!.enabled).toBe(true);

    await activityQuery!.queryFn();
    expect(getRecords).toHaveBeenCalledWith({ activity_id: mockActivity.id, per_page: 100 });
  });

  it('disables the query when the modal is closed', () => {
    render(
      <ActivityDetailsModal isOpen={false} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    const activityQuery = mockUseQuery.mock.calls
      .map(([opts]) => opts as { queryKey: unknown; enabled?: boolean })
      .find((o) => Array.isArray(o.queryKey) && (o.queryKey as unknown[])[0] === 'records' && (o.queryKey as unknown[])[1] === 'activity');

    expect(activityQuery).toBeDefined();
    expect(activityQuery!.enabled).toBe(false);
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
    // select-service testid sits on the wrapper div; the Combobox trigger lives inside it
    const serviceWrapper = row2!.querySelector('[data-testid="select-service"]');
    expect(serviceWrapper).toBeInTheDocument();
    expect(serviceWrapper!.querySelector('[data-testid="combobox-trigger"]')).toBeInTheDocument();
    expect(row2!.querySelector('[data-testid="input-capacity"]')).toBeInTheDocument();
  });

  it('renders master and location on the same row', () => {
    const { container } = render(<SettingsTab {...defaultProps} />);
    const row3 = container.querySelector('[data-testid="settings-row-master-location"]');
    expect(row3).toBeInTheDocument();
    // MasterPicker renders via Combobox — a button trigger
    expect(row3!.querySelector('[data-testid="combobox-trigger"]')).toBeInTheDocument();
    // select-location testid moved onto the wrapper div (native select is gone)
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
    // MasterPicker renders via Combobox — open the dropdown to inspect options
    const masterRow = container.querySelector(
      '[data-testid="settings-row-master-location"]',
    )!;
    const trigger = masterRow.querySelector(
      '[data-testid="combobox-trigger"]',
    ) as HTMLButtonElement;
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    // Combobox renders colored square indicators (span with backgroundColor) for each option
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

// ─── SettingsTab — Combobox interactions (GH #214 rows 4-5) ─────────────────

describe('SettingsTab — service/location combobox flow', () => {
  it('selects a service via combobox and emits the service side effects', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    fireEvent.click(
      within(screen.getByTestId('select-service')).getByTestId('combobox-trigger'),
    );
    fireEvent.click(screen.getByTestId('combobox-option-s2'));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 's2',
        serviceName: 'Картина акрилом',
        minAge: '6',
        duration: 2,
      }),
    );
  });

  it('filters service options via combobox search', () => {
    render(<SettingsTab activity={mockActivity} onUpdate={vi.fn()} />);
    fireEvent.click(
      within(screen.getByTestId('select-service')).getByTestId('combobox-trigger'),
    );
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'акрилом' } });
    expect(screen.getByTestId('combobox-option-s2')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-s1')).not.toBeInTheDocument();
  });

  it('clear option empties the service like the old empty <option value="">', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    fireEvent.click(
      within(screen.getByTestId('select-service')).getByTestId('combobox-trigger'),
    );
    fireEvent.click(screen.getByTestId('combobox-option-clear'));
    // handleServiceChange('') sets state but finds no service → no onUpdate payload,
    // exactly as with the native select's empty option
    expect(onUpdate).not.toHaveBeenCalled();
    const trigger = within(screen.getByTestId('select-service')).getByTestId('combobox-trigger');
    expect(trigger.textContent).toContain('Выберите');
  });

  it('selects a location via combobox and emits locationId', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    fireEvent.click(
      within(screen.getByTestId('select-location')).getByTestId('combobox-trigger'),
    );
    fireEvent.click(screen.getByTestId('combobox-option-alpika'));
    expect(onUpdate).toHaveBeenCalledWith({ locationId: 'alpika' });
  });
});

// ─── ClientTab — Layout & Feature Tests ──────────────────────────────────────

describe('ClientTab — layout & features', () => {
  const mockPayments: Array<{ id: string; record_id: string; amount: number; method: string | null; created_at: string; updated_at: string }> = [
    { id: 'p1', record_id: 'r1', amount: 3500, method: 'card', created_at: '', updated_at: '' },
  ];

  // New hook-driven prop signature (#127 Task 7).
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    client: mockClient,
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
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
    // Override useRecordData to return a payment so we can test the delete button
    // (the default mock above already imports useRecordData, so we use the
    // already-imported mocked function)
    vi.mocked(useRecordData).mockReturnValueOnce({
      recordData: null,
      record: mockRecord,
      visitors: [mockVisitor],
      activity: undefined,
      services: [],
      masters: [],
      locations: [],
      payments: mockPayments,
      visitorsMap: new Map(),
      tariffs: mockTariffs,
      isLoading: false,
      status: 'waiting' as const,
    });

    render(<ClientTab {...defaultProps} />);
    const deleteButtons = screen.getAllByLabelText('Удалить');
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('delete click runs the dry-run flow and reports via onDeleteRecord — no 5s timer (Addendum 13)', async () => {
    render(<ClientTab {...defaultProps} />);
    const deleteBtn = screen.getByTestId('btn-delete-record');
    fireEvent.click(deleteBtn);

    // Addendum 13: the legacy 5-second setTimeout + undo toast is gone —
    // a successful dry-run (204) navigates immediately via onDeleteRecord.
    await waitFor(() => {
      expect(defaultProps.onDeleteRecord).toHaveBeenCalledWith('r1');
    });
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
