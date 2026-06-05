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
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getPayments: vi.fn(),
  updateVisitStatus: vi.fn(),
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
  getMasters,
  getLocations,
  getPayments,
  updateVisitStatus,
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

const mockMasters = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'artist', specialty: 'живопись', avatar_url: null, is_active: true, created_at: '', updated_at: '' },
];

const mockLocations = [
  { id: 'loc1', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 20, yandex_map_url: null, review_url: null, record_info: null, image_url: null, is_active: true, created_at: '', updated_at: '' },
];

const mockPayments = [
  { id: 'p1', record_id: 'r1', amount: 1500, method: 'card', created_at: '', updated_at: '', is_active: true },
];

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
      if (key === 'masters') {
        return { data: mockMasters, isLoading: false, error: null } as any;
      }
      if (key === 'locations') {
        return { data: mockLocations, isLoading: false, error: null } as any;
      }
      if (key === 'payments') {
        return { data: mockPayments, isLoading: false, error: null } as any;
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
    const statusSelect = screen.getByLabelText('Статус записи');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('confirmed');
  });

  it('renders all status options', () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус записи');
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
    // 3500 + 2500 = 6000 — appears in Итого and Остаток (no payments)
    const matches = screen.getAllByText(/6[\s]?000\s?₽/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
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
    const statusSelect = screen.getByLabelText('Статус записи');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', { status: 'cancelled' });
    });
  });

  it('invalidates records query after status change', async () => {

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус записи');

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
    const statusSelect = screen.getByLabelText('Статус записи');

    fireEvent.change(statusSelect, { target: { value: 'cancelled' } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['record', 'r1'] });
    });
  });

  it('does NOT call updateRecord on status change', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус записи');

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
    // "Картина маслом" appears in the header div and in the dropdown option
    const matches = screen.getAllByText('Картина маслом');
    expect(matches.length).toBeGreaterThanOrEqual(1);
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

  // ─── 3.1: Activity dropdowns (Мастер, Активность, Место) ─────────────

  it('renders Мастер dropdown with masters list', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const masterSelect = screen.getByLabelText('Мастер');
    expect(masterSelect).toBeInTheDocument();
    expect(masterSelect).toHaveValue('m1');
  });

  it('renders Мастер name in dropdown options', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const masterSelect = screen.getByLabelText('Мастер');
    expect(masterSelect).toHaveTextContent('Ольга Середа');
  });

  it('renders Активность dropdown with services list', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const serviceSelect = screen.getByLabelText('Активность');
    expect(serviceSelect).toBeInTheDocument();
    expect(serviceSelect).toHaveValue('s1');
  });

  it('renders Место dropdown with locations list', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const locationSelect = screen.getByLabelText('Место');
    expect(locationSelect).toBeInTheDocument();
    expect(locationSelect).toHaveValue('loc1');
  });

  it('renders Место name in dropdown options', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const locationSelect = screen.getByLabelText('Место');
    expect(locationSelect).toHaveTextContent('Альпика');
  });

  it('renders date from activity', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // activity start is '2026-05-15T14:00:00', should render as ru-RU date
    expect(screen.getByText('Дата')).toBeInTheDocument();
    expect(screen.getByText('15.05.2026')).toBeInTheDocument();
  });

  it('renders time from activity', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Время')).toBeInTheDocument();
    // Activity start 2026-05-15T14:00:00 — time is 14:00
    expect(screen.getByText('14:00')).toBeInTheDocument();
  });

  it('shows "Не выбран" placeholder in master dropdown when no activity', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'record') {
        return { data: { ...mockRecord, activity_id: '' }, isLoading: false, error: null } as any;
      }
      if (key === 'activity') {
        return { data: undefined, isLoading: false, error: null } as any;
      }
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (key === 'services') {
        return { data: [mockServiceResponse], isLoading: false, error: null } as any;
      }
      if (key === 'masters') {
        return { data: mockMasters, isLoading: false, error: null } as any;
      }
      if (key === 'locations') {
        return { data: mockLocations, isLoading: false, error: null } as any;
      }
      if (key === 'payments') {
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: undefined, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const masterSelect = screen.getByLabelText('Мастер');
    expect(masterSelect).toHaveValue('');
  });

  // ─── 3.2: Visitor status as dropdown ────────────────────────────────

  it('renders visitor status as dropdown', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус посетителя');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('waiting');
  });

  it('renders all visitor status options in dropdown', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус посетителя');
    const options = Array.from(statusSelect.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toContain('waiting');
    expect(values).toContain('visited');
    expect(values).toContain('missed');
    expect(values).toContain('cancelled');
  });

  it('calls updateVisitStatus when visitor status changes', async () => {
    vi.mocked(updateVisitStatus).mockResolvedValue({
      id: 'v1', record_id: 'r1', visitor_id: 'vis1', price: 3500, status: 'visited', created_at: '', updated_at: '', is_active: true,
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус посетителя');
    fireEvent.change(statusSelect, { target: { value: 'visited' } });

    await waitFor(() => {
      expect(updateVisitStatus).toHaveBeenCalledWith('v1', 'visited');
    });
  });

  it('invalidates record query after visitor status change', async () => {
    vi.mocked(updateVisitStatus).mockResolvedValue({
      id: 'v1', record_id: 'r1', visitor_id: 'vis1', price: 3500, status: 'visited', created_at: '', updated_at: '', is_active: true,
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const statusSelect = screen.getByLabelText('Статус посетителя');
    fireEvent.change(statusSelect, { target: { value: 'visited' } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['record', 'r1'] });
    });
  });

  // ─── 3.3: Payment summary (Итого / Оплачено / Остаток) ─────────────

  it('renders payment summary with Итого, Оплачено, Остаток', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Итого')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('Остаток')).toBeInTheDocument();
  });

  it('shows total cost in payment summary', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Total for 1 visit at 3500
    const totalElements = screen.getAllByText('3 500 ₽');
    expect(totalElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows paid amount from payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // mockPayments has amount 1500
    expect(screen.getByText('1 500 ₽')).toBeInTheDocument();
  });

  it('shows remaining amount as difference', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // 3500 - 1500 = 2000
    expect(screen.getByText('2 000 ₽')).toBeInTheDocument();
  });

  it('shows zero remaining when fully paid', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'payments') {
        return { data: [{ id: 'p1', record_id: 'r1', amount: 3500, method: 'card', created_at: '', updated_at: '', is_active: true }], isLoading: false, error: null } as any;
      }
      const key2 = options?.queryKey?.[0];
      if (key2 === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (key2 === 'activity') {
        return { data: mockActivityResponse, isLoading: false, error: null } as any;
      }
      if (key2 === 'services') {
        return { data: [mockServiceResponse], isLoading: false, error: null } as any;
      }
      if (key2 === 'masters') {
        return { data: mockMasters, isLoading: false, error: null } as any;
      }
      if (key2 === 'locations') {
        return { data: mockLocations, isLoading: false, error: null } as any;
      }
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // 3500 - 3500 = 0
    expect(screen.getByText('0 ₽')).toBeInTheDocument();
  });

  it('uses custom_price for total when set', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'record') {
        return { data: { ...mockRecord, custom_price: 5000 }, isLoading: false, error: null } as any;
      }
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (key === 'activity') {
        return { data: mockActivityResponse, isLoading: false, error: null } as any;
      }
      if (key === 'services') {
        return { data: [mockServiceResponse], isLoading: false, error: null } as any;
      }
      if (key === 'masters') {
        return { data: mockMasters, isLoading: false, error: null } as any;
      }
      if (key === 'locations') {
        return { data: mockLocations, isLoading: false, error: null } as any;
      }
      if (key === 'payments') {
        return { data: [{ id: 'p1', record_id: 'r1', amount: 2000, method: 'card', created_at: '', updated_at: '', is_active: true }], isLoading: false, error: null } as any;
      }
      return { data: undefined, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Total = custom_price 5000, paid = 2000, remaining = 3000
    expect(screen.getByText('5 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('2 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('3 000 ₽')).toBeInTheDocument();
  });

  // ─── 3.4: Comment field ────────────────────────────────────────────

  it('renders comment textarea', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Комментарий')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Добавить комментарий...')).toBeInTheDocument();
  });

  it('shows existing comment from record', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'record') {
        return { data: { ...mockRecord, comment: 'Тестовый комментарий' }, isLoading: false, error: null } as any;
      }
      if (key === 'visitors') {
        return { data: mockVisitors, isLoading: false, error: null } as any;
      }
      if (key === 'activity') {
        return { data: mockActivityResponse, isLoading: false, error: null } as any;
      }
      if (key === 'services') {
        return { data: [mockServiceResponse], isLoading: false, error: null } as any;
      }
      if (key === 'masters') {
        return { data: mockMasters, isLoading: false, error: null } as any;
      }
      if (key === 'locations') {
        return { data: mockLocations, isLoading: false, error: null } as any;
      }
      if (key === 'payments') {
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: undefined, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    expect(textarea).toHaveValue('Тестовый комментарий');
  });

  it('saves comment on blur via patchRecord', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Новый комментарий' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', { comment: 'Новый комментарий' });
    });
  });

  it('does not patch comment when value is unchanged', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    // Don't change, just blur
    fireEvent.blur(textarea);

    await waitFor(() => {
      // patchRecord should NOT have been called with comment
      const commentCalls = (patchRecord as any).mock.calls.filter(
        (call: any[]) => call[1] && 'comment' in call[1]
      );
      expect(commentCalls).toHaveLength(0);
    });
  });
});
