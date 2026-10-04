/**
 * GH #324 (spec §6/§9.1/§9.2) — PhotosTable delete flow THROUGH THE REAL
 * PIPELINE, mirror of TagsTableDeleteFlow.test.tsx (#318). The unit
 * PhotosTable tests mock usePhotosMutations, so the pending stack never
 * runs there; these tests wire the REAL chain —
 *
 *   PhotosTable → useDeletePhoto (real) → PendingActionsProvider (real)
 *              → UIProvider (real) + ToastContainer (real)
 *
 * with only the api-client boundary mocked (getPhotos / getAllServices /
 * getAllLocations / dryRunDeletePhoto / resolveDeletePhoto). This is the
 * only vitest place asserting what the user actually SEES:
 * - §9.1 clean photo: «Удалить» → NO window.confirm → row gone + ring toast
 *   «Удалено. Отменить»; «Отменить» → row back, no DELETE ever fired.
 * - §9.2 tagged photo: dry-run 409 → DeleteDialog («Теги — будут
 *   отвязаны:») → confirm → ring; window expiry commits
 *   {resolutions: {photo_tags: cascade}, expected: {photo_tags: ids}}.
 *
 * Fake timers follow the PendingActionsContext pattern: installed up-front
 * with shouldAdvanceTime, async work flushed with advanceTimersByTimeAsync.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPhotos: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
    dryRunDeletePhoto: vi.fn(),
    resolveDeletePhoto: vi.fn(),
  };
});

import {
  getPhotos,
  getAllServices,
  getAllLocations,
  dryRunDeletePhoto,
  resolveDeletePhoto,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PhotoListResponse, PhotoResponse } from '@memo/api-client';
import { PhotosTable } from '@/app/(main)/photos/components/PhotosTable';
import { PhotosProvider } from '@/contexts/PhotosContext';
import { UIProvider } from '@/contexts/UIContext';
import { PendingActionsProvider } from '@/contexts/PendingActionsContext';
import { ToastContainer } from '@/app/components/toast/ToastContainer';
// #349 Task 8 made urlState required on PhotosProvider (RecordsProvider
// precedent) — render the real provider with the shared static stub.
import { createPhotosUrlStateStub } from '../helpers/photosUrlStateStub';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);
const mockDryRun = vi.mocked(dryRunDeletePhoto);
const mockResolveDeletePhoto = vi.mocked(resolveDeletePhoto);

const TEST_PHOTOS: PhotoResponse[] = [
  {
    id: 'p-1',
    filename: 'море.jpg',
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: false,
    tags: [],
    client_name: null,
    created_at: '2026-06-07T14:05:00',
    updated_at: '2026-06-07T14:05:00',
  },
  {
    id: 'p-2',
    filename: 'горы.png',
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: true,
    tags: [{ id: 't-1', title: 'Гуашь' }],
    client_name: null,
    created_at: '2026-06-07T14:05:00',
    updated_at: '2026-06-07T14:05:00',
  },
];

const PHOTO_DEPS: DependencyNode[] = [
  {
    entity: 'photo_tags',
    auto: false,
    relation: 'Тег',
    count: 1,
    allowed_actions: ['cascade'],
    message: null,
    items: [{ id: 't-1', label: 'Гуашь' }],
  },
];

/** Full provider chain — everything real except the api-client boundary. */
function renderFlow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <PendingActionsProvider>
          <PhotosProvider urlState={createPhotosUrlStateStub()}>
            <PhotosTable />
            <ToastContainer />
          </PhotosProvider>
        </PendingActionsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

function photoList(items: PhotoResponse[]): PhotoListResponse {
  return { items, total: items.length, page: 1, per_page: 10 };
}

/** Open the row menu of `rowTestId` and hit «Удалить». */
async function clickDeleteOnRow(rowTestId: string): Promise<void> {
  const row = screen.getByTestId(rowTestId);
  fireEvent.click(
    row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));
}

describe('PhotosTable delete flow — full pipeline (GH #324 §9.1/§9.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetPhotos.mockResolvedValue(photoList(TEST_PHOTOS));
    mockGetAllServices.mockResolvedValue([]);
    mockGetAllLocations.mockResolvedValue([]);
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeletePhoto.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('§9.1 clean photo: «Удалить» → NO window.confirm → row gone + ring toast; «Отменить» → row back, no DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderFlow();
    await screen.findByText('море.jpg');

    await clickDeleteOnRow('photo-row-p-1');

    // The instant confirm path is GONE — the deferred pipeline owns the flow.
    expect(confirmSpy).not.toHaveBeenCalled();

    // Row disappears optimistically (dry-run 204 inside the real hook).
    await waitFor(() =>
      expect(screen.queryByTestId('photo-row-p-1')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('photo-row-p-2')).toBeInTheDocument();

    // The pending toast carries the countdown ring (#94) + the undo label.
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();
    expect(mockResolveDeletePhoto).not.toHaveBeenCalled();

    // Undo inside the window: the row returns, the server DELETE never fires.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    await waitFor(() =>
      expect(screen.getByTestId('photo-row-p-1')).toBeInTheDocument(),
    );
    expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
    expect(mockDryRun).toHaveBeenCalledTimes(1);
  });

  it('§9.2 tagged photo: 409 → DeleteDialog «Теги — будут отвязаны:» → confirm → ring; expiry commits {resolutions, expected}', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, PHOTO_DEPS),
    );
    renderFlow();
    await screen.findByText('горы.png');

    await clickDeleteOnRow('photo-row-p-2');

    // Dry-run conflict parks the tree and opens the dialog; row stays.
    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('photo-row-p-2')).toBeInTheDocument();
    // The dialog wording: tags SURVIVE — «будут отвязаны», never «удалены».
    expect(screen.getByText('Теги — будут отвязаны:')).toBeInTheDocument();
    expect(screen.getByText('Гуашь')).toBeInTheDocument();

    // Confirm checkbox (choice dep exists) + «Удалить».
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    // Dialog closes immediately (enqueue is sync); row gone + ring toast.
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('photo-row-p-2')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();

    // Commit fires ONLY after the 5s undo window — with the dialog-built
    // resolutions and the expected id-sets from the tree's items (D6).
    expect(mockResolveDeletePhoto).not.toHaveBeenCalled();
    mockGetPhotos.mockResolvedValue(photoList([TEST_PHOTOS[0]]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockResolveDeletePhoto).toHaveBeenCalledTimes(1);
    expect(mockResolveDeletePhoto).toHaveBeenCalledWith('p-2', {
      resolutions: { photo_tags: 'cascade' },
      expected: { photo_tags: ['t-1'] },
    });
    // Nothing resurrected the row after the commit + refetch.
    expect(screen.queryByTestId('photo-row-p-2')).not.toBeInTheDocument();
  });

  it('§9.1 clean photo: window expiry commits {expected: {}} and refreshes the list', async () => {
    renderFlow();
    await screen.findByText('море.jpg');

    await clickDeleteOnRow('photo-row-p-1');
    await waitFor(() =>
      expect(screen.queryByTestId('photo-row-p-1')).not.toBeInTheDocument(),
    );

    mockGetPhotos.mockResolvedValue(photoList([TEST_PHOTOS[1]]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockResolveDeletePhoto).toHaveBeenCalledTimes(1);
    expect(mockResolveDeletePhoto).toHaveBeenCalledWith('p-1', { expected: {} });
    expect(screen.queryByTestId('photo-row-p-1')).not.toBeInTheDocument();
  });
});
