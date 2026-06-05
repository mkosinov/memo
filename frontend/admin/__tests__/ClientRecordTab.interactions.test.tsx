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

// ─── Mock react-query ──────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries };

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Status change via CustomSelect ────────────────────────────────────

  it('status changes through CustomSelect dropdown', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const triggers = screen.getAllByTestId('custom-select-trigger');
    fireEvent.click(triggers[1]);
    fireEvent.click(screen.getByTestId('custom-select-option-visited'));
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();
  });

  // ─── Visitor section with custom mocks ────────────────────────────────

  it('shows adult label when visitor has no age', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      visitors: { data: [{ ...mockVisitors[0], age: null }], isLoading: false, error: null },
      payments: { data: [], isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('(взр.)')).toBeInTheDocument();
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
    const priceInputs = screen.getAllByTestId('input-visit-price');
    expect(priceInputs[0]).toHaveValue(3500);
    expect(priceInputs[1]).toHaveValue(2500);
  });

  it('uses custom_price for total when set', () => {
    buildDefaultQueryImpl(mockUseQuery, {
      record: { data: { ...mockRecord, custom_price: 5000 }, isLoading: false, error: null },
      payments: { data: [{ id: 'p1', record_id: 'r1', amount: 2000, method: 'card', created_at: '', updated_at: '', is_active: true }], isLoading: false, error: null },
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('input-custom-price')).toHaveValue(5000);
    expect(screen.getByText('2 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('3 000 ₽')).toBeInTheDocument();
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

  // ─── Payment display ──────────────────────────────────────────────────

  it('renders payment list with existing payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payment-list')).toBeInTheDocument();
    const rows = screen.getAllByTestId('payment-row');
    expect(rows.length).toBe(1);
    expect(screen.getByText(/1 500 ₽ \(карта\)/)).toBeInTheDocument();
  });

  it('displays all payment methods in CustomSelect', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const triggers = screen.getAllByTestId('custom-select-trigger');
    const paymentMethodTrigger = triggers[triggers.length - 1];
    fireEvent.click(paymentMethodTrigger);
    const dropdown = screen.getByTestId('custom-select-dropdown');
    expect(dropdown).toHaveTextContent('Карта');
    expect(dropdown).toHaveTextContent('Наличные');
    expect(dropdown).toHaveTextContent('Перевод');
  });

  it('renders add payment form', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByPlaceholderText('Сумма')).toBeInTheDocument();
    expect(screen.getByText('Добавить оплату')).toBeInTheDocument();
  });

  // ─── Save button state ────────────────────────────────────────────────

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

  it('save button enables when status is changed via CustomSelect', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const triggers = screen.getAllByTestId('custom-select-trigger');
    fireEvent.click(triggers[1]);
    fireEvent.click(screen.getByTestId('custom-select-option-visited'));
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

  // ─── Add visitor (combobox) ───────────────────────────────────────────

  it('shows inline form when add visitor button clicked', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('input-visitor-name')).toBeInTheDocument();
    expect(screen.getByTestId('input-visitor-age')).toBeInTheDocument();
    expect(screen.getByTestId('btn-create-visitor')).toBeInTheDocument();
  });

  it('shows existing visitors in dropdown when typing in visitor name input', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    const nameInput = screen.getByTestId('input-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Анн' } });

    expect(screen.getByTestId('visitor-option-vis1')).toBeInTheDocument();
  });
});
