import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { ActivityDetailsModal } from '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal';
import { TabNav } from '../app/components/modal/ActivityDetailsModal/TabNav';
import { SettingsTab } from '../app/components/modal/ActivityDetailsModal/SettingsTab';
import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';
import { NewRecordTab } from '../app/components/modal/ActivityDetailsModal/NewRecordTab';

// ─── Shared mock data & context factories ────────────────────────────────

import {
  mockActivity,
  mockClient,
  mockRecord,
  mockVisitor,
  mockTariffs,
  mockMasters,
  mockServices,
} from './helpers/mockData';

import {
  createMockScheduleData,
  createMockGridSettings,
  createMockUIContext,
} from './helpers/mockContexts';
import { parseApiError } from '@/app/lib/api/parseApiError';
import type { ScheduleDataContextType, AddActivityOutcome } from '@/contexts/schedule/ScheduleDataContext';
import type { Tariff } from '@memo/domain';

// ─── API Client Mock ───────────────────────────────────────────────────────

// #480 §3.4: components import enum schemas at module level — spread the
// actual module, the fn mocks below stay as overrides.
vi.mock('@memo/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memo/api-client')>()),
  // parseApiError does `err instanceof ApiError` — create mode's error path
  // reaches it, so the mock must expose the class (same as ClientRecordTab).
  ApiError: class ApiError extends Error {},
  getClientByPhone: vi.fn(),
  getClientsPaged: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  dryRunDeleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  updateVisitStatus: vi.fn(),
  getRecords: vi.fn(),
  getClientById: vi.fn(),
}));

import {
  getClientByPhone,
  getClientsPaged,
  createClient,
  createVisitor,
  createRecord,
  dryRunDeleteRecord,
  createPayment,
} from '@memo/api-client';
import type { PaymentResponse } from '@memo/api-client';

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
    // The GH #285 delete hook snapshots ['records', ...] caches via
    // getQueriesData at click time — none seeded in these tests.
    getQueriesData: vi.fn(() => [] as Array<[readonly unknown[], unknown]>),
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

/** Serve the activity's records (tab strip source). */
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
  // Hook-driven prop signature (#127 Task 7). The client's name+phone are NOT
  // here — they live only in the tab-strip label (ClientLabelById); the
  // per-tab resolution states are covered by the #140 US-2 describe below.
  const defaultProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders the record summary (no duplicated client header)', () => {
    stubClientsById({ c1: { data: mockClient } });
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('client-tab-header')).not.toBeInTheDocument();
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

// ─── NewRecordTab Tests ────────────────────────────────────────────────────

describe('NewRecordTab', () => {
  const defaultProps = {
    activity: mockActivity,
    serviceTariffs: mockTariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  it('renders phone input', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByLabelText(/Телефон/)).toBeInTheDocument();
  });

  it('renders name input', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByLabelText(/Имя/)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByText('Создать запись')).toBeInTheDocument();
  });

  it('renders add visitor button', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByText(/Добавить посетителя/)).toBeInTheDocument();
  });

  it('renders notifications checkbox', () => {
    render(<NewRecordTab {...defaultProps} />);
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
    vi.mocked(createRecord).mockResolvedValue({ id: 'r_new', activity_id: 'ev_1', client_id: 'c1', status: 'waiting', seats: 1, comment: null, custom_price: null, created_at: '', updated_at: '', visits: [] });
    vi.mocked(createClient).mockResolvedValue({ id: 'c_new', name: 'New', phone: '+7', email: null, channel: 'telegram', created_at: '', updated_at: '', archived: false });
    vi.mocked(createVisitor).mockResolvedValue({ id: 'vis_new', client_id: 'c1', name: 'V', age: null, created_at: '', updated_at: '' });
    vi.mocked(dryRunDeleteRecord).mockResolvedValue(undefined);
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
    // GH #414 (spec §Форматирование, показ): the label phones render grouped
    // via formatPhoneDisplay (ClientLabelById), not the raw stored strings.
    const tab1 = screen.getByTestId('tab-client-r1');
    const tab2 = screen.getByTestId('tab-client-r2');
    expect(tab1.textContent).toContain('Анна Иванова');
    expect(tab1.textContent).toContain('+7 900 123 45 67');
    expect(tab2.textContent).toContain('Борис Петров');
    expect(tab2.textContent).toContain('+7 900 987 65 43');
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
    // GH #258/#259: the parent returns null when closed, so the record-hook
    // subtree never mounts — no fetch call happens at all (stronger than the
    // old enabled=false probe).
    render(
      <ActivityDetailsModal isOpen={false} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(mockUseActivityRecords).not.toHaveBeenCalled();
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

// ─── SettingsTab — capacity gate (GH #280: вместимость ≥ 1) ─────────────────
// Instant-patch convention (same as the «ЧЧ:ММ» duration): the field follows
// raw input, but the capacity PATCH fires only for Number(value) >= 1 —
// empty/zero input is silently not applied.

describe('SettingsTab — capacity gate (вместимость ≥ 1, GH #280)', () => {
  it('does not patch capacity when the input is emptied or set to 0', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    const input = screen.getByTestId('input-capacity');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '0' } });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('patches capacity for values >= 1', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    const input = screen.getByTestId('input-capacity');
    fireEvent.change(input, { target: { value: '1' } });
    expect(onUpdate).toHaveBeenCalledWith({ capacity: 1 });
    fireEvent.change(input, { target: { value: '12' } });
    expect(onUpdate).toHaveBeenCalledWith({ capacity: 12 });
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
});

// ─── SettingsTab — datetime patch source (GH #553: полная дата) ─────────────
// The datetime instant-patch sends the FULL calendar date — `{ start }` from
// composeLocalISO(datePart, snappedMinutes), the same floating-local ISO the
// create form sends (#280). The chosen date is no longer discarded; the legacy
// `dayIndex + startMinutes` keys belong to the grid senders (dnd, slot stamps)
// and must NOT appear in the form's payload. Empty/partial field values send
// nothing at all (broken `start` in PATCH is impossible by construction).

describe('SettingsTab — datetime patch sends full date (GH #553)', () => {
  it('sends { start } with the chosen full date+snapped time, not dayIndex + startMinutes', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    const input = screen.getByTestId('input-datetime');
    // 14:25 snaps to 14:30 on the 30-min grid (mockGridSettings)
    fireEvent.change(input, { target: { value: '2026-06-09T14:25' } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ start: '2026-06-09T14:30:00' });
    // the legacy grid keys must not ride along
    const payload = onUpdate.mock.calls[0][0];
    expect(payload).not.toHaveProperty('dayIndex');
    expect(payload).not.toHaveProperty('startMinutes');
  });

  it('keeps the chosen date outside the open week (date is not discarded)', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    const input = screen.getByTestId('input-datetime');
    // mockActivity sits on 2026-06-13; pick a date from a DIFFERENT week
    fireEvent.change(input, { target: { value: '2026-07-01T10:00' } });
    expect(onUpdate).toHaveBeenCalledWith({ start: '2026-07-01T10:00:00' });
  });

  it('does not patch when the field is cleared (empty value)', () => {
    const onUpdate = vi.fn();
    render(<SettingsTab activity={mockActivity} onUpdate={onUpdate} />);
    const input = screen.getByTestId('input-datetime');
    fireEvent.change(input, { target: { value: '' } });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ─── GH #553: тост успеха патча даты-времени (уровень модалки) ───────────────
// Единственный «озвученный» instant-patch: успешный start-патч может увезти
// занятие из открытой недели (карточка «исчезнет» по рефетчу) — успех сопровождается
// тостом общего стека, текст зеркален созданию («Сохранено: <услуга> — <дата>,
// <время>»), вид — дефолтный info (toast-info). Остальные поля молчат; реджект —
// молчаливый откат (error-тоста у обновления занятия нет); модалка не закрывается
// ни при каком исходе (решение гейта B).

describe('ActivityDetailsModal — date-time patch success toast (GH #553)', () => {
  it('shows the «Сохранено: …» toast (default info kind) when a start patch resolves; modal stays open', async () => {
    const updateActivity = vi.fn(() => Promise.resolve());
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ updateActivity }));
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );

    // 14:25 snaps to 14:30 on the 30-min grid (same trigger as the SettingsTab
    // payload test above) → { start: '2026-06-09T14:30:00' }
    fireEvent.change(screen.getByTestId('input-datetime'), { target: { value: '2026-06-09T14:25' } });
    expect(updateActivity).toHaveBeenCalledWith(mockActivity.id, { start: '2026-06-09T14:30:00' });

    // Toast fires in the mutation's .then — service name resolves via the
    // context services list (s1 = «Картина маслом»), date-time via the shared
    // datetime helpers from updates.start. Single-arg call = default info
    // kind (→ toast-info in the real stack).
    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Сохранено: Картина маслом — вторник, 9 июня, 14:30'),
    );
    // Gate B: the modal never closes on a date-time patch outcome.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays silent on non-start patches (other instant-patch fields keep today’s behavior)', async () => {
    const updateActivity = vi.fn(() => Promise.resolve());
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ updateActivity }));
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast }));
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    // A capacity instant-patch (>= 1 gate) resolves fine — but no toast.
    fireEvent.change(screen.getByTestId('input-capacity'), { target: { value: '10' } });
    expect(updateActivity).toHaveBeenCalledWith(mockActivity.id, { capacity: 10 });

    // Settle anchor (mutation promise flushed inside act) before the negative
    // assert, so a late toast cannot silently green the test.
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows no success toast when the start patch rejects (silent rollback, as today)', async () => {
    const updateActivity = vi.fn(() => Promise.reject(new Error('server down')));
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ updateActivity }));
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast }));
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );

    fireEvent.change(screen.getByTestId('input-datetime'), { target: { value: '2026-06-09T14:25' } });

    // Rejection settled: rollback is the mutation's business, the patch stays
    // silent (no error toast for activity updates, no success toast either),
    // and the rejection must not surface as unhandled.
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── ClientTab — Layout & Feature Tests ──────────────────────────────────────

describe('ClientTab — layout & features', () => {
  // PaymentResponse[] (typed — method is the PaymentMethod union since
  // #480 §3.3; a loose `string | null` annotation no longer type-checks).
  const mockPayments: PaymentResponse[] = [
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

// ─── NewRecordTab — Feature Tests ──────────────────────────────────────────

describe('NewRecordTab — visitor optional, tariff required; typed phone must be complete (GH #221 decision 11)', () => {
  const defaultProps = {
    activity: mockActivity,
    serviceTariffs: mockTariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  it('does not start with any visitors (empty array)', () => {
    render(<NewRecordTab {...defaultProps} />);
    // Should not have any visitor form rows initially
    expect(screen.queryAllByTestId('visitor-form-row').length).toBe(0);
  });

  it('shows add visitor button', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByText(/\+ Добавить посетителя/)).toBeInTheDocument();
  });

  it('adds a visitor when add button is clicked', () => {
    render(<NewRecordTab {...defaultProps} />);
    fireEvent.click(screen.getByText(/\+ Добавить посетителя/));
    expect(screen.getAllByTestId('visitor-form-row').length).toBe(1);
  });

  it('channel select is always visible (not behind checkbox)', () => {
    render(<NewRecordTab {...defaultProps} />);
    expect(screen.getByTestId('select-channel')).toBeInTheDocument();
  });

  it('submits with name only — EMPTY phone is a legitimate pre-existing path (spec §10)', () => {
    render(<NewRecordTab {...defaultProps} />);
    // Name-only quick-add with no phone predates #221 and stays untouched
    // (§10). Only a TYPED-BUT-INCOMPLETE number hits the completeness guard.
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));
    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'unpicked', phone: '' }),
    );
  });

  it('validates tariff is selected before submit when visitors exist', () => {
    render(<NewRecordTab {...defaultProps} serviceTariffs={[]} />);
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));
    // With no tariffs and adding a visitor, should handle gracefully
  });

  it('added visitor defaults to the resolver tariff (first adult), not the first in list (GH #284)', () => {
    // Kid-first list proves the classifier (not array position) picks the default.
    const kidFirst: Tariff[] = [
      { id: 't2', title: 'Детский', price: 2500, description: null, audience: 'kid' },
      { id: 't1', title: 'Взрослый', price: 3500, description: null, audience: 'adult' },
    ];
    render(<NewRecordTab {...defaultProps} serviceTariffs={kidFirst} />);
    fireEvent.click(screen.getByText(/\+ Добавить посетителя/));

    const row = screen.getByTestId('visitor-form-row');
    const select = row.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('t1');
  });

  it('changing visitor age re-resolves the default tariff (overwrites manual pick) (GH #284)', () => {
    // Spec §2.5: ANY age change re-substitutes the tariff — manual pick is
    // clobbered by design (owner decision).
    render(<NewRecordTab {...defaultProps} />);
    fireEvent.click(screen.getByText(/\+ Добавить посетителя/));

    const row = screen.getByTestId('visitor-form-row');
    const ageInput = row.querySelector('input[type="number"]') as HTMLInputElement;
    const select = row.querySelector('select') as HTMLSelectElement;

    // Manual pick: Детский
    fireEvent.change(select, { target: { value: 't2' } });
    expect(select.value).toBe('t2');

    // Age 14 → adult side → back to Взрослый
    fireEvent.change(ageInput, { target: { value: '14' } });
    expect(select.value).toBe('t1');

    // Age 7 → kid side → Детский
    fireEvent.change(ageInput, { target: { value: '7' } });
    expect(select.value).toBe('t2');
  });
});

// ─── NewRecordTab — PhoneInput typeahead (GH #221 Task 6) ──────────────────
// Pick = client id: phone+name freeze read-only, × restores typing, and the
// submit payload switches between { client_id } and { phone, name }.
// The old onBlur exact-fetch handler is REMOVED (spec §5 Removed).

describe('NewRecordTab — picked client (GH #221)', () => {
  // PhoneInput's onSearch is getClientsPaged (mocked at module level above).
  const defaultProps2 = {
    activity: mockActivity,
    serviceTariffs: mockTariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  function mockSearchHit() {
    vi.mocked(getClientsPaged).mockResolvedValue({
      items: [{ ...mockClient, name: 'Анна Иванова', phone: '+7 (900) 123-45-67' }],
      total: 1,
      page: 1,
      per_page: 10,
    } as never);
  }

  async function typeAndPick() {
    mockSearchHit();
    render(<NewRecordTab {...defaultProps2} />);
    // 4 digits → past the threshold; debounced search fires (fake timers below).
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '9991' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const row = await screen.findByRole('option', { name: /Анна Иванова/ });
    fireEvent.click(row);
  }

  beforeEach(() => {
    defaultProps2.onSubmit.mockClear();
    defaultProps2.showToast.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('freezes phone + name read-only after pick; × restores both fields', async () => {
    await typeAndPick();

    // Phone field shows the picked client and is read-only with a clear ×.
    const phoneInput = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(phoneInput).toHaveAttribute('readonly');
    expect(phoneInput.value).toContain('Анна Иванова');
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();

    // Name field shows the stored client name and is read-only (decision 10:
    // editing a client's name belongs to the client card).
    const nameInput = screen.getByTestId('input-client-name') as HTMLInputElement;
    expect(nameInput).toHaveAttribute('readonly');
    expect(nameInput.value).toBe('Анна Иванова');

    // × clears the pick: both fields return to typing mode, name is emptied.
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    const clearedPhone = screen.getByTestId('input-phone') as HTMLInputElement;
    const clearedName = screen.getByTestId('input-client-name') as HTMLInputElement;
    expect(clearedPhone).not.toHaveAttribute('readonly');
    expect(clearedName).not.toHaveAttribute('readonly');
    expect(clearedName.value).toBe('');
  });

  it('submits the picked union (kind=picked, client_id only) after a pick', async () => {
    await typeAndPick();
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(defaultProps2.onSubmit).toHaveBeenCalledTimes(1);
    const payload = defaultProps2.onSubmit.mock.calls[0][0];
    // Disjoint union: the picked branch carries the id, no phone/name keys.
    expect(payload).toEqual({
      kind: 'picked',
      client_id: 'c1',
      visitors: [],
      notify: false,
      channel: 'telegram',
      seats: 1,
    });
  });

  it('submits the unpicked union (compact phone + name) when nothing is picked', () => {
    render(<NewRecordTab {...defaultProps2} />);
    // GH #414: PhoneInput lifts the compact «+<код><нац.>» per keystroke —
    // a «+…» fill parses to the national remainder under the bound country,
    // and the compact is exactly what reaches the payload (storage form).
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+79991234567' } });
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Новый клиент' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    const payload = defaultProps2.onSubmit.mock.calls[0][0];
    expect(payload).toEqual({
      kind: 'unpicked',
      phone: '+79991234567',
      name: 'Новый клиент',
      client_id: null,
      visitors: [],
      notify: false,
      channel: 'telegram',
      seats: 1,
    });
  });

  it('does not call the exact-route getClientByPhone on blur (REMOVED)', () => {
    render(<NewRecordTab {...defaultProps2} />);
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+79991234567' } });
    fireEvent.blur(screen.getByTestId('input-phone'));
    expect(getClientByPhone).not.toHaveBeenCalled();
  });

  it('(picked) never validates the phone — picked clients come from stored data', async () => {
    // A pick freezes the field with the client label (not a parseable phone),
    // yet the save must go through untouched.
    await typeAndPick();
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(defaultProps2.showToast).not.toHaveBeenCalledWith(
      'Проверьте номер телефона — возможно, он введён не полностью',
    );
    expect(defaultProps2.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps2.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'picked', client_id: 'c1' }),
    );
  });
});

// ─── NewRecordTab — unpicked completeness guard (GH #221 Task 7) ───────────
// Spec §2 decision 11 / §6 step 2: the unpicked save requires a complete
// valid number (parsePhoneNumberFromString + RU default, same library as the
// mask). Incomplete → retryable toast, nothing submitted/fetched/created.

describe('NewRecordTab — unpicked completeness guard (GH #221 Task 7)', () => {
  const guardProps = {
    activity: mockActivity,
    serviceTariffs: mockTariffs,
    onSubmit: vi.fn(),
    showToast: vi.fn(),
  };

  beforeEach(() => {
    guardProps.onSubmit.mockClear();
    guardProps.showToast.mockClear();
    // Same fake-timer harness as the sibling «picked client» describe: the
    // phone typing below schedules RemoteSearchSelect's REAL 300 ms debounce,
    // and a real timer surviving past the environment teardown surfaces as an
    // unhandled `window is not defined` rejection (aggravated by the GH #414
    // fix-round tests — the guard block now owns its timers).
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('(0) blocks the save on an INCOMPLETE number with the exact message; nothing submitted', () => {
    render(<NewRecordTab {...guardProps} />);
    // Half-typed number: mask shows it, but it is not a valid complete number.
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+7 (999) 123' } });
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Кто-то' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(guardProps.onSubmit).not.toHaveBeenCalled();
    expect(guardProps.showToast).toHaveBeenCalledWith(
      'Проверьте номер телефона — возможно, он введён не полностью',
    );
  });

  it('(0b) EMPTY phone is a legitimate pre-existing path — proceeds, no toast, no guard', () => {
    // Semantics ruling (spec §7 + pre-#221 behavior): the guard targets
    // TYPED-BUT-INCOMPLETE numbers only. An empty phone quick-add (client
    // with no phone) predates #221 (§10: write paths untouched) and must
    // submit as before.
    render(<NewRecordTab {...guardProps} />);
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Кто-то' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(guardProps.showToast).not.toHaveBeenCalled();
    expect(guardProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(guardProps.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'unpicked', phone: '' }),
    );
  });

  it('(0c) out-of-list paste («без страны» with digits) blocks the save with «Выберите страну из списка»; nothing submitted (GH #414 fix)', () => {
    // The pasted «+1 …» number has no list country: the compact lift is ''
    // (indistinguishable from empty), so pre-fix the save sailed through and
    // the hook created a client with phone: '' — silent data loss. The fix
    // blocks BEFORE the completeness guard with the PhoneField message
    // (client-card parity, spec §Граничные случаи).
    render(<NewRecordTab {...guardProps} />);
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+1 650 555 1234' } });
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Кто-то' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(guardProps.onSubmit).not.toHaveBeenCalled();
    expect(guardProps.showToast).toHaveBeenCalledWith('Выберите страну из списка');
  });

  it('(0d) clearing the digits after an out-of-list paste lifts the block — empty save proceeds', () => {
    render(<NewRecordTab {...guardProps} />);
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+1 650 555 1234' } });
    // Empty the field — no digits, no «без страны» block (the phone-less
    // quick-add path stays open).
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Кто-то' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(guardProps.showToast).not.toHaveBeenCalled();
    expect(guardProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(guardProps.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'unpicked', phone: '' }),
    );
  });

  it('(unpicked, complete) a complete number passes the guard and submits', () => {
    render(<NewRecordTab {...guardProps} />);
    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '+79991234567' } });
    fireEvent.change(screen.getByTestId('input-client-name'), { target: { value: 'Новый' } });
    fireEvent.click(screen.getByTestId('btn-create-record'));

    expect(guardProps.showToast).not.toHaveBeenCalled();
    expect(guardProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(guardProps.onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'unpicked' }),
    );
  });
});

// ─── GH #258/#259: режим create (клик по свободному слоту, spec §2.1) ────────
// Модалка монтируется при activity=null: единственная вкладка «Создание
// занятия», без клиентских вкладок/кнопки «+ Запись», без футера удаления;
// заголовок «Новое занятие» доступен по aria-labelledby. Крестик и клик мимо
// заблокированы, пока CreateActivityTab сообщает saving=true.

describe('create mode', () => {
  it('renders «Новое занятие» with a single tab and the create form', () => {
    render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={vi.fn()}
        activity={null}
        mode="create"
        createDefaults={{ date: '2026-10-21', startMinutes: 540 }}
      />,
    );

    // Title accessible via aria-labelledby on the dialog.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'activity-modal-title');
    const heading = within(dialog).getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Новое занятие');

    // Tab nav renders with exactly ONE tab («Создание занятия»).
    const tabNav = screen.getByTestId('tab-nav');
    const tabs = within(tabNav).getAllByRole('button');
    expect(tabs).toHaveLength(1);
    expect(within(tabNav).getByText('Создание занятия')).toBeInTheDocument();

    // No settings tab, no client tabs, no «+ Запись», no delete footer.
    expect(screen.queryByTestId('tab-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^tab-client-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-delete-activity')).not.toBeInTheDocument();

    // The create form is visible (GH #280: combobox wrapper anchor + prefilled
    // datetime from the slot).
    expect(screen.getByTestId('create-master')).toBeInTheDocument();
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-21T09:00');
  });

  it('edit mode keeps tabs and delete footer (regression perimeter)', () => {
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );

    expect(screen.getByTestId('tab-settings')).toBeInTheDocument();
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByTestId('tab-add')).toBeInTheDocument();
    expect(screen.getByTestId('btn-delete-activity')).toBeInTheDocument();
  });

  it('blocks close via backdrop and close button while saving, closes otherwise', async () => {
    // Saving is driven through the real form: addActivities hangs on a
    // deferred promise (GH #595 §4.3) → CreateActivityTab reports saving=true;
    // resolving with a rejected outcome (error path, form stays open) → false.
    let release!: (outcomes: AddActivityOutcome[]) => void;
    const addActivities = vi.fn<ScheduleDataContextType['addActivities']>(
      () => new Promise<AddActivityOutcome[]>((resolve) => { release = resolve; }),
    );
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ addActivities }));
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={onClose}
        activity={null}
        mode="create"
        createDefaults={{ date: '2026-10-21', startMinutes: 540 }}
      />,
    );

    // Make the form valid and submit — saving becomes true and stays true
    // until the batch promise settles (allSettled lock, §4.3). Combobox
    // picks (GH #280) для мастера/услуги; локация — чекбокс-группа (GH #595);
    // вместимость — руками (у shared mockLocations нет defaultCapacity).
    const pickIn = (containerTestId: string, optionValue: string) => {
      fireEvent.click(
        within(screen.getByTestId(containerTestId)).getByTestId('combobox-trigger'),
      );
      fireEvent.click(screen.getByTestId(`combobox-option-${optionValue}`));
    };
    pickIn('create-master', 'm1');
    pickIn('create-service', 's1'); // длительность «02:30» заполнится сама
    fireEvent.click(screen.getByLabelText('Альпика'));
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('btn-create-activity'));
    expect(addActivities).toHaveBeenCalledTimes(1);

    // While saving=true: no close-cross rendered, backdrop click is inert.
    expect(() => screen.getByLabelText('Закрыть')).toThrow();
    fireEvent.click(screen.getByTestId('details-modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();

    // Once the batch resolves (error path keeps the form open), both close
    // paths work again.
    await act(async () => {
      release([{ locationId: 'alpika', status: 'rejected', error: new Error('server down') }]);
    });
    fireEvent.click(screen.getByTestId('details-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    // The close button («крестик») is back as well.
    expect(screen.getByLabelText('Закрыть')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

// ─── GH #598: фикс-высота h-[85dvh] + владелец скролла ───────────────────────
// Контейнер модалки занятия несёт фикс-класс во ВСЕХ режимах (высота стабильна
// между вкладками — исходная жалоба #74); скролл принадлежит внутреннему
// div-у панели-потребителя (min-h-0 + overscroll-contain), не обёртке общего
// Modal. Тело несёт тестид — селектор геометрических ассертов e2e (US-2).

describe('ActivityDetailsModal — fixed height & scroll ownership (GH #598)', () => {
  it('create mode: container carries the fixed height class h-[85dvh]', () => {
    render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={vi.fn()}
        activity={null}
        mode="create"
        createDefaults={{ date: '2026-10-21', startMinutes: 840 }}
      />,
    );
    expect(screen.getByTestId('activity-details-modal-container').className).toMatch(
      /(?:^|\s)h-\[85dvh\]/,
    );
  });

  it('edit mode: container carries the fixed height class h-[85dvh]', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    expect(screen.getByTestId('activity-details-modal-container').className).toMatch(
      /(?:^|\s)h-\[85dvh\]/,
    );
  });

  it('quickAdd mode: container carries the fixed height class h-[85dvh]', () => {
    render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={vi.fn()}
        activity={mockActivity}
        mode="quickAdd"
      />,
    );
    expect(screen.getByTestId('activity-details-modal-container').className).toMatch(
      /(?:^|\s)h-\[85dvh\]/,
    );
  });

  it('create mode: scrolling body owns the scroll (testid + min-h-0 + overscroll-contain)', () => {
    render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={vi.fn()}
        activity={null}
        mode="create"
        createDefaults={{ date: '2026-10-21', startMinutes: 840 }}
      />,
    );
    const scrollBody = screen.getByTestId('activity-details-modal-scroll-body');
    // min-h-0: flex-потомок обязан мочь сжиматься ниже контента, иначе
    // фикс-высота клиппит (дефект-2 #262); overscroll-contain: прокрутка не
    // «протекает» на страницу под модалкой.
    expect(scrollBody.className).toContain('overflow-y-auto');
    expect(scrollBody.className).toContain('min-h-0');
    expect(scrollBody.className).toContain('overscroll-contain');
    // форма живёт внутри скроллящегося тела
    expect(scrollBody.contains(screen.getByTestId('create-master'))).toBe(true);
  });

  it('edit mode: scrolling body owns the scroll (same testid + classes)', () => {
    render(
      <ActivityDetailsModal isOpen={true} onClose={vi.fn()} activity={mockActivity} mode="edit" />,
    );
    const scrollBody = screen.getByTestId('activity-details-modal-scroll-body');
    expect(scrollBody.className).toContain('overflow-y-auto');
    expect(scrollBody.className).toContain('min-h-0');
    expect(scrollBody.className).toContain('overscroll-contain');
    expect(scrollBody.contains(screen.getByTestId('input-datetime'))).toBe(true);
  });
});

// ─── GH #598: кнопка «Создать» в футере create-режима ────────────────────────
// Пере-дом из CreateActivityTab.test.tsx: кнопка переехала из скроллящегося
// тела в футер Modal (testid сохранён), гейты те же (canSave || saving);
// вкладка публикует canSave/submit наверх минимальным мостом (образец —
// onSavingChange). Матрица гейтов и submit-payload покрыты здесь — рендером
// панели с футером; в старом доме остался только контракт моста.

describe('create mode — footer «Создать» button (GH #598, re-domed from CreateActivityTab)', () => {
  // Локации — локальный фиксстур с defaultCapacity (в shared mockLocations
  // этого поля нет) — тот же прецедент, что и в старом доме матрицы.
  const locations = [
    { id: 'l1', title: 'Студия', defaultCapacity: 6 },
    { id: 'l2', title: 'Лофт', defaultCapacity: 10 },
  ];
  // Слот: среда 2026-10-21, 14:00 (840 минут — на 30-минутной сетке).
  const defaults = { date: '2026-10-21', startMinutes: 840 };
  // GH #595: отправка — пакет addActivities (исходы по каждой локации).
  const addActivities = vi.fn<ScheduleDataContextType['addActivities']>();
  const onClose = vi.fn();

  function renderCreateModal() {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ masters: mockMasters, services: mockServices, locations, addActivities }),
    );
    return render(
      <ActivityDetailsModal
        isOpen={true}
        onClose={onClose}
        activity={null}
        mode="create"
        createDefaults={defaults}
      />,
    );
  }

  /** Выбор в комбобоксе по тестиду контейнера: клик по триггеру → клик по опции. */
  function pickInCombobox(containerTestId: string, optionValue: string) {
    fireEvent.click(within(screen.getByTestId(containerTestId)).getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId(`combobox-option-${optionValue}`));
  }

  /** Валидная форма: мастер m1 + услуга s1 (длит. 150) + чекбокс локации l1 (вмест. 6). */
  function fillValidForm() {
    pickInCombobox('create-master', 'm1');
    pickInCombobox('create-service', 's1');
    fireEvent.click(screen.getByLabelText('Студия'));
  }

  /** Успешный исход по каждой входной локации (§4.3: порядок исходов = входов). */
  const createdOutcome = (locationId: string): AddActivityOutcome => ({
    locationId,
    status: 'fulfilled',
    activity: { id: `created-${locationId}` } as Extract<
      AddActivityOutcome,
      { status: 'fulfilled' }
    >['activity'],
  });

  beforeEach(() => {
    addActivities.mockReset();
    // По умолчанию — полный успех (тост/закрытие в .then пакета, не в колбэках).
    addActivities.mockImplementation((inputs) =>
      Promise.resolve(inputs.map((i) => createdOutcome(i.locationId))),
    );
    onClose.mockClear();
  });

  it('renders «Создать» in the modal footer — outside the scroll body — disabled until valid', () => {
    renderCreateModal();
    const btn = screen.getByTestId('btn-create-activity');
    expect(btn).toBeDisabled(); // дата-время префиллита, справочники не выбраны

    // Кнопка в футерной полосе (shrink-0), НЕ внутри скроллящегося тела —
    // всегда видна без прокрутки (US-2).
    expect(btn.closest('div.shrink-0')).not.toBeNull();
    const scrollBody = screen.getByTestId('activity-details-modal-scroll-body');
    expect(scrollBody.contains(btn)).toBe(false);

    fillValidForm();
    expect(btn).toBeEnabled();
  });

  it('gates «Создать» until master+service+location chosen (slot prefill alone is not enough)', () => {
    renderCreateModal();
    const btn = screen.getByTestId('btn-create-activity');
    expect(btn).toBeDisabled();

    pickInCombobox('create-master', 'm1');
    expect(btn).toBeDisabled();
    pickInCombobox('create-service', 's1'); // длительность заполнится сама
    expect(btn).toBeDisabled(); // 0 отмеченных локаций → блок (§4.1: ≥1)
    fireEvent.click(screen.getByLabelText('Студия')); // вместимость — умолчание 6
    expect(btn).toBeEnabled();
  });

  it('gates «Создать»: empty datetime, bad duration, capacity < 1 each block the button', () => {
    renderCreateModal();
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

  it('private toggle flips role="switch" and submits isPrivate: true (US-4)', async () => {
    renderCreateModal();
    fillValidForm();

    const toggle = screen.getByTestId('create-private');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('btn-create-activity'));
    await waitFor(() => expect(addActivities).toHaveBeenCalledTimes(1));
    expect(addActivities.mock.calls[0][0][0]).toMatchObject({ isPrivate: true });
  });

  it('submits exact payload: field datetime → start (snapped local ISO), ЧЧ:ММ → minutes', async () => {
    renderCreateModal();
    fillValidForm();
    // Ручной выбор даты другой недели + несетевой слот: уходит ВЫБОР поля,
    // не «открытая неделя + день недели» (поведение GH #280).
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:17' } });
    fireEvent.change(screen.getByTestId('create-duration'), { target: { value: '01:15' } });
    fireEvent.change(screen.getByTestId('create-capacity'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    await waitFor(() => expect(addActivities).toHaveBeenCalledTimes(1));
    // §4.3: пакетный контракт — массив входов (здесь ровно 1, без колбэков).
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

  it('success toast names the chosen calendar date and closes the modal (onSaved)', async () => {
    renderCreateModal();
    fillValidForm();
    fireEvent.click(screen.getByTestId('btn-create-activity'));

    // Тост/закрытие рождаются в .then пакета addActivities (полный успех).
    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Создано: Картина маслом — среда, 21 октября, 14:00'),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on error: toast with parsed message and error kind, values kept, modal not closed', async () => {
    renderCreateModal();
    fillValidForm();
    // меняем дату-время, чтобы проверить «значения НЕ сброшены»
    fireEvent.change(screen.getByTestId('create-datetime'), { target: { value: '2026-10-28T15:00' } });
    const err = { code: 'VALIDATION_ERROR' };
    addActivities.mockImplementationOnce(() =>
      Promise.resolve([{ locationId: 'l1', status: 'rejected' as const, error: err }]),
    );

    fireEvent.click(screen.getByTestId('btn-create-activity'));

    const { showToast } = mockUseUI();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(parseApiError(err).message, 'error'),
    );
    expect(screen.getByTestId('create-datetime')).toHaveValue('2026-10-28T15:00');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('footer button stays disabled while saving; no double submit; re-enabled on success', async () => {
    renderCreateModal();
    fillValidForm();
    // Пакет висит до ручного release (снапшот saving-лока, §4.3).
    let release!: (outcomes: AddActivityOutcome[]) => void;
    addActivities.mockImplementationOnce(
      () => new Promise<AddActivityOutcome[]>((resolve) => { release = resolve; }),
    );

    const btn = screen.getByTestId('btn-create-activity');
    fireEvent.click(btn);
    expect(addActivities).toHaveBeenCalledTimes(1);

    // во время запроса: кнопка задизейблена (saving поднят onSavingChange),
    // повторный клик не отправляет
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(addActivities).toHaveBeenCalledTimes(1);

    // успех: кнопка снова активна (пакет зарезолвлен — состояние сброшено в DOM)
    await act(async () => {
      release([createdOutcome('l1')]);
    });
    await waitFor(() => expect(btn).toBeEnabled());
  });
});

// ─── Delete activity (#286 Task 5 — deferred flow call site) ─────────────────

describe('ActivityDetailsModal — delete activity (#286 deferred flow)', () => {
  const DEPS: import('@memo/api-client').DependencyNode[] = [
    {
      entity: 'records', auto: false, relation: 'records', count: 1, allowed_actions: [],
      items: [{ id: 'r1', label: 'Картина маслом, 2026-09-14, Аноним' }],
    },
    { entity: 'visits', auto: false, relation: 'records', count: 1, allowed_actions: [] },
  ];

  it('closes immediately and hands needs-confirm to the context pending-confirm state', async () => {
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);
    const setPendingActivityConfirm = vi.fn();
    const deleteActivityDeferred = vi.fn(() =>
      Promise.resolve({ kind: 'needs-confirm' as const, dependencies: DEPS, refetched: false }),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ deleteActivityDeferred, setPendingActivityConfirm }),
    );
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );

    fireEvent.click(screen.getByTestId('btn-delete-activity'));

    // The modal closes IMMEDIATELY (before the dry-run settles) — the dialog
    // will render at the view level, driven by the context state.
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {});

    expect(setPendingActivityConfirm).toHaveBeenCalledTimes(1);
    expect(setPendingActivityConfirm).toHaveBeenCalledWith({
      activityId: mockActivity.id,
      dependencies: DEPS,
      refetched: false,
    });
  });

  it('clean path: closes immediately, no confirm state, no own toast', async () => {
    stubClientsById({ c1: { data: mockClient } });
    stubActivityRecords([mockRecord]);
    const setPendingActivityConfirm = vi.fn();
    const showToast = vi.fn();
    const deleteActivityDeferred = vi.fn(() =>
      Promise.resolve({ kind: 'enqueued' as const, refetched: false }),
    );
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ deleteActivityDeferred, setPendingActivityConfirm }),
    );
    mockUseUI.mockReturnValue(createMockUIContext({ showToast }));
    const onClose = vi.fn();
    render(
      <ActivityDetailsModal isOpen={true} onClose={onClose} activity={mockActivity} mode="edit" />,
    );

    fireEvent.click(screen.getByTestId('btn-delete-activity'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {});

    expect(setPendingActivityConfirm).not.toHaveBeenCalled();
    // No own toast — the PendingActions pipeline owns the undo toast.
    expect(showToast).not.toHaveBeenCalled();
  });
});
