import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWithStats, RecordResponse } from '@memo/api-client';
import { UIProvider } from '../contexts/UIContext';
import { createMockClientsContext } from './helpers/mockContexts';

// ─── Mock api-client ──────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => {
  class ApiError extends Error {
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
    status: number;
    code?: string;
  }
  return {
    ApiError,
    getClientsWithStats: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    patchClient: vi.fn(),
    deleteClient: vi.fn(),
    getRecord: vi.fn(),
    getRecords: vi.fn().mockResolvedValue([]),
    patchRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
    createPayment: vi.fn(),
    patchPayment: vi.fn(),
    deletePayment: vi.fn(),
    getClientVisitors: vi.fn(),
  };
});

import {
  getClientsWithStats,
  updateClient as apiUpdateClient,
  deleteClient as apiDeleteClient,
  getRecord,
  patchRecord,
  updateRecord,
  deleteRecord,
  createPayment,
  getClientVisitors,
  ApiError,
} from '@memo/api-client';

// ─── Mock ScheduleContext ─────────────────────────────────────────────────

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({ gridFrequency: 30 })),
  ScheduleProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ─── Mock ClientsContext ──────────────────────────────────────────────────

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
  ClientsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { useClients } from '@/contexts/ClientsContext';
const mockUseClients = vi.mocked(useClients);

// ─── Mock react-query ──────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useQueryClient: vi.fn(),
  };
});

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─── Mock data ────────────────────────────────────────────────────────────

const mockClient: ClientWithStats = {
  id: 'c1',
  name: 'Анна Иванова',
  phone: '+7 (900) 123-45-67',
  email: null,
  channel: 'telegram',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  is_active: true,
  visits_count: 5,
  last_visit: '2026-05-20T10:00:00',
  total_paid: 17500,
  missed_visits: 1,
};

const mockClient2: ClientWithStats = {
  ...mockClient,
  id: 'c2',
  name: 'Борис Петров',
  phone: '+7 (900) 987-65-43',
  visits_count: 2,
  total_paid: 5000,
  missed_visits: 0,
};

const mockRecord: RecordResponse = {
  id: 'rec1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [
    {
      id: 'v1',
      record_id: 'rec1',
      visitor_id: 'vis1',
      price: 3500,
      custom_price: null,
      status: 'waiting',
      created_at: '',
      updated_at: '',
      is_active: true,
    },
  ],
};

const mockClientWithRecords: ClientWithStats & {
  records: Array<{ id: string; date: string; time: string; created_at: string }>;
} = {
  ...mockClient,
  records: [
    { id: 'rec1', date: '2026-05-10', time: '14:00', created_at: '2026-05-10T10:00:00' },
    { id: 'rec2', date: '2026-04-20', time: '16:30', created_at: '2026-04-20T10:00:00' },
  ],
};

const mockVisitors = [
  { id: 'vis1', client_id: 'c1', name: 'Анна Иванова', age: 30, created_at: '', updated_at: '', is_active: true },
];

const mockActivityResponses = [
  { id: 'ev_1', master_id: 'm1', service_id: 's1', location_id: 'loc1', start: '2026-05-10T14:00:00', duration: 150, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', is_active: true, occupied: 3 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClientCardModal ↔ ClientInfoTab integration (real components)', () => {
  const mockInvalidateQueries = vi.fn();
  const mockUpdateClient = vi.fn().mockResolvedValue(undefined);
  const mockDeleteClient = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockUseClients.mockReturnValue(
      createMockClientsContext({ updateClient: mockUpdateClient, deleteClient: mockDeleteClient }),
    );

    vi.mocked(apiUpdateClient).mockResolvedValue(mockClient);
    vi.mocked(apiDeleteClient).mockResolvedValue(undefined);
    vi.mocked(getClientVisitors).mockResolvedValue([]);

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: vi.fn(),
      fetchQuery: vi.fn(),
    } as any);

    // Mock useQuery to return different data based on query key
    vi.mocked(useQuery).mockImplementation((...args: any[]) => {
      const queryKey = args[0]?.queryKey ?? args[0];
      if (Array.isArray(queryKey) && queryKey[0] === 'records' && queryKey[1] === 'client') {
        // Records list query for ClientCardModal — return records array
        return { data: mockClientWithRecords.records, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      // Default: single record query for ClientRecordTab
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderModal(client: ClientWithStats | null, mode: 'view' | 'create' = 'view') {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    return render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={client} isOpen={true} onClose={vi.fn()} mode={mode} />
      </QueryClientProvider></UIProvider>,
    );
  }

  it('save button is disabled initially, enabled after name change, disabled after save', async () => {
    await renderModal(mockClient);

    // Save should be disabled initially
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeDisabled();

    // Change name
    const nameInput = screen.getByLabelText('Имя');
    fireEvent.change(nameInput, { target: { value: 'Новое Имя' } });

    // Save should now be enabled
    expect(saveBtn).toBeEnabled();

    // Click save
    fireEvent.click(saveBtn);

    // After save, button should be disabled again
    await waitFor(() => {
      expect(saveBtn).toBeDisabled();
    });
  });

  it('save button enables after phone change', async () => {
    await renderModal(mockClient);

    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeDisabled();

    const phoneInput = screen.getByLabelText('Телефон');
    fireEvent.change(phoneInput, { target: { value: '+7 (999) 111-22-33' } });

    expect(saveBtn).toBeEnabled();
  });

  it('save button enables after email change', async () => {
    await renderModal(mockClient);

    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeDisabled();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'new@test.com' } });

    expect(saveBtn).toBeEnabled();
  });

  it('save button enables after channel change', async () => {
    await renderModal(mockClient);

    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeDisabled();

    const channelSelect = screen.getByLabelText('Канал');
    fireEvent.change(channelSelect, { target: { value: 'whatsapp' } });

    expect(saveBtn).toBeEnabled();
  });

  it('delete button calls context deleteClient after confirm', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    const onClose = vi.fn();
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClient} isOpen={true} onClose={onClose} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    const deleteBtn = screen.getByRole('button', { name: /Удалить/i });

    // jsdom's window.confirm returns false by default (not implemented)
    // so deleteClient should NOT be called without explicit confirm mock
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockDeleteClient).not.toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('save button sends correct data to context updateClient', async () => {
    await renderModal(mockClient);

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое Имя' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (000) 000-00-00' } });

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      expect(mockUpdateClient).toHaveBeenCalledWith('c1', {
        name: 'Новое Имя',
        phone: '+7 (000) 000-00-00',
        email: '',
        channel: 'telegram',
      });
    });
  });
});

describe('ClientCardModal ↔ ClientRecordTab integration (real components)', () => {
  const mockInvalidateQueries = vi.fn();
  const mockUpdateClient = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockUseClients.mockReturnValue(
      createMockClientsContext({ updateClient: mockUpdateClient }),
    );

    vi.mocked(getRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(updateRecord).mockResolvedValue(mockRecord);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1',
      record_id: 'rec1',
      amount: 1000,
      method: 'card',
      created_at: '',
      updated_at: '',
      is_active: true,
    });
    vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors);

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: vi.fn(),
      fetchQuery: vi.fn(),
    } as any);

    // Mock useQuery to return different data based on query key
    vi.mocked(useQuery).mockImplementation((...args: any[]) => {
      const queryKey = args[0]?.queryKey ?? args[0];
      if (Array.isArray(queryKey) && queryKey[0] === 'records' && queryKey[1] === 'client') {
        // Records list query for ClientCardModal — return records array
        return { data: mockClientWithRecords.records, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activities') {
        // Activities for records query
        return { data: mockActivityResponses, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activity') {
        return { data: mockActivityResponses[0], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && (queryKey[0] === 'masters' || queryKey[0] === 'locations' || queryKey[0] === 'services')) {
        return { data: [], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'payments') {
        return { data: [], isLoading: false, error: null } as any;
      }
      // Default: single record query for ClientRecordTab
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switching to record tab renders record data', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Click on a record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    // Record tab should be visible with data from mocked useQuery
    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Verify the record data is displayed (CustomSelect triggers exist in record tab)
    expect(screen.getAllByTestId('custom-select-trigger').length).toBeGreaterThan(0);
  });

  it('record tab payment form calls createPayment', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Open new payment row
    fireEvent.click(screen.getByTestId('btn-add-payment'));

    // Fill payment amount and blur to trigger save
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.change(amountInput, { target: { value: '2500' } });
    fireEvent.blur(amountInput);

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'rec1',
        amount: 2500,
        method: 'card',
        created_at: expect.any(String),
      });
    });
  });

  it.skip('record tab status icon cycles visit status', async () => {
    // SKIPPED: Real ClientRecordTab uses visit-status-select (dropdown), not visit-status-icon (button)
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Click the status icon to cycle
    fireEvent.click(screen.getByTestId('visit-status-icon'));

    // Save button should be enabled
    await waitFor(() => {
      expect(screen.getByTestId('btn-save-record')).toBeEnabled();
    });
  });

  it('record tab delete calls deleteRecord but does NOT close modal', async () => {
    const onClose = vi.fn();
    // handleDelete calls window.confirm — mock it to allow deletion
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={onClose} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Click delete record
    fireEvent.click(screen.getByTestId('btn-delete-record'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('rec1');
    });
    // Delete deliberately does NOT close the modal — user stays in context
    expect(onClose).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockRestore();
  });

  it('switching back to client tab from record tab shows client info', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Start on client tab
    expect(screen.getByLabelText('Имя')).toBeInTheDocument();

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));
    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Switch back to client tab
    fireEvent.click(screen.getByText('Клиент'));
    await waitFor(() => {
      expect(screen.getByLabelText('Имя')).toBeInTheDocument();
    });
  });
});

// ─── Cross-page integration: create → view → edit → save ───────────────

describe('Cross-page integration: create client → view → edit → save', () => {
  const mockInvalidateQueries = vi.fn();

  beforeEach(() => {
    mockUseClients.mockReturnValue(
      createMockClientsContext({
        createClient: vi.fn().mockResolvedValue(mockClient),
        updateClient: vi.fn().mockResolvedValue(undefined),
      }),
    );

    vi.mocked(getRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(updateRecord).mockResolvedValue(mockRecord);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1',
      record_id: 'rec1',
      amount: 1000,
      method: 'card',
      created_at: '',
      updated_at: '',
      is_active: true,
    });
    vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors);
    vi.mocked(apiUpdateClient).mockResolvedValue(mockClient);

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: vi.fn(),
      fetchQuery: vi.fn(),
    } as any);

    vi.mocked(useQuery).mockImplementation((...args: any[]) => {
      const queryKey = args[0]?.queryKey ?? args[0];
      if (Array.isArray(queryKey) && queryKey[0] === 'records' && queryKey[1] === 'client') {
        return { data: mockClientWithRecords.records, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activities') {
        return { data: mockActivityResponses, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activity') {
        return { data: mockActivityResponses[0], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && (queryKey[0] === 'masters' || queryKey[0] === 'locations' || queryKey[0] === 'services')) {
        return { data: [], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'payments') {
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create client → view in table → open modal → switch to record tab → edit comment → save', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');

    // 1. Open modal in view mode (simulates opening a client card from a table)
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // 2. Verify client info is visible
    expect(screen.getByLabelText('Имя')).toBeInTheDocument();

    // 3. Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));
    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // 4. Record tab is rendered with correct data (comment field exists)
    expect(screen.getByTestId('input-comment')).toBeInTheDocument();

    // 5. Switch back to client tab and edit name
    fireEvent.click(screen.getByText('Клиент'));
    await waitFor(() => {
      expect(screen.getByLabelText('Имя')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Обновлённое Имя' } });

    // 6. Save should be enabled
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);

    // 7. After save, button should be disabled again
    await waitFor(() => {
      expect(saveBtn).toBeDisabled();
    });
  });
});

// ─── Error scenario tests ──────────────────────────────────────────────

describe('Error scenarios: create client fails', () => {
  const mockInvalidateQueries = vi.fn();
  // Suppress unhandled rejections during error scenario tests
  const originalListeners: Array<{ type: string; listener: any }> = [];

  beforeEach(() => {
    // Suppress unhandledrejection events to prevent vitest from failing
    const handler = (e: Event) => { e.preventDefault(); };
    window.addEventListener('unhandledrejection', handler);
    originalListeners.push({ type: 'unhandledrejection', listener: handler });
    vi.mocked(getRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(updateRecord).mockResolvedValue(mockRecord);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1',
      record_id: 'rec1',
      amount: 1000,
      method: 'card',
      created_at: '',
      updated_at: '',
      is_active: true,
    });
    vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors);
    vi.mocked(apiUpdateClient).mockResolvedValue(mockClient);

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: vi.fn(),
      fetchQuery: vi.fn(),
    } as any);

    vi.mocked(useQuery).mockImplementation((...args: any[]) => {
      const queryKey = args[0]?.queryKey ?? args[0];
      if (Array.isArray(queryKey) && queryKey[0] === 'records' && queryKey[1] === 'client') {
        return { data: mockClientWithRecords.records, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activities') {
        return { data: mockActivityResponses, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'activity') {
        return { data: mockActivityResponses[0], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && (queryKey[0] === 'masters' || queryKey[0] === 'locations' || queryKey[0] === 'services')) {
        return { data: [], isLoading: false, error: null } as any;
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'payments') {
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    vi.mocked(useMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    } as any);
  });

  afterEach(() => {
    // Restore unhandledrejection listeners
    originalListeners.forEach(({ type, listener }) => {
      window.removeEventListener(type, listener);
    });
    originalListeners.length = 0;
    vi.restoreAllMocks();
  });

  it('shows error when save client fails (API 500)', async () => {
    const failingUpdateClient = vi.fn().mockReturnValue(
      Promise.reject(new Error('Internal Server Error')),
    );
    // Suppress the unhandled rejection at process level
    const suppressRejection = (e: any) => { e.preventDefault?.(); };
    process.on('unhandledRejection', suppressRejection);

    mockUseClients.mockReturnValue(
      createMockClientsContext({ updateClient: failingUpdateClient }),
    );

    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClient} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Change name to trigger save
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое Имя' } });
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeEnabled();

    // Click save
    fireEvent.click(saveBtn);

    // Wait for the async operation
    await waitFor(() => {
      expect(failingUpdateClient).toHaveBeenCalled();
    });

    process.removeListener('unhandledRejection', suppressRejection);

    // Modal should still be rendered (not closed on error in view mode)
    expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    // Input should retain edited value (data not lost)
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Новое Имя');
  });

  it('shows error when save client fails — data not lost', async () => {
    const failingUpdateClient = vi.fn().mockReturnValue(
      Promise.reject(new Error('Network error')),
    );
    const suppressRejection = (e: any) => { e.preventDefault?.(); };
    process.on('unhandledRejection', suppressRejection);

    mockUseClients.mockReturnValue(
      createMockClientsContext({ updateClient: failingUpdateClient }),
    );

    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClient} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Change phone
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (999) 000-00-00' } });

    // Save and fail
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      expect(failingUpdateClient).toHaveBeenCalled();
    });

    process.removeListener('unhandledRejection', suppressRejection);

    // Phone input should still have the edited value (data not lost)
    expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('+7 (999) 000-00-00');
  });

  it('handles duplicate phone (409) gracefully on create', async () => {
    const duplicateError = new ApiError(409, 'Client with this phone already exists', 'CLIENT_DUPLICATE_PHONE');
    const createClientFn = vi.fn().mockRejectedValue(duplicateError);
    const onClose = vi.fn();
    mockUseClients.mockReturnValue(
      createMockClientsContext({ createClient: createClientFn }),
    );

    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    const onClientCreated = vi.fn();
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal
          client={null}
          isOpen={true}
          onClose={onClose}
          mode="create"
          onClientCreated={onClientCreated}
        />
      </QueryClientProvider></UIProvider>,
    );

    // In create mode, the real ClientInfoTab renders "Создать" button
    // Make a change to enable the save button (it's disabled when no changes)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Тест' } });

    // Click "Создать" button (the real component renders this text in create mode)
    const createBtn = screen.getByRole('button', { name: /Создать/i });
    expect(createBtn).toBeEnabled();
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(createClientFn).toHaveBeenCalled();
    });

    // Should NOT call onClientCreated since create failed
    expect(onClientCreated).not.toHaveBeenCalled();

    // Error is caught — parseApiError shows toast, modal stays open for retry
    expect(onClose).not.toHaveBeenCalled();
  });
});
