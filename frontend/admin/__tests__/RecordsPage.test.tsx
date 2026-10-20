/**
 * Records page composition (#412 US-1, Task 2): the filter panel rides in
 * the DataTable toolbar (toolbarLead) — the external `rounded-xl border p-4`
 * card above the table is retired. The panel root anchor is
 * `[data-testid="records-filters"]`; field prefixes are unchanged.
 *
 * Mounts the REAL page tree (Suspense → urlState adapter → RecordsProvider →
 * content) with the same seams RecordsTable.test.tsx / RecordsFilters.test.tsx
 * mock: api-client fetchers, useRecordData, useDeleteRecord, UIContext.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));

vi.mock('@memo/api-client', () => ({
  // The provider's list query — resolved empty (composition only).
  getRecordsView: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 }),
  // RecordsFilters' own canonical-key selection queries.
  getAllLocations: vi.fn().mockResolvedValue([]),
  getAllServices: vi.fn().mockResolvedValue([]),
  getAllMasters: vi.fn().mockResolvedValue([]),
}));

// The same seams RecordsTable.test.tsx mocks — the table's detail-panel and
// delete hooks must not hit the network in a composition test.
vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: () => ({
    recordData: null,
    record: null,
    visitors: [],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: [],
    visitorsMap: new Map(),
    tariffs: [],
    isLoading: false,
    status: 'waiting' as const,
  }),
}));

vi.mock('@/hooks/useDeleteRecord', () => ({
  useDeleteRecord: () => ({
    removeRecord: vi.fn(),
    removeRecordResolved: vi.fn(),
  }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

import { __resetNavigation } from './helpers/nextNavigationMock';
import RecordsPage from '../app/(main)/records/page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetNavigation('', '/records');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecordsPage — filter panel in the table toolbar (#412 US-1)', () => {
  it('mounts the panel inside the DataTable toolbar row, next to the column gear', () => {
    renderPage();

    const panel = screen.getByTestId('records-filters');

    // The panel's closest `p-4 border-b` ancestor is the DataTable toolbar
    // row — the row that also carries the column-settings gear.
    const toolbar = panel.closest('.p-4.border-b');
    expect(toolbar).not.toBeNull();
    expect(
      toolbar!.querySelector('button[aria-label="Настроить колонки"]'),
    ).not.toBeNull();
  });

  it('has no external filter card — the panel\'s card is the table card', () => {
    renderPage();

    const panel = screen.getByTestId('records-filters');

    // The retired composition put the panel in its own rounded-xl card ABOVE
    // the table card. Now the panel's closest rounded-xl ancestor must be the
    // table card itself (it contains the table).
    const card = panel.closest('.rounded-xl');
    expect(card).not.toBeNull();
    expect(card!.querySelector('table')).not.toBeNull();
  });

  it('keeps the built-in DataTable search/status controls off', () => {
    renderPage();

    const panel = screen.getByTestId('records-filters');
    const toolbar = panel.closest('.p-4.border-b');
    expect(toolbar).not.toBeNull();

    // Built-in status select (aria-label «Статус») stays disabled — status
    // filtering lives in the panel's StatusFiltersPicker. The panel's own
    // search input (aria-label «Поиск по клиенту или услуге») is the first
    // control of the bar, NOT the toolbar's built-in search.
    expect(toolbar!.querySelector('select[aria-label="Статус"]')).toBeNull();
    expect(
      toolbar!.querySelector('input[aria-label="Поиск по клиенту или услуге"]'),
    ).not.toBeNull();
  });
});
