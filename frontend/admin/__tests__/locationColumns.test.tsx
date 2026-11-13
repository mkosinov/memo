import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { LocationResponse } from '@memo/api-client';
import { locationColumns } from '../app/(main)/locations/components/locationColumns';

/**
 * GH #601 Task 4 — «Не в web» badge in the locations table title cell.
 *
 * Spec §2.6/§5: a location with «Видно клиентам» off (`is_public = false`)
 * shows the «Не в web» pill NEXT TO THE TITLE (donor: the «Архив» badge
 * pattern — muted gray pair, rounded-full, text-xs). The badge is a
 * negative-space signal only — no visibility filter is added to the
 * filters row (spec §8).
 */

function makeLocation(overrides: Partial<LocationResponse> = {}): LocationResponse {
  return {
    id: 'loc-1',
    title: 'Студия на Невском',
    address: 'Невский пр. 28',
    description: null,
    capacity: 10,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    location_hint: null,
    sort_order: 0,
    is_public: true,
    archived: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

function renderTitleCell(location: LocationResponse) {
  const col = locationColumns().find((c) => c.key === 'title')!;
  return render(<>{col.render!(location)}</>);
}

describe('locationColumns — «Не в web» badge (GH #601)', () => {
  it('hidden location (is_public=false): badge next to the title', () => {
    const { container } = renderTitleCell(makeLocation({ is_public: false }));
    const badge = container.querySelector('[data-testid="location-web-hidden-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Не в web');
    // The title itself stays the cell's primary content.
    expect(container.textContent).toContain('Студия на Невском');
  });

  it('visible location (is_public=true): no badge', () => {
    const { container } = renderTitleCell(makeLocation({ is_public: true }));
    expect(container.querySelector('[data-testid="location-web-hidden-badge"]')).toBeNull();
  });

  it('hidden ≠ archived: an is_public=false location may be unarchived and vice versa', () => {
    // Both negative flags can coexist; the badge renders regardless of archive state.
    const { container } = renderTitleCell(
      makeLocation({ is_public: false, archived: true }),
    );
    expect(container.querySelector('[data-testid="location-web-hidden-badge"]')).not.toBeNull();
  });
});
