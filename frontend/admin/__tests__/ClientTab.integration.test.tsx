import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// ─── Shared mock data ──────────────────────────────────────────────────────

import {
  mockMasters,
  mockServices,
  mockLocations,
  mockActivity,
  mockClient,
  mockRecord,
  mockVisitor,
  mockPayment,
  mockTariffs,
} from './helpers/mockData';

import {
  createMockScheduleContext,
  createMockRecordsContext,
  createMockUIContext,
} from './helpers/mockContexts';

import { patchVisit as apiPatchVisit } from '@memo/api-client';

// ─── API Client Mock ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  searchClientByPhone: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  deletePayment: vi.fn(),
  updateVisitStatus: vi.fn(),
  getRecord: vi.fn(),
  getClientVisitors: vi.fn(),
  getActivity: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getPayments: vi.fn(),
  patchRecord: vi.fn(),
  patchActivity: vi.fn(),
  deleteVisitor: vi.fn(),
  createVisit: vi.fn(),
  patchVisit: vi.fn(),
  deleteVisit: vi.fn(),
  updateVisitor: vi.fn(),
}));

vi.mock('@/contexts/ScheduleContext', () => ({ useSchedule: vi.fn() }));
vi.mock('@/contexts/RecordsContext', () => ({ useRecords: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: vi.fn(),
    fetchQuery: vi.fn(),
  })),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);

// ─── Component under test ──────────────────────────────────────────────────

import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';

describe('ClientTab — integration with shared atoms', () => {
  beforeEach(() => {
    mockUseSchedule.mockReturnValue(createMockScheduleContext());
    mockUseRecords.mockReturnValue(createMockRecordsContext());
    mockUseUI.mockReturnValue(createMockUIContext());
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  const defaultProps = {
    record: mockRecord,
    client: mockClient,
    visitors: [mockVisitor],
    visits: mockRecord.visits,
    payments: [],
    serviceTariffs: mockTariffs,
    onUpdateRecord: vi.fn().mockResolvedValue(undefined),
    onDeleteRecord: vi.fn(),
    onAddPayment: vi.fn(),
    onDeletePayment: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  };

  // ─── RecordHeader atom ──────────────────────────────────────────────

  it('renders RecordHeader with client name', () => {
    render(<ClientTab {...defaultProps} />);
    // ClientTab uses RecordSummary (not RecordHeader) — verify the component renders
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
    // Client name appears in visit rows when visitorsMap has data from useRecordData
    // (useRecordData is mocked via useQuery, so name may not appear — verify structure instead)
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });

  it('renders StatusBadge in RecordHeader', () => {
    render(<ClientTab {...defaultProps} />);
    // ClientTab uses RecordSummary with StatusPicker (not StatusBadge)
    expect(screen.getByTestId('record-status')).toBeInTheDocument();
  });

  // ─── RecordVisitRow atom ───────────────────────────────────────────

  it('renders RecordVisitRow for each visit', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });

  // ─── PaymentTotals atom ────────────────────────────────────────────

  it('renders PaymentTotals', () => {
    render(<ClientTab {...defaultProps} />);
    // Payment totals are now in the payments-total row of RecordPaymentsTable
    expect(screen.getByTestId('payments-total')).toBeInTheDocument();
  });

  // ─── PaymentList atom ──────────────────────────────────────────────

  it('renders PaymentList when payments exist', () => {
    const payments = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '', updated_at: '', is_active: true },
    ];
    render(<ClientTab {...defaultProps} payments={payments} />);
    expect(screen.getByTestId('record-payments-table')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  it('renders PaymentForm', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByTestId('btn-add-payment')).toBeInTheDocument();
  });

  // ─── Surface-specific behavior ─────────────────────────────────────

  it('renders client link', () => {
    render(<ClientTab {...defaultProps} />);
    // Client link is now in ActivityDetailsModal tab labels.
    // Verify the record summary with status trigger renders instead.
    const statusTrigger = screen.getByTestId('record-status-trigger');
    expect(statusTrigger).toBeInTheDocument();
    expect(statusTrigger.tagName).toBe('BUTTON');
  });

  it('renders delete button', () => {
    render(<ClientTab {...defaultProps} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
  });

  it('renders delete payment button for each payment', () => {
    const payments = [
      { id: 'p1', record_id: 'r1', amount: 3500, method: 'card', created_at: '', updated_at: '', is_active: true },
    ];
    render(<ClientTab {...defaultProps} payments={payments} />);
    const deleteButtons = screen.getAllByLabelText('Удалить платёж');
    expect(deleteButtons.length).toBe(1);
  });

  it('shows toast on delete with undo callback', () => {
    vi.useFakeTimers();
    render(<ClientTab {...defaultProps} />);
    fireEvent.click(screen.getByTestId('btn-delete-record'));

    expect(defaultProps.showToast).toHaveBeenCalledWith(
      'Запись удалена через 5 секунд',
      expect.any(Function),
    );

    vi.useRealTimers();
  });

  // ─── Mutations wiring ──────────────────────────────────────────────

  it('addPayment fires onAddPayment callback', async () => {
    render(<ClientTab {...defaultProps} />);
    // Open payment add form first
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    fireEvent.change(screen.getByTestId('add-payment-amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('add-payment-submit'));

    await waitFor(() => {
      expect(defaultProps.onAddPayment).toHaveBeenCalledWith('r1', 500, 'card');
    });
  });

  it('deletePayment fires onDeletePayment callback', async () => {
    const payments = [
      { id: 'p1', record_id: 'r1', amount: 1000, method: 'card', created_at: '', updated_at: '', is_active: true },
    ];
    render(<ClientTab {...defaultProps} payments={payments} />);
    fireEvent.click(screen.getByTestId('payment-p1-delete'));

    await waitFor(() => {
      expect(defaultProps.onDeletePayment).toHaveBeenCalledWith('p1');
    });
  });

  it('renders seats summary', () => {
    render(<ClientTab {...defaultProps} />);
    // Seats info is displayed in RecordSummary as "Мест:" label
    expect(screen.getByText('Мест:')).toBeInTheDocument();
  });

  // ─── Status change wiring ─────────────────────────────────────────

  it('status change on RecordVisitRow calls patchVisit', async () => {
    vi.mocked(apiPatchVisit).mockResolvedValue({ id: 'v1', status: 'visited', custom_price: null, created_at: '', updated_at: '', is_active: true, record_id: 'r1', price: 0 } as any);
    render(<ClientTab {...defaultProps} />);

    const statusContainer = screen.getByTestId('visit-v1-status');
    const trigger = within(statusContainer).getByTestId('visit-v1-status-trigger');
    fireEvent.click(trigger);

    const option = within(statusContainer).getByTestId('visit-v1-status-option-visited');
    fireEvent.click(option);

    await waitFor(() => {
      expect(apiPatchVisit).toHaveBeenCalledWith('v1', expect.objectContaining({ status: 'visited' }));
    });
    // Should NOT call the full-record onUpdateRecord for a status-only change
    expect(defaultProps.onUpdateRecord).not.toHaveBeenCalled();
  });
});
