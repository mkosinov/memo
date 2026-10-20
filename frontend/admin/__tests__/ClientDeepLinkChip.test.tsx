import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClientDeepLinkChip } from '../app/(main)/clients/components/ClientDeepLinkChip';

/**
 * #232 §3.5 — the narrowing chip: visible affordance for an active deep-link
 * narrowing + its removal. The ✕ removes every `clientId` from the address
 * (other query params preserved) via the injected onRemove (#349: the
 * page's URL-hook navigate) converges the filter; the handler itself never
 * touches setFilters.
 *
 * #412 US-4 (spec §3.2): the container carries
 * `data-testid="client-deep-link-chip"`; the ✕ accessible name substitutes
 * the client («Убрать фильтр по клиенту: <имя>») with honest fallbacks
 * (dead link — no name to substitute; multi-id — the count), and after
 * removal focus moves to the filters panel, not the page body.
 */

const onRemove = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockPathname = '/clients';

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
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

/**
 * Mount a bare stand-in for the toolbar panel root (#412 focus target): the
 * chip locates the panel by its spec-mandated testid and calls focus().
 */
function mountFakePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.setAttribute('data-testid', 'clients-filters');
  panel.tabIndex = -1;
  document.body.appendChild(panel);
  return panel;
}

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
  mockPathname = '/clients';
  onRemove.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelector('[data-testid="clients-filters"]')?.remove();
});

describe('ClientDeepLinkChip — render (#232 §3.5, #412 US-4)', () => {
  it('one id → «Открыт по ссылке» (no UUID in text)', () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    expect(screen.getByText('Открыт по ссылке')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(U1);
  });

  it('two ids → «Открыто по ссылке: 2» (no UUIDs in text)', () => {
    render(<ClientDeepLinkChip clientIds={[U1, U2]} onRemove={onRemove} />);
    expect(screen.getByText('Открыто по ссылке: 2')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(U1);
    expect(document.body.textContent).not.toContain(U2);
  });

  it('three ids → «Открыто по ссылке: 3»', () => {
    render(<ClientDeepLinkChip clientIds={[U1, U2, U3]} onRemove={onRemove} />);
    expect(screen.getByText('Открыто по ссылке: 3')).toBeInTheDocument();
  });

  it('container carries data-testid="client-deep-link-chip" (#412)', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    expect(screen.getByTestId('client-deep-link-chip')).toBeInTheDocument();
  });

  it('✕ name substitutes the client when known (#412: «Убрать фильтр по клиенту: <имя>»)', () => {
    render(
      <ClientDeepLinkChip clientIds={[U1]} clientName="Анна Иванова" onRemove={onRemove} />,
    );
    expect(
      screen.getByRole('button', { name: 'Убрать фильтр по клиенту: Анна Иванова' }),
    ).toBeInTheDocument();
  });

  it('✕ name falls back without substitution when the client name is unknown (dead link)', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: 'Убрать фильтр по клиенту' })).toBeInTheDocument();
  });

  it('✕ name for multi-id carries the count («по клиентам: N»)', () => {
    render(<ClientDeepLinkChip clientIds={[U1, U2]} onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: 'Убрать фильтр по клиентам: 2' })).toBeInTheDocument();
  });

  it('✕ is an accessible real button (keyboard-focusable, not a div with onClick)', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    const close = screen.getByRole('button', { name: 'Убрать фильтр по клиенту' });
    expect(close.tagName).toBe('BUTTON');
  });
});

describe('ClientDeepLinkChip — ✕ removal (#232 §3.5, #412 focus)', () => {
  it('replaces the address without clientId, keeping other query params, scroll: false', () => {
    mockSearchParams = new URLSearchParams([
      ['clientId', U1],
      ['page', '2'],
      ['status', 'all'],
    ]);
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр по клиенту' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('/clients?page=2&status=all');
  });

  it('removes ALL occurrences (multi-id narrowing)', () => {
    mockSearchParams = new URLSearchParams([
      ['clientId', U1],
      ['clientId', U2],
      ['q', 'анна'],
    ]);
    render(<ClientDeepLinkChip clientIds={[U1, U2]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр по клиентам: 2' }));
    expect(onRemove).toHaveBeenCalledWith('/clients?q=%D0%B0%D0%BD%D0%BD%D0%B0');
  });

  it('falls back to the bare pathname when nothing else is left', () => {
    mockSearchParams = new URLSearchParams([['clientId', U1]]);
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр по клиенту' }));
    expect(onRemove).toHaveBeenCalledWith('/clients');
  });

  it('after removal focus moves to the filters panel, not the page body (#412 US-4)', () => {
    const panel = mountFakePanel();
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    const close = screen.getByRole('button', { name: 'Убрать фильтр по клиенту' });
    close.focus();
    expect(document.activeElement).toBe(close); // keyboard user was on the ✕
    fireEvent.click(close);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(panel); // panel root, not <body>
  });

  it('removal stays a no-op on focus when no panel is mounted (defensive)', () => {
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр по клиенту' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('the handler does not write filters — the chip is not a context consumer', async () => {
    // The component must not import useClientsTable at all (single-writer
    // rule): the sync effect from Task 4 converges clientIds after the URL
    // change. Importing the module graph bare (no provider anywhere in this
    // suite) proves no context hook runs during render or click.
    const { useClientsTable } = await import('@/contexts/ClientsContext');
    render(<ClientDeepLinkChip clientIds={[U1]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр по клиенту' }));
    expect(useClientsTable).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
