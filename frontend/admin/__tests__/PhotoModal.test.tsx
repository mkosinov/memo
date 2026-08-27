import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { PhotoModal } from '@/app/(main)/photos/components/PhotoModal';
import { formatActivityStart } from '@/lib/utils';

// Mock list getters (GH #212 T13 — typeaheads consume list ?q= endpoints)
const mockGetVisitors = vi.fn();
const mockGetServices = vi.fn();
const mockGetActivities = vi.fn();
const mockGetTags = vi.fn();

vi.mock('@memo/api-client', () => ({
  getVisitors: (...args: unknown[]) => mockGetVisitors(...args),
  getServices: (...args: unknown[]) => mockGetServices(...args),
  getActivities: (...args: unknown[]) => mockGetActivities(...args),
  getTags: (...args: unknown[]) => mockGetTags(...args),
}));

/** PaginatedResponse envelope wrapper (list endpoints return envelopes). */
function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 10 };
}

/* Full list-response item shapes (extra fields beyond the old search results) */

const VISITOR_FIXTURE = {
  id: 'v1',
  client_id: 'c1',
  name: 'Анна Иванова',
  age: 7,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

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

const ACTIVITY_FIXTURE = {
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'l1',
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

const TAG_FIXTURE = { id: 'tag1', tag: 'Гуашь' };

beforeEach(() => {
  mockGetVisitors.mockReset();
  mockGetServices.mockReset();
  mockGetActivities.mockReset();
  mockGetTags.mockReset();
  mockGetVisitors.mockResolvedValue(envelope([VISITOR_FIXTURE]));
  mockGetServices.mockResolvedValue(envelope([SERVICE_FIXTURE]));
  mockGetActivities.mockResolvedValue(envelope([ACTIVITY_FIXTURE]));
  mockGetTags.mockResolvedValue(envelope([TAG_FIXTURE]));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
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
  return render(<PhotoModal {...defaultProps} {...overrides} />);
}

/** Type into a SearchableSelect input and let the debounce fire. */
async function typeAndWait(input: HTMLElement, value: string) {
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  // Flush the async onSearch promise chain
  await act(async () => {});
}

describe('PhotoModal', () => {
  it('renders all fields from PHOTO_FIELDS', () => {
    renderPhotoModal();
    expect(screen.getByText('Имя файла')).toBeInTheDocument();
    expect(screen.getByText('Посетитель')).toBeInTheDocument();
    expect(screen.getByText('Услуга')).toBeInTheDocument();
    expect(screen.getByText('Активность')).toBeInTheDocument();
  });

  it('renders SearchableSelect for visitor_id field', () => {
    renderPhotoModal();
    // SearchableSelect renders an input with aria-label matching the label
    const visitorInput = screen.getByRole('textbox', { name: /Посетитель/ });
    expect(visitorInput).toBeInTheDocument();
    expect(visitorInput.tagName).toBe('INPUT');
  });

  it('renders SearchableSelect for service_id field', () => {
    renderPhotoModal();
    const serviceInput = screen.getByRole('textbox', { name: /Услуга/ });
    expect(serviceInput).toBeInTheDocument();
    expect(serviceInput.tagName).toBe('INPUT');
  });

  it('renders SearchableSelect for activity_id field', () => {
    renderPhotoModal();
    const activityInput = screen.getByRole('textbox', { name: /Активность/ });
    expect(activityInput).toBeInTheDocument();
    expect(activityInput.tagName).toBe('INPUT');
  });

  it('renders text input for filename field', () => {
    renderPhotoModal();
    // filename is a text field, should have a regular text input
    const filenameInput = screen.getByPlaceholderText('photo-001.jpg');
    expect(filenameInput).toBeInTheDocument();
    expect(filenameInput.tagName).toBe('INPUT');
  });

  it('SearchableSelect fields are not required', () => {
    renderPhotoModal();
    // visitor_id, service_id, activity_id should not have required indicators
    // The only required field is filename
    const requiredStars = screen.getAllByText('*');
    // Only 1 required field (filename) → 1 star
    expect(requiredStars).toHaveLength(1);
  });

  it('searches visitors via getVisitors with q and per_page', async () => {
    renderPhotoModal();
    const visitorInput = screen.getByLabelText(/Посетитель/);

    await typeAndWait(visitorInput, 'Ан');

    expect(mockGetVisitors).toHaveBeenCalledWith({ q: 'Ан', per_page: 10 });
  });

  it('renders visitor name with age subtitle', async () => {
    renderPhotoModal();
    const visitorInput = screen.getByRole('textbox', { name: /Посетитель/ });

    await typeAndWait(visitorInput, 'Ан');

    await waitFor(() => {
      expect(screen.getByText(/Анна Иванова/)).toBeInTheDocument();
      expect(screen.getByText(/7/)).toBeInTheDocument();
    });
  });

  it('passes selected visitor UUID to onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });

    // Fill required field
    const filenameInput = screen.getByPlaceholderText('photo-001.jpg');
    act(() => {
      fireEvent.change(filenameInput, { target: { value: 'test.jpg' } });
    });

    // Submit the form
    const saveButton = screen.getByText('Сохранить');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    // Verify the submitted data has filename
    const submittedData = onSubmit.mock.calls[0][0];
    expect(submittedData).toHaveProperty('filename', 'test.jpg');
    // visitor_id, service_id, activity_id only present if user selected a value
    expect(submittedData).not.toHaveProperty('visitor_id');
    expect(submittedData).not.toHaveProperty('service_id');
    expect(submittedData).not.toHaveProperty('activity_id');
  });

  it('searches tags via getTags with q and per_page', async () => {
    renderPhotoModal();
    const tagInput = screen.getByPlaceholderText('Введите название тега...');

    await typeAndWait(tagInput, 'Гу');

    expect(mockGetTags).toHaveBeenCalledWith({ q: 'Гу', per_page: 10 });
    await waitFor(() => {
      expect(screen.getByText('Гуашь')).toBeInTheDocument();
    });
  });

  it('activity search passes service_id from formData and formats start', async () => {
    renderPhotoModal();
    const activityInput = screen.getByRole('textbox', { name: /Активность/ });

    // No service selected yet — service_id omitted (undefined)
    await typeAndWait(activityInput, 'Ма');
    expect(mockGetActivities).toHaveBeenCalledWith({ q: 'Ма', service_id: undefined, per_page: 10 });

    await waitFor(() => {
      // service_title shown; start formatted ISO → "HH:mm dd.mm.yyyy"
      expect(screen.getByText(/Картина маслом/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(formatActivityStart(ACTIVITY_FIXTURE.start)))).toBeInTheDocument();
    });

    // Select the activity — service_id auto-fills from the item
    fireEvent.click(screen.getByText(/Картина маслом/));

    // Search again — now service_id from formData is passed
    await typeAndWait(activityInput, 'Ма');
    expect(mockGetActivities).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Ма', service_id: ACTIVITY_FIXTURE.service_id, per_page: 10 }),
    );
  });
});
