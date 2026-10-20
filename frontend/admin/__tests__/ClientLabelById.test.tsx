/**
 * GH #140 US-2 progressive client label + GH #414 Task 9 phone display.
 *
 * Spec §Форматирование, показ: the record-tab client label renders the
 * stored phone through the shared display formatter — legacy seed-row
 * spellings («+7 999 …», «8 …», compact «+7999…») group like compacts,
 * garbage passes through verbatim. Progressive states are pinned too:
 * «…» while pending, «Без контакта» ONLY on error or an anonymous record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ClientResponse } from '@memo/api-client';

vi.mock('@/hooks/useClient', () => ({
  useClient: vi.fn(),
}));

import { useClient } from '@/hooks/useClient';
import { ClientLabelById } from '../app/components/modal/ActivityDetailsModal/ClientLabelById';
import { formatPhoneDisplay } from '../app/components/shared/phone/format';
import { LEGACY_SEED_SPELLINGS } from './helpers/mockData';

const mockUseClient = vi.mocked(useClient);

function makeClient(overrides: Partial<ClientResponse> = {}): ClientResponse {
  return {
    id: 'c1',
    name: 'Анна Иванова',
    phone: '+79991234567',
    email: null,
    channel: null,
    created_at: '',
    updated_at: '',
    archived: false,
    ...overrides,
  };
}

function mockClientQuery(client: ClientResponse | null): void {
  mockUseClient.mockReturnValue({
    data: client ?? undefined,
    isPending: client === null,
    isError: false,
  } as unknown as ReturnType<typeof useClient>);
}

beforeEach(() => {
  mockClientQuery(makeClient());
});

afterEach(() => vi.restoreAllMocks());

// ─── Progressive states (GH #140 US-2) ──────────────────────────────────────

describe('ClientLabelById — progressive states', () => {
  it('renders «…» while the client query is pending', () => {
    mockUseClient.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useClient>);
    render(<ClientLabelById clientId="c1" />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('renders «Без контакта» on query error', () => {
    mockUseClient.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useClient>);
    render(<ClientLabelById clientId="c1" />);
    expect(screen.getByText('Без контакта')).toBeInTheDocument();
  });

  it('renders «Без контакта» for an anonymous record (no client id)', () => {
    render(<ClientLabelById clientId={undefined} />);
    expect(screen.getByText('Без контакта')).toBeInTheDocument();
  });
});

// ─── Phone display through the shared formatter (GH #414 Task 9) ───────────
// The spellings table lives in the shared fixtures (GH #429 dedup); the
// second pin locks the label to `formatPhoneDisplay` — the automatable
// seed-row eyeball check from the plan DoD.

describe('ClientLabelById — phone display (GH #414 Task 9)', () => {
  it.each(LEGACY_SEED_SPELLINGS)(
    'secondary line renders stored %s as %s (formatPhoneDisplay)',
    (stored, expected) => {
      mockClientQuery(makeClient({ phone: stored }));
      const { container } = render(<ClientLabelById clientId="c1" />);
      const lines = container.querySelectorAll('span');
      expect(lines[0].textContent).toBe('Анна Иванова');
      expect(lines[1].textContent).toBe(expected);
      expect(expected).toBe(formatPhoneDisplay(stored));
    },
  );

  it('falls back to the formatted phone in the primary line when the name is empty', () => {
    mockClientQuery(makeClient({ name: '', phone: '+79991234567' }));
    const { container } = render(<ClientLabelById clientId="c1" />);
    const lines = container.querySelectorAll('span');
    expect(lines[0].textContent).toBe('+7 999 123 45 67');
  });

  it('renders only the name line when the stored phone is null', () => {
    mockClientQuery(makeClient({ phone: null }));
    const { container } = render(<ClientLabelById clientId="c1" />);
    expect(container.querySelectorAll('span')).toHaveLength(1);
    expect(container.querySelector('span')!.textContent).toBe('Анна Иванова');
  });
});
