/**
 * Payload-mapping tests for PhotosTable handlers (GH #211 Task 9):
 * the modal's form data (owner slots as strings/null, tag_ids as
 * {id, tag} objects) must reach the mutations as the API contract —
 * owners as string|null, tag_ids as string[]. Covers BOTH create and
 * edit, plus the 422 surfacing path (rejected mutation → error toast).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PhotoResponse } from '@memo/api-client';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Modal-shaped payload — owners as strings/null, tag_ids as {id, tag}
// objects (exactly what the real PhotoModal submits).
const { shared, MODAL_PAYLOAD } = vi.hoisted(() => ({
  shared: {
    createMut: { mutateAsync: vi.fn() },
    updateMut: { mutateAsync: vi.fn() },
    deleteMut: { mutateAsync: vi.fn() },
    toastStore: { showToast: vi.fn() },
  },
  MODAL_PAYLOAD: {
    filename: 'new.jpg',
    client_id: 'c1',
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: true,
    tag_ids: [{ id: 'tag-1', tag: 'Гуашь' }],
  },
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => shared.toastStore,
}));

vi.mock('@/hooks/usePhotosMutations', () => ({
  useCreatePhoto: () => shared.createMut,
  useUpdatePhoto: () => shared.updateMut,
  useDeletePhoto: () => shared.deleteMut,
}));

// Stub modal that captures the handler under test: clicking the stub button
// submits the fixed modal-shaped payload through the REAL PhotosTable handler.
vi.mock('@/app/(main)/photos/components/PhotoModal', () => ({
  PhotoModal: ({
    mode,
    onSubmit,
  }: {
    mode: string;
    onSubmit: (data: Record<string, unknown>) => Promise<void>;
  }) => (
    <button
      data-testid={`modal-submit-${mode}`}
      onClick={() => {
        void onSubmit(MODAL_PAYLOAD);
      }}
    >
      modal submit
    </button>
  ),
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPhotos: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
  };
});

import { getPhotos, getAllServices, getAllLocations } from '@memo/api-client';
import type { PhotoListResponse } from '@memo/api-client';
import { PhotosTable } from '@/app/(main)/photos/components/PhotosTable';
import { PhotosProvider } from '@/contexts/PhotosContext';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);

function photoList(items: PhotoResponse[]): PhotoListResponse {
  return { items, total: items.length, page: 1, per_page: 10 };
}

const mockPhoto: PhotoResponse = {
  id: 'p-1',
  filename: 'test.jpg',
  client_id: 'c1',
  service_id: null,
  activity_id: null,
  location_id: null,
  is_public: true,
  tags: [{ id: 'tag-1', tag: 'Гуашь' }],
  client_name: 'Анна Иванова',
  created_at: '2026-06-07T14:05:00',
  updated_at: '2026-06-07T14:05:00',
};

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PhotosProvider>
        <PhotosTable />
      </PhotosProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPhotos.mockResolvedValue(photoList([mockPhoto]));
  mockGetAllServices.mockResolvedValue([]);
  mockGetAllLocations.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PhotosTable create payload mapping (GH #211 Task 9)', () => {
  it('maps modal form data → PhotoCreate (owners + tag_ids)', async () => {
    shared.createMut.mutateAsync.mockResolvedValue(mockPhoto);
    renderTable();

    fireEvent.click(screen.getByText('+ Добавить фото'));
    fireEvent.click(await screen.findByTestId('modal-submit-create'));

    await waitFor(() => expect(shared.createMut.mutateAsync).toHaveBeenCalled());
    expect(shared.createMut.mutateAsync).toHaveBeenCalledWith({
      filename: 'new.jpg',
      client_id: 'c1',
      service_id: null,
      activity_id: null,
      location_id: null,
      is_public: true,
      tag_ids: ['tag-1'],
    });
    expect(shared.toastStore.showToast).toHaveBeenCalledWith('Фото создано');
  });
});

describe('PhotosTable edit payload mapping (GH #211 Task 9)', () => {
  it('maps modal form data → PhotoUpdate (owners incl. null + tag_ids)', async () => {
    shared.updateMut.mutateAsync.mockResolvedValue(mockPhoto);
    renderTable();

    await screen.findByText('test.jpg');
    fireEvent.click(screen.getByText('test.jpg')); // row click → edit modal
    fireEvent.click(await screen.findByTestId('modal-submit-edit'));

    await waitFor(() => expect(shared.updateMut.mutateAsync).toHaveBeenCalled());
    expect(shared.updateMut.mutateAsync).toHaveBeenCalledWith({
      id: 'p-1',
      data: {
        filename: 'new.jpg',
        client_id: 'c1',
        service_id: null,
        activity_id: null,
        location_id: null,
        is_public: true,
        tag_ids: ['tag-1'],
      },
    });
    expect(shared.toastStore.showToast).toHaveBeenCalledWith('Фото обновлено');
  });

  it('shows an error toast on rejection (server 422 ≥2 owners)', async () => {
    shared.updateMut.mutateAsync.mockRejectedValue(new Error('422'));
    renderTable();

    await screen.findByText('test.jpg');
    fireEvent.click(screen.getByText('test.jpg'));
    fireEvent.click(await screen.findByTestId('modal-submit-edit'));

    await waitFor(() => expect(shared.updateMut.mutateAsync).toHaveBeenCalled());
    expect(shared.toastStore.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});
