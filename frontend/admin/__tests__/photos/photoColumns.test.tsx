/**
 * Tests for photoColumns — the photos table column config (GH #211 Task 9).
 *
 * Pins the 8-column array: sortable ONLY filename/is_public/created_at
 * (sortField values match the server PhotoSortBy whitelist), «Клиент» via
 * client_name, «Услуга»/«Локация» resolved through the /all maps (unknown /
 * archived ids → «—»), «Активность» hidden by default (raw id until #213),
 * «Дата» date-first.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { PhotoResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { photoColumns } from '../../app/(main)/photos/components/photoColumns';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makePhoto(overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: 'p-1',
    filename: 'море-001.jpg',
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: false,
    tags: [],
    client_name: null,
    created_at: '2026-06-07T14:05:00',
    updated_at: '2026-06-07T14:05:00',
    ...overrides,
  };
}

function makeService(id: string, title: string): ServiceResponse {
  return {
    id,
    title,
    description: '',
    image_url: '',
    specialty: '',
    min_age: 0,
    max_age: null,
    duration: 60,
    record_info: '',
    tariffs: [],
    tags: [],
    materials: [],
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeLocation(id: string, name: string): LocationResponse {
  return {
    id,
    name,
    address: '',
    description: null,
    capacity: 10,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const servicesMap = new Map<string, ServiceResponse>([
  ['svc-1', makeService('svc-1', 'Картина маслом')],
]);
const locationsMap = new Map<string, LocationResponse>([
  ['loc-1', makeLocation('loc-1', 'Студия на Невском')],
]);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('photoColumns — shape (GH #211 Task 9)', () => {
  it('returns the 8 columns in spec order', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    expect(cols.map((c) => c.key)).toEqual([
      'preview',
      'filename',
      'client',
      'service',
      'location',
      'activity',
      'is_public',
      'created_at',
    ]);
  });

  it('marks ONLY filename/is_public/created_at sortable (server PhotoSortBy)', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const byKey = new Map(cols.map((c) => [c.key, c]));

    expect(byKey.get('preview')?.sortable).toBe(false);
    expect(byKey.get('client')?.sortable).toBe(false);
    expect(byKey.get('service')?.sortable).toBe(false);
    expect(byKey.get('location')?.sortable).toBe(false);
    expect(byKey.get('activity')?.sortable).toBe(false);

    expect(byKey.get('filename')?.sortable).not.toBe(false);
    expect(byKey.get('filename')?.sortField).toBe('filename');
    expect(byKey.get('is_public')?.sortable).not.toBe(false);
    expect(byKey.get('is_public')?.sortField).toBe('is_public');
    expect(byKey.get('created_at')?.sortable).not.toBe(false);
    expect(byKey.get('created_at')?.sortField).toBe('created_at');
  });

  it('hides ONLY «Активность» by default', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    expect(cols.filter((c) => !c.defaultVisible).map((c) => c.key)).toEqual(['activity']);
    expect(cols.find((c) => c.key === 'preview')?.defaultVisible).toBe(true);
  });
});

describe('photoColumns — cell rendering (GH #211 Task 9)', () => {
  it('renders «Клиент» from client_name (and «—» when absent)', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const client = cols.find((c) => c.key === 'client')!;

    render(<>{client.render!(makePhoto({ client_name: 'Анна Иванова' }))}</>);
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();

    render(<>{client.render!(makePhoto())}</>);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('resolves «Услуга»/«Локация» via the maps; unknown ids → «—»', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const service = cols.find((c) => c.key === 'service')!;
    const location = cols.find((c) => c.key === 'location')!;

    render(
      <>
        {service.render!(makePhoto({ service_id: 'svc-1' }))}
        {location.render!(makePhoto({ location_id: 'loc-1' }))}
      </>,
    );
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();

    render(
      <>
        {service.render!(makePhoto({ service_id: 'archived-svc' }))}
        {location.render!(makePhoto({ location_id: 'archived-loc' }))}
        {service.render!(makePhoto())}
        {location.render!(makePhoto())}
      </>,
    );
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('renders «Активность» as the raw id (until #213)', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const activity = cols.find((c) => c.key === 'activity')!;

    render(<>{activity.render!(makePhoto({ activity_id: 'act-1' }))}</>);
    expect(screen.getByText('act-1')).toBeInTheDocument();

    render(<>{activity.render!(makePhoto())}</>);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the «Публичное» badge: Да / Нет', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const isPublic = cols.find((c) => c.key === 'is_public')!;

    render(<>{isPublic.render!(makePhoto({ is_public: true }))}</>);
    expect(screen.getByText('Да')).toBeInTheDocument();

    render(<>{isPublic.render!(makePhoto({ is_public: false }))}</>);
    expect(screen.getByText('Нет')).toBeInTheDocument();
  });

  it('renders «Дата» date-first from created_at', () => {
    const cols = photoColumns({ servicesMap, locationsMap });
    const createdAt = cols.find((c) => c.key === 'created_at')!;

    render(<>{createdAt.render!(makePhoto())}</>);
    expect(screen.getByText('07.06.2026')).toBeInTheDocument();
  });
});
