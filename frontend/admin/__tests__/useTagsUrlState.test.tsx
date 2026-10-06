import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, TagResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + TagsContext stay REAL, so this
// pins the actual fetcher params (useClientsUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getTags: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getTags } from '@memo/api-client';
import {
  useTagsUrlState,
  tagsUrlConfig,
  TAGS_SORT_FIELDS,
} from '../app/(main)/tags/useTagsUrlState';
import { TagsProvider, useTagsTable } from '../contexts/TagsContext';

const mockGetTags = vi.mocked(getTags);

function envelope(items: TagResponse[] = []): PaginatedResponse<TagResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetTags.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetTags.mockResolvedValue(envelope());
  __resetNavigation('', '/tags');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Real-time sleep past the ~16ms coalescing window, inside act. */
async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('useTagsUrlState — config (#349 Task 5)', () => {
  it('exposes the canonical preset contract for the tags page', () => {
    // Sort whitelist = the backend tags whitelist (domain-rules/tags.md):
    // a single sortable column — `title` (the table's only column).
    expect(TAGS_SORT_FIELDS).toEqual(['title']);
    expect(tagsUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(tagsUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: ['title'],
      defaultValue: '',
    });
    expect(tagsUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(tagsUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(tagsUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
    // Tags carry NO archive status (hard-delete dictionary) → no status preset.
    expect('status' in tagsUrlConfig).toBe(false);
  });

  it('valid ?q=жив&sort_by=title&sort_order=desc is honored', () => {
    __resetNavigation('?q=жив&sort_by=title&sort_order=desc', '/tags');
    const { result } = renderHook(() => useTagsUrlState());
    expect(result.current.state.q).toBe('жив');
    expect(result.current.state.sort_by).toBe('title');
    expect(result.current.state.sort_order).toBe('desc');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.per_page).toBe(10);
  });

  it('dirty values silently fall back (sort_by=bogus, page=0, per_page=7), URL untouched', () => {
    __resetNavigation('?sort_by=bogus&sort_order=desc&page=0&per_page=7', '/tags');
    const { result } = renderHook(() => useTagsUrlState());
    expect(result.current.state.sort_by).toBe('');
    // Orphan sort_order (requirement at default) is ignored.
    expect(result.current.state.sort_order).toBe('asc');
    expect(result.current.state.page).toBe(1);
    expect(result.current.state.per_page).toBe(10);
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });

  it('update({sort_by}) writes sort + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/tags');
    const { result } = renderHook(() => useTagsUrlState());
    act(() => {
      result.current.update({ sort_by: 'title', sort_order: 'desc' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/tags?sort_by=title&sort_order=desc');
  });
});

describe('TagsProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useTagsTable> | null } = { current: null };
    function Probe() {
      probe.current = useTagsTable();
      return null;
    }
    function Page() {
      const urlState = useTagsUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <TagsProvider urlState={urlState}>
            <Probe />
          </TagsProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no sort/q keys, page 1 / per_page 10', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetTags).toHaveBeenCalledTimes(1));
    // Deep equality — no sort keys (server default title ASC order, §4.4).
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10 });
    expect(probe.current!.sortBy).toBeNull();
    expect(probe.current!.search).toBe('');
  });

  it('?q=жив&sort_by=title&sort_order=desc&page=2&per_page=50 — one fetch, exact params', async () => {
    __resetNavigation('?q=%D0%B6%D0%B8%D0%B2&sort_by=title&sort_order=desc&page=2&per_page=50', '/tags');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetTags).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      q: 'жив',
      sort_by: 'title',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(probe.current!.search).toBe('жив');
    expect(probe.current!.sortBy).toBe('title');
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetTags).toHaveBeenCalledTimes(1);
  });

  it('1-char q stays in state but never reaches the wire (≥2 server clamp)', async () => {
    __resetNavigation('?q=x', '/tags');
    renderProvider();
    await waitFor(() => expect(mockGetTags).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10 });
  });

  it('setSearch writes q to the URL (one push) — lands in the address', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetTags).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setSearch('жив');
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/tags?q=%D0%B6%D0%B8%D0%B2');
  });
});
