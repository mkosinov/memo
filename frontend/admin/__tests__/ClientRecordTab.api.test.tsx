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
const mockSetQueryData = vi.fn();
const mockFetchQuery = vi.fn();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries, setQueryData: mockSetQueryData, fetchQuery: mockFetchQuery };

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

  // ─── Delete record ────────────────────────────────────────────────

  it('calls deleteRecord when delete clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('r1');
    });
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

  it('calls patchRecord on save with comment', async () => {
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

  // ─── Add visitor via AddVisitorForm atom ───────────────────────────

  it('creates visitor and adds to record via AddVisitorForm', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    fireEvent.change(screen.getByTestId('add-visitor-name'), { target: { value: 'Новый Гость' } });
    fireEvent.change(screen.getByTestId('add-visitor-age'), { target: { value: '10' } });
    // The add visitor form auto-submits on blur (no explicit submit button)
    fireEvent.blur(screen.getByTestId('add-visitor-name'));

    await waitFor(() => {
      expect(createVisitor).toHaveBeenCalledWith({
        client_id: 'c1',
        name: 'Новый Гость',
        age: 10,
      });
    });
  });
});
