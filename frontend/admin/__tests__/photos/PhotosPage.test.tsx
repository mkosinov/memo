/**
 * Wiring test — the photos page renders PhotosFilters ABOVE PhotosTable
 * (GH #211 Task 8; records/page.tsx precedent: filters card + table card,
 * both inside the provider).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/app/(main)/photos/components/PhotosTable', () => ({
  PhotosTable: () => <div data-testid="photos-table-stub" />,
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

import { getPhotos, getAllServices, getAllLocations } from '@memo/api-client';
import PhotosPage from '../../app/(main)/photos/page';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPhotos.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
  mockGetAllServices.mockResolvedValue([]);
  mockGetAllLocations.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('photos page wiring (GH #211 Task 8)', () => {
  it('renders the filter bar above the table', async () => {
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

    // Filters BEFORE the table in document order.
    const position = filtersStub.compareDocumentPosition(tableStub);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => {
      expect(mockGetPhotos).toHaveBeenCalled();
    });
  });
});
