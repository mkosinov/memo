import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWithStats } from '@memo/api-client';
import { useClients } from '@/contexts/ClientsContext';
import { createMockClientsContext } from './helpers/mockContexts';

// ─── Mock contexts ───────────────────────────────────────────────────────

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(),
  ScheduleProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
  ClientsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const mockUseClients = vi.mocked(useClients);

// ─── Mock components ─────────────────────────────────────────────────────

vi.mock('../app/(main)/clients/components/ClientsFilters', () => ({
  ClientsFilters: () => <div data-testid="clients-filters">ClientsFilters</div>,
}));

vi.mock('../app/(main)/clients/components/ClientsTable', () => ({
  ClientsTable: ({ onClientClick }: any) => (
    <div data-testid="clients-table">
      <button onClick={() => onClientClick({ id: 'c1', name: 'Test Client' })}>
        Click client
      </button>
    </div>
  ),
}));

vi.mock('../app/(main)/clients/components/ClientCardModal', () => ({
  ClientCardModal: ({ isOpen, onClose, mode }: any) =>
    isOpen ? (
      <div data-testid="client-card-modal">
        <span data-testid="modal-mode">{mode}</span>
        <button data-testid="modal-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

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

// ─── Helpers ──────────────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClientsPage', () => {
  beforeEach(() => {
    mockUseClients.mockReturnValue(createMockClientsContext({ total: 25, page: 1, perPage: 20 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders page header with "Клиенты" title', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Клиенты')).toBeInTheDocument();
  });

  it('renders "+ Новый клиент" button', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText('+ Новый клиент')).toBeInTheDocument();
  });

  it('renders ClientsFilters', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('clients-filters')).toBeInTheDocument();
  });

  it('renders ClientsTable', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('clients-table')).toBeInTheDocument();
  });

  it('renders pagination with total count', async () => {
    mockUseClients.mockReturnValue(createMockClientsContext({ total: 45, page: 1, perPage: 20 }));
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText('45 клиентов')).toBeInTheDocument();
  });

  it('renders current page number', async () => {
    mockUseClients.mockReturnValue(createMockClientsContext({ total: 45, page: 2, perPage: 20 }));
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Стр. 2')).toBeInTheDocument();
  });

  it('renders per-page selector dropdown', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('20');
  });

  it('per-page selector has options 10, 20, 50, 100', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map(o => o.value)).toEqual(['10', '20', '50', '100']);
  });

  it('disables previous button on first page', async () => {
    mockUseClients.mockReturnValue(createMockClientsContext({ total: 45, page: 1, perPage: 20 }));
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    const prevButton = screen.getByText('←').closest('button');
    expect(prevButton).toBeDisabled();
  });

  it('enables next button when there are more pages', async () => {
    mockUseClients.mockReturnValue(createMockClientsContext({ total: 45, page: 1, perPage: 20 }));
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    const nextButton = screen.getByText('→').closest('button');
    expect(nextButton).not.toBeDisabled();
  });

  it('opens modal in create mode when "+ Новый клиент" is clicked', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('+ Новый клиент'));
    expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-mode').textContent).toBe('create');
  });

  it('opens modal in view mode when a client is clicked', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Click client'));
    expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-mode').textContent).toBe('view');
  });

  it('closes modal when close is triggered', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('+ Новый клиент'));
    expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  // ─── Pagination edge cases ─────────────────────────────────────────────

  describe('pagination edge cases', () => {
    it('disables next button on last page', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 25, page: 2, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      const nextButton = screen.getByText('→').closest('button');
      expect(nextButton).toBeDisabled();
    });

    it('enables both prev and next buttons on middle page', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 60, page: 2, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      const prevButton = screen.getByText('←').closest('button');
      const nextButton = screen.getByText('→').closest('button');
      expect(prevButton).not.toBeDisabled();
      expect(nextButton).not.toBeDisabled();
    });

    it('shows correct client count for single client', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 1, page: 1, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      expect(screen.getByText('1 клиентов')).toBeInTheDocument();
    });

    it('shows zero clients count', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 0, page: 1, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      expect(screen.getByText('0 клиентов')).toBeInTheDocument();
    });
  });
});
