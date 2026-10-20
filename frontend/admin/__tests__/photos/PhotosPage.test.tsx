/**
 * Wiring test — the photos page mounts PhotosFilters into PhotosTable's
 * toolbarLead slot (GH #211 Task 8 composition; #412 US-3: the panel rides
 * in the DataTable toolbar's left group — the external filter card above
 * the table is retired). Both live inside the provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/app/(main)/photos/components/PhotosTable', () => ({
  // #412 US-3 — the stub renders the toolbarLead slot (the real table passes
  // it into the DataTable toolbar's left group).
  PhotosTable: ({ toolbarLead }: { toolbarLead?: React.ReactNode }) => (
    <div data-testid="photos-table-stub">{toolbarLead}</div>
  ),
}));

vi.mock('@/app/(main)/photos/components/PhotosFilters', () => ({
  PhotosFilters: () => <div data-testid="photos-filters-stub" />,
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPhotos: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
  };
});

// #349 Task 8 — the page now reads URL state (useTableUrlState) inside its
// Suspense boundary: real next/navigation shape via the shared stateful mock.
vi.mock('next/navigation', async () => await import('../helpers/nextNavigationMock'));
import { __resetNavigation } from '../helpers/nextNavigationMock';

import { getPhotos, getAllServices, getAllLocations } from '@memo/api-client';
import PhotosPage from '../../app/(main)/photos/page';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);

beforeEach(() => {
  vi.clearAllMocks();
  __resetNavigation('', '/photos');
  mockGetPhotos.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
  mockGetAllServices.mockResolvedValue([]);
  mockGetAllLocations.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('photos page wiring (GH #211 Task 8)', () => {
  it('mounts the filter bar inside the table toolbarLead — no external filter card (#412 US-3)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PhotosPage />
      </QueryClientProvider>,
    );

    const filtersStub = await screen.findByTestId('photos-filters-stub');
    const tableStub = screen.getByTestId('photos-table-stub');
    expect(filtersStub).toBeInTheDocument();
    expect(tableStub).toBeInTheDocument();

    // #412 US-3: the panel is rendered BY the table (toolbarLead
    // pass-through) — the retired composition rendered it as a sibling
    // card above the table.
    expect(tableStub.contains(filtersStub)).toBe(true);

    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalled();
    });
  });
});
