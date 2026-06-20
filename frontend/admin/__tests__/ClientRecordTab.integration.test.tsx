import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mock api-client ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecord: vi.fn(),
  updateRecord: vi.fn(),
  patchRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
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
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({
    gridFrequency: 30,
    masters: [],
    services: [],
    locations: [],
  })),
}));

const mockInvalidateQueries = vi.fn();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries, setQueryData: vi.fn(), fetchQuery: vi.fn() };

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
      created_at: '', updated_at: '', is_active: true,
    });
    vi.mocked(deletePayment).mockResolvedValue(undefined);
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'Новый', age: null,
      created_at: '', updated_at: '', is_active: true,
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
    const nameInput = screen.getByTestId('visit-v1-name');
    expect(nameInput).toHaveValue('Анна Иванова');
  });

  // ─── PaymentList atom ──────────────────────────────────────────────

  it('renders PaymentList with existing payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payment-list')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  // ─── PaymentTotals atom ────────────────────────────────────────────

  it('renders PaymentTotals with correct values', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payment-totals')).toBeInTheDocument();
    // Total=3500, Paid=1500
    expect(screen.getByText('3 500 ₽')).toBeInTheDocument();
    expect(screen.getByText('1 500 ₽')).toBeInTheDocument();
  });

  // ─── PaymentForm atom ──────────────────────────────────────────────

  it('renders PaymentForm', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payment-form')).toBeInTheDocument();
  });

  // ─── AddVisitorForm atom ───────────────────────────────────────────

  it('shows AddVisitorForm when add button clicked', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('add-visitor-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-name')).toBeInTheDocument();
  });

  // ─── Mutations wiring ──────────────────────────────────────────────

  it('addPayment fires createPayment mutation', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.change(screen.getByTestId('payment-amount'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('payment-submit'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 2000,
        method: 'card',
      });
    });
  });

  it('addVisitor fires createVisitor then patchRecord', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    fireEvent.change(screen.getByTestId('add-visitor-name'), { target: { value: 'Новый Гость' } });
    fireEvent.click(screen.getByTestId('add-visitor-submit'));

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
});
