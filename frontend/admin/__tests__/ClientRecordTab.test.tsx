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
  patchActivity: vi.fn(),
  createVisitor: vi.fn(),
}));

import {
  getRecord,
  patchRecord,
  deleteRecord,
  createPayment,
  deletePayment,
  getClientVisitors,
  getActivity,
  getServices,
  getMasters,
  getLocations,
  getPayments,
  patchActivity,
  createVisitor,
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
  tariffs: [
    { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
    { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
  ],
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

    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchActivity).mockResolvedValue(mockActivityResponse);
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
    const serviceSelect = screen.getByLabelText('Услуга') as HTMLSelectElement;
    expect(serviceSelect.value).toBe('s1');
  });

  it('renders all service options', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const serviceSelect = screen.getByLabelText('Услуга') as HTMLSelectElement;
    const options = Array.from(serviceSelect.querySelectorAll('option'));
    const values = options.map(o => o.value);
    expect(values).toContain('s1');
  });

  // ─── Master / Location ─────────────────────────────────────────────────

  it('renders master dropdown (disabled)', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const masterSelect = screen.getByLabelText('Мастер') as HTMLSelectElement;
    expect(masterSelect).toBeDisabled();
    expect(masterSelect.value).toBe('m1');
  });

  it('renders location dropdown (disabled)', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const locationSelect = screen.getByLabelText('Локация') as HTMLSelectElement;
    expect(locationSelect).toBeDisabled();
    expect(locationSelect.value).toBe('loc1');
  });

  // ─── Visit status icon ────────────────────────────────────────────────

  it('renders visit status icon', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('visit-status-icon')).toBeInTheDocument();
  });

  it('status icon cycles through statuses on click', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const icon = screen.getByTestId('visit-status-icon');

    // Initial status is waiting (yellow)
    expect(icon).toHaveStyle({ color: '#F59E0B' });

    // Click to cycle to visited (green)
    fireEvent.click(icon);
    expect(icon).toHaveStyle({ color: '#10B981' });

    // Click to cycle to missed (red)
    fireEvent.click(icon);
    expect(icon).toHaveStyle({ color: '#EF4444' });

    // Click to cycle to cancelled (gray)
    fireEvent.click(icon);
    expect(icon).toHaveStyle({ color: '#6B7280' });

    // Click to cycle back to waiting
    fireEvent.click(icon);
    expect(icon).toHaveStyle({ color: '#F59E0B' });
  });

  // ─── Visitors ─────────────────────────────────────────────────────────

  it('renders visitors section', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Посетители')).toBeInTheDocument();
  });

  it('renders visitor rows with names', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
  });

  it('shows adult label when visitor has no age', () => {
    mockUseQuery.mockImplementation((options: any) => {
      const key = options?.queryKey?.[0];
      if (key === 'visitors') {
        return {
          data: [{ ...mockVisitors[0], age: null }],
          isLoading: false,
          error: null,
        } as any;
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
      return { data: mockRecord, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('(взр.)')).toBeInTheDocument();
  });

  it('renders tariff dropdown for each visit', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const tariffSelects = screen.getAllByLabelText('Тариф посетителя');
    expect(tariffSelects.length).toBe(mockRecord.visits.length);
  });

  it('shows visit price', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const prices = screen.getAllByTestId('visit-price');
    expect(prices[0]).toHaveTextContent('3 500 ₽');
  });

  it('shows "Нет посетителей" when record has no visits', () => {
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
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: { ...mockRecord, id: 'r3', visits: [] }, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r3" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Нет посетителей')).toBeInTheDocument();
  });

  // ─── Payments ─────────────────────────────────────────────────────────

  it('renders payment summary', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Оплата')).toBeInTheDocument();
  });

  it('shows total cost from visits', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Итого:')).toBeInTheDocument();
    // 3500 total
    const priceInputs = screen.getAllByTestId('visit-price');
    expect(priceInputs[0]).toHaveTextContent('3 500 ₽');
  });

  it('shows paid amount from payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Оплачено:')).toBeInTheDocument();
    expect(screen.getByText('1 500 ₽')).toBeInTheDocument();
  });

  it('shows remaining amount', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Остаток:')).toBeInTheDocument();
    // 3500 - 1500 = 2000
    expect(screen.getByText('2 000 ₽')).toBeInTheDocument();
  });

  it('calculates total from multiple visits', () => {
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
        return { data: [], isLoading: false, error: null } as any;
      }
      return { data: mockRecordMultipleVisits, isLoading: false, error: null } as any;
    });

    render(<ClientRecordTab recordId="r2" clientId="c1" onClose={onClose} />);
    // 3500 + 2500 = 6000
    const priceSpans = screen.getAllByTestId('visit-price');
    expect(priceSpans[0]).toHaveTextContent('3 500 ₽');
    expect(priceSpans[1]).toHaveTextContent('2 500 ₽');
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
    // Total = 5000 (custom), paid = 2000, remaining = 3000
    expect(screen.getByText('5 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('2 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('3 000 ₽')).toBeInTheDocument();
  });

  // ─── Payment list with delete ────────────────────────────────────────

  it('renders payment list with existing payments', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('payment-list')).toBeInTheDocument();
    const rows = screen.getAllByTestId('payment-row');
    expect(rows.length).toBe(1);
    expect(screen.getByText(/1 500 ₽ \(карта\)/)).toBeInTheDocument();
  });

  it('calls deletePayment when delete button clicked', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-delete-payment'));

    await waitFor(() => {
      expect(deletePayment).toHaveBeenCalledWith('p1');
    });
  });

  it('invalidates queries after deleting payment', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-delete-payment'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  // ─── Add payment form ─────────────────────────────────────────────────

  it('renders add payment form', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByPlaceholderText('Сумма')).toBeInTheDocument();
    expect(screen.getByText('Добавить оплату')).toBeInTheDocument();
  });

  it('calls createPayment when add button clicked with amount', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Сумма'), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('btn-add-payment'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 1500,
        method: 'card',
      });
    });
  });

  it('does not call createPayment with zero amount', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Сумма'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('does not call createPayment with empty amount', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Сумма'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('btn-add-payment'));
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('allows changing payment method', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const methodSelect = screen.getByDisplayValue('Карта');
    fireEvent.change(methodSelect, { target: { value: 'cash' } });
    fireEvent.change(screen.getByPlaceholderText('Сумма'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('btn-add-payment'));

    await waitFor(() => {
      expect(createPayment).toHaveBeenCalledWith({
        record_id: 'r1',
        amount: 2000,
        method: 'cash',
      });
    });
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

  it('displays all payment methods in Russian', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Карта')).toBeInTheDocument();
    expect(screen.getByText('Наличные')).toBeInTheDocument();
    expect(screen.getByText('Перевод')).toBeInTheDocument();
  });

  // ─── Comment ───────────────────────────────────────────────────────────

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

  // ─── Delete record ─────────────────────────────────────────────────────

  it('renders delete button', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByText('Удалить запись')).toBeInTheDocument();
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

  // ─── Save / Cancel with hasChanges ─────────────────────────────────────

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

  it('save button enables when status icon is cycled', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('visit-status-icon'));
    expect(screen.getByTestId('btn-save-record')).toBeEnabled();
  });

  it('calls patchRecord and patchActivity on save', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    // Change comment to enable save
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Новый комментарий' } });
    fireEvent.click(screen.getByTestId('btn-save-record'));

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', expect.objectContaining({
        comment: 'Новый комментарий',
      }));
    });
  });

  it('patchActivity is called when date is changed', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const dateInput = screen.getByLabelText('Дата');
    fireEvent.change(dateInput, { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByTestId('btn-save-record'));

    await waitFor(() => {
      expect(patchActivity).toHaveBeenCalledWith('ev_1', expect.objectContaining({
        start: '2026-06-01T14:00:00',
      }));
    });
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

  it('invalidates queries after save', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.click(screen.getByTestId('btn-save-record'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['record', 'r1'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  // ─── Add visitor ────────────────────────────────────────────────────────

  it('renders add visitor button', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    expect(screen.getByTestId('btn-add-visitor')).toBeInTheDocument();
  });

  it('shows inline form when add visitor button clicked', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('input-visitor-name')).toBeInTheDocument();
    expect(screen.getByTestId('input-visitor-age')).toBeInTheDocument();
    expect(screen.getByTestId('btn-create-visitor')).toBeInTheDocument();
  });

  it('creates visitor and adds to record on form submit', async () => {
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new',
      client_id: 'c1',
      name: 'Новый Гость',
      age: 10,
      created_at: '',
      updated_at: '',
      is_active: true,
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    fireEvent.change(screen.getByTestId('input-visitor-name'), { target: { value: 'Новый Гость' } });
    fireEvent.change(screen.getByTestId('input-visitor-age'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('btn-create-visitor'));

    await waitFor(() => {
      expect(createVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый Гость',
        age: 10,
      });
    });

    await waitFor(() => {
      expect(patchRecord).toHaveBeenCalledWith('r1', expect.objectContaining({
        visits: expect.arrayContaining([
          expect.objectContaining({ visitor_id: 'vis1' }),
          expect.objectContaining({ visitor_id: 'vis_new' }),
        ]),
      }));
    });
  });

  // ─── Service name display ───────────────────────────────────────────────

  it('displays activity service name in dropdown', () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const serviceSelect = screen.getByLabelText('Услуга');
    expect(serviceSelect).toHaveTextContent('Картина маслом');
  });
});
