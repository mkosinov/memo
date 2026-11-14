/**
 * useMyProfile — GH #262 T7 hook family (spec §5.5, D2/D4/D10), migrated to
 * the staff branches (#584 §5): every call rides the whoami-computed branch
 * from AuthContext — GET/PUT /api/v1/my/{branch}, avatar POST
 * /api/v1/my/{branch}/avatar (the former /my/portrait).
 *
 * The profile query lives on the ['me','profile',branch] key — a CHILD of
 * the ['me'] prefix so a single invalidateQueries(['me']) covers it. Profile
 * writes (PUT, avatar upload) invalidate ['me'] (the local snapshot) PLUS
 * the staff/masters families via lib/invalidate.ts (the public half of the
 * card changed). NO new EntityName, NO new SSE entity (D10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getMyStaffProfile: vi.fn(),
    updateMyStaffProfile: vi.fn(),
    uploadAvatar: vi.fn(),
    changePassword: vi.fn(),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import {
  useMyProfile,
  useUpdateMyProfile,
  useUploadAvatar,
  useChangePassword,
  ME_PROFILE_KEY,
} from '../hooks/useMyProfile';
import {
  getMyStaffProfile,
  updateMyStaffProfile,
  uploadAvatar,
  changePassword,
} from '@memo/api-client';
import { useAuth } from '@/contexts/AuthContext';
import type { MyProfileUpdate, MyStaffProfile } from '@memo/api-client';
import {
  mockMyStaffProfileMaster,
  mockMyStaffProfileStaffNoMaster,
} from './helpers/mockData';

const mockGetMyStaffProfile = vi.mocked(getMyStaffProfile);
const mockUpdateMyStaffProfile = vi.mocked(updateMyStaffProfile);
const mockUploadAvatar = vi.mocked(uploadAvatar);
const mockChangePassword = vi.mocked(changePassword);
const mockUseAuth = vi.mocked(useAuth);

/** Auth mock exposing only what the hook family reads: the branch (#584 §5). */
function mockBranch(branch: 'master' | 'admin' | null) {
  mockUseAuth.mockReturnValue({ branch } as unknown as ReturnType<typeof useAuth>);
}

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockBranch('master');
  });
  afterEach(() => vi.restoreAllMocks());

  it('exposes the ["me","profile"] prefix (child of the ["me"] prefix)', () => {
    expect(ME_PROFILE_KEY).toEqual(['me', 'profile']);
  });

  it('fetches the profile via getMyStaffProfile(branch) on the branch key', async () => {
    mockGetMyStaffProfile.mockResolvedValue(mockMyStaffProfileMaster);
    const { queryClient, wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetMyStaffProfile).toHaveBeenCalledTimes(1);
    expect(mockGetMyStaffProfile).toHaveBeenCalledWith('master');
    expect(result.current.data).toEqual(mockMyStaffProfileMaster);
    expect(queryClient.getQueryData(['me', 'profile', 'master'])).toEqual(
      mockMyStaffProfileMaster,
    );
  });

  it('rides the admin branch when whoami computed it (branch switch → new key)', async () => {
    mockBranch('admin');
    mockGetMyStaffProfile.mockResolvedValue(mockMyStaffProfileMaster);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetMyStaffProfile).toHaveBeenCalledWith('admin');
  });

  it('keeps the previous profile through a branch flip (no undefined interim — the mydata form must not unmount mid-edit)', async () => {
    // #584 S3 regression shape: login derives branch=admin (role-based
    // guess), the first refresh re-derives 'master' from whoami for a
    // combined admin+master — the profile query key swaps mid-session.
    // MyDataModal renders a loading card while `profile` is undefined,
    // UNMOUNTING the form and destroying unsaved edits (the observed bug:
    // the save PUT travels with an empty body). The interim between the
    // key swap and the new fetch's resolution must keep serving the
    // previous branch's data (same account, same rows — §4.4).
    mockBranch('admin');
    mockGetMyStaffProfile.mockResolvedValueOnce(mockMyStaffProfileStaffNoMaster);
    const { wrapper } = createQueryClientWrapper();

    const { result, rerender } = renderHook(() => useMyProfile(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockMyStaffProfileStaffNoMaster);

    // Flip the branch with the master-branch fetch PENDING (deferred; the
    // holder object dodges TS's closure narrowing of a plain let).
    const deferral: { resolve?: (v: MyStaffProfile) => void } = {};
    mockGetMyStaffProfile.mockImplementationOnce(
      () =>
        new Promise<MyStaffProfile>((resolve) => {
          deferral.resolve = resolve;
        }),
    );
    mockBranch('master');
    rerender();

    // The interim: the admin-branch profile stays defined — never undefined.
    expect(result.current.data).toEqual(mockMyStaffProfileStaffNoMaster);
    expect(result.current.isFetching).toBe(true);

    // The master-branch data lands once the fetch resolves.
    deferral.resolve?.(mockMyStaffProfileMaster);
    await waitFor(() => expect(result.current.data).toEqual(mockMyStaffProfileMaster));
    expect(mockGetMyStaffProfile).toHaveBeenLastCalledWith('master');
  });

  it('stays disabled (no fetch) while the branch is unresolved (auth loading)', async () => {
    mockBranch(null);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    // Give an (incorrect) immediate fetch attempt time to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetMyStaffProfile).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateMyProfile (mutation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBranch('master');
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls updateMyStaffProfile(branch, partial payload)', async () => {
    mockUpdateMyStaffProfile.mockResolvedValue(mockMyStaffProfileMaster);
    const { wrapper } = createQueryClientWrapper();
    const { result } = renderHook(() => useUpdateMyProfile(), { wrapper });

    const payload: MyProfileUpdate = { patronymic: 'Ивановна' };
    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(mockUpdateMyStaffProfile).toHaveBeenCalledWith('master', payload);
  });

  it('invalidates ["me"] + the staff/masters families on success', async () => {
    mockUpdateMyStaffProfile.mockResolvedValue(mockMyStaffProfileMaster);
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

describe('useUploadAvatar (mutation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBranch('master');
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls uploadAvatar(branch, file) and invalidates ["me"] + staff/masters', async () => {
    mockUploadAvatar.mockResolvedValue({ avatar_url: '/api/v1/files/avatar/n.png' });
    const { queryClient, wrapper } = createQueryClientWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUploadAvatar(), { wrapper });

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await act(async () => {
      await result.current.mutateAsync(file);
    });

    expect(mockUploadAvatar).toHaveBeenCalledWith('master', file);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['staff'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['masters'] });
  });
});

describe('useChangePassword (mutation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBranch('master');
  });
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
