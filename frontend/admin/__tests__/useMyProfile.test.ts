/**
 * useMyProfile — GH #262 T7 hook family (spec §5.5, D2/D4/D10).
 *
 * The profile query lives on the ['me','profile'] key — a CHILD of the
 * ['me'] prefix so a single invalidateQueries(['me']) covers it. Profile
 * writes (PUT /my, portrait upload) invalidate ['me'] (the local snapshot)
 * PLUS the staff/masters families via lib/invalidate.ts (the public half of
 * the card changed). NO new EntityName, NO new SSE entity (D10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getMyProfile: vi.fn(),
    updateMyProfile: vi.fn(),
    uploadPortrait: vi.fn(),
    changePassword: vi.fn(),
  };
});

import {
  useMyProfile,
  useUpdateMyProfile,
  useUploadPortrait,
  useChangePassword,
  ME_PROFILE_KEY,
} from '../hooks/useMyProfile';
import {
  getMyProfile,
  updateMyProfile,
  uploadPortrait,
  changePassword,
} from '@memo/api-client';
import type { MyProfile, MyProfileUpdate } from '@memo/api-client';
import { mockMyProfileMaster } from './helpers/mockData';

const mockGetMyProfile = vi.mocked(getMyProfile);
const mockUpdateMyProfile = vi.mocked(updateMyProfile);
const mockUploadPortrait = vi.mocked(uploadPortrait);
const mockChangePassword = vi.mocked(changePassword);

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useMyProfile (query)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('exposes the ["me","profile"] key (child of the ["me"] prefix)', () => {
    expect(ME_PROFILE_KEY).toEqual(['me', 'profile']);
  });

  it('fetches the profile via getMyProfile on that key', async () => {
    mockGetMyProfile.mockResolvedValue(mockMyProfileMaster as MyProfile);
    const { queryClient, wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetMyProfile).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(mockMyProfileMaster);
    expect(queryClient.getQueryData(ME_PROFILE_KEY)).toEqual(mockMyProfileMaster);
  });
});

describe('useUpdateMyProfile (mutation)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls updateMyProfile with the partial payload', async () => {
    mockUpdateMyProfile.mockResolvedValue(mockMyProfileMaster as MyProfile);
    const { wrapper } = createQueryClientWrapper();
    const { result } = renderHook(() => useUpdateMyProfile(), { wrapper });

    const payload: MyProfileUpdate = { patronymic: 'Ивановна' };
    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(mockUpdateMyProfile).toHaveBeenCalledWith(payload);
  });

  it('invalidates ["me"] + the staff/masters families on success', async () => {
    mockUpdateMyProfile.mockResolvedValue(mockMyProfileMaster as MyProfile);
    const { queryClient, wrapper } = createQueryClientWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateMyProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ patronymic: 'X' });
    });

    // Local snapshot family.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    // staff family fans out (INVALIDATION_MAP) to staff + masters + records.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
  });
});

describe('useUploadPortrait (mutation)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls uploadPortrait and invalidates ["me"] + staff/masters', async () => {
    mockUploadPortrait.mockResolvedValue({ avatar_url: '/api/v1/files/avatar/n.png' });
    const { queryClient, wrapper } = createQueryClientWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUploadPortrait(), { wrapper });

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await act(async () => {
      await result.current.mutateAsync(file);
    });

    expect(mockUploadPortrait).toHaveBeenCalledWith(file);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
  });
});

describe('useChangePassword (mutation)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls changePassword with current + new password', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const { wrapper } = createQueryClientWrapper();
    const { result } = renderHook(() => useChangePassword(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        current_password: 'old12345',
        new_password: 'new12345',
      });
    });

    expect(mockChangePassword).toHaveBeenCalledWith({
      current_password: 'old12345',
      new_password: 'new12345',
    });
  });
});
