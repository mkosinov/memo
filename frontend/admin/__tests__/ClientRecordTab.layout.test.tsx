import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
} from '@memo/api-client';

// ─── Shared mock data ──────────────────────────────────────────────────────

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

// ─── Component under test ──────────────────────────────────────────────────

import { ClientRecordTab } from '../app/(main)/clients/components/ClientRecordTab';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ClientRecordTab — layout', () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Loading / NotFound ────────────────────────────────────────────────

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('shows not found state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any);

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Запись не найдена')).toBeInTheDocument();
  });

  // ─── Date / Time / Service ─────────────────────────────────────────────

  it('renders date input with activity date', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const dateInput = screen.getByLabelText('Дата') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-05-15');
  });

  it('renders time input with activity time', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const timeInput = screen.getByLabelText('Время') as HTMLInputElement;
    expect(timeInput.value).toBe('14:00');
  });

  it('renders service dropdown with current service', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });

  it('renders all service options in dropdown', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const triggers = screen.getAllByTestId('custom-select-trigger');
    // Triggers: [0]=location, [1]=service
    fireEvent.click(triggers[1]);
    const dropdown = screen.getByTestId('custom-select-dropdown');
    expect(dropdown).toHaveTextContent('Не выбрана');
  });

  // ─── Master / Location ─────────────────────────────────────────────────

  it('renders master dropdown with current master', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
  });

  it('renders location dropdown with current location', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Альпика')).toBeInTheDocument();
  });

  // ─── Visit status (atom-based StatusPicker) ────────────────────────────

  it('renders visit status via StatusPicker atom', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // RecordVisitRow renders StatusPicker — verify the row exists with status picker
    const visitRow = screen.getByTestId('visit-row-v1');
    expect(visitRow.querySelector('[data-testid$="-status-trigger"]')).toBeInTheDocument();
  });

  // ─── Visitors section ─────────────────────────────────────────────────

  it('renders visitors section', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Посетители')).toBeInTheDocument();
  });

  it('renders visitor rows via RecordVisitRow atom', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // RecordVisitRow renders with data-testid="visit-row-{id}"
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });

  it('renders visitor name input inside RecordVisitRow', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const visitRow = screen.getByTestId('visit-row-v1');
    const nameInput = visitRow.querySelector('input') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('Анна Иванова');
  });

  it('renders tariff select inside RecordVisitRow', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('visit-v1-tariff')).toBeInTheDocument();
  });

  // ─── Payment section (atoms) ──────────────────────────────────────────

  it('renders payment summary', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Оплаты')).toBeInTheDocument();
  });

  it('renders PaymentTotals with correct values', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payments-total')).toBeInTheDocument();
    // Paid=1500 (from mockPayments), total cost shows in input-custom-price
    expect(screen.getAllByText('1 500 ₽').length).toBeGreaterThan(0);
  });

  it('shows total cost in custom-price input', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const customPriceInput = screen.getByTestId('input-custom-price');
    expect(customPriceInput).toHaveValue(3500);
  });

  it('renders PaymentList with existing payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('record-payments-table')).toBeInTheDocument();
    expect(screen.getByTestId('payment-p1')).toBeInTheDocument();
  });

  it('renders PaymentForm for adding payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('btn-add-payment')).toBeInTheDocument();
  });

  // ─── Comment / Delete / Visitor button ────────────────────────────────

  it('renders comment textarea', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Комментарий')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Добавить комментарий...')).toBeInTheDocument();
  });

  it('renders delete button', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
  });

  it('renders add visitor button', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('btn-add-visitor')).toBeInTheDocument();
  });

  it('displays activity service name in CustomSelect', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });
});
