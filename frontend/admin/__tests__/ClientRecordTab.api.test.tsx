import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';

// ─── Mock UIContext ────────────────────────────────────────────────────────
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
  }),
}));

// ─── Mock api-client ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecord: vi.fn(),
  updateRecord: vi.fn(),
  patchRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
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
  ApiError: class ApiError extends Error { code: string; constructor(msg: string, code: string) { super(msg); this.code = code; } },
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

vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

import { useSchedule } from '@/contexts/ScheduleContext';

// ─── PendingActions mock (captures enqueuePendingAction calls) ─────────────

const mockEnqueuePendingAction = vi.fn();

// ─── Mock react-query ──────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();
const mockSetQueriesData = vi.fn();
const mockFetchQuery = vi.fn();
const mockGetQueryData = vi.fn(() => undefined);
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  setQueryData: mockSetQueryData,
  setQueriesData: mockSetQueriesData,
  fetchQuery: mockFetchQuery,
  getQueryData: mockGetQueryData,
};

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
  createVisit,
  deleteVisit as apiDeleteVisit,
  updateVisitor,
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


  beforeEach(() => {
    vi.clearAllMocks();
    buildDefaultQueryImpl(mockUseQuery);
    mockEnqueuePendingAction.mockReset();
    vi.mocked(patchRecord).mockResolvedValue(mockRecord);
    vi.mocked(patchActivity).mockResolvedValue(mockActivityResponse);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(createPayment).mockResolvedValue({
      id: 'p1', record_id: 'r1', amount: 1000, method: 'card',
      created_at: '', updated_at: '',
    });
    vi.mocked(deletePayment).mockResolvedValue(undefined);
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'Новый Гость', age: 10,
      created_at: '', updated_at: '', is_active: true,
    });
    vi.mocked(deleteVisitor).mockResolvedValue(undefined);
    vi.mocked(createVisit).mockResolvedValue({
      id: 'v_new', record_id: 'r1', visitor_id: 'vis_new', tariff_id: 't1',
      price: 3500, custom_price: null, status: 'waiting',
      created_at: '', updated_at: '',
    });
    vi.mocked(apiDeleteVisit).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Delete record ────────────────────────────────────────────────

  it('calls deleteRecord when delete clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledWith('r1');
    });
  });

  it('invalidates records query after delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    fireEvent.click(screen.getByText('Удалить запись'));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['records'] });
    });
  });

  // ─── Save (patchRecord) calls ─────────────────────────────────────────

  it('calls patchRecord on save with comment', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
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
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
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
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
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
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
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

  // ─── T8 RED: fine-grained visit CRUD (no coarse saveRecord({visits})) ──

  it('add visitor uses fine-grained addVisit (createVisit called, not coarse patchRecord with visits)', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Новый Гость' } });
    // The add visitor form auto-submits on blur (no explicit submit button)
    fireEvent.blur(nameInput);

    // Fine-grained path: addVisit in useRecordMutations calls createVisitor + createVisit.
    // The coarse path (handleAddVisitor using saveRecord({visits: [...]}) is gone.
    await waitFor(() => {
      expect(createVisit).toHaveBeenCalled();
    });
  });

  it('delete visit uses deleteVisitDeferred (enqueuePendingAction), not direct deleteVisit API', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    // Click × button on the saved visit row
    fireEvent.click(screen.getByTestId('visit-row-v1-delete'));

    // deleteVisitDeferred delegates to PendingActions — must call enqueuePendingAction
    // and must NOT immediately call deleteVisit API (the provider owns the timer).
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'delete',
          message: expect.stringContaining('Отменить'),
        }),
      );
    });
    expect(apiDeleteVisit).not.toHaveBeenCalled();
  });

  it('record-level Save calls patchRecord with custom_price+comment (no visits field)', async () => {
    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    const textarea = screen.getByPlaceholderText('Добавить комментарий...');
    fireEvent.change(textarea, { target: { value: 'Test comment' } });
    fireEvent.click(screen.getByTestId('btn-save-record'));

    // After T8: record-level Save does NOT include visits — visits are managed
    // by the fine-grained addVisit/patchVisit/deleteVisitDeferred mutations.
    await waitFor(() => {
      const lastCall = vi.mocked(patchRecord).mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0]).toBe('r1');
      // No visits field in the patchRecord body
      expect(lastCall![1]).not.toHaveProperty('visits');
    });
  });

  it('visitor name change calls updateVisitor directly (no optimistic override layer)', async () => {
    vi.mocked(updateVisitor).mockResolvedValue({
      id: 'vis1', client_id: 'c1', name: 'Новое Имя', age: 30,
      created_at: '', updated_at: '', is_active: true,
    });

    render(<ClientRecordTab recordId="r1" clientId="c1" />);
    const visitRow = screen.getByTestId('visit-row-v1');
    const nameInput = visitRow.querySelector('input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Новое Имя' } });
    fireEvent.blur(nameInput);

    // Direct path: handleVisitorChange calls updateVisitor immediately,
    // not via the optimistic override layer.
    await waitFor(() => {
      expect(updateVisitor).toHaveBeenCalledWith(
        'vis1',
        expect.objectContaining({ name: 'Новое Имя' }),
      );
    });
  });

  it('ClientRecordTab.tsx does not import useOptimisticVisitMutation', () => {
    const filePath = path.resolve(
      __dirname,
      '../app/(main)/clients/components/ClientRecordTab.tsx',
    );
    const src = fs.readFileSync(filePath, 'utf-8');
    expect(src).not.toMatch(/useOptimisticVisitMutation/);
  });
});
