import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const mockRouter = { push: vi.fn(), replace: vi.fn() };
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
}));

const mockUseClients = vi.mocked(useClients);

// ─── Mock components ─────────────────────────────────────────────────────

vi.mock('../app/(main)/clients/components/ClientsFilters', () => ({
  ClientsFilters: () => <div data-testid="clients-filters">ClientsFilters</div>,
}));

vi.mock('../app/(main)/clients/components/ClientsTable', () => ({
  // #139 T6 — ClientsTable renders the unified <DataTable> which owns the pager.
  // Mock reads `useClients` from the module scope (mocked above) and exposes
  // the pager controls so page-level tests can assert on them.
  ClientsTable: ({ onClientClick }: any) => {
    // useClients is already imported at the top of this file from the mocked module.
    const ctx = useClients();
    return (
      <div data-testid="clients-table">
        <button onClick={() => onClientClick({ id: 'c1', name: 'Test Client' })}>
          Click client
        </button>
        <div className="pager-stub">
          <span>{ctx.total} всего</span>
          <select data-testid="page-size-select" value={ctx.perPage} onChange={(e) => ctx.setPerPage(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button aria-label="Предыдущая страница" disabled={ctx.page <= 1} onClick={() => ctx.setPage(ctx.page - 1)}>←</button>
          <button aria-label="Следующая страница" disabled={ctx.page >= Math.max(1, Math.ceil(ctx.total / ctx.perPage))} onClick={() => ctx.setPage(ctx.page + 1)}>→</button>
        </div>
      </div>
    );
  },
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
  archived: false,
  records_count: 5,
  last_record: '2026-05-20T10:00:00',
  total_paid: 17500,
  missed_records: 1,
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
    mockSearchParams = new URLSearchParams();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
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
    // #139 T6 — legacy "N клиентов" pager removed; DataTable renders "N всего".
    expect(screen.getByText('45 всего')).toBeInTheDocument();
  });

  it('renders per-page selector dropdown', async () => {
    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );
    const select = screen.getByTestId('page-size-select');
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
    const select = screen.getByTestId('page-size-select');
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
    const prevButton = screen.getByLabelText('Предыдущая страница');
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
    const nextButton = screen.getByLabelText('Следующая страница');
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

  // ─── Pagination edge cases (#139 T6 — DataTable owns pagination) ─────

  describe('pagination edge cases', () => {
    it('disables next button on last page', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 25, page: 2, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      const nextButton = screen.getByLabelText('Следующая страница');
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
      const prevButton = screen.getByLabelText('Предыдущая страница');
      const nextButton = screen.getByLabelText('Следующая страница');
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
      // #139 T6 — unified dict copy ("N всего") replaces legacy "N клиентов".
      expect(screen.getByText('1 всего')).toBeInTheDocument();
    });

    it('shows zero clients count', async () => {
      mockUseClients.mockReturnValue(createMockClientsContext({ total: 0, page: 1, perPage: 20 }));
      const ClientsPage = (await import('../app/(main)/clients/page')).default;
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ClientsPage />
        </QueryClientProvider>,
      );
      expect(screen.getByText('0 всего')).toBeInTheDocument();
    });
  });
});

describe('ClientsPage — ?clientId= deep-link (GH #216)', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deep-link param narrows the table: setFilters({search: id, status: all})', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'uuid-target-1']]);
    const ctx = createMockClientsContext({ items: [], clients: [] });
    mockUseClients.mockReturnValue(ctx);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(ctx.setFilters).toHaveBeenCalledWith({ search: 'uuid-target-1', status: 'all' }),
    );
  });

  it('no param: deep-link setFilters not called', async () => {
    const ctx = createMockClientsContext({ total: 25, page: 1, perPage: 20 });
    mockUseClients.mockReturnValue(ctx);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(ctx.setFilters).not.toHaveBeenCalled();
  });

  it('find-effect opens the modal when the narrowed row arrives', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-deep-1']]);
    const target = { id: 'c-deep-1', name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [target], clients: [target] }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    // Reuse the assertion idiom the existing create-mode modal tests use.
    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
  });

  it('row not in items: modal stays closed (negative find branch)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-missing']]);
    const other = { id: 'c-other', name: 'Other', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [other], clients: [other] }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  it('dead link: settled empty list strips the param from the URL', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-gone']]);
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [], clients: [], isPending: false, isFetching: false }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith('/clients', { scroll: false }),
    );
  });
});
