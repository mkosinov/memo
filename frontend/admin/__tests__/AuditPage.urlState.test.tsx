import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the wire fetchers (list + authors dropdown source); the factory +
// AuditLogContext + the page's own wiring stay REAL — this pins that the
// PAGE actually feeds its URL adapter into the provider (managed mode).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getAuditLogs: vi.fn(),
    getAuditLogAuthors: vi.fn(),
  };
});

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation } from './helpers/nextNavigationMock';

import { getAuditLogs, getAuditLogAuthors } from '@memo/api-client';
import AuditPage from '../app/(main)/audit/page';

const mockGetAuditLogs = vi.mocked(getAuditLogs);
const mockGetAuditLogAuthors = vi.mocked(getAuditLogAuthors);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGetAuditLogs.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
  mockGetAuditLogAuthors.mockResolvedValue([]);
  __resetNavigation('', '/audit');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AuditPage — URL state wiring (#349 Task 9)', () => {
  it('renders without suspending forever on a bare mount (Suspense boundary present)', async () => {
    const { container } = renderPage();
    // The page shell resolves past the Suspense fallback: heading renders.
    await waitFor(() => expect(container.textContent).toContain('Журнал'), { timeout: 3000 });
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
  });

  it('link filters drive the provider: one fetch carrying the URL params', async () => {
    __resetNavigation('?action=create&entity=tags&date_from=2026-01-01&page=2&per_page=50', '/audit');
    renderPage();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    expect(mockGetAuditLogs.mock.calls[0][0]).toEqual({
      action: 'create',
      entity: 'tags',
      date_from: '2026-01-01',
      page: 2,
      per_page: 50,
    });
  });
});
