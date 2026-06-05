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
  createVisitor,
  deleteVisitor,
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

describe('ClientRecordTab — API interactions', () => {
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
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'Новый Гость', age: 10,
      created_at: '', updated_at: '', is_active: true,
    });
    vi.mocked(deleteVisitor).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Payment API ──────────────────────────────────────────────────────

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

  it('allows changing payment method via CustomSelect', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    const triggers = screen.getAllByTestId('custom-select-trigger');
    const paymentMethodTrigger = triggers[triggers.length - 1];
    fireEvent.click(paymentMethodTrigger);
    fireEvent.click(screen.getByTestId('custom-select-option-cash'));
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

  // ─── Delete record ────────────────────────────────────────────────────

  it('calls deleteRecord when delete clicked (does not close modal)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('r1');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('invalidates records query after delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  // ─── Save (patchRecord) calls ─────────────────────────────────────────

  it('calls patchRecord and patchActivity on save', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
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

  // ─── Delete visitor ───────────────────────────────────────────────────

  it('creates visitor and adds to record on form submit', async () => {
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

  it('selecting existing visitor does not call createVisitor', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    const nameInput = screen.getByTestId('input-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Анн' } });

    fireEvent.click(screen.getByTestId('visitor-option-vis1'));
    expect(nameInput).toHaveValue('Анна Иванова');

    fireEvent.click(screen.getByTestId('btn-create-visitor'));

    await waitFor(() => {
      expect(createVisitor).not.toHaveBeenCalled();
      expect(patchRecord).toHaveBeenCalledWith('r1', expect.objectContaining({
        visits: expect.arrayContaining([
          expect.objectContaining({ visitor_id: 'vis1' }),
        ]),
      }));
    });
  });

  it('typing new name and submitting creates new visitor', async () => {
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'Новый Гость', age: null,
      created_at: '', updated_at: '', is_active: true,
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    const nameInput = screen.getByTestId('input-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Новый Гость' } });

    expect(screen.queryByTestId('visitor-option-vis1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-create-visitor'));

    await waitFor(() => {
      expect(createVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый Гость',
        age: undefined,
      });
    });
  });
});
