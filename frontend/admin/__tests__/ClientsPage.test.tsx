import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientWithStats } from '@memo/api-client';
import { useClientsTable, defaultFilters } from '@/contexts/ClientsContext';
import { createMockClientsTableState } from './helpers/mockContexts';

// ─── Mock contexts ───────────────────────────────────────────────────────

// GH #138 Task 6: /clients is decoupled from the schedule stack — the page
// mounts ONLY GridSettingsProvider (ClientRecordTab reads gridFrequency from
// it). The stub asserts the NEW contract: page children must render through
// GridSettingsProvider, not ScheduleProvider. If the page ever regresses to
// ScheduleProvider, the ScheduleProvider stub below makes it fail loudly
// (ScheduleProvider renders nothing).
vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  GridSettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="grid-settings-provider">{children}</div>
  ),
}));

vi.mock('@/contexts/schedule/ScheduleProvider', () => ({
  ScheduleProvider: () => {
    throw new Error(
      'page must not mount ScheduleProvider — /clients uses GridSettingsProvider only (GH #138 T6)',
    );
  },
}));

// #231 seed-era: the ClientsProvider mock records the props of every render
// so the deep-link tests can assert on `initialFilters` (replaces the
// effect-era setFilters assertions). vi.hoisted keeps the capture array
// available to the hoisted vi.mock factory.
const { clientsProviderMounts } = vi.hoisted(() => ({
  clientsProviderMounts: [] as Array<{ initialFilters?: unknown }>,
}));

// importOriginal keeps the real `defaultFilters` export available — the
// shared mockContexts fixture imports it for createMockClientsTableState.
vi.mock('@/contexts/ClientsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ClientsContext')>();
  return {
    ...actual,
    useClientsTable: vi.fn(),
    ClientsProvider: ({ children, initialFilters }: { children: React.ReactNode; initialFilters?: unknown }) => {
      clientsProviderMounts.push({ initialFilters });
      return <div>{children}</div>;
    },
  };
});

const mockRouter = { push: vi.fn(), replace: vi.fn() };
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
  // #232 §3.5 — the narrowing chip builds its replace-target from pathname.
  usePathname: () => '/clients',
}));

const mockUseClients = vi.mocked(useClientsTable);

// ─── Mock components ─────────────────────────────────────────────────────

vi.mock('../app/(main)/clients/components/ClientsFilters', () => ({
  ClientsFilters: () => <div data-testid="clients-filters">ClientsFilters</div>,
}));

vi.mock('../app/(main)/clients/components/ClientsTable', () => ({
  // #139 T6 — ClientsTable renders the unified <DataTable> which owns the pager.
  // Mock reads `useClientsTable` from the module scope (mocked above) and exposes
  // the pager controls so page-level tests can assert on them.
  ClientsTable: ({ onClientClick }: any) => {
    // useClientsTable is already imported at the top of this file from the mocked module.
    const ctx = useClientsTable();
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
    clientsProviderMounts.length = 0;
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 25, page: 1, perPage: 20 }));
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
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 45, page: 1, perPage: 20 }));
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
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 45, page: 1, perPage: 20 }));
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
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 45, page: 1, perPage: 20 }));
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
      mockUseClients.mockReturnValue(createMockClientsTableState({ total: 25, page: 2, perPage: 20 }));
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
      mockUseClients.mockReturnValue(createMockClientsTableState({ total: 60, page: 2, perPage: 20 }));
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
      mockUseClients.mockReturnValue(createMockClientsTableState({ total: 1, page: 1, perPage: 20 }));
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
      mockUseClients.mockReturnValue(createMockClientsTableState({ total: 0, page: 1, perPage: 20 }));
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

describe('ClientsPage — ?clientId= deep-link (#232 machine field era)', () => {
  // Real-shaped UUIDs — the parser drops anything else (#232 §3.3).
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const U3 = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
    clientsProviderMounts.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds the provider: initialFilters={clientIds, status: all} for one valid id', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(clientsProviderMounts.length).toBeGreaterThan(0);
    const seedMount = clientsProviderMounts.find(m => m.initialFilters !== undefined);
    expect(seedMount).toBeDefined();
    expect(seedMount!.initialFilters).toEqual({ clientIds: [U1], status: 'all' });
  });

  it('seeds the provider with all valid ids when the param repeats', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1], ['clientId', U2]]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    const seedMount = clientsProviderMounts.find(m => m.initialFilters !== undefined);
    expect(seedMount).toBeDefined();
    expect(seedMount!.initialFilters).toEqual({ clientIds: [U1, U2], status: 'all' });
  });

  it('garbage param: no seed, default filters (all components invalid)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'abc'], ['clientId', '  ']]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 25, page: 1, perPage: 20 }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(clientsProviderMounts.every(m => m.initialFilters === undefined)).toBe(true);
  });

  it('mixed garbage and valid: only valid ids seed the provider', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'abc'], ['clientId', U1], ['clientId', '']]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    const seedMount = clientsProviderMounts.find(m => m.initialFilters !== undefined);
    expect(seedMount).toBeDefined();
    expect(seedMount!.initialFilters).toEqual({ clientIds: [U1], status: 'all' });
  });

  it('repeated identical id dedups to a single-element seed', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1], ['clientId', U1.toUpperCase()]]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    const seedMount = clientsProviderMounts.find(m => m.initialFilters !== undefined);
    expect(seedMount).toBeDefined();
    expect(seedMount!.initialFilters).toEqual({ clientIds: [U1], status: 'all' });
  });

  it('no param: initialFilters prop not passed (undefined)', async () => {
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 25, page: 1, perPage: 20 }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(clientsProviderMounts.length).toBeGreaterThan(0);
    expect(clientsProviderMounts.every(m => m.initialFilters === undefined)).toBe(true);
  });

  // ─── Auto-open rule (#232 §3.3/§3.4) ────────────────────────────────────

  it('find-effect opens the modal when the narrowed row arrives (single id)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const target = { id: U1, name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [target] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
  });

  it('two ids: modal never auto-opens even though rows are present (US-3)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1], ['clientId', U2]]);
    const a = { id: U1, name: 'A', archived: false } as ClientWithStats;
    const b = { id: U2, name: 'B', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [a, b] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  it('row not in items: modal stays closed (negative find branch)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U3]]);
    const other = { id: U1, name: 'Other', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [other] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  // ─── Modal lifecycle (#232 §3.4) ────────────────────────────────────────

  it('dead link: settled empty list does NOT strip the param from the URL', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U3]]);
    mockUseClients.mockReturnValue(
      createMockClientsTableState({ items: [], isPending: false, isFetching: false }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    // The dead-link cleanup effect is removed (#232 §3.4): the address is
    // never wiped silently — the empty table + chip is the honest state.
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('closing the modal keeps it closed while the param stays in the URL (latch #216)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const target = { id: U1, name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [target] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });

    // User closes the modal. The unit-env router mock does NOT mutate
    // mockSearchParams, so the param REMAINS — the exact latch window.
    fireEvent.click(screen.getByTestId('modal-close'));

    await waitFor(() =>
      expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument(),
    );
  });

  it('closing the modal does not touch the address (no hidden router.replace)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const target = { id: U1, name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [target] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('modal-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument(),
    );

    // #232 §3.4: closing the card must not mutate the URL.
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('latch resets when the param leaves the URL — same id re-navigated reopens the modal', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const target = { id: U1, name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [target] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    // Fresh JSX per rerender — reusing one element reference makes React bail
    // out of reconciliation (same-element bailout gotcha).
    const ui = () => (
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>
    );
    const { rerender } = render(ui());

    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('modal-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument(),
    );

    // Param leaves the URL (e.g. narrowing removed) → latch resets.
    mockSearchParams = new URLSearchParams();
    rerender(ui());
    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());

    // Same id arrives again → the modal opens again.
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    rerender(ui());

    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
  });

  // ─── Live sync: URL → clientIds machine field (#232 §3.3) ───────────────

  it('sync effect converges the machine field when the state lacks the URL ids', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const state = createMockClientsTableState({ items: [] });
    mockUseClients.mockReturnValue(state);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(state.setFilters).toHaveBeenCalledWith({ clientIds: [U1] });
    });
  });

  it('URL change (back/forward/edit) updates the machine field', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const state = createMockClientsTableState({ items: [] });
    mockUseClients.mockReturnValue(state);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    // Fresh JSX per rerender — reusing one element reference makes React bail
    // out of reconciliation (same-element bailout gotcha).
    const ui = () => (
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>
    );
    const { rerender } = render(ui());

    await waitFor(() => {
      expect(state.setFilters).toHaveBeenCalledWith({ clientIds: [U1] });
    });
    // Emulate the real merge-patch landing (vi.fn does not update state).
    state.filters = { ...state.filters, clientIds: [U1] };
    vi.mocked(state.setFilters).mockClear();

    // Back/forward or manual edit lands on two ids.
    mockSearchParams = new URLSearchParams([['clientId', U1], ['clientId', U2]]);
    rerender(ui());
    await waitFor(() => {
      expect(state.setFilters).toHaveBeenCalledWith({ clientIds: [U1, U2] });
    });
    state.filters = { ...state.filters, clientIds: [U1, U2] };
    vi.mocked(state.setFilters).mockClear();

    // Narrowing removed from the address. (undefined ≈ null in the page's
    // sameIds normalization, so the write only fires once the state actually
    // holds a narrowing.)
    mockSearchParams = new URLSearchParams();
    rerender(ui());
    await waitFor(() => {
      expect(state.setFilters).toHaveBeenCalledWith({ clientIds: null });
    });
  });

  it('no redundant sync write when the state already matches the URL ids', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    const state = createMockClientsTableState({
      items: [],
      filters: { ...defaultFilters, clientIds: [U1], status: 'all' },
    });
    mockUseClients.mockReturnValue(state);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(state.setFilters).not.toHaveBeenCalled();
  });

  // ─── Narrowing chip (#232 §3.5) ─────────────────────────────────────────

  it('renders the chip between filters and table when the URL narrows (single id)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('client-deeplink-chip')).toBeInTheDocument());
    expect(screen.getByText('Открыт по ссылке')).toBeInTheDocument();
    // Between the filters block and the table (spec §3.5 placement).
    const chip = screen.getByTestId('client-deeplink-chip');
    const filtersBlock = screen.getByTestId('clients-filters').closest('div');
    const tableBlock = screen.getByTestId('clients-table').closest('div');
    expect(chip.compareDocumentPosition(filtersBlock!)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(chip.compareDocumentPosition(tableBlock!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('multi-id URL renders «Открыто по ссылке: N»', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1], ['clientId', U2]]);
    mockUseClients.mockReturnValue(createMockClientsTableState({ items: [] }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Открыто по ссылке: 2')).toBeInTheDocument());
  });

  it('no narrowing → no chip', async () => {
    mockSearchParams = new URLSearchParams();
    mockUseClients.mockReturnValue(createMockClientsTableState({ total: 25 }));

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(screen.queryByTestId('client-deeplink-chip')).not.toBeInTheDocument();
  });

  it('chip ✕ clears only the address — no setFilters from the click (#232 §3.5)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', U1], ['page', '2']]);
    const state = createMockClientsTableState({
      // user-set filters live ON TOP of the narrowing (AND semantics, §3.3)
      filters: { ...defaultFilters, clientIds: [U1], status: 'all', search: 'анна' },
      items: [],
    });
    mockUseClients.mockReturnValue(state);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('client-deeplink-chip')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));

    // Address only: page param survives, clientId is gone, scroll: false.
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/clients?page=2', { scroll: false });
    expect(mockRouter.push).not.toHaveBeenCalled();
    // NO setFilters from the click — the Task 4 sync effect owns convergence.
    // (The mount-time sync effect may fire for state/URL mismatch; clear the
    // history first, then assert the click itself added no filter writes.)
    vi.mocked(state.setFilters).mockClear();
    expect(state.setFilters).not.toHaveBeenCalled();
  });
});
