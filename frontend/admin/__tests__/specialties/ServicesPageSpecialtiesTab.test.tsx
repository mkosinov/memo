import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// GH #599 Task 8.1 — the third view of the /services page: the tab's
// visibility rides on can('specialties:read') (the materials:read
// precedent), the button carries data-testid="specialties-tab" (spec VC),
// and #349 mounts ONLY the visible view's provider (no background fetch).

const { mockCan } = vi.hoisted(() => ({ mockCan: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can: mockCan }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getServices: vi.fn(),
    getMaterials: vi.fn(),
    getSpecialties: vi.fn(),
  };
});

vi.mock('next/navigation', async () => await import('../helpers/nextNavigationMock'));
import { __resetNavigation } from '../helpers/nextNavigationMock';

import { getServices, getMaterials, getSpecialties } from '@memo/api-client';
import ServicesPage from '@/app/(main)/services/page';
import { PendingActionsProvider } from '@/contexts/PendingActionsContext';

const mockGetServices = vi.mocked(getServices);
const mockGetMaterials = vi.mocked(getMaterials);
const mockGetSpecialties = vi.mocked(getSpecialties);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // PendingActionsProvider mirrors the root layout — the default services
  // view's mutation hooks consume it at mount.
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingActionsProvider>
        <ServicesPage />
      </PendingActionsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetNavigation('', '/services');
  mockGetServices.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
  mockGetMaterials.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
  mockGetSpecialties.mockResolvedValue({
    items: [
      {
        id: 'spec-painting',
        title: 'Живопись',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T10:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    per_page: 10,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ServicesPage — the «Направления» third view (GH #599 Task 8.1)', () => {
  it('admin sees the specialties tab; the default view stays «Услуги» — no background specialty fetch (#349)', async () => {
    mockCan.mockImplementation((p: string) => p === 'materials:read' || p === 'specialties:read');
    renderPage();

    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('specialties-tab')).toBeInTheDocument();
    expect(screen.getByTestId('specialties-tab')).toHaveTextContent('Направления');
    // #349: only the VISIBLE view's provider mounts — the specialties (and
    // materials) first GETs never fire from the services view.
    expect(mockGetSpecialties).not.toHaveBeenCalled();
    expect(mockGetMaterials).not.toHaveBeenCalled();
    expect(screen.getByText('Управление услугами')).toBeInTheDocument();
  });

  it('clicking the tab switches the view: header + ONE paged specialty fetch', async () => {
    mockCan.mockImplementation((p: string) => p === 'specialties:read');
    renderPage();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('specialties-tab'));

    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(1));
    expect(mockGetSpecialties).toHaveBeenCalledWith({ page: 1, per_page: 10 });
    expect(screen.getByText('Управление направлениями')).toBeInTheDocument();
    expect(await screen.findByText('Живопись')).toBeInTheDocument();
    // The services provider unmounted — no second services fetch.
    expect(mockGetServices).toHaveBeenCalledTimes(1);
  });

  it('without specialties:read the tab is hidden (the materials:read precedent)', async () => {
    mockCan.mockImplementation(() => false);
    renderPage();

    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('specialties-tab')).not.toBeInTheDocument();
  });
});
