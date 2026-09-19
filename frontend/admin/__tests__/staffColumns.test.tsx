/**
 * Tests for staffColumns — the staff table column config (GH #266 / #220
 * Task 2). Pins the «Архив» status column: hidden by default (#220 flips
 * defaultVisible to false — the archive state stays reachable via the row
 * menu and the server status filter), key `status` unchanged (persisted
 * picker selections key off it), and the badge rendered per the #207
 * inverted `archived` field.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { StaffResponse } from '@memo/api-client';
import { staffColumns } from '../app/(main)/staff/components/staffColumns';

// ─── Fixtures (mirrors the StaffTable.test.tsx mock shape) ──────────────────

const noopPositionTitle = () => 'Мастер';

function makeStaff(overrides: Partial<StaffResponse> = {}): StaffResponse {
  return {
    id: 'm1',
    first_name: 'Ольга',
    last_name: 'Середа',
    position_ids: ['master'],
    master: { specialty: 'живопись', color: '#5B8C7A', archived: false },
    has_user: false,
    archived: false,
    ...overrides,
  } as StaffResponse;
}

function renderCell(key: string, staff: StaffResponse) {
  const col = staffColumns(noopPositionTitle).find((c) => c.key === key)!;
  return render(<>{col.render!(staff)}</>);
}

// ─── Shape ─────────────────────────────────────────────────────────────────

describe('staffColumns — «Архив» status column (GH #220 Task 2)', () => {
  it('keeps key «status» and label «Архив», is hidden by default', () => {
    const col = staffColumns(noopPositionTitle).find((c) => c.key === 'status')!;
    // Key must NOT change — persisted picker selections key off it (#220).
    expect(col.key).toBe('status');
    expect(col.label).toBe('Архив');
    expect(col.defaultVisible).toBe(false);
  });

  it('untouched default-visible columns keep their shape', () => {
    const visibleKeys = staffColumns(noopPositionTitle)
      .filter((c) => c.defaultVisible)
      .map((c) => c.key);
    expect(visibleKeys).toEqual(['name', 'positions', 'specialty', 'color']);
  });
});

// ─── Badge cell ─────────────────────────────────────────────────────────────

describe('staffColumns — «Архив» badge cell', () => {
  it('renders «Активен» for an active person', () => {
    const { container } = renderCell('status', makeStaff({ archived: false }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Активен');
  });

  it('renders «Архив» for an archived person', () => {
    const { container } = renderCell('status', makeStaff({ archived: true }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Архив');
  });
});
