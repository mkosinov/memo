import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecordHeader } from '../RecordHeader';
import type { RecordWithDerived } from '../types';
import type { ClientResponse, VisitResponse, PaymentResponse, TariffResponse } from '@memo/api-client';

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

const mockVisit: VisitResponse = {
  id: 'v1',
  record_id: 'r1',
  visitor_id: 'vis1',
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
      anonym_visits: 0,
      comment: null,
      custom_price: null,
      created_at: '2026-05-10T10:00:00',
      updated_at: '2026-05-10T10:00:00',
      visits: [mockVisit],
    },
    status: 'waiting',
    visits: [mockVisit],
    payments: [],
    client: mockClient,
    tariffs: [],
    ...overrides,
  };
}

describe('RecordHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders client name and phone', () => {
    render(<RecordHeader data={makeData()} />);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByText('+7 (900) 123-45-67')).toBeInTheDocument();
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
    render(<RecordHeader data={makeData({ visits: [mockVisit] })} />);
    expect(screen.getByText(/1 место/)).toBeInTheDocument();
  });

  it('debounces anonym_visits change and calls onAnonymVisitsChange', async () => {
    const onAnonymVisitsChange = vi.fn();
    render(
      <RecordHeader
        data={makeData()}
        onAnonymVisitsChange={onAnonymVisitsChange}
      />,
    );

    const input = screen.getByTestId('anonym-visits-input');
    fireEvent.change(input, { target: { value: '3' } });

    // Not called yet (debounced 500ms)
    expect(onAnonymVisitsChange).not.toHaveBeenCalled();

    // Advance timer past debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onAnonymVisitsChange).toHaveBeenCalledWith(3);
  });
});
