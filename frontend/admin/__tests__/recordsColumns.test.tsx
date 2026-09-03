/**
 * Tests for recordsColumns — the records table column config (GH #213 Task 7).
 *
 * Pins the lookup-free factory (spec §6.2: the RecordColumnLookup seam is
 * gone; the factory takes only `onClientClick` and cells read the
 * denormalized RecordView row fields from GET /records/view). Covers every
 * cell's rendering and fallback: date ('—' when activity_start is null),
 * client name + onClientClick wiring, service + DiamondIcon, master dot
 * color/tooltip, location, guests, total and the three payment badges.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { RecordView } from '@memo/api-client';
import { recordColumns } from '../app/(main)/records/components/recordsColumns';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RecordView> = {}): RecordView {
  return {
    id: 'rec-1',
    activity_id: 'act-1',
    client_id: 'client-1',
    status: 'waiting',
    seats: 1,
    anonym_visits: 0,
    comment: null,
    custom_price: null,
    created_at: '2026-06-15T10:00:00',
    updated_at: '2026-06-15T10:00:00',
    visits: [
      {
        id: 'vis-1',
        record_id: 'rec-1',
        visitor_id: 'v-1',
        price: 2500,
        custom_price: null,
        status: 'active',
        created_at: '2026-06-15T10:00:00',
        updated_at: '2026-06-15T10:00:00',
      },
    ],
    // View display fields (GH #213 §4)
    client_name: 'Анна Смирнова',
    activity_start: '2026-06-15T10:00:00Z',
    service_title: 'Рисование акварелью',
    master_name: 'Иванова Мария',
    location_name: 'Студия на Арбате',
    master_color: '#E74C3C',
    is_private: false,
    paid: 0,
    ...overrides,
  };
}

function columns(onClientClick = vi.fn()) {
  return recordColumns({ onClientClick });
}

function renderCell(key: string, record: RecordView, onClientClick = vi.fn()) {
  const col = columns(onClientClick).find((c) => c.key === key)!;
  return render(<>{col.render!(record)}</>);
}

// ─── Shape ─────────────────────────────────────────────────────────────────

describe('recordColumns — shape (GH #213 Task 7, spec §6.2)', () => {
  it('is a lookup-free factory (only onClientClick) keeping the 9 columns in order', () => {
    const cols = columns();
    expect(cols.map((c) => c.key)).toEqual([
      'date',
      'client',
      'guests',
      'service',
      'master',
      'location',
      'status',
      'total',
      'payment',
    ]);
  });
});

// ─── Date cell ─────────────────────────────────────────────────────────────

describe('recordColumns — date cell (spec §6.3)', () => {
  it('renders row.activity_start via parseActivityStart/formatDateRu/formatTime', () => {
    renderCell('date', makeRecord({ activity_start: '2026-06-15T10:00:00Z' }));
    expect(screen.getByText('15 июня')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('renders «—» when activity_start is null', () => {
    renderCell('date', makeRecord({ activity_start: null }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ─── Client cell ───────────────────────────────────────────────────────────

describe('recordColumns — client cell (spec §6.3)', () => {
  it('renders row.client_name in a button; click passes the row to onClientClick', () => {
    const onClientClick = vi.fn();
    const record = makeRecord({ client_name: 'Анна Смирнова' });
    renderCell('client', record, onClientClick);
    const button = screen.getByRole('button', { name: 'Анна Смирнова' });
    fireEvent.click(button);
    expect(onClientClick).toHaveBeenCalledWith(record);
  });

  it('renders «—» when client_name is null (anonymous record)', () => {
    renderCell('client', makeRecord({ client_id: null, client_name: null }));
    expect(screen.getByRole('button', { name: '—' })).toBeInTheDocument();
  });
});

// ─── Guests / total cells ──────────────────────────────────────────────────

describe('recordColumns — guests and total cells (unchanged semantics)', () => {
  it('guests = max(1, visits.length)', () => {
    const visits = makeRecord().visits;
    renderCell(
      'guests',
      makeRecord({ visits: [...visits, { ...visits[0], id: 'vis-2' }] }),
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    renderCell('guests', makeRecord());
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('total = sum of visit prices', () => {
    renderCell('total', makeRecord());
    expect(screen.getByText('2 500₽')).toBeInTheDocument();
  });
});

// ─── Service cell ──────────────────────────────────────────────────────────

describe('recordColumns — service cell (spec §6.3)', () => {
  it('renders row.service_title with the DiamondIcon when is_private', () => {
    renderCell('service', makeRecord({ service_title: 'Йога', is_private: true }));
    expect(screen.getByText('Йога')).toBeInTheDocument();
    expect(screen.getByLabelText('Индивидуальное занятие')).toBeInTheDocument();
  });

  it('omits the DiamondIcon for group activities', () => {
    renderCell('service', makeRecord({ is_private: false }));
    expect(screen.queryByLabelText('Индивидуальное занятие')).not.toBeInTheDocument();
  });

  it('renders «—» when service_title is null', () => {
    renderCell('service', makeRecord({ service_title: null }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ─── Master cell ───────────────────────────────────────────────────────────

describe('recordColumns — master cell (spec §6.3)', () => {
  it('renders the color dot with row.master_color and a row.master_name tooltip', () => {
    const { container } = renderCell(
      'master',
      makeRecord({ master_color: '#E74C3C', master_name: 'Иванова Мария' }),
    );
    const dot = container.querySelector('[title="Иванова Мария"]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe('rgb(231, 76, 60)');
  });

  it('falls back to the gray #999 dot without a tooltip when master fields are null', () => {
    const { container } = renderCell(
      'master',
      makeRecord({ master_color: null, master_name: null }),
    );
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(1);
    expect((dots[0] as HTMLElement).style.backgroundColor).toBe('rgb(153, 153, 153)');
    expect(dots[0].getAttribute('title')).toBeNull();
  });
});

// ─── Location cell ─────────────────────────────────────────────────────────

describe('recordColumns — location cell (spec §6.3)', () => {
  it('renders row.location_name and «—» when null', () => {
    renderCell('location', makeRecord({ location_name: 'Студия на Арбате' }));
    expect(screen.getByText('Студия на Арбате')).toBeInTheDocument();

    renderCell('location', makeRecord({ location_name: null }));
    expect(screen.getAllByText('—')).toHaveLength(1);
  });
});

// ─── Payment cell ──────────────────────────────────────────────────────────

describe('recordColumns — payment badges (spec §6.3)', () => {
  it('renders «✓ Оплачено» when row.paid covers the visits total', () => {
    renderCell('payment', makeRecord({ paid: 2500 }));
    expect(screen.getByText('✓ Оплачено')).toBeInTheDocument();
  });

  it('renders «Частично (N₽)» when 0 < row.paid < total', () => {
    renderCell('payment', makeRecord({ paid: 1000 }));
    expect(screen.getByText('Частично (1 000₽)')).toBeInTheDocument();
  });

  it('renders «Не оплачено» when row.paid is 0', () => {
    renderCell('payment', makeRecord({ paid: 0 }));
    expect(screen.getByText('Не оплачено')).toBeInTheDocument();
  });
});
