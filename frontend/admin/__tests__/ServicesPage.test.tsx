/**
 * GH #263 T9 — ServicesPage material-block gating.
 *
 * The «Материалы» toggle on /services is the "materials block" surface: a
 * master holds no materials:read token (spec §3.5), so the tab must not
 * render at all (switching to it would fire a 403 fetch and show an empty
 * table). Admin sees both tabs (no regression).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getServices: vi.fn().mockResolvedValue({
      items: [], total: 0, page: 1, per_page: 10,
    }),
    getAllMaterials: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';
import ServicesPage from '../app/(main)/services/page';
import { UIProvider } from '@/contexts/UIContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.mocked(useAuth);

function mockAuthFor(role: 'admin' | 'master', permissions: string[]) {
  mockUseAuth.mockReturnValue({
    user: { id: 'u-1', phone: '+79990000001', role, master_id: null, email: null },
    permissions,
    master: null,
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
    can: vi.fn(
      (p: string) => permissions.includes('*') || permissions.includes(p),
    ),
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

/** Spec §3.5 master tokens: services:read yes, materials:read NO. */
const MASTER_PERMS = [
  'records:read', 'records:write', 'visits:read', 'visits:write',
  'visitors:read', 'visitors:write', 'services:read', 'locations:read',
  'tags:read', 'masters:read', 'clients:read', 'payments:read',
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <ServicesPage />
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('ServicesPage materials gating (GH #263 T9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the «Материалы» tab without materials:read (master)', async () => {
    mockAuthFor('master', MASTER_PERMS);
    renderPage();
    await screen.findByText('Управление услугами');
    expect(screen.queryByRole('button', { name: 'Материалы' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Услуги' })).toBeInTheDocument();
  });

  it('shows both tabs with materials:read (admin, no regression)', async () => {
    mockAuthFor('admin', ['*']);
    renderPage();
    await screen.findByText('Управление услугами');
    expect(screen.getByRole('button', { name: 'Материалы' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Услуги' })).toBeInTheDocument();
  });

  it('master view keeps services table reachable (services:read)', async () => {
    mockAuthFor('master', MASTER_PERMS);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Нет записей')).toBeInTheDocument();
    });
  });
});
