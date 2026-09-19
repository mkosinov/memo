/**
 * Tests for materialColumns — the materials table column config (#139 T4 /
 * GH #220 Task 2). Pins the «Статус» status column: hidden by default (#220
 * flips defaultVisible to false — archive state stays reachable via the row
 * menu and the server status filter), key `archived` unchanged (persisted
 * picker selections key off it), and the badge verbatim from the pre-#139
 * cell.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { MaterialResponse } from '@memo/api-client';
import { materialColumns } from '../app/(main)/services/components/materialsColumns';

// ─── Fixtures (mirrors the MaterialsTable.test.tsx mock shape) ──────────────

function makeMaterial(overrides: Partial<MaterialResponse> = {}): MaterialResponse {
  return {
    id: 'mat-1',
    title: 'Фартук',
    description: 'Защитная одежда',
    archived: false,
    used_in_services_count: 2,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderCell(key: string, material: MaterialResponse) {
  const col = materialColumns().find((c) => c.key === key)!;
  return render(<>{col.render!(material)}</>);
}

// ─── Shape ─────────────────────────────────────────────────────────────────

describe('materialColumns — «Статус» status column (GH #220 Task 2)', () => {
  it('keeps key «archived» and label «Статус», is hidden by default', () => {
    const col = materialColumns().find((c) => c.key === 'archived')!;
    // Key must NOT change — persisted picker selections key off it (#220).
    expect(col.key).toBe('archived');
    expect(col.label).toBe('Статус');
    expect(col.defaultVisible).toBe(false);
  });

  it('untouched default-visible columns keep their shape', () => {
    const visibleKeys = materialColumns()
      .filter((c) => c.defaultVisible)
      .map((c) => c.key);
    expect(visibleKeys).toEqual(['title', 'description', 'used_in_services_count']);
  });
});

// ─── Badge cell ─────────────────────────────────────────────────────────────

describe('materialColumns — «Статус» badge cell', () => {
  it('renders «Активен» on the success pair for an active material', () => {
    const { container } = renderCell('archived', makeMaterial({ archived: false }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Активен');
    expect(badge.style.backgroundColor).toBe('var(--success-bg, #dcfce7)');
    expect(badge.style.color).toBe('var(--success, #16a34a)');
  });

  it('renders «Архив» on the muted/surface pair for an archived material', () => {
    const { container } = renderCell('archived', makeMaterial({ archived: true }));
    const badge = container.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Архив');
    expect(badge.style.backgroundColor).toBe('var(--surface)');
    expect(badge.style.color).toBe('var(--ink-light)');
  });
});
