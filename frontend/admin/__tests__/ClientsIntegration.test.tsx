import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWithStats, RecordResponse } from '@memo/api-client';
import { createMockClientsContext } from './helpers/mockContexts';

// ─── Mock api-client ──────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getClientsWithStats: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  patchClient: vi.fn(),
  deleteClient: vi.fn(),
  getRecord: vi.fn(),
  getRecords: vi.fn().mockResolvedValue([]),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  getClientVisitors: vi.fn(),
}));

import {
  getClientsWithStats,
  updateClient as apiUpdateClient,
  deleteClient as apiDeleteClient,
  getRecord,
  updateRecord,
  deleteRecord,
  createPayment,
  getClientVisitors,
} from '@memo/api-client';

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
  comment: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [
    {
      id: 'v1',
      record_id: 'rec1',
      visitor_id: 'vis1',
      price: 3500,
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

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
    } as any);

    // Mock useQuery to return different data based on query key
    vi.mocked(useQuery).mockImplementation((...args: any[]) => {
      const queryKey = args[0]?.queryKey ?? args[0];
      if (Array.isArray(queryKey) && queryKey[0] === 'records' && queryKey[1] === 'client') {
        // Records list query for ClientCardModal — return records array
        return { data: mockClientWithRecords.records, isLoading: false, error: null } as any;
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
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={client} isOpen={true} onClose={vi.fn()} mode={mode} />
      </QueryClientProvider>,
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

  it('delete button calls context deleteClient', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClient} isOpen={true} onClose={onClose} mode="view" />
      </QueryClientProvider>,
    );

    const deleteBtn = screen.getByRole('button', { name: /Удалить клиента/i });
    fireEvent.click(deleteBtn);

    expect(mockDeleteClient).toHaveBeenCalledWith('c1');
    expect(onClose).toHaveBeenCalled();
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

  it('switching to record tab renders record data', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider>,
    );

    // Click on a record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    // Record tab should be visible with data from mocked useQuery
    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Verify the record data is displayed (status select with current value)
    const statusSelect = screen.getByLabelText('Статус');
    expect(statusSelect).toHaveValue('confirmed');
  });

  it('record tab payment form calls createPayment', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Fill payment amount
    fireEvent.change(screen.getByPlaceholderText('Сумма'), { target: { value: '2500' } });

    // Click add payment
    fireEvent.click(screen.getByTestId('btn-add-payment'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'rec1',
        amount: 2500,
        method: 'card',
      });
    });
  });

  it('record tab status change calls updateRecord', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Change status
    const statusSelect = screen.getByLabelText('Статус');
    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(updateRecord).toHaveBeenCalledWith('rec1', { status: 'cancelled' });
    });
  });

  it('record tab delete calls deleteRecord and onClose', async () => {
    const onClose = vi.fn();
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={onClose} mode="view" />
      </QueryClientProvider>,
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
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('switching back to client tab from record tab shows client info', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider>,
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
