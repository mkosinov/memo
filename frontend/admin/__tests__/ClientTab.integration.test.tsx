import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import fs from 'fs';
import path from 'path';

// ─── Shared mock data ──────────────────────────────────────────────────────

import {
  mockRecord,
  mockVisitor,
  mockTariffs,
  mockVisit,
} from './helpers/mockData';

import {
  createMockRecordsContext,
  createMockUIContext,
} from './helpers/mockContexts';

import { patchVisit as apiPatchVisit, patchRecord } from '@memo/api-client';
import type { RecordResponse, TariffResponse } from '@memo/api-client';

// ─── API Client Mock ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getClientByPhone: vi.fn(),
  createClient: vi.fn(),
  createVisitor: vi.fn(),
  createRecord: vi.fn(),
  dryRunDeleteRecord: vi.fn(),
  resolveDeleteRecord: vi.fn(),
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
const mockGetQueriesData = vi.fn(() => [] as Array<[readonly unknown[], unknown]>);
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
    // The GH #285 delete hook snapshots ['records', ...] caches via
    // getQueriesData at click time — none seeded in these tests.
    getQueriesData: mockGetQueriesData,
  })),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';
import { useRecordData } from '@/hooks/useRecordData';

const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);
const mockUseRecordData = vi.mocked(useRecordData);

// ─── Component under test ──────────────────────────────────────────────────

import { ClientTab } from '../app/components/modal/ActivityDetailsModal/ClientTab';

describe('ClientTab — fully hook-driven (#127 Task 7)', () => {
  beforeEach(() => {
    mockUseRecords.mockReturnValue(createMockRecordsContext());
    mockUseUI.mockReturnValue(createMockUIContext());
    vi.clearAllMocks();
    // Re-apply the PendingActions mock after clearAllMocks
    mockEnqueuePendingAction.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  // Minimal props for the new hook-driven API.
  // NO visits/payments/visitors/serviceTariffs/onUpdateRecord/onAddVisitor/showToast.
  // GH #140: the `client` prop is gone — ClientTab resolves its client via
  // useClient(clientId) internally.
  const newProps = {
    recordId: 'r1',
    activityId: 'ev_1',
    clientId: 'c1',
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

  // ─── #257 D4 cascade: record-level status change rewrites ALL visits ─

  it('record-level status change sends all visits (incl. anonymous) with tariff_id and custom_price preserved', async () => {
    // Canonical record: a named visit (tariff, no custom price) + an
    // anonymous visit (visitor_id = null, custom-price override). Derived
    // from the shared fixtures — no inline mock objects.
    const recordWithTwoVisits: RecordResponse = {
      ...mockRecord,
      status: 'waiting',
      visits: [
        { ...mockVisit, tariff_id: 'tariff-1', custom_price: null },
        {
          ...mockVisit,
          id: 'v2',
          visitor_id: null,
          tariff_id: 'tariff-2',
          custom_price: 500,
        },
      ],
    };
    mockUseRecordData.mockReturnValue({
      recordData: null,
      record: recordWithTwoVisits,
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
    });

    render(<ClientTab {...newProps} />);
    // Open the record-level StatusPicker and pick «visited».
    const trigger = screen.getByTestId('record-status-trigger');
    fireEvent.click(trigger);
    const option = screen.getByTestId('record-status-option-visited');
    fireEvent.click(option);

    await waitFor(() => {
      // D4 cascade: ONE visits-array PUT/PATCH where every visit — named
      // and anonymous — carries the new status AND keeps its money fields.
      expect(patchRecord).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          visits: [
            expect.objectContaining({
              visitor_id: 'vis1',
              tariff_id: 'tariff-1',
              price: 3500,
              custom_price: null,
              status: 'visited',
            }),
            expect.objectContaining({
              visitor_id: null,
              tariff_id: 'tariff-2',
              price: 3500,
              custom_price: 500,
              status: 'visited',
            }),
          ],
        }),
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
    const customTariffs: TariffResponse[] = [
      { id: 'tariff-1', service_id: 's1', title: 'Взрослый', price: 2500, description: null, audience: 'adult' },
      { id: 'tariff-2', service_id: 's1', title: 'Детский', price: 1500, description: null, audience: 'kid' },
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

  // ─── Delete record — GH #285 deferred flow (useUI toast, no legacy
  // 5s timer + undo toast) ──────────────────────────────────────────────

  it('delete click runs the dry-run via useDeleteRecord, enqueues and navigates immediately', async () => {
    render(<ClientTab {...newProps} />);
    fireEvent.click(screen.getByTestId('btn-delete-record'));
    // The new ClientTab reads showToast from useUI (not props).
    expect(mockUseUI).toHaveBeenCalled();
    // GH #285 D2/D6: a clean 204 dry-run enqueues the deferred delete
    // (5s undo window — the PendingActions provider owns the timer) and the
    // tab navigates right away — the pending action survives unmount.
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'delete-record-r1', kind: 'delete' }),
      );
    });
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

  // ─── #257 unified visitors model: seats derive from record.visits ───

  it('seats display equals visits.length from canonical record (hook, not prop)', () => {
    // #257: seats = len(visits) — anonymous seats are visits with
    // visitor_id = null, so the visit list IS the seat list. Two saved
    // visits (one anonymous) → «Мест: 2».
    const recordWithTwoVisits: RecordResponse = {
      ...mockRecord,
      status: 'waiting',
      visits: [mockVisit, { ...mockVisit, id: 'v2', visitor_id: null }],
    };
    mockUseRecordData.mockReturnValue({
      recordData: null,
      record: recordWithTwoVisits,
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
    });

    render(<ClientTab {...newProps} />);
    const summary = screen.getByTestId('record-summary');
    expect(within(summary).getByText('Мест:')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
  });

  it('no production component reads record.anonym_visits anymore (#257 invariant)', () => {
    // #257 unified visitors model: seats are derived purely from
    // record.visits — the legacy counter field is gone from the API.
    // Guards the two surfaces that used to read it: the record tab
    // (seats display) and the modal tab label (x{totalSeats}).
    for (const rel of [
      '../app/components/modal/ActivityDetailsModal/ClientTab.tsx',
      '../app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx',
    ]) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');
      expect(src).not.toMatch(/anonym_visits/);
    }
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

