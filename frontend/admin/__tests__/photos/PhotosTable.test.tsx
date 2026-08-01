import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/hooks/usePhotosMutations', () => ({
  useUpdatePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/(main)/photos/components/PhotoModal', () => ({
  PhotoModal: () => null,
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

import { useQuery } from '@tanstack/react-query';
import { PhotosTable } from '@/app/(main)/photos/components/PhotosTable';

// Minimal mock PhotoResponse — NO is_active field (GH #194 dropped it).
const mockPhoto = {
  id: 'p-1',
  filename: 'test.jpg',
  visitor_id: 'vis-1',
  service_id: 'svc-1',
  activity_id: 'act-1',
  is_public: false,
  tags: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function mockQuery(data: unknown) {
  vi.mocked(useQuery).mockReturnValue({
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useQuery>);
}

describe('PhotosTable status UI removal (GH #194)', () => {
  it('does not render a "Статус" column header', () => {
    mockQuery([]);
    render(<PhotosTable />);
    // exact:false → catches "Статус ↕" (sort icon appended to header label).
    expect(screen.queryByText('Статус', { exact: false })).not.toBeInTheDocument();
  });

  it('does not render the status filter <select> ("Все статусы")', () => {
    mockQuery([]);
    render(<PhotosTable />);
    expect(screen.queryByText('Все статусы')).not.toBeInTheDocument();
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
    expect(screen.queryByText('Архив')).not.toBeInTheDocument();
  });

  it('does not render an "Активен"/"Архив" status badge for a row', () => {
    mockQuery([mockPhoto]);
    render(<PhotosTable />);
    // The row should render the filename…
    expect(screen.getByText('test.jpg')).toBeInTheDocument();
    // …but no dead status badges.
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
    expect(screen.queryByText('Архив')).not.toBeInTheDocument();
  });
});