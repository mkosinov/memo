import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { RecordResponse } from '@memo/api-client';

// ─── Mock api-client functions ─────────────────────────────────────────────

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
}));

import {
  getRecord,
  updateRecord,
  patchRecord,
  deleteRecord,
  createPayment,
  getClientVisitors,
  getActivity,
  getServices,
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
  custom_price: null,
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

const mockVisitors = [
  { id: 'vis1', client_id: 'c1', name: 'Анна Иванова', age: 30, created_at: '', updated_at: '', is_active: true },
  { id: 'vis2', client_id: 'c1', name: 'Мария Петрова', age: 25, created_at: '', updated_at: '', is_active: true },
];

const mockActivityResponse = {
  id: 'ev_1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc1',
  start: '2026-05-15T14:00:00',
  duration: 150,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2026-05-01T00:00:00',
  updated_at: '2026-05-01T00:00:00',
  is_active: true,
  occupied: 3,
};

const mockServiceResponse = {
  id: 's1',
  title: 'Картина маслом',
  description: 'Рисуем картину маслом',
  image_url: '',
  specialty: 'живопись',
  min_age: 6,
  max_age: 99,
  duration: 150,
  record_info: '',
  tariffs: [],
  tags: [],
  is_active: true,
  created_at: '',
  updated_at: '',
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

    // Default: react-query returns data for all queries
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (key === 'activity') {
        return { data: mockActivityResponse, isLoading: false, error: null } as any;
      }
      if (key === 'services') {
        return { data: [mockServiceResponse], isLoading: false, error: null } as any;
      }
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    vi.mocked(updateRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
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

  it('renders event info section', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Мероприятие')).toBeInTheDocument();
  });

  it('renders status dropdown with current status', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('confirmed');
  });

  it('renders all status options', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');
    const options = Array.from(statusSelect.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toContain('pending');
    expect(values).toContain('confirmed');
    expect(values).toContain('cancelled');
    expect(values).toContain('no_show');
  });

  it('renders visitors section', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Посетители')).toBeInTheDocument();
  });

  it('renders visitor rows with actual names', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('renders payment summary with total cost', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Оплата')).toBeInTheDocument();
    // 3 500 ₽ appears both in visitor row and payment total — use getAllByText
    const matches = screen.getAllByText(/3[\s]?500\s?₽/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('calculates total from multiple visits', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      return { data: mockRecordMultipleVisits, isLoading: false, error: null } as any;
    });


    render(<ClientRecordTab recordId="r2" clientId="c1" onClose={onClose} />);
    // 3500 + 2500 = 6000
    expect(screen.getByText(/6[\s]?000\s?₽/)).toBeInTheDocument();
  });

  it('renders add payment form', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByPlaceholderText('Сумма')).toBeInTheDocument();
    expect(screen.getByText('Добавить')).toBeInTheDocument();
  });

  it('renders delete button', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
  });

  it('calls patchRecord when status changes', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', { status: 'cancelled' });
    });
  });

  it('invalidates records query after status change', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  it('calls deleteRecord and onClose when delete clicked', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('r1');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('invalidates records query after delete', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  it('calls createPayment when add button clicked with amount', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

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

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    // Should not be called because amount is not > 0
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('allows changing payment method', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

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

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    const amountInput = screen.getByPlaceholderText('Сумма');
    fireEvent.change(amountInput, { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(amountInput).toHaveValue(null);
    });
  });

  // ─── Payment form edge cases ────────────────────────────────────────────

  it('does not call createPayment with empty string amount', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    expect(createPayment).not.toHaveBeenCalled();
  });

  it('does not call createPayment with negative amount', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '-500' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    expect(createPayment).not.toHaveBeenCalled();
  });

  it('sends transfer method when payment method is changed to transfer', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    const methodSelect = screen.getByDisplayValue('Карта');
    fireEvent.change(methodSelect, { target: { value: 'transfer' } });

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '3000' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 3000,
        method: 'transfer',
      });
    });
  });

  it('invalidates payments query after successful payment', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  it('shows "Нет посетителей" when record has no visits', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      return { data: { ...mockRecord, id: 'r3', visits: [] }, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r3" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Нет посетителей')).toBeInTheDocument();
  });

  it('displays all payment method options', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    const methodSelect = screen.getByDisplayValue('Карта');
    const options = Array.from(methodSelect.querySelectorAll('option'));
    const values = options.map(o => o.value);
    expect(values).toContain('card');
    expect(values).toContain('cash');
    expect(values).toContain('transfer');
  });

  it('displays status icon for each status type', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Each status has an SVG icon — confirmed status shows checkmark
    const statusSelect = screen.getByTestId('select-record-status');
    expect(statusSelect).toBeInTheDocument();
  });

  it('shows total cost with locale formatting', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // 3500 should be formatted as "3 500 ₽" — appears in both visitor row and payment total
    const matches = screen.getAllByText('3 500 ₽');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  // ─── PATCH-based status and price ────────────────────────────────────────

  it('invalidates record query after status change', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['record', 'r1'] });
    });
  });

  it('does NOT call updateRecord on status change', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус');

    fireEvent.change(statusSelect, { target: { value: 'confirmed' } });

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalled();
    });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('calls patchRecord for custom_price on blur', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const priceInput = screen.getByTestId('input-custom-price');

    fireEvent.change(priceInput, { target: { value: '5000' } });
    fireEvent.blur(priceInput);

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', { custom_price: 5000 });
    });
  });

  // ─── Activity name display ───────────────────────────────────────────────

  it('displays activity service name', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });

  // ─── Payment invalidation ────────────────────────────────────────────────

  it('invalidates record query after adding payment', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Сумма'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['record', 'r1'] });
    });
  });

  // ─── Visitor price editing ──────────────────────────────────────────────

  it('allows editing visit price inline', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Should have a price input for each visit
    const priceInputs = screen.getAllByTestId('visit-price-input');
    expect(priceInputs.length).toBe(mockRecord.visits.length);
  });

  it('calls patchRecord when visit price is changed and blurred', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Click the price span to enter edit mode
    const priceSpan = screen.getAllByTestId('visit-price-input')[0];
    fireEvent.click(priceSpan);

    // Now it should be an input
    const priceInput = screen.getAllByTestId('visit-price-input')[0];
    fireEvent.change(priceInput, { target: { value: '4000' } });
    fireEvent.blur(priceInput);

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          visits: expect.arrayContaining([
            expect.objectContaining({ price: 4000 }),
          ]),
        }),
      );
    });
  });
});
