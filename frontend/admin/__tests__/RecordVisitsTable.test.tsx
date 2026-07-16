/**
 * Tests for RecordVisitsTable — row-state management.
 *
 * Spec (#127 Task 5):
 *   - Saved rows = useMemo(() => visits.map(v => visitResponseToRow(v, visitorsMap)), [visits, visitorsMap])
 *   - Draft rows (id === null) = separate useState
 *   - Render = [...savedRows, ...drafts]
 *   - handleAddClick → setDrafts(...)
 *   - handleRemove (draft) → setDrafts(prev => prev.filter(r => r !== row))
 *   - handleDeleteRow (saved) → call onDeleteVisit(id) — NO local filter
 *   - onSaved → preserve submitted name/age until the cache catches up
 *
 * The component must NOT use a useEffect to re-sync local state from the visits
 * prop (this was the source of Bug #3 "row disappears" — the effect overwrote
 * local editing state mid-edit).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mock UIContext ──────────────────────────────────────────────────────────

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { useUI } from '@/contexts/UIContext';
const mockUseUI = vi.mocked(useUI);

import { RecordVisitsTable } from '../app/components/shared/record/blocks/RecordVisitsTable';
import type { VisitResponse, TariffResponse } from '@memo/api-client';

// ─── Mock data ───────────────────────────────────────────────────────────────

const mockTariffs: TariffResponse[] = [
  { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
  { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
];

const emptyVisitorsMap = new Map<string, { name: string; age: number | null }>();

/** Standard "save" response — mirrors what `addVisit` returns. */
const SAVED_VISIT: VisitResponse = {
  id: 'v_new',
  record_id: 'r1',
  visitor_id: 'vis_new',
  tariff_id: 't1',
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
};

// ─── Helper ──────────────────────────────────────────────────────────────────

afterEach(() => vi.restoreAllMocks());

function makeMocks(opts: {
  onAddVisit?: (data: any) => Promise<VisitResponse>;
  onPatchVisit?: (id: string, data: any) => Promise<VisitResponse>;
  onDeleteVisit?: (id: string) => Promise<void>;
} = {}) {
  return {
    onAddVisit: opts.onAddVisit ?? vi.fn().mockResolvedValue(SAVED_VISIT),
    onPatchVisit: opts.onPatchVisit ?? vi.fn().mockImplementation(async (id) => ({
      id,
      record_id: 'r1',
      visitor_id: `vis_${id}`,
      tariff_id: 't1',
      price: 3500,
      custom_price: null,
      status: 'waiting',
      created_at: '',
      updated_at: '',
    } as VisitResponse)),
    onDeleteVisit: opts.onDeleteVisit ?? vi.fn().mockResolvedValue(undefined),
    onChangeVisitor: vi.fn(),
    onAnonymVisitsChange: vi.fn(),
  };
}

function renderVisitsTable(
  opts: {
    visits?: VisitResponse[];
    visitorsMap?: Map<string, { name: string; age: number | null }>;
    mocks?: ReturnType<typeof makeMocks>;
  } = {},
) {
  mockUseUI.mockReturnValue({
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
  });

  const mocks = opts.mocks ?? makeMocks();

  const utils = render(
    <RecordVisitsTable
      visits={opts.visits ?? []}
      visitorsMap={opts.visitorsMap ?? emptyVisitorsMap}
      tariffs={mockTariffs}
      anonymVisits={0}
      totalCost={0}
      recordStatus="waiting"
      clientId="c1"
      onAddVisit={mocks.onAddVisit}
      onPatchVisit={mocks.onPatchVisit}
      onDeleteVisit={mocks.onDeleteVisit}
      onChangeVisitor={mocks.onChangeVisitor}
      onAnonymVisitsChange={mocks.onAnonymVisitsChange}
    />,
  );

  return { ...mocks, ...utils };
}

function rerender(
  utils: ReturnType<typeof render>,
  opts: {
    visits?: VisitResponse[];
    visitorsMap?: Map<string, { name: string; age: number | null }>;
    mocks?: ReturnType<typeof makeMocks>;
  },
) {
  const mocks = opts.mocks ?? makeMocks();
  utils.rerender(
    <RecordVisitsTable
      visits={opts.visits ?? []}
      visitorsMap={opts.visitorsMap ?? emptyVisitorsMap}
      tariffs={mockTariffs}
      anonymVisits={0}
      totalCost={0}
      recordStatus="waiting"
      clientId="c1"
      onAddVisit={mocks.onAddVisit}
      onPatchVisit={mocks.onPatchVisit}
      onDeleteVisit={mocks.onDeleteVisit}
      onChangeVisitor={mocks.onChangeVisitor}
      onAnonymVisitsChange={mocks.onAnonymVisitsChange}
    />,
  );
  return mocks;
}

// ─── Tests: existing behavior preserved ──────────────────────────────────────

describe('RecordVisitsTable — new-row save (preserves existing behavior)', () => {
  it('saves anonymous visit (blank name) on Enter', async () => {
    const { onAddVisit } = renderVisitsTable();

    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();

    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(onAddVisit).toHaveBeenCalledTimes(1));
    expect(onAddVisit).toHaveBeenCalledWith(
      expect.objectContaining({ name: '' }),
    );
  });

  it('saves visit with only tariff selected (no name, no age)', async () => {
    const { onAddVisit } = renderVisitsTable();

    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    const tariffSelect = screen.getByTestId('add-visitor-tariff');
    fireEvent.change(tariffSelect, { target: { value: 't2' } });

    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(onAddVisit).toHaveBeenCalledTimes(1));
    expect(onAddVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '',
        tariff_id: 't2',
        price: 2500,
      }),
    );
  });
});

// ─── Tests: new behavior (RED — failing against current code) ────────────────

describe('RecordVisitsTable — saved rows derive from visits prop (useMemo)', () => {
  it('renders saved rows derived from visits prop', () => {
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    renderVisitsTable({ visits });

    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v2')).toBeInTheDocument();
  });

  it('saved row disappears when visits prop no longer contains it (cache update)', () => {
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    const utils = renderVisitsTable({ visits });
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();

    // Simulate the parent re-rendering after v1 was removed from the cache
    // (e.g. by the optimistic `removeVisit` helper from Task 4).
    const remaining: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    rerender(utils, { visits: remaining });

    expect(screen.queryByTestId('visit-row-v1')).not.toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v2')).toBeInTheDocument();
  });

  it('does not keep a stale local copy of a deleted saved row', async () => {
    // Parent state has v1 + v2; user clicks × on v1.
    // After the optimistic cache update (parent rerenders with [v2]),
    // v1 must be gone — not kept in a local cache.
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    const mocks = makeMocks();
    const utils = renderVisitsTable({ visits, mocks });

    // Click × on v1
    fireEvent.click(screen.getByTestId('visit-row-v1-delete'));

    // onDeleteVisit should be called with the id
    await waitFor(() => expect(mocks.onDeleteVisit).toHaveBeenCalledWith('v1'));

    // Parent rerenders without v1 (optimistic cache update)
    const remaining: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    rerender(utils, { visits: remaining, mocks });

    // v1 is gone
    expect(screen.queryByTestId('visit-row-v1')).not.toBeInTheDocument();
    // v2 still present
    expect(screen.getByTestId('visit-row-v2')).toBeInTheDocument();
  });

  it('does NOT locally filter the deleted row — if the visits prop still has it, the row stays (cache rollback)', async () => {
    // Spec (Task 5): "handleDeleteRow (saved) → call onDeleteVisit(id) — do NOT
    // locally filter saved rows; the useMemo reacts to the cache change."
    //
    // The new architecture trusts the visits prop as the single source of truth.
    // If the parent doesn't remove the visit (e.g., delete was rolled back
    // server-side, or the cache hasn't been updated yet), the row must stay
    // visible — NOT be hidden by a local filter.
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
      { ...SAVED_VISIT, id: 'v2', visitor_id: 'vis2' },
    ];
    const mocks = makeMocks();
    const utils = renderVisitsTable({ visits, mocks });

    // Click × on v1 — onDeleteVisit is called
    fireEvent.click(screen.getByTestId('visit-row-v1-delete'));
    await waitFor(() => expect(mocks.onDeleteVisit).toHaveBeenCalledWith('v1'));

    // Simulate a cache rollback: the parent re-renders with the SAME visits
    // (the delete was undone server-side, so the visit is back in the list).
    rerender(utils, { visits, mocks });

    // In the new architecture (useMemo), the row MUST still be visible —
    // there is no local filter to hide it. (The OLD architecture with
    // setRows(prev => prev.filter(...)) would have hidden it.)
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v2')).toBeInTheDocument();
  });
});

describe('RecordVisitsTable — drafts isolated from visits prop', () => {
  it('draft row renders alongside saved rows', () => {
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
    ];
    renderVisitsTable({ visits });

    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();
    // saved row is still there
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });

  it('draft editing state is preserved when parent rerenders with the same visits (no useEffect overwrite)', () => {
    // Reproduces Bug #3: in the old code, a useEffect on `visits` re-derived
    // local state and clobbered the user's in-progress draft.
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
    ];
    const utils = renderVisitsTable({ visits });

    // Add a draft
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Анна' } });
    expect((nameInput as HTMLInputElement).value).toBe('Анна');

    // Parent rerenders with the same visits (new array reference — common after
    // unrelated refetches). The draft input must keep its value.
    const sameVisitsRef: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
    ];
    rerender(utils, { visits: sameVisitsRef });

    // The draft row is still there with the typed name
    const draftRow = screen.getByTestId('visit-row-new');
    expect(draftRow).toBeInTheDocument();
    const preservedInput = screen.getByTestId('add-visitor-name') as HTMLInputElement;
    expect(preservedInput.value).toBe('Анна');
  });

  it('handleRemove on a draft row removes only the draft (saved rows untouched)', () => {
    const visits: VisitResponse[] = [
      { ...SAVED_VISIT, id: 'v1', visitor_id: 'vis1' },
    ];
    renderVisitsTable({ visits });

    // Add a draft
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();

    // Click × on the draft
    fireEvent.click(screen.getByTestId('visit-row-new-delete'));

    // Draft is gone, saved row remains
    expect(screen.queryByTestId('visit-row-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v1')).toBeInTheDocument();
  });
});

describe('RecordVisitsTable — onSaved removes the draft from drafts', () => {
  it('after save, the draft row is removed (the saved row will be served by the cache)', async () => {
    // Simulate the post-save flow:
    // 1. User adds a draft
    // 2. User presses Enter
    // 3. onAddVisit resolves → onSaved fires
    // 4. Parent re-renders with the new visit in `visits` (cache caught up)
    //    AND the visitorsMap has the new visitor.
    const mocks = makeMocks();
    const utils = renderVisitsTable({ mocks });

    // 1. Add draft
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Анна' } });

    // 2. Save
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    await waitFor(() => expect(mocks.onAddVisit).toHaveBeenCalledTimes(1));

    // 3-4. Parent re-renders with the new visit in visits AND visitorsMap.
    // The draft row should NOT be in the DOM anymore — savedRows useMemo
    // produces the row from the cache, and the duplicate draft is removed.
    const newVisitorsMap = new Map<string, { name: string; age: number | null }>([
      ['vis_new', { name: 'Анна', age: null }],
    ]);
    const newVisits: VisitResponse[] = [{ ...SAVED_VISIT, id: 'v_new', visitor_id: 'vis_new' }];
    rerender(utils, { visits: newVisits, visitorsMap: newVisitorsMap, mocks });

    // Draft is gone, saved row appears
    expect(screen.queryByTestId('visit-row-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('visit-row-v_new')).toBeInTheDocument();
    // The name input shows "Анна" (from the visitorsMap)
    const savedRow = screen.getByTestId('visit-row-v_new');
    const savedNameInput = savedRow.querySelector('input[type="text"]') as HTMLInputElement;
    expect(savedNameInput.value).toBe('Анна');
  });

  it('preserves submitted name/age between onSaved and the cache refetch (no flicker to blank)', async () => {
    // Spec note: "Preserve submitted values behavior (name/age) until the
    // cache refetch resolves." Between onAddVisit resolving and the parent
    // rerendering with the new visit + visitorsMap, the user must still see
    // the submitted name (the visitorsMap is still stale).
    const mocks = makeMocks();
    renderVisitsTable({ mocks });

    // Add a draft, type a name, save
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.change(nameInput, { target: { value: 'Анна' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    // onAddVisit resolves, onSaved fires — but the parent has NOT rerendered
    // with the new visit yet. The row with id=v_new must still be in the DOM
    // (preserving "Анна") because we're waiting for the cache to catch up.
    await waitFor(() => expect(mocks.onAddVisit).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const savedRow = screen.getByTestId('visit-row-v_new');
      expect(savedRow).toBeInTheDocument();
    });

    // The name input must show "Анна" (not blank / "Аноним")
    const savedRow = screen.getByTestId('visit-row-v_new');
    const savedNameInput = savedRow.querySelector('input[type="text"]') as HTMLInputElement;
    expect(savedNameInput).toBeTruthy();
    expect(savedNameInput.value).toBe('Анна');
  });
});
