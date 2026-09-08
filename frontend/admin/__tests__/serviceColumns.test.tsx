/**
 * Tests for serviceColumns — the services table column config.
 *
 * Covers the GH #223 materials badges column (spec §8): compact chips with
 * material TITLES only (the note ?? description fallback governs the web
 * text block, NOT badges), em dash when a service has no links. Also pins
 * the column shape: materials sits after age, non-sortable; the retired
 * material_hint column is removed by #223 Task 13.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ServiceResponse } from '@memo/api-client';
import { serviceColumns } from '../app/(main)/services/components/serviceColumns';

// ─── Fixtures (recordsColumns.test.tsx precedent — no shared ServiceResponse
// factory exists in helpers/mockData.ts) ────────────────────────────────────

function makeService(overrides: Partial<ServiceResponse> = {}): ServiceResponse {
  return {
    id: 'svc-1',
    title: 'Рисование акварелью',
    description: 'Мастер-класс по акварели',
    image_url: '',
    specialty: 'Живопись',
    min_age: 6,
    max_age: 12,
    duration: 90,
    record_info: '',
    tariffs: [],
    tags: [],
    materials: [],
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderCell(key: string, service: ServiceResponse) {
  const col = serviceColumns().find((c) => c.key === key)!;
  return render(<>{col.render!(service)}</>);
}

// ─── Shape ─────────────────────────────────────────────────────────────────

describe('serviceColumns — shape (GH #223 Task 3)', () => {
  it('has the materials column after age, non-sortable (no server sort key); material_hint is retired (Task 13)', () => {
    const keys = serviceColumns().map((c) => c.key);
    expect(keys).not.toContain('material_hint'); // retired by GH #223 Task 13
    const ageIdx = keys.indexOf('age');
    expect(ageIdx).toBeGreaterThan(-1);
    expect(keys[ageIdx + 1]).toBe('materials');

    const col = serviceColumns().find((c) => c.key === 'materials')!;
    expect(col.label).toBe('Материалы');
    expect(col.defaultVisible).toBe(true);
    expect(col.sortable).toBe(false); // backend sort whitelist has no materials mapping
  });
});

// ─── Materials cell ────────────────────────────────────────────────────────

describe('serviceColumns — materials badges cell (GH #223 Task 3, spec §8)', () => {
  it('renders one chip per material, titles only, in array (title ASC) order', () => {
    renderCell(
      'materials',
      makeService({
        materials: [
          { id: 'm-1', title: 'Акварель', description: 'Акварельные краски', note: 'бумага 300 г' },
          { id: 'm-2', title: 'Керамика', description: 'Глина и стек', note: null },
        ],
      }),
    );

    const chips = screen.getAllByTestId('material-badge');
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.textContent)).toEqual(['Акварель', 'Керамика']);
    // Titles only — note/description never leak into badges (spec §8)
    expect(screen.queryByText('бумага 300 г')).not.toBeInTheDocument();
    expect(screen.queryByText('Акварельные краски')).not.toBeInTheDocument();
  });

  it('renders an em dash when the service has no materials', () => {
    renderCell('materials', makeService({ materials: [] }));

    expect(screen.queryByTestId('material-badge')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
