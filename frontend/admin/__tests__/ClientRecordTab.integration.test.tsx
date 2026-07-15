import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// ─── Mock UIContext ────────────────────────────────────────────────────────
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  }),
}));

// ─── Mock api-client ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecord: vi.fn(),
  updateRecord: vi.fn(),
  patchRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  getClientVisitors: vi.fn(),
  getActivity: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getPayments: vi.fn(),
  updateVisitStatus: vi.fn(),
  patchActivity: vi.fn(),
  createVisitor: vi.fn(),
  deleteVisitor: vi.fn(),
  createVisit: vi.fn(),
  patchVisit: vi.fn(),
  deleteVisit: vi.fn(),
  updateVisitor: vi.fn(),
  ApiError: class ApiError extends Error { code: string; constructor(msg: string, code: string) { super(msg); this.code = code; } },
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({
    gridFrequency: 30,
    masters: [],
    services: [],
    locations: [],
  })),
}));

vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: vi.fn() }),
}));

const mockInvalidateQueries = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  setQueryData: vi.fn(),
  setQueriesData: vi.fn(),
  getQueryData: vi.fn(),
  fetchQuery: vi.fn(),
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => mockQueryClient),
  useMutation: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import {
  patchRecord,
  patchActivity,
  deleteRecord,
  createPayment,
  deletePayment,
  createVisitor,
  updateVisitStatus,
  createVisit,
  patchVisit as apiPatchVisit,
} from '@memo/api-client';

import {
  mockRecord,
  mockVisitors,
  mockActivityResponse,
  mockServiceResponse,
  mockMasters,
  mockLocations,
  mockPayments,
  buildDefaultQueryImpl,
} from './helpers/clientRecordTabSetup';

const mockUseQuery = vi.mocked(useQuery);

import { ClientRecordTab } from '../app/(main)/clients/components/ClientRecordTab';

describe('ClientRecordTab — integration with shared atoms', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    buildDefaultQueryImpl(mockUseQuery);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchActivity).mockResolvedValue(mockActivityResponse);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p_new', record_id: 'r1', amount: 1000, method: 'card',
      created_at: '', updated_at: '',
    });
    vi.mocked(deletePayment).mockResolvedValue(undefined);
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'Новый', age: null,
      created_at: '', updated_at: '', is_active: true,
    });
    vi.mocked(createVisit).mockResolvedValue({
      id: 'v_new', record_id: 'r1', visitor_id: 'vis_new', tariff_id: 't1',
      price: 3500, custom_price: null, status: 'waiting',
      created_at: '', updated_at: '',
    });
    vi.mocked(apiPatchVisit).mockResolvedValue({
      id: 'v1', record_id: 'r1', visitor_id: 'vis1', tariff_id: 't1',
      price: 3500, custom_price: null, status: 'visited',
      created_at: '', updated_at: '',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  // ─── RecordHeader atom ──────────────────────────────────────────────

  it('renders RecordHeader with client name', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('record-header')).toBeInTheDocument();
    // useRecordData doesn't fetch full client — RecordHeader shows "Без имени" as placeholder
    expect(screen.getByText('Без имени')).toBeInTheDocument();
  });

  it('renders StatusBadge in RecordHeader', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('status-badge-waiting')).toBeInTheDocument();
  });

  it('renders anonym-visits input in RecordHeader', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('anonym-visits-input')).toBeInTheDocument();
  });

  // ─── RecordVisitRow atom ───────────────────────────────────────────

  it('renders one RecordVisitRow per visit', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });

  it('renders visit name inside RecordVisitRow', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const visitRow = screen.getByTestId('visit-row-v1');
    const nameInput = visitRow.querySelector('input') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('Анна Иванова');
  });

  // ─── PaymentList atom ──────────────────────────────────────────────

  it('renders PaymentList with existing payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('record-payments-table')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  // ─── PaymentTotals atom ────────────────────────────────────────────

  it('renders PaymentTotals with correct values', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payments-total')).toBeInTheDocument();
    // Paid=1500 (from mockPayments)
    expect(screen.getAllByText('1 500 ₽').length).toBeGreaterThan(0);
  });

  // ─── PaymentForm atom ──────────────────────────────────────────────

  it('renders PaymentForm', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('btn-add-payment')).toBeInTheDocument();
  });

  // ─── AddVisitorForm atom ───────────────────────────────────────────

  it('shows AddVisitorForm when add button clicked', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    // The new unified row renders with id===null → testId visit-row-new
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-name')).toBeInTheDocument();
  });

  // ─── Mutations wiring ──────────────────────────────────────────────

  it('addPayment fires createPayment mutation', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Open new payment row
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    const amountInput = screen.getByTestId('add-payment-amount');
    fireEvent.change(amountInput, { target: { value: '2000' } });
    fireEvent.blur(amountInput);

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 2000,
        method: 'card',
        created_at: expect.any(String),
      });
    });
  });

  it('addVisitor fires createVisitor then patchRecord', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Новый Гость' } });
    // The add visitor form auto-submits on blur (no explicit submit button)
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(createVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый Гость',
        age: undefined,
      });
    });
  });

  it('deletePayment fires deletePayment mutation', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('payment-p1-delete'));

    await waitFor(() => {
      expect(deletePayment).toHaveBeenCalledWith('p1');
    });
  });

  it('saveRecord fires patchRecord on save', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Test comment' } });
    fireEvent.click(screen.getByTestId('btn-save-record'));

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', expect.objectContaining({
        comment: 'Test comment',
      }));
    });
  });

  // ─── Status change wiring ─────────────────────────────────────────

  it('status change on RecordVisitRow calls patchVisit', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    const statusContainer = screen.getByTestId('visit-v1-status');
    const trigger = within(statusContainer).getByTestId('visit-v1-status-trigger');
    fireEvent.click(trigger);

    const option = within(statusContainer).getByTestId('visit-v1-status-option-visited');
    fireEvent.click(option);

    await waitFor(() => {
      expect(apiPatchVisit).toHaveBeenCalledWith('v1', expect.objectContaining({ status: 'visited' }));
    });
  });
});
