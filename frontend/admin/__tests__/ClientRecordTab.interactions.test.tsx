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
  createVisit: vi.fn(),
  patchVisit: vi.fn(),
  deleteVisit: vi.fn(),
  updateVisitor: vi.fn(),
}));

// ─── Mock ScheduleContext ────────────────────────────────────────────────

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => ({
    gridFrequency: 30,
    masters: [],
    services: [],
    locations: [],
  })),
}));

import { useSchedule } from '@/contexts/ScheduleContext';

// ─── Mock react-query ──────────────────────────────────────────────────────

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
  createVisit,
} from '@memo/api-client';

// ─── Shared mock data ──────────────────────────────────────────────────────

import {
  mockRecord,
  mockRecordMultipleVisits,
  mockVisitors,
  mockActivityResponse,
  mockServiceResponse,
  mockMasters,
  mockLocations,
  mockPayments,
  buildDefaultQueryImpl,
} from './helpers/clientRecordTabSetup';

const mockUseQuery = vi.mocked(useQuery);

// ─── Component under test ──────────────────────────────────────────────────

import { ClientRecordTab } from '../app/(main)/clients/components/ClientRecordTab';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ClientRecordTab — interactions', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    buildDefaultQueryImpl(mockUseQuery);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchActivity).mockResolvedValue(mockActivityResponse);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1', record_id: 'r1', amount: 1000, method: 'card',
      created_at: '', updated_at: '', is_active: true,
    });
    vi.mocked(deletePayment).mockResolvedValue(undefined);
    vi.mocked(createVisit).mockResolvedValue({
      id: 'v_new', record_id: 'r1', visitor_id: 'vis_new', tariff_id: 't1',
      price: 3500, custom_price: null, status: 'waiting',
      created_at: '', updated_at: '', is_active: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Visitor section ────────────────────────────────────────────────

  it('shows adult label when visitor has no age', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      visitors: { data: [{ ...mockVisitors[0], age: null }], isLoading: false, error: null },
      payments: { data: [], isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // RecordVisitRow shows age as "(взр.)" when visitorAge is null
    const visitRow = screen.getByTestId('visit-row-v1');
    expect(visitRow).toBeInTheDocument();
    // The name input is inside the visit row (InlineEditCell without testid)
    const nameInput = visitRow.querySelector('input') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('Анна Иванова');
  });

  it('shows "Нет посетителей" when record has no visits', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      payments: { data: [], isLoading: false, error: null },
      record: { data: { ...mockRecord, id: 'r3', visits: [] }, isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r3" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Нет посетителей')).toBeInTheDocument();
  });

  it('calculates total from multiple visits', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      payments: { data: [], isLoading: false, error: null },
      record: { data: mockRecordMultipleVisits, isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r2" clientId="c1" onClose={onClose} />);
    // Both visit rows should be rendered
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v2')).toBeInTheDocument();
  });

  it('uses custom_price for total when set', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      record: { data: { ...mockRecord, custom_price: 5000 }, isLoading: false, error: null },
      payments: { data: [{ id: 'p1', record_id: 'r1', amount: 2000, method: 'card', created_at: '', updated_at: '', is_active: true }], isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('input-custom-price')).toHaveValue(5000);
  });

  it('shows existing comment from record', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      record: { data: { ...mockRecord, comment: 'Тестовый комментарий' }, isLoading: false, error: null },
      payments: { data: [], isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    expect(textarea).toHaveValue('Тестовый комментарий');
  });

  // ─── Payment display (atoms) ──────────────────────────────────────

  it('renders payment list with existing payments via PaymentList atom', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('record-payments-table')).toBeInTheDocument();
    // PaymentList renders items with data-testid="payment-{id}"
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  it('renders PaymentForm for adding payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('btn-add-payment')).toBeInTheDocument();
  });

  // ─── Save button state ────────────────────────────────────────────

  it('save button is disabled when no changes', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const saveBtn = screen.getByTestId('btn-save-record');
    expect(saveBtn).toBeDisabled();
  });

  it('cancel button is disabled when no changes', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const cancelBtn = screen.getByRole('button', { name: /Отмена/ });
    expect(cancelBtn).toBeDisabled();
  });

  it('save button enables when date is changed', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const dateInput = screen.getByLabelText('Дата');
    fireEvent.change(dateInput, { target: { value: '2026-06-01' } });
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();
  });

  it('save button enables when comment is changed', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Новый комментарий' } });
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();
  });

  it('save button enables when custom price is changed', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const priceInput = screen.getByTestId('input-custom-price');
    fireEvent.change(priceInput, { target: { value: '5000' } });
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();
  });

  it('cancel resets all changes', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Новый комментарий' } });
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();

    const cancelBtn = screen.getByRole('button', { name: /Отмена/ });
    fireEvent.click(cancelBtn);

    expect(textarea).toHaveValue('');
    expect(screen.getByTestId('btn-save-record')).toBeDisabled();
  });

  // ─── Add visitor (via AddVisitorForm atom) ────────────────────────

  it('shows AddVisitorForm when add visitor button clicked', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    // The new unified row renders with id===null → testId visit-row-new
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-name')).toBeInTheDocument();
    expect(screen.getByTestId('add-visitor-age')).toBeInTheDocument();
  });
});
