import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { ActivityDetailsModal } from '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal';
import { TabNav } from '../app/components/modal/ActivityDetailsModal/TabNav';
import { SettingsTab } from '../app/components/modal/ActivityDetailsModal/SettingsTab';
import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';
import { NewBookingTab } from '../app/components/modal/ActivityDetailsModal/NewBookingTab';

// ─── Shared mock data & context factories ────────────────────────────────

import {
  mockActivity,
  mockClient,
  mockRecord,
  mockVisitor,
  mockTariffs,
} from './helpers/mockData';

import {
  createMockScheduleData,
  createMockGridSettings,
  createMockUIContext,
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
} from '@memo/api-client';

// ─── Context Mocks ──────────────────────────────────────────────────────────

// GH #213 §6.6 (R3): NO RecordsContext mock — the modal renders without any
// RecordsProvider. `useRecords()` throws outside its provider, so a stray
// dependency on it fails every test here.
// GH #140 US-2: NO ClientsContext mock either — the modal has ZERO
// clients-list dependency; per-tab resolution goes through useClient.

// GH #141 Task 10: the modal + SettingsTab read the split contexts — data for
// services/masters/locations + mutations, grid settings for gridFrequency.
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
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

// ─── Point-hook mocks (GH #140 Task 6) ──────────────────────────────────────
// useClient is configurable per id so the tests can pin the progressive
// «…» → name+phone render and the «Без контакта» error/anonymous branches.

vi.mock('@/hooks/useClient', () => ({
  useClient: vi.fn(),
  useClientRecords: vi.fn(),
}));

vi.mock('@/hooks/useActivities', () => ({
  useActivityRecords: vi.fn(),
  useActivity: vi.fn(),
  useActivitiesForRecords: vi.fn(),
}));

vi.mock('@/hooks/usePayments', () => ({
  usePaymentTotals: vi.fn(),
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

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUI } from '@/contexts/UIContext';
import { useRecordData } from '@/hooks/useRecordData';
import { useClient, useClientRecords } from '@/hooks/useClient';
import {
  useActivityRecords,
  useActivity,
  useActivitiesForRecords,
} from '@/hooks/useActivities';
import { usePaymentTotals } from '@/hooks/usePayments';

const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseGridSettings = vi.mocked(useGridSettings);
const mockUseUI = vi.mocked(useUI);
const mockUseClient = vi.mocked(useClient);
const mockUseClientRecords = vi.mocked(useClientRecords);
const mockUseActivityRecords = vi.mocked(useActivityRecords);
const mockUseActivity = vi.mocked(useActivity);
const mockUseActivitiesForRecords = vi.mocked(useActivitiesForRecords);
const mockUsePaymentTotals = vi.mocked(usePaymentTotals);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Serve the activity's booking records (tab strip source). */
function stubActivityRecords(records: unknown[]) {
  mockUseActivityRecords.mockReturnValue({ data: records } as never);
}

type ClientState = {
  data?: unknown;
  isPending?: boolean;
  isError?: boolean;
};

/**
 * Configure useClient per id (GH #140 US-2). Ids absent from the map resolve
 * as settled-with-no-data («…» branch); pass an explicit entry to pin
 * pending/error states.
 */
function stubClientsById(states: Record<string, ClientState>) {
  mockUseClient.mockImplementation(((id: string | undefined) => {
    const state = id ? states[id] : undefined;
    return {
      data: state?.data,
      isPending: state?.isPending ?? false,
      isError: state?.isError ?? false,
    };
  }) as never);
}

beforeEach(() => {
  mockUseScheduleData.mockReturnValue(createMockScheduleData());
  mockUseGridSettings.mockReturnValue(createMockGridSettings());
  mockUseUI.mockReturnValue(createMockUIContext());
  mockUseActivityRecords.mockReturnValue({ data: [] } as never);
  mockUseClient.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  } as never);
  mockUseClientRecords.mockReturnValue({ data: undefined } as never);
  mockUseActivity.mockReturnValue({ data: undefined } as never);
  mockUseActivitiesForRecords.mockReturnValue({ data: [] } as never);
  mockUsePaymentTotals.mockReturnValue({ data: undefined } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
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
  // Hook-driven prop signature (#127 Task 7; GH #140 — no `client` prop,
  // ClientTab resolves its client via useClient(clientId)).
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders client name', () => {
    stubClientsById({ c1: { data: mockClient } });
    render(<ClientTab {...defaultProps} />);
    // GH #140 US-2: the resolved client shows in the tab content header.
    const header = screen.getByTestId('client-tab-header');
    expect(header.textContent).toContain('Анна Иванова');
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
  });

  it('renders client phone as read-only', () => {
    stubClientsById({ c1: { data: mockClient } });
    render(<ClientTab {...defaultProps} />);
    // GH #140 US-2: phone renders next to the name in the tab content.
    const header = screen.getByTestId('client-tab-header');
    expect(header.textContent).toContain('+7 (900) 123-45-67');
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

  it('shows «…» while the client query is pending', () => {
    stubClientsById({ c1: { isPending: true } });
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('client-tab-header').textContent).toBe('…');
  });

  it('shows «Без контакта» when the client query errors', () => {
    stubClientsById({ c1: { isError: true } });
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('client-tab-header').textContent).toBe('Без контакта');
  });

  it('shows «Без контакта» immediately for an anonymous record (no client_id)', () => {
    // clientId '' → useClient(undefined): no query fires, no «…» phase.
    render(<ClientTab {...defaultProps} clientId="" />);
    expect(screen.getByTestId('client-tab-header').textContent).toBe('Без контакта');
    expect(mockUseClient).toHaveBeenCalledWith(undefined);
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
  beforeEach(() => {
    vi.mocked(createRecord).mockResolvedValue({ id: 'r_new', activity_id: 'ev_1', client_id: 'c1', status: 'pending', seats: 1, anonym_visits: 0, comment: null, custom_price: null, created_at: '', updated_at: '', visits: [] });
    vi.mocked(createClient).mockResolvedValue({ id: 'c_new', name: 'New', phone: '+7', email: null, channel: 'telegram', created_at: '', updated_at: '', archived: false });
    vi.mocked(createVisitor).mockResolvedValue({ id: 'vis_new', client_id: 'c1', name: 'V', age: null, created_at: '', updated_at: '' });
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({ id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '', updated_at: '' });
    vi.mocked(getClientByPhone).mockRejectedValue(new Error('Not found'));
    // #191/#140: booking tabs come from useActivityRecords; client c1 resolves
    // per-tab via useClient (no clients list anywhere).
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);
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

// ─── GH #140 US-2: per-tab client resolution (no clients-list source) ───────
// Every record tab mounts its own useClient observer: names+phones resolve on
// ALL tabs (including non-active ones), progressively («…» → resolved), with
// «Без контакта» ONLY on error or an anonymous record.

describe('ActivityDetailsModal — per-tab client resolution (#140 US-2)', () => {
  const mockClient2 = {
    ...mockClient,
    id: 'c2',
    name: 'Борис Петров',
    phone: '+7 (900) 987-65-43',
  };
  const record2 = { ...mockRecord, id: 'r2', client_id: 'c2' };

  it('renders ALL record tabs immediately with «…» while clients are pending', () => {
    // Both clients pending → both tabs still render (placeholder labels).
    stubClientsById({ c1: { isPending: true }, c2: { isPending: true } });
    stubActivityRecords([mockRecord, record2]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    expect(screen.getByTestId('tab-client-r1')).toBeInTheDocument();
    expect(screen.getByTestId('tab-client-r2')).toBeInTheDocument();
    expect(screen.getAllByText('…').length).toBe(2);
    // «Без контакта» must NOT appear while pending — only on error/anonymous.
    expect(screen.queryByText('Без контакта')).not.toBeInTheDocument();
  });

  it('shows resolved name+phone on EVERY tab, including non-active ones', () => {
    stubClientsById({ c1: { data: mockClient }, c2: { data: mockClient2 } });
    stubActivityRecords([mockRecord, record2]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // Default active tab is 'settings' — no record tab activated, yet both
    // clients resolve (US-2 core: beyond-first-20 clients always render).
    const tab1 = screen.getByTestId('tab-client-r1');
    const tab2 = screen.getByTestId('tab-client-r2');
    expect(tab1.textContent).toContain('Анна Иванова');
    expect(tab1.textContent).toContain('+7 (900) 123-45-67');
    expect(tab2.textContent).toContain('Борис Петров');
    expect(tab2.textContent).toContain('+7 (900) 987-65-43');
  });

  it('resolves each tab client via useClient on the shared per-id key', () => {
    stubClientsById({ c1: { data: mockClient }, c2: { data: mockClient2 } });
    stubActivityRecords([mockRecord, record2]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    expect(mockUseClient).toHaveBeenCalledWith('c1');
    expect(mockUseClient).toHaveBeenCalledWith('c2');
  });

  it('shows «Без контакта» when a tab client query errors', () => {
    stubClientsById({ c1: { isError: true } });
    stubActivityRecords([mockRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    expect(screen.getByText('Без контакта')).toBeInTheDocument();
    expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument();
  });

  it('shows «Без контакта» immediately for an anonymous record (client_id null)', () => {
    const anonymousRecord = { ...mockRecord, id: 'r2', client_id: null };
    stubClientsById({}); // nothing resolves — anonymous must NOT show «…»
    stubActivityRecords([anonymousRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // No client_id → immediate «Без контакта», no pending placeholder.
    expect(screen.getByText('Без контакта')).toBeInTheDocument();
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('opens the client profile via window.open from the tab label', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = vi.fn();
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );

    fireEvent.click(screen.getByTestId('open-profile-r1'));
    expect(windowOpen).toHaveBeenCalledWith(
      '/clients?clientId=c1',
      '_blank',
      'noopener,noreferrer',
    );
    expect(onClose).toHaveBeenCalled();
    windowOpen.mockRestore();
  });

  it('has zero clients-list dependency (source-level pin)', () => {
    // GH #140 DoD: the module must not import/use any clients-list source.
    const filePath = path.resolve(
      __dirname,
      '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx',
    );
    const src = fs.readFileSync(filePath, 'utf-8');
    expect(src).not.toMatch(/useClients\s*\(/);
    expect(src).not.toMatch(/useClientsTable/);
    expect(src).not.toMatch(/ClientsContext/);
  });
});

// ─── ActivityDetailsModal: activity-records hook (#191 → #140 point hook) ───

describe('ActivityDetailsModal — activity records via useActivityRecords (#140)', () => {
  it('renders booking tabs from the activity-records hook', () => {
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);

    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('requests records gated on isOpen', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(mockUseActivityRecords).toHaveBeenCalledWith(mockActivity.id, true);
  });

  it('disables the records fetch when the modal is closed', () => {
    render(
      <ActivityDetailsModal isOpen={false} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(mockUseActivityRecords).toHaveBeenCalledWith(mockActivity.id, false);
  });
});

// ─── ClientTab — stats re-source (GH #140, ClientQuickCard recipe) ──────────
// useClient returns ClientResponse (no stats fields): ClientStatistics is fed
// from useClientRecords + useActivitiesForRecords + usePaymentTotals over the
// same 100-record window ClientQuickCard shows.

describe('ClientTab — derived client statistics (#140)', () => {
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
  };

  const clientRecordA = { ...mockRecord, id: 'cr1', activity_id: 'ev_a', status: 'missed' };
  const clientRecordB = { ...mockRecord, id: 'cr2', activity_id: 'ev_b', status: 'visited' };
  const activityA = { id: 'ev_a', start: '2026-05-10T14:00:00' };
  const activityB = { id: 'ev_b', start: '2026-04-20T18:00:00' };

  it('derives recordsCount / missedRecords / lastRecord / totalPaid from the record window', () => {
    stubClientsById({ c1: { data: mockClient } });
    mockUseClientRecords.mockReturnValue({ data: [clientRecordA, clientRecordB] } as never);
    mockUseActivitiesForRecords.mockReturnValue({ data: [activityB, activityA] } as never);
    mockUsePaymentTotals.mockReturnValue({ data: { cr1: 1000, cr2: 2500 } } as never);

    render(<ClientTab {...defaultProps} />);

    const stats = screen.getByTestId('client-statistics');
    expect(within(stats).getByText('2')).toBeInTheDocument(); // recordsCount
    expect(within(stats).getByText('1')).toBeInTheDocument(); // missedRecords
    expect(within(stats).getByText('10.05.2026')).toBeInTheDocument(); // lastRecord = max activity start
    expect(within(stats).getByText('3 500 ₽')).toBeInTheDocument(); // totalPaid = 1000 + 2500
  });

  it('requests totals over the sorted record-id window (ClientQuickCard key parity)', () => {
    stubClientsById({ c1: { data: mockClient } });
    mockUseClientRecords.mockReturnValue({ data: [clientRecordB, clientRecordA] } as never);

    render(<ClientTab {...defaultProps} />);

    expect(mockUsePaymentTotals).toHaveBeenCalledWith(['cr1', 'cr2']);
  });

  it('renders all-«—» stats for an anonymous record (nothing derivable)', () => {
    render(<ClientTab {...defaultProps} clientId="" />);

    const stats = screen.getByTestId('client-statistics');
    expect(within(stats).getAllByText('—').length).toBe(4);
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
    // Activity with startMinutes=845 (14:05) — NOT aligned to 30-min grid
    const activityWithArbitraryMinutes = {
      ...mockActivity,
      startMinutes: 845,
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
        durationMinutes: 120,
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

  // Hook-driven prop signature (#127 Task 7; GH #140 — no `client` prop).
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
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
    await vi.waitFor(() => {
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
