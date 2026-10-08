import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecordHeader } from '../RecordHeader';
import type { RecordWithDerived } from '../types';
import type { ClientResponse, VisitResponse } from '@memo/api-client';
import { formatPhoneDisplay } from '@/app/components/shared/phone/format';

const mockClient: ClientResponse = {
  id: 'c1',
  name: 'Анна Иванова',
  phone: '+7 (900) 123-45-67',
  email: null,
  channel: 'telegram',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  archived: false,
};

const mockNamedVisit: VisitResponse = {
  id: 'v1',
  record_id: 'r1',
  visitor_id: 'vis1',
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
};

/** #257: anonymous seats are real visits with visitor_id = null. */
const mockAnonymousVisit: VisitResponse = {
  id: 'v2',
  record_id: 'r1',
  visitor_id: null,
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
};

function makeData(overrides: Partial<RecordWithDerived> = {}): RecordWithDerived {
  return {
    record: {
      id: 'r1',
      activity_id: 'ev_1',
      client_id: 'c1',
      seats: 1,
      comment: null,
      custom_price: null,
      created_at: '2026-05-10T10:00:00',
      updated_at: '2026-05-10T10:00:00',
      visits: [mockNamedVisit],
    },
    status: 'waiting',
    visits: [mockNamedVisit],
    payments: [],
    client: mockClient,
    tariffs: [],
    ...overrides,
  };
}

// ─── Phone display through the shared formatter (GH #414 Task 9) ───────────

/** Legacy seed-row spellings → the grouped display (spec §Форматирование,
 *  показ); the second pin locks the header to `formatPhoneDisplay`. */
const LEGACY_SEED_SPELLINGS: Array<[string, string]> = [
  ['+79991234567', '+7 999 123 45 67'], // compact storage (current seeds)
  ['+7 999 123-45-67', '+7 999 123 45 67'], // legacy spaced/hyphenated
  ['8 999 123-45-67', '+7 999 123 45 67'], // legacy trunk-prefixed
  ['спам', 'спам'], // garbage → verbatim (tolerance to legacy rows)
];

describe('RecordHeader — phone display (GH #414 Task 9)', () => {
  it.each(LEGACY_SEED_SPELLINGS)('client phone line renders stored %s as %s', (stored, expected) => {
    const client: ClientResponse = { ...mockClient, phone: stored };
    render(<RecordHeader data={makeData({ client })} />);
    expect(screen.getByTestId('client-phone').textContent).toBe(expected);
    expect(expected).toBe(formatPhoneDisplay(stored));
  });
});

describe('RecordHeader', () => {
  it('renders client name and phone', () => {
    render(<RecordHeader data={makeData()} />);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    // GH #414: the stored '+7 (900) 123-45-67' renders grouped.
    expect(screen.getByText('+7 900 123 45 67')).toBeInTheDocument();
  });

  it('renders "Без имени" when client is null', () => {
    render(<RecordHeader data={makeData({ client: null })} />);
    expect(screen.getByText('Без имени')).toBeInTheDocument();
  });

  it('renders StatusBadge with the derived status', () => {
    render(<RecordHeader data={makeData({ status: 'visited' })} />);
    expect(screen.getByTestId('status-badge-visited')).toBeInTheDocument();
  });

  it('shows seats summary with correct pluralization', () => {
    render(<RecordHeader data={makeData({ visits: [mockNamedVisit] })} />);
    expect(screen.getByText(/1 место/)).toBeInTheDocument();
  });

  it('derives the anonymous count from visits (visitor_id = null)', () => {
    render(
      <RecordHeader
        data={makeData({ visits: [mockNamedVisit, mockAnonymousVisit] })}
      />,
    );
    expect(screen.getByText('1 анонимных')).toBeInTheDocument();
  });

  it('calls onAddAnonymousVisit on inc click', async () => {
    const onAddAnonymousVisit = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordHeader data={makeData()} onAddAnonymousVisit={onAddAnonymousVisit} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('anonym-visits-inc'));
    });

    expect(onAddAnonymousVisit).toHaveBeenCalledTimes(1);
  });

  it('calls onDeleteAnonymousVisit on dec click', async () => {
    const onDeleteAnonymousVisit = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordHeader
        data={makeData({ visits: [mockNamedVisit, mockAnonymousVisit] })}
        onDeleteAnonymousVisit={onDeleteAnonymousVisit}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('anonym-visits-dec'));
    });

    expect(onDeleteAnonymousVisit).toHaveBeenCalledTimes(1);
  });

  it('disables dec when there are no anonymous visits', () => {
    render(
      <RecordHeader data={makeData({ visits: [] })} onAddAnonymousVisit={vi.fn()} />,
    );

    expect(screen.getByTestId('anonym-visits-dec')).toBeDisabled();
  });

  it('hides the stepper zone in read-only mode', () => {
    render(
      <RecordHeader
        data={makeData({ visits: [mockNamedVisit, mockAnonymousVisit] })}
        isReadOnly
      />,
    );

    expect(screen.queryByTestId('anonym-visits-inc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('anonym-visits-dec')).not.toBeInTheDocument();
    expect(screen.queryByText('1 анонимных')).not.toBeInTheDocument();
  });

  it('ignores repeated inc clicks while onAddAnonymousVisit is pending', async () => {
    let resolveAdd!: () => void;
    const onAddAnonymousVisit = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveAdd = res;
        }),
    );
    render(
      <RecordHeader data={makeData()} onAddAnonymousVisit={onAddAnonymousVisit} />,
    );

    const inc = screen.getByTestId('anonym-visits-inc');
    await act(async () => {
      fireEvent.click(inc);
    });

    expect(onAddAnonymousVisit).toHaveBeenCalledTimes(1);
    // Button is pending → disabled
    expect(inc).toBeDisabled();

    // Repeated click while pending — handler not invoked again
    await act(async () => {
      fireEvent.click(inc);
    });
    expect(onAddAnonymousVisit).toHaveBeenCalledTimes(1);

    // Resolve → button re-enables
    await act(async () => {
      resolveAdd();
    });
    expect(inc).toBeEnabled();
  });
});
