'use client';

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getMyStaffProfile,
  updateMyStaffProfile,
  uploadAvatar,
  changePassword,
} from '@memo/api-client';
import type { MyStaffProfile, MyProfileUpdate, ChangePassword, StaffBranch } from '@memo/api-client';
import { useAuth } from '@/contexts/AuthContext';
import { invalidateEntities } from '@/lib/invalidate';

/**
 * «Мои данные» data layer (GH #262 T7, spec §5.2/§5.5; #584 §5 — staff
 * branches). Every call rides the whoami-computed branch from AuthContext:
 * GET/PUT /api/v1/my/{branch}, avatar POST /api/v1/my/{branch}/avatar (the
 * former /my/portrait — renamed by #584, upload contract unchanged).
 *
 * Query key: ['me','profile',branch] — a CHILD of the ['me'] prefix, so any
 * future reader of the auth snapshot is covered by one
 * invalidateQueries(['me']); the branch tail re-fetches when a refresh
 * re-derives the branch (e.g. a combined admin+master after login).
 *
 * Invalidation (spec §5.5, D10): a profile write invalidates the LOCAL
 * ['me'] prefix plus the existing `staff` family through lib/invalidate.ts.
 * INVALIDATION_MAP fans `staff` out to ['staff'] + ['masters'] + ['records']
 * (the masters view is staff ⨝ masters, records render master_name from the
 * join), so the masters family is covered by the same call. NO new
 * EntityName, NO INVALIDATION_MAP change, NO new SSE entity.
 */

export const ME_KEY = ['me'] as const;
export const ME_PROFILE_KEY = ['me', 'profile'] as const;

/** Guards a mutation fired before the chain resolved the branch. */
function requireBranch(branch: StaffBranch | null): StaffBranch {
  if (branch === null) {
    throw new Error('staff branch is not resolved yet (auth still loading)');
  }
  return branch;
}

/** GET /api/v1/my/{branch} — the flat editable profile (public card half + private half). */
export function useMyProfile() {
  const { branch } = useAuth();
  return useQuery<MyStaffProfile>({
    queryKey: [...ME_PROFILE_KEY, branch],
    queryFn: () => getMyStaffProfile(requireBranch(branch)),
    // Auth still loading → no branch to address yet; the query idles until
    // the whoami chain resolves it.
    enabled: branch !== null,
    // #584 branch-flip guard: login derives the branch from the role alone;
    // the first refresh re-derives it from whoami (a combined admin+master
    // flips admin→master) and the key swaps mid-session. Without the
    // placeholder the interim renders `data: undefined`, MyDataModal swaps
    // to its loading card, the form UNMOUNTS and the user's unsaved edits
    // are destroyed (the S3 regression: the save PUT traveled with an
    // empty body). Both branches serve the same account/rows (§4.4), so
    // serving the previous branch's data through the swap is honest.
    placeholderData: keepPreviousData,
  });
}

function invalidateProfileFamilies(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ME_KEY });
  invalidateEntities(qc, ['staff']);
}

/** PUT /api/v1/my/{branch} — partial update; omitted keys keep, explicit null clears. */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  const { branch } = useAuth();
  return useMutation({
    mutationFn: (data: MyProfileUpdate) => updateMyStaffProfile(requireBranch(branch), data),
    onSuccess: () => invalidateProfileFamilies(qc),
  });
}

/** POST /api/v1/my/{branch}/avatar — multipart upload; writes Staff.avatar_url. */
export function useUploadAvatar() {
  const qc = useQueryClient();
  const { branch } = useAuth();
  return useMutation({
    mutationFn: (file: File) => uploadAvatar(requireBranch(branch), file),
    onSuccess: () => invalidateProfileFamilies(qc),
  });
}

/**
 * POST /api/v1/auth/change-password — no cache invalidation: the profile is
 * untouched, and the CURRENT session stays alive (D6). Other sessions are
 * revoked server-side.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (data: ChangePassword) => changePassword(data),
  });
}
