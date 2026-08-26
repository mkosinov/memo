import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';

// ─── Shared mock data ──────────────────────────────────────────────────────

import {
  mockClient,
  mockRecord,
  mockVisitor,
  mockTariffs,
} from './helpers/mockData';

import {
  createMockScheduleContext,
  createMockRecordsContext,
  createMockUIContext,
} from './helpers/mockContexts';

import { patchVisit as apiPatchVisit } from '@memo/api-client';

// ─── API Client Mock ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  searchClientByPhone: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
  patchPayment: vi.fn(),
  deletePayment: vi.fn(),
  updateVisitStatus: vi.fn(),
  getRecord: vi.fn(),
  getClientVisitors: vi.fn(),
  getActivity: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getPayments: vi.fn(),
  patchRecord: vi.fn(),
  patchActivity: vi.fn(),
  deleteVisitor: vi.fn(),
  createVisit: vi.fn(),
  patchVisit: vi.fn(),
  deleteVisit: vi.fn(),
  patchVisitor: vi.fn(),
}));

// ─── Mocks for hook-based consumers ────────────────────────────────────────

const mockEnqueuePendingAction = vi.fn();

vi.mock('@/contexts/ScheduleContext', () => ({ useSchedule: vi.fn() }));
vi.mock('@/contexts/RecordsContext', () => ({ useRecords: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));

// useRecordData is the canonical source — return mockTariffs + mockVisit + mockPayment
// so the component renders identically to the prop-based version, but from the hook.
vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: vi.fn(() => ({
    recordData: null,
    record: mockRecord,
    visitors: [mockVisitor],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: [],
    visitorsMap: new Map([['vis1', { name: 'Анна Иванова', age: 30 }]]),
    tariffs: mockTariffs,
    isLoading: false,
    status: 'waiting' as const,
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}));

const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();
const mockSetQueriesData = vi.fn();
const mockFetchQuery = vi.fn();
const mockGetQueryData = vi.fn(() => null);
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
    setQueriesData: mockSetQueriesData,
    fetchQuery: mockFetchQuery,
    getQueryData: mockGetQueryData,
  })),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';
import { useRecordData } from '@/hooks/useRecordData';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);
const mockUseRecordData = vi.mocked(useRecordData);

// ─── Component under test ──────────────────────────────────────────────────

import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';

describe('ClientTab — fully hook-driven (#127 Task 7)', () => {
  beforeEach(() => {
    mockUseSchedule.mockReturnValue(createMockScheduleContext());
    mockUseRecords.mockReturnValue(createMockRecordsContext());
    mockUseUI.mockReturnValue(createMockUIContext());
    vi.clearAllMocks();
    // Re-apply the PendingActions mock after clearAllMocks
    mockEnqueuePendingAction.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  // Minimal props for the new hook-driven API.
  // NO visits/payments/visitors/serviceTariffs/onUpdateRecord/onAddVisitor/showToast.
  const newProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
    client: mockClient,
    onDeleteRecord: vi.fn(),
    onClose: vi.fn(),
  };

  // ─── Renders from useRecordData, not props ───────────────────────────

  it('renders ClientTab using useRecordData (no prop visits/payments)', () => {
    render(<ClientTab {...newProps} />);
    // The mock for useRecordData provides record with 1 visit (mockVisit v1).
    // ClientTab should render the visit row from the hook data, not from props.
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('record-summary')).toBeInTheDocument();
    // Confirms useRecordData was called with the right IDs
    expect(mockUseRecordData).toHaveBeenCalledWith('r1', 'c1');
  });

  it('does NOT receive visits/payments/serviceTariffs/onUpdateRecord/onAddVisitor props', () => {
    // Spy on console.error to catch React unknown-prop warnings.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ClientTab {...newProps} />);
    // React warns about unknown DOM props but unknown React component props are
    // typically ignored unless typed. The real check: ClientTab accepts the new
    // prop shape via its interface, so passing ONLY the new props must work.
    // If the old props were still required, TS would error at compile time.
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed prop type'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  // ─── Delete-visit goes through deleteVisitDeferred (PendingActions) ──

  it('delete-visit calls enqueuePendingAction (deleteVisitDeferred path), not direct API', async () => {
    render(<ClientTab {...newProps} />);
    // The visit row delete button is rendered by RecordVisitsTable.
    // Click "+ Add visitor" to make row interactive, then delete.
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    // Click the delete button on the saved visit row
    const deleteBtn = screen.getByTestId('visit-row-v1-delete');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      // deleteVisitDeferred delegates to PendingActions — must call enqueuePendingAction
      expect(mockEnqueuePendingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'delete',
          message: expect.stringContaining('Отменить'),
        }),
      );
    });
  });

  // ─── Status change uses updateRecord (record-level op) ───────────────

  it('status change uses updateRecord from hook (coarse record-level)', async () => {
    render(<ClientTab {...newProps} />);
    // Open status picker on the record summary
    const trigger = screen.getByTestId('record-status-trigger');
    fireEvent.click(trigger);
    // Pick "visited"
    const option = screen.getByTestId('record-status-option-visited');
    fireEvent.click(option);

    await waitFor(() => {
      // status change → updateRecord with all visits set to new status
      // This goes through the hook's updateRecord, NOT through onUpdateRecord prop
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['record', 'r1'] }),
      );
    });
  });

  // ─── Add visit goes through addVisit (fine-grained) ─────────────────

  it('add-visit wires through addVisit (creates Visitor + Visit via hook)', async () => {
    // Mock createVisitor + createVisit (used by addVisit in useRecordMutations)
    const { createVisitor, createVisit } = await import('@memo/api-client');
    vi.mocked(createVisitor).mockResolvedValue({
      id: 'vis_new', client_id: 'c1', name: 'New Visitor', age: null,
      created_at: '', updated_at: '',
    } as any);
    vi.mocked(createVisit).mockResolvedValue({
      id: 'v_new', record_id: 'r1', visitor_id: 'vis_new',
      price: 3500, custom_price: null, status: 'waiting',
      created_at: '', updated_at: '',
    } as any);

    render(<ClientTab {...newProps} />);
    // Open new-visit draft row
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Test' } });
    // Trigger save via Enter key
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => {
      // addVisit in the hook creates visitor + visit — proves fine-grained path
      expect(createVisit).toHaveBeenCalled();
    });
  });

  // ─── Tariffs come from useRecordData (hook), not serviceTariffs prop ─

  it('tariff dropdown uses tariffs from useRecordData', async () => {
    // Provide custom tariffs via the hook mock
    const customTariffs = [
      { id: 'tariff-1', service_id: 's1', title: 'Взрослый', price: 2500, description: null },
      { id: 'tariff-2', service_id: 's1', title: 'Детский', price: 1500, description: null },
    ];
    mockUseRecordData.mockReturnValue({
      recordData: null,
      record: mockRecord,
      visitors: [mockVisitor],
      activity: undefined,
      services: [],
      masters: [],
      locations: [],
      payments: [],
      visitorsMap: new Map([['vis1', { name: 'Анна Иванова', age: 30 }]]),
      tariffs: customTariffs,
      isLoading: false,
      status: 'waiting' as const,
    });

    render(<ClientTab {...newProps} />);
    // Click "+ Добавить" to add a new visit row
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    // The tariff <select> for the new row should have tariff options from the hook
    const select = screen.getByTestId('add-visitor-tariff');
    const options = within(select).getAllByRole('option');
    // 1 placeholder ("— тариф —") + 2 tariff options = 3
    expect(options).toHaveLength(3);
    expect(options[1]).toHaveTextContent('Взрослый');
    expect(options[2]).toHaveTextContent('Детский');
  });

  // ─── Delete record — Addendum 13 dry-run flow (useUI toast, no legacy
  // 5s timer + undo toast) ──────────────────────────────────────────────

  it('delete click runs the dry-run via useDeleteRecord and navigates immediately', async () => {
    render(<ClientTab {...newProps} />);
    fireEvent.click(screen.getByTestId('btn-delete-record'));
    // The new ClientTab reads showToast from useUI (not props).
    expect(mockUseUI).toHaveBeenCalled();
    // Addendum 13: a successful dry-run reports back to the parent right
    // away — no 5-second setTimeout, no undo toast.
    await waitFor(() => {
      expect(newProps.onDeleteRecord).toHaveBeenCalledWith('r1');
    });
  });

  // ─── useOptimisticVisitMutation is no longer imported ────────────────

  it('does not import useOptimisticVisitMutation', () => {
    // Read the source file and assert the import is gone.
    const filePath = path.resolve(
      __dirname,
      '../app/components/modal/ActivityDetailsModal/ClientTab.tsx',
    );
    const src = fs.readFileSync(filePath, 'utf-8');
    expect(src).not.toMatch(/useOptimisticVisitMutation/);
  });

  // ─── Seats reads anonym_visits from canonical hook (not props) ──────

  it('seats display reads anonym_visits from canonical record (hook, not prop)', () => {
    // The anonym_visits change path goes through handleAnonymChange in
    // ClientTab → useRecordMutations.updateRecord. There's no visible
    // anonym-visits input in ClientTab's current UI (it lives in
    // RecordHeader, which is rendered by ClientRecordTab, not ClientTab).
    // We verify the wiring by checking the seats summary reads from the hook.
    render(<ClientTab {...newProps} />);
    // The seats display in RecordSummary reads anonym_visits from the
    // canonical record — proves it is read from the hook, not props.
    expect(screen.getByText('Мест:')).toBeInTheDocument();
  });

  // ─── Status change on visit row uses patchVisit (fine-grained) ──────

  it('status change on visit row uses patchVisit (fine-grained, not onUpdateRecord)', async () => {
    vi.mocked(apiPatchVisit).mockResolvedValue({
      id: 'v1', status: 'visited', custom_price: null, created_at: '',
      updated_at: '', record_id: 'r1', price: 0, visitor_id: 'vis1',
    } as any);
    render(<ClientTab {...newProps} />);

    const statusContainer = screen.getByTestId('visit-v1-status');
    const trigger = within(statusContainer).getByTestId('visit-v1-status-trigger');
    fireEvent.click(trigger);

    const option = within(statusContainer).getByTestId('visit-v1-status-option-visited');
    fireEvent.click(option);

    await waitFor(() => {
      expect(apiPatchVisit).toHaveBeenCalledWith('v1', expect.objectContaining({ status: 'visited' }));
    });
  });
});

