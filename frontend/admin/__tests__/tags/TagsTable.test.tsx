import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/hooks/useTagsMutations', () => ({
  useUpdateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/(main)/tags/components/TagModal', () => ({
  TagModal: () => null,
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

import { useQuery } from '@tanstack/react-query';
import { TagsTable } from '@/app/(main)/tags/components/TagsTable';

describe('TagsTable error state', () => {
  it('shows ErrorState when useQuery returns an error', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(<TagsTable />);
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
  });

  it('does not show ErrorState when no error', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(<TagsTable />);
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });
});

describe('TagsTable status column removal (GH #194)', () => {
  // Minimal mock tag — TagResponse only has { id, tag }
  const mockTag = { id: 't-1', tag: 'Живопись' };

  it('does not render a "Статус" column header', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(<TagsTable />);
    // exact:false → catches "Статус ↕" (sort icon appended to header label).
    expect(screen.queryByText('Статус', { exact: false })).not.toBeInTheDocument();
  });

  it('does not render an "Активен" status badge for a row', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: [mockTag],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(<TagsTable />);
    // The row itself should render the tag name…
    expect(screen.getByText('Живопись')).toBeInTheDocument();
    // …but no "Активен" badge (the dead status badge).
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
  });
});
