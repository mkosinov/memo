import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

vi.mock('../app/(main)/clients/components/ClientRecordTab', () => ({
  ClientRecordTab: ({ recordId, onClose }: any) => (
    <div data-testid="client-record-tab">
      <span data-testid="record-id">{recordId}</span>
      <button data-testid="record-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

// ─── Context Mock ─────────────────────────────────────────────────────────

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

import { useClients } from '@/contexts/ClientsContext';
import { createMockClientsContext } from './helpers/mockContexts';

const mockUseClients = vi.mocked(useClients);

beforeEach(() => {
  mockUseClients.mockReturnValue(createMockClientsContext());
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

const mockClientWithRecords = {
  ...mockClientWithStats,
  records: [
    {
      id: 'rec1',
      date: '2026-05-10',
      time: '14:00',
      created_at: '2026-05-10T10:00:00',
    },
    {
      id: 'rec2',
      date: '2026-04-20',
      time: '16:30',
      created_at: '2026-04-20T10:00:00',
    },
  ],
} as ClientWithStats & { records: Array<{ id: string; date: string; time: string; created_at: string }> };

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
    render(<ClientCardModal {...defaultProps} client={mockClientWithRecords} />);
    // Click on first record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));
    expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    expect(screen.getByTestId('record-id').textContent).toBe('rec1');
  });

  it('shows ClientInfoTab by default (client tab active)', () => {
    render(<ClientCardModal {...defaultProps} />);
    expect(screen.getByTestId('client-info-tab')).toBeInTheDocument();
    expect(screen.getByTestId('info-client-name').textContent).toBe('Анна Иванова');
  });

  it('shows record date buttons for each record', () => {
    render(<ClientCardModal {...defaultProps} client={mockClientWithRecords} />);
    // Should have 2 record tabs + 1 client tab
    expect(screen.getByText(/10\.05\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/20\.04\.2026/)).toBeInTheDocument();
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

  it('ClientInfoTab onDelete calls context deleteClient and onClose', () => {
    const deleteClient = vi.fn();
    const onClose = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ deleteClient }));
    render(<ClientCardModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('info-delete'));
    expect(deleteClient).toHaveBeenCalledWith('c1');
    expect(onClose).toHaveBeenCalled();
  });
});
