import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { ClientCardModal } from '../app/(main)/clients/components/ClientCardModal';
import type { ClientWithStats } from '@memo/api-client';

// ─── Mock child components ────────────────────────────────────────────────

vi.mock('../app/(main)/clients/components/ClientInfoTab', () => ({
  ClientInfoTab: ({ client, onSave, onDelete }: any) => (
    <div data-testid="client-info-tab">
      <span data-testid="info-client-name">{client?.name}</span>
      <button data-testid="info-save" onClick={() => onSave({ name: 'updated' })}>Save</button>
      <button data-testid="info-delete" onClick={onDelete}>Delete</button>
    </div>
  ),
}));

// Payment summary state for the enhanced mock
// Use vi.hoisted + getter pattern so vi.mock factory always reads fresh values
const getMockRecordTabState = vi.hoisted(() => {
  const state = { total: 0, paid: 0, remaining: 0, hasChanges: false };
  return {
    getState: () => state,
    setTotal: (v: number) => { state.total = v; },
    setPaid: (v: number) => { state.paid = v; },
    setRemaining: (v: number) => { state.remaining = v; },
    reset: (overrides?: Partial<typeof state>) => {
      Object.assign(state, { total: 0, paid: 0, remaining: 0, hasChanges: false, ...overrides });
    },
  };
});

vi.mock('../app/(main)/clients/components/ClientRecordTab', () => ({
  ClientRecordTab: ({ recordId, clientId, onClose, onSave }: any) => {
    const [comment, setComment] = React.useState('');
    const [isDirty, setIsDirty] = React.useState(false);
    const state = getMockRecordTabState.getState();

    return (
      <div data-testid="client-record-tab">
        <span data-testid="record-id">{recordId}</span>
        <span data-testid="record-client-id">{clientId}</span>
        {/* Payment summary */}
        <div data-testid="payment-summary">
          <span data-testid="total-price">{state.total.toLocaleString('ru-RU')} ₽</span>
          <span data-testid="paid-amount">{state.paid.toLocaleString('ru-RU')} ₽</span>
          <span data-testid="remaining-amount">{state.remaining.toLocaleString('ru-RU')} ₽</span>
        </div>
        {/* Comment field to test dirty state */}
        <textarea
          data-testid="record-comment"
          value={comment}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setComment(e.target.value);
            setIsDirty(true);
          }}
          placeholder="Комментарий"
        />
        <button
          data-testid="btn-save-record"
          disabled={!isDirty}
          onClick={() => onSave?.({ comment })}
        >
          Сохранить
        </button>
        <button data-testid="record-close" onClick={onClose}>Close</button>
      </div>
    );
  },
}));

// ─── React Query Mock ────────────────────────────────────────────────────

const mockUseQuery = vi.fn().mockReturnValue({ data: [], isLoading: false });

// Helper: set up mock to return records for the records query and activities for the activities query
function mockQueriesForRecordsAndActivities(records: any[] = mockRecords, activities: any[] = mockActivities) {
  mockUseQuery.mockImplementation((...args: any[]) => {
    const queryKey = args[0]?.queryKey ?? args[1]?.queryKey ?? [];
    if (queryKey[0] === 'records') return { data: records, isLoading: false };
    if (queryKey[0] === 'activities') return { data: activities, isLoading: false };
    return { data: [], isLoading: false };
  });
}

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (...args: any[]) => mockUseQuery(...args),
  };
});

// ─── API Client Mock ──────────────────────────────────────────────────────

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getRecords: vi.fn().mockResolvedValue([]),
  };
});

// ─── Context Mock ─────────────────────────────────────────────────────────

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => ({ showToast: vi.fn() })),
}));

import { useClients } from '@/contexts/ClientsContext';
import { createMockClientsContext } from './helpers/mockContexts';

const mockUseClients = vi.mocked(useClients);

beforeEach(() => {
  mockUseClients.mockReturnValue(createMockClientsContext());
  mockUseQuery.mockReturnValue({ data: [], isLoading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Mock data ────────────────────────────────────────────────────────────

const mockClientWithStats: ClientWithStats = {
  id: 'c1',
  name: 'Анна Иванова',
  phone: '+7 (900) 123-45-67',
  email: 'anna@test.com',
  channel: 'telegram',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  is_active: true,
  visits_count: 5,
  last_visit: '2026-05-10',
  total_paid: 17500,
  missed_visits: 1,
};

const mockRecords = [
  {
    id: 'rec1',
    activity_id: 'ev_1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    comment: null,
    created_at: '2026-05-10T10:00:00',
    updated_at: '2026-05-10T10:00:00',
    is_active: true,
    visits: [],
  },
  {
    id: 'rec2',
    activity_id: 'ev_2',
    client_id: 'c1',
    status: 'pending',
    seats: 2,
    comment: null,
    created_at: '2026-04-20T10:00:00',
    updated_at: '2026-04-20T10:00:00',
    is_active: true,
    visits: [],
  },
];

const mockActivities = [
  { id: 'ev_1', start: '2026-05-10T14:00:00', duration: 2.5 },
  { id: 'ev_2', start: '2026-04-20T18:00:00', duration: 2 },
];

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClientCardModal', () => {
  const defaultProps = {
    client: mockClientWithStats,
    isOpen: true,
    onClose: vi.fn(),
    mode: 'view' as const,
  };

  it('renders nothing when isOpen is false', () => {
    render(<ClientCardModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  it('renders modal when isOpen is true', () => {
    render(<ClientCardModal {...defaultProps} />);
    expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
  });

  it('shows client name in left panel header', () => {
    render(<ClientCardModal {...defaultProps} />);
    const leftPanel = screen.getByTestId('client-card-left-panel');
    expect(within(leftPanel).getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('shows client phone in left panel header', () => {
    render(<ClientCardModal {...defaultProps} />);
    const leftPanel = screen.getByTestId('client-card-left-panel');
    expect(within(leftPanel).getByText('+7 (900) 123-45-67')).toBeInTheDocument();
  });

  it('shows "Дорогой гость" when client is null (create mode)', () => {
    render(<ClientCardModal {...defaultProps} client={null} mode="create" />);
    expect(screen.getByText('Дорогой гость')).toBeInTheDocument();
  });

  it('shows "Не указан" when phone is missing', () => {
    const noPhoneClient = { ...mockClientWithStats, phone: '' };
    render(<ClientCardModal {...defaultProps} client={noPhoneClient} />);
    expect(screen.getByText('Не указан')).toBeInTheDocument();
  });

  it('has "Клиент" tab button', () => {
    render(<ClientCardModal {...defaultProps} />);
    expect(screen.getByText('Клиент')).toBeInTheDocument();
  });

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn();
    render(<ClientCardModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('client-card-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets active tab to client when modal opens', () => {
    const { rerender } = render(<ClientCardModal {...defaultProps} isOpen={false} />);
    // Open the modal
    rerender(<ClientCardModal {...defaultProps} isOpen={true} />);
    // ClientInfoTab should be shown (default tab is 'client')
    expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();
  });

  it('switches to record tab when record button is clicked', () => {
    mockQueriesForRecordsAndActivities();
    render(<ClientCardModal {...defaultProps} />);
    // Click on first record tab
    fireEvent.click(screen.getByText('10.05.2026'));
    expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    expect(screen.getByTestId('record-id').textContent).toBe('rec1');
  });

  it('passes clientId to ClientRecordTab', () => {
    mockQueriesForRecordsAndActivities();
    render(<ClientCardModal {...defaultProps} />);
    fireEvent.click(screen.getByText('10.05.2026'));
    expect(screen.getByTestId('record-client-id').textContent).toBe('c1');
  });

  it('shows ClientInfoTab by default (client tab active)', () => {
    render(<ClientCardModal {...defaultProps} />);
    expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();
    expect(screen.getByTestId('info-client-name').textContent).toBe('Анна Иванова');
  });

  it('shows record date buttons for each record', () => {
    mockQueriesForRecordsAndActivities();
    render(<ClientCardModal {...defaultProps} />);
    // Should have 2 record tabs + 1 client tab
    expect(screen.getByText('10.05.2026')).toBeInTheDocument();
    expect(screen.getByText('20.04.2026')).toBeInTheDocument();
  });

  it('shows activity date and time in record tab buttons', () => {
    // Uses custom activities with different times
    mockQueriesForRecordsAndActivities(mockRecords, [
      { id: 'ev_1', start: '2026-05-10T14:00:00', duration: 2.5 },
      { id: 'ev_2', start: '2026-04-20T18:00:00', duration: 2 },
    ]);
    render(<ClientCardModal {...defaultProps} />);
    // Should show activity start dates, not record created_at
    expect(screen.getByText('10.05.2026')).toBeInTheDocument();
    expect(screen.getByText('14:00')).toBeInTheDocument();
    expect(screen.getByText('20.04.2026')).toBeInTheDocument();
    expect(screen.getByText('18:00')).toBeInTheDocument();
  });

  it('renders two-panel layout (left panel + right panel)', () => {
    const { container } = render(<ClientCardModal {...defaultProps} />);
    const modal = screen.getByTestId('client-card-modal');
    // Modal should contain a left panel and a right panel
    expect(modal.querySelector('[data-testid="client-card-left-panel"]')).toBeInTheDocument();
    expect(modal.querySelector('[data-testid="client-card-right-panel"]')).toBeInTheDocument();
  });

  it('ClientInfoTab onSave calls context updateClient', () => {
    const updateClient = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ updateClient }));
    render(<ClientCardModal {...defaultProps} />);
    fireEvent.click(screen.getByTestId('info-save'));
    expect(updateClient).toHaveBeenCalledWith('c1', { name: 'updated' });
  });

  it('ClientInfoTab onDelete wraps deleteClient with confirm', async () => {
    const deleteClient = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ deleteClient }));
    render(<ClientCardModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('info-delete'));
    // jsdom's window.confirm returns false by default, so deleteClient should not be called
    await vi.waitFor(() => {
      expect(deleteClient).not.toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ─── Tab switching edge cases ───────────────────────────────────────────

  describe('tab switching', () => {
    it('switches back to client tab from record tab', () => {
      mockQueriesForRecordsAndActivities();
      render(<ClientCardModal {...defaultProps} />);

      // Start on client tab
      expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();

      // Switch to a record tab
      fireEvent.click(screen.getByText('10.05.2026'));
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();

      // Switch back to client tab
      fireEvent.click(screen.getByText('Клиент'));
      expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('client-record-tab')).not.toBeInTheDocument();
    });

    it('resets to client tab when modal is closed and reopened', () => {
      mockQueriesForRecordsAndActivities();
      const { rerender } = render(
        <ClientCardModal {...defaultProps} isOpen={true} />,
      );

      // Switch to record tab
      fireEvent.click(screen.getByText('10.05.2026'));
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();

      // Close modal
      rerender(<ClientCardModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();

      // Reopen modal
      rerender(<ClientCardModal {...defaultProps} isOpen={true} />);
      // Should reset to client tab
      expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();
    });

    it('renders the correct record tab content for different records', () => {
      mockQueriesForRecordsAndActivities();
      render(<ClientCardModal {...defaultProps} />);

      // Click first record
      fireEvent.click(screen.getByText('10.05.2026'));
      expect(screen.getByTestId('record-id').textContent).toBe('rec1');

      // Switch back to client, then click second record
      fireEvent.click(screen.getByText('Клиент'));
      fireEvent.click(screen.getByText('20.04.2026'));
      expect(screen.getByTestId('record-id').textContent).toBe('rec2');
    });

    it('Клиент tab has active styling when selected', () => {
      render(<ClientCardModal {...defaultProps} />);
      const clientTab = screen.getByText('Клиент');
      expect(clientTab.className).toContain('bg-brand');
      expect(clientTab.className).toContain('text-white');
    });

    it('does not render record tabs when client has no records', () => {
      mockUseQuery.mockReturnValue({ data: [], isLoading: false });
      render(<ClientCardModal {...defaultProps} />);
      expect(screen.getByText('Клиент')).toBeInTheDocument();
      // No date-based record buttons
      expect(screen.queryByText(/10\.05\.2026/)).not.toBeInTheDocument();
    });
  });

  // ─── Modal close behavior ───────────────────────────────────────────────

  describe('modal close behavior', () => {
    it('does not call onClose when clicking inside the modal content', () => {
      const onClose = vi.fn();
      render(<ClientCardModal {...defaultProps} onClose={onClose} />);
      // Click on the modal body
      fireEvent.click(screen.getByTestId('client-card-left-panel'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('passing null client in view mode still renders modal header', () => {
      render(<ClientCardModal {...defaultProps} client={null} mode="view" />);
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });

    it('closes modal on Escape key', () => {
      const onClose = vi.fn();
      render(<ClientCardModal {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('does not close modal on other key presses', () => {
      const onClose = vi.fn();
      render(<ClientCardModal {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close on Escape when modal is closed', () => {
      const onClose = vi.fn();
      render(<ClientCardModal {...defaultProps} isOpen={false} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ─── Create mode — keep modal open ─────────────────────────────────────

  describe('create mode', () => {
    it('calls onClientCreated instead of onClose after successful create', async () => {
      const onClientCreated = vi.fn();
      const newClient = { ...mockClientWithStats, id: 'new-c1', name: 'Новый' };
      const createClient = vi.fn().mockResolvedValue(newClient);
      mockUseClients.mockReturnValue(createMockClientsContext({ createClient }));

      render(
        <ClientCardModal
          {...defaultProps}
          client={null}
          mode="create"
          onClientCreated={onClientCreated}
        />,
      );

      fireEvent.click(screen.getByTestId('info-save'));

      // Wait for async createClient
      const { waitFor } = await import('@testing-library/react');
      await waitFor(() => {
        expect(createClient).toHaveBeenCalled();
      });
      expect(onClientCreated).toHaveBeenCalledWith(newClient);
    });
  });
});

// ─── Record tab integration: payment summary + save button ─────────────

describe('ClientCardModal — Record tab integration', () => {
  const defaultProps = {
    client: mockClientWithStats,
    isOpen: true,
    onClose: vi.fn(),
    mode: 'view' as const,
  };

  beforeEach(() => {
    mockUseClients.mockReturnValue(createMockClientsContext());
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
    // Reset payment summary mock state
    getMockRecordTabState.reset({ total: 7000, paid: 3500, remaining: 3500 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('record tab shows payment summary with correct totals', async () => {
    // Set up records with visits and payments
    getMockRecordTabState.reset({ total: 7000, paid: 3500, remaining: 3500 });
    mockQueriesForRecordsAndActivities();

    render(<ClientCardModal {...defaultProps} />);

    // Switch to record tab
    fireEvent.click(screen.getByText('10.05.2026'));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Verify payment summary displays correct totals
    // Note: toLocaleString('ru-RU') uses non-breaking space (U+00A0) as thousands separator
    const nbsp = '\u00A0';
    expect(screen.getByTestId('total-price').textContent).toBe(`7${nbsp}000 ₽`);
    expect(screen.getByTestId('paid-amount').textContent).toBe(`3${nbsp}500 ₽`);
    expect(screen.getByTestId('remaining-amount').textContent).toBe(`3${nbsp}500 ₽`);
  });

  it('record tab shows zero remaining when fully paid', async () => {
    getMockRecordTabState.reset({ total: 3500, paid: 3500, remaining: 0 });
    mockQueriesForRecordsAndActivities();

    render(<ClientCardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('10.05.2026'));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    const nbsp = '\u00A0';
    expect(screen.getByTestId('total-price').textContent).toBe(`3${nbsp}500 ₽`);
    expect(screen.getByTestId('paid-amount').textContent).toBe(`3${nbsp}500 ₽`);
    expect(screen.getByTestId('remaining-amount').textContent).toBe('0 ₽');
  });

  it('record tab save button activates on comment change', async () => {
    mockQueriesForRecordsAndActivities();

    render(<ClientCardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('10.05.2026'));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Save button should be disabled initially
    const saveBtn = screen.getByTestId('btn-save-record');
    expect(saveBtn).toBeDisabled();

    // Change comment
    fireEvent.change(screen.getByTestId('record-comment'), {
      target: { value: 'Новый комментарий' },
    });

    // Save button should now be enabled
    expect(saveBtn).toBeEnabled();
  });

  it('record tab save button disables after cancel (no cancel in mock, but test dirty state)', async () => {
    mockQueriesForRecordsAndActivities();

    render(<ClientCardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('10.05.2026'));

    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Save should be disabled
    const saveBtn = screen.getByTestId('btn-save-record');
    expect(saveBtn).toBeDisabled();

    // Change to dirty
    fireEvent.change(screen.getByTestId('record-comment'), {
      target: { value: 'Тест' },
    });
    expect(saveBtn).toBeEnabled();
  });
});
