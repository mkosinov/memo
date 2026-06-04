import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { RecordResponse } from '@memo/api-client';

// ─── Mock api-client functions ─────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  deletePayment: vi.fn(),
}));

import {
  getRecord,
  updateRecord,
  deleteRecord,
  createPayment,
} from '@memo/api-client';

// ─── Mock react-query ──────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries };

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => mockQueryClient),
  useMutation: vi.fn(),
}));

import { useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Mock data ─────────────────────────────────────────────────────────────

const mockRecord: RecordResponse = {
  id: 'r1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [
    {
      id: 'v1',
      record_id: 'r1',
      visitor_id: 'vis1',
      price: 3500,
      status: 'waiting',
      created_at: '',
      updated_at: '',
      is_active: true,
    },
  ],
};

const mockRecordMultipleVisits: RecordResponse = {
  ...mockRecord,
  id: 'r2',
  visits: [
    { ...mockRecord.visits[0], id: 'v1', price: 3500 },
    { ...mockRecord.visits[0], id: 'v2', visitor_id: 'vis2', price: 2500 },
  ],
};

const mockUseQuery = vi.mocked(useQuery);

// Static import — vi.mock is hoisted so mocks apply before module execution
import { ClientRecordTab } from '../app/(main)/clients/components/ClientRecordTab';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ClientRecordTab', () => {
  const onClose = vi.fn();
  const mockMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: react-query returns data
    mockUseQuery.mockReturnValue({
      data: mockRecord,
      isLoading: false,
      error: null,
    } as any);

    vi.mocked(updateRecord).mockResolvedValue(mockRecord);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1',
      record_id: 'r1',
      amount: 1000,
      method: 'card',
      created_at: '',
      updated_at: '',
      is_active: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('shows not found state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any);


    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Запись не найдена')).toBeInTheDocument();
  });

  it('renders event info section', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Мероприятие')).toBeInTheDocument();
  });

  it('renders status dropdown with current status', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('confirmed');
  });

  it('renders all status options', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');
    const options = Array.from(statusSelect.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toContain('pending');
    expect(values).toContain('confirmed');
    expect(values).toContain('cancelled');
    expect(values).toContain('no_show');
  });

  it('renders visitors section', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Посетители')).toBeInTheDocument();
  });

  it('renders visitor rows', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText(/vis1/)).toBeInTheDocument();
  });

  it('renders payment summary with total cost', () => {
    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Оплата')).toBeInTheDocument();
    // 3 500 ₽ appears both in visitor row and payment total — use getAllByText
    const matches = screen.getAllByText(/3[\s]?500\s?₽/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('calculates total from multiple visits', () => {
    mockUseQuery.mockReturnValue({
      data: mockRecordMultipleVisits,
      isLoading: false,
      error: null,
    } as any);


    render(<ClientRecordTab recordId="r2" onClose={onClose} />);
    // 3500 + 2500 = 6000
    expect(screen.getByText(/6[\s]?000\s?₽/)).toBeInTheDocument();
  });

  it('renders add payment form', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByPlaceholderText('Сумма')).toBeInTheDocument();
    expect(screen.getByText('Добавить')).toBeInTheDocument();
  });

  it('renders delete button', () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
  });

  it('calls updateRecord when status changes', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(updateRecord).toHaveBeenCalledWith('r1', { status: 'cancelled' });
    });
  });

  it('invalidates records query after status change', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  it('calls deleteRecord and onClose when delete clicked', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('r1');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('invalidates records query after delete', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  it('calls createPayment when add button clicked with amount', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '1500' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 1500,
        method: 'card',
      });
    });
  });

  it('does not call createPayment with zero amount', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    // Should not be called because amount is not > 0
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('allows changing payment method', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    const methodSelect = screen.getByDisplayValue('Карта');
    fireEvent.change(methodSelect, { target: { value: 'cash' } });

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '2000' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 2000,
        method: 'cash',
      });
    });
  });

  it('clears payment amount after successful add', async () => {

    render(<ClientRecordTab recordId="r1" onClose={onClose} />);

    const amountInput = screen.getByPlaceholderText('Сумма');
    fireEvent.change(amountInput, { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(amountInput).toHaveValue(null);
    });
  });
});
