/**
 * Tests for PhotoModal (GH #211 Task 9):
 *   - «Посетитель» field GONE; «Клиент» searchable picker (active clients)
 *   - «Локация» Combobox over getAllLocations() (GH #214 row 9)
 *   - mutually-exclusive owners: picking Активность clears Услуга and vice versa
 *   - canonical activity label (spec §7.7) in BOTH dropdown options and the
 *     selected value («dd.mm.yyyy HH:mm — Локация — Услуга»)
 *   - server 422 (≥2 owners) surfaces via the existing onSubmit catch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhotoModal } from '@/app/(main)/photos/components/PhotoModal';
import { mockClientWithStats } from './helpers/mockData';

// Mock list getters — the modal consumes the SAME endpoints as PhotosFilters.
const mockGetClientsPaged = vi.fn();
const mockGetServices = vi.fn();
const mockGetActivities = vi.fn();
const mockGetTags = vi.fn();
const mockGetAllLocations = vi.fn();

vi.mock('@memo/api-client', () => ({
  getClientsPaged: (...args: unknown[]) => mockGetClientsPaged(...args),
  getServices: (...args: unknown[]) => mockGetServices(...args),
  getActivities: (...args: unknown[]) => mockGetActivities(...args),
  getTags: (...args: unknown[]) => mockGetTags(...args),
  getAllLocations: (...args: unknown[]) => mockGetAllLocations(...args),
}));

/** PaginatedResponse envelope wrapper (list endpoints return envelopes). */
function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 10 };
}

/* ─── Fixtures ─────────────────────────────────────────────────────── */

const SERVICE_FIXTURE = {
  id: 's1',
  title: 'Картина маслом',
  description: '',
  image_url: '',
  specialty: 'живопись',
  min_age: 5,
  max_age: 12,
  duration: 90,
  record_info: '',
  tariffs: [],
  tags: [],
  archived: false,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

// Canonical-label fixture: start without a timezone suffix → local-time
// semantics (PhotosFilters.test precedent). location_id matches LOCATION's id.
const ACTIVITY_FIXTURE = {
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc-1',
  start: '2026-06-07T14:05:00',
  duration: 90,
  capacity: 10,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  occupied: 0,
  service_title: 'Картина маслом',
};

const LOCATION_FIXTURE = {
  id: 'loc-1',
  name: 'Студия на Невском',
  short_title: 'Невский',
  address: 'Невский пр. 28',
  description: null,
  capacity: 10,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  archived: false,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

/** Second location — search-filtering needs ≥2 options to prove hiding. */
const LOCATION_FIXTURE_2 = {
  id: 'loc-2',
  name: 'Мастерская на Литейном',
  short_title: 'Литейный',
  address: 'Литейный пр. 17',
  description: null,
  capacity: 8,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  archived: false,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

const TAG_FIXTURE = { id: 'tag1', tag: 'Гуашь' };

/** «dd.mm.yyyy HH:mm — Локация — Услуга» (date-first, spec §7.7). */
const CANONICAL_LABEL = '07.06.2026 14:05 — Студия на Невском — Картина маслом';

beforeEach(() => {
  mockGetClientsPaged.mockReset();
  mockGetServices.mockReset();
  mockGetActivities.mockReset();
  mockGetTags.mockReset();
  mockGetAllLocations.mockReset();
  mockGetClientsPaged.mockResolvedValue(envelope([mockClientWithStats]));
  mockGetServices.mockResolvedValue(envelope([SERVICE_FIXTURE]));
  mockGetActivities.mockResolvedValue(envelope([ACTIVITY_FIXTURE]));
  mockGetTags.mockResolvedValue(envelope([TAG_FIXTURE]));
  mockGetAllLocations.mockResolvedValue([LOCATION_FIXTURE, LOCATION_FIXTURE_2]);
});

afterEach(() => {
  // typeAndDebounce scopes fake timers per-debounce; restore defensively.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const defaultProps = {
  mode: 'create' as const,
  photo: null,
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
  title: 'Добавить фото',
};

function renderPhotoModal(overrides: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PhotoModal {...defaultProps} {...overrides} />
    </QueryClientProvider>,
  );
}

/** Debounce-driven flow: fake timers only around the 300ms debounce. */
function typeAndDebounce(input: HTMLElement, value: string) {
  vi.useFakeTimers();
  try {
    fireEvent.change(input, { target: { value } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Wait until the locations dictionary has loaded AND propagated — the
 * canonical activity label and the location Combobox options both derive
 * from it. Combobox options only exist in the DOM while the dropdown is
 * open, so open it first; `combobox-option-loc-1` appearing is the
 * DOM-level proof the map reached the component. Closes the dropdown again
 * so callers start from a clean state.
 */
async function waitForLocationsLoaded() {
  fireEvent.click(screen.getByTestId('combobox-trigger'));
  await screen.findByTestId('combobox-option-loc-1');
  fireEvent.click(screen.getByTestId('combobox-trigger'));
}

describe('PhotoModal — field set (GH #211 Task 9)', () => {
  it('renders Клиент/Локация pickers and NOT Посетитель', () => {
    renderPhotoModal();
    expect(screen.getByText('Клиент')).toBeInTheDocument();
    expect(screen.getByText('Локация')).toBeInTheDocument();
    expect(screen.queryByText('Посетитель')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Посетитель/ })).not.toBeInTheDocument();
  });

  it('renders the remaining PHOTO_FIELDS', () => {
    renderPhotoModal();
    expect(screen.getByText('Имя файла')).toBeInTheDocument();
    expect(screen.getByText('Услуга')).toBeInTheDocument();
    expect(screen.getByText('Активность')).toBeInTheDocument();
    // filename stays a plain text input
    expect(screen.getByPlaceholderText('photo-001.jpg').tagName).toBe('INPUT');
  });

  it('only filename is required (1 star)', () => {
    renderPhotoModal();
    expect(screen.getAllByText('*')).toHaveLength(1);
  });
});

describe('PhotoModal — Клиент picker', () => {
  it('searches active clients via getClientsPaged and selects client_id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });

    typeAndDebounce(screen.getByRole('textbox', { name: 'Клиент' }), 'Ан');

    await waitFor(() => {
      expect(mockGetClientsPaged).toHaveBeenCalledWith({ q: 'Ан', per_page: 10, status: 'active' });
    });
    const option = await screen.findByText('Анна Иванова');
    fireEvent.click(option);

    // Fill the required filename, submit → client_id travels in the payload.
    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ filename: 'test.jpg', client_id: 'c1' }),
    );
    // visitor_id is gone from the payload entirely (GH #211).
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('visitor_id');
  });
});

describe('PhotoModal — Локация Combobox (GH #214 row 9)', () => {
  it('shows the «Без локации» clear label in the trigger when empty', async () => {
    renderPhotoModal();
    expect(await screen.findByTestId('combobox-trigger')).toHaveTextContent('Без локации');
  });

  it('loads options via getAllLocations, selects one and submits location_id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });

    // Open the Combobox — options populate once the locations dictionary loads.
    fireEvent.click(await screen.findByTestId('combobox-trigger'));
    fireEvent.click(await screen.findByTestId('combobox-option-loc-1'));

    // Selection reflects in the trigger label.
    expect(screen.getByTestId('combobox-trigger')).toHaveTextContent('Студия на Невском');

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ location_id: 'loc-1' }),
    );
    expect(mockGetAllLocations).toHaveBeenCalled();
  });

  it('filters location options by a name fragment (non-matching hidden)', async () => {
    renderPhotoModal();
    fireEvent.click(await screen.findByTestId('combobox-trigger'));
    await screen.findByTestId('combobox-option-loc-1');

    // Fragment of «Студия на Невском» — haystack includes short_title (§6.2).
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'невск' } });
    expect(screen.getByTestId('combobox-option-loc-1')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-loc-2')).not.toBeInTheDocument();
  });
});

describe('PhotoModal — mutually-exclusive owners (service ↔ activity)', () => {
  it('selecting an activity clears the previously selected service', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });
    await waitForLocationsLoaded();

    // 1. Select a service first
    typeAndDebounce(screen.getByRole('textbox', { name: 'Услуга' }), 'Ка');
    fireEvent.click(await screen.findByText('Картина маслом'));

    // 2. Then select an activity → service must be cleared
    typeAndDebounce(screen.getByRole('textbox', { name: 'Активность' }), 'Ма');
    fireEvent.click(await screen.findByText(CANONICAL_LABEL));

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.activity_id).toBe('a1');
    expect(payload.service_id ?? null).toBeNull();
  });

  it('selecting a service clears the previously selected activity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });
    await waitForLocationsLoaded();

    // 1. Select an activity first
    typeAndDebounce(screen.getByRole('textbox', { name: 'Активность' }), 'Ма');
    fireEvent.click(await screen.findByText(CANONICAL_LABEL));

    // 2. Then select a service → activity must be cleared
    typeAndDebounce(screen.getByRole('textbox', { name: 'Услуга' }), 'Ка');
    fireEvent.click(await screen.findByText('Картина маслом'));

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.service_id).toBe('s1');
    expect(payload.activity_id ?? null).toBeNull();
  });

  it('does NOT auto-fill service_id when an activity is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });
    await waitForLocationsLoaded();

    typeAndDebounce(screen.getByRole('textbox', { name: 'Активность' }), 'Ма');
    fireEvent.click(await screen.findByText(CANONICAL_LABEL));

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.activity_id).toBe('a1');
    // Auto-fill removed — service stays null (owners are mutually exclusive).
    expect(payload.service_id ?? null).toBeNull();
  });
});

describe('PhotoModal — canonical activity label (spec §7.7)', () => {
  it('renders options AND the selected value via formatActivityLabel', async () => {
    renderPhotoModal();
    await waitForLocationsLoaded();

    typeAndDebounce(screen.getByRole('textbox', { name: 'Активность' }), 'Ма');

    // Dropdown option: date-first canonical label (location resolved from the
    // modal's getAllLocations map).
    const option = await screen.findByText(CANONICAL_LABEL);
    fireEvent.click(option);

    // Selected value keeps the SAME canonical label in the input.
    expect(screen.getByRole('textbox', { name: 'Активность' })).toHaveValue(CANONICAL_LABEL);
  });
});

describe('PhotoModal — tag submission (GH #211 Task 9)', () => {
  it('submits selected tags under tag_ids', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });

    // Add a tag chip via the tags typeahead
    typeAndDebounce(screen.getByPlaceholderText('Введите название тега...'), 'Гу');
    fireEvent.click(await screen.findByText('Гуашь'));

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.tag_ids).toEqual([{ id: 'tag1', tag: 'Гуашь' }]);
  });
});

describe('PhotoModal — server 422 surfaces (GH #211 §6.2)', () => {
  it('keeps the modal open when onSubmit rejects (422 ≥2 owners)', async () => {
    // Simulate the server rejecting a ≥2-owner payload — the modal surfaces it
    // through the existing catch (toast handled by the caller) and stays open.
    const onSubmit = vi.fn().mockRejectedValue(new Error('422'));
    const onClose = vi.fn();
    renderPhotoModal({ onSubmit, onClose });

    fireEvent.change(screen.getByPlaceholderText('photo-001.jpg'), {
      target: { value: 'test.jpg' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
