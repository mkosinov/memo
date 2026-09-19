/**
 * Tests for clientColumns — the clients table column config (GH #220 Task 1).
 *
 * Pins the archived status column added after «Сумма оплат»: hidden by
 * default (defaultVisible: false), NON-sortable (the backend clients sort
 * whitelist has no `archived` key — a sortable header would silently sort by
 * name), and the «Активен»/«Архив» badge rendered on CSS variables per the
 * serviceColumns pattern. Badge text follows client gender («Активен», not
 * «Активна» as in services).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ClientWithStats } from '@memo/api-client';
import { clientColumns } from '../app/(main)/clients/components/clientColumns';

// ─── Fixtures (mirrors ClientsTable.test.tsx mock shape) ────────────────────

function makeClient(overrides: Partial<ClientWithStats> = {}): ClientWithStats {
  return {
    id: 'c1',
    name: 'Анна Иванова',
    phone: '+7 (900) 123-45-67',
    email: null,
    channel: 'telegram',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    archived: false,
    records_count: 5,
    last_record: '2026-05-20T10:00:00',
    total_paid: 17500,
    missed_records: 1,
    ...overrides,
  };
}

function renderCell(key: string, client: ClientWithStats) {
  const col = clientColumns().find((c) => c.key === key)!;
  return render(<>{col.render!(client)}</>);
}

// ─── Shape ─────────────────────────────────────────────────────────────────

describe('clientColumns — archived status column (GH #220 Task 1)', () => {
  it('is the last data column, after «Сумма оплат»', () => {
    const keys = clientColumns().map((c) => c.key);
    expect(keys.indexOf('total_paid')).toBe(keys.length - 2);
    expect(keys[keys.length - 1]).toBe('archived');
  });

  it('has label «Статус», is hidden by default and non-sortable (no server sort key)', () => {
    const col = clientColumns().find((c) => c.key === 'archived')!;
    expect(col.label).toBe('Статус');
    expect(col.defaultVisible).toBe(false);
    expect(col.sortable).toBe(false); // clients sort whitelist has no `archived` — header would silently sort by name
  });
});

// ─── Badge cell ─────────────────────────────────────────────────────────────

describe('clientColumns — archived badge cell (GH #220 Task 1)', () => {
  it('renders «Активен» on the success pair for an active client', () => {
    const { container } = renderCell('archived', makeClient({ archived: false }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Активен');
    expect(badge.style.backgroundColor).toBe('var(--success-bg)');
    expect(badge.style.color).toBe('var(--success)');
  });

  it('renders «Архив» on the muted/surface pair for an archived client', () => {
    const { container } = renderCell('archived', makeClient({ archived: true }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Архив');
    expect(badge.style.backgroundColor).toBe('var(--surface)');
    expect(badge.style.color).toBe('var(--ink-light)');
  });

  it('renders the badge as a rounded chip (serviceColumns pattern, not location Tailwind palette)', () => {
    const { container } = renderCell('archived', makeClient());
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('text-xs');
  });
});

// ─── Regression: untouched columns keep their shape ─────────────────────────

describe('clientColumns — untouched columns regression', () => {
  it('keeps the pre-#220 column order for the first five columns', () => {
    const keys = clientColumns().map((c) => c.key);
    expect(keys.slice(0, 5)).toEqual([
      'name',
      'phone',
      'records_count',
      'last_record',
      'total_paid',
    ]);
  });
});
