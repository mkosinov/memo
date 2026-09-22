import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClientDeepLinkChip } from '../app/(main)/clients/components/ClientDeepLinkChip';

/**
 * #232 §3.5 — the narrowing chip: visible affordance for an active deep-link
 * narrowing + its removal. The ✕ removes every `clientId` from the address
 * (other query params preserved) via router.replace — the Task 4 sync effect
 * converges the filter; the handler itself never touches setFilters.
 */

const mockRouter = { push: vi.fn(), replace: vi.fn() };
let mockSearchParams = new URLSearchParams();
let mockPathname = '/clients';

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
  useRouter: () => mockRouter,
}));

// If the chip ever grows a context dependency, the unmocked real hook throws
// outside a provider — this suite renders the chip bare on purpose.
vi.mock('@/contexts/ClientsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ClientsContext')>();
  return { ...actual, useClientsTable: vi.fn() };
});

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
  mockPathname = '/clients';
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientDeepLinkChip — render (#232 §3.5)', () => {
  it('one id → «Открыт по ссылке» (no UUID in text)', () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    expect(screen.getByText('Открыт по ссылке')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(U1);
  });

  it('two ids → «Открыто по ссылке: 2» (no UUIDs in text)', () => {
    render(<ClientDeepLinkChip clientIds={[U1, U2]} />);
    expect(screen.getByText('Открыто по ссылке: 2')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(U1);
    expect(document.body.textContent).not.toContain(U2);
  });

  it('three ids → «Открыто по ссылке: 3»', () => {
    render(<ClientDeepLinkChip clientIds={[U1, U2, U3]} />);
    expect(screen.getByText('Открыто по ссылке: 3')).toBeInTheDocument();
  });

  it('✕ is an accessible button with aria-label «Снять сужение»', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    const close = screen.getByRole('button', { name: 'Снять сужение' });
    expect(close).toBeInTheDocument();
    // keyboard-focusable: a real button in the tab order, not a div with onClick
    expect(close.tagName).toBe('BUTTON');
  });
});

describe('ClientDeepLinkChip — ✕ removal (#232 §3.5)', () => {
  it('replaces the address without clientId, keeping other query params, scroll: false', () => {
    mockSearchParams = new URLSearchParams([
      ['clientId', U1],
      ['page', '2'],
      ['status', 'all'],
    ]);
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/clients?page=2&status=all', { scroll: false });
  });

  it('removes ALL occurrences (multi-id narrowing)', () => {
    mockSearchParams = new URLSearchParams([
      ['clientId', U1],
      ['clientId', U2],
      ['q', 'анна'],
    ]);
    render(<ClientDeepLinkChip clientIds={[U1, U2]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));
    expect(mockRouter.replace).toHaveBeenCalledWith(
      '/clients?q=%D0%B0%D0%BD%D0%BD%D0%B0',
      { scroll: false },
    );
  });

  it('falls back to the bare pathname when nothing else is left', () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/clients', { scroll: false });
  });

  it('never pushes (replace-only — no history spam)', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('the handler does not write filters — the chip is not a context consumer', async () => {
    // The component must not import useClientsTable at all (single-writer
    // rule): the sync effect from Task 4 converges clientIds after the URL
    // change. Importing the module graph bare (no provider anywhere in this
    // suite) proves no context hook runs during render or click.
    const { useClientsTable } = await import('@/contexts/ClientsContext');
    render(<ClientDeepLinkChip clientIds={[U1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять сужение' }));
    expect(useClientsTable).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });
});
