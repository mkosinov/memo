'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyProfile,
  updateMyProfile,
  uploadPortrait,
  changePassword,
} from '@memo/api-client';
import type { MyProfile, MyProfileUpdate, ChangePassword } from '@memo/api-client';
import { invalidateEntities } from '@/lib/invalidate';

/**
 * «Мои данные» data layer (GH #262 T7, spec §5.2/§5.5).
 *
 * Query key: ['me','profile'] — a CHILD of the ['me'] prefix, so any future
 * reader of the auth snapshot is covered by one invalidateQueries(['me']).
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

/** GET /api/v1/my — the flat editable profile (public card half + private half). */
export function useMyProfile() {
  return useQuery<MyProfile>({
    queryKey: ME_PROFILE_KEY,
    queryFn: () => getMyProfile(),
  });
}

function invalidateProfileFamilies(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ME_KEY });
  invalidateEntities(qc, ['staff']);
}

/** PUT /api/v1/my — partial update; omitted keys keep, explicit null clears. */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MyProfileUpdate) => updateMyProfile(data),
    onSuccess: () => invalidateProfileFamilies(qc),
  });
}

/** POST /api/v1/my/portrait — multipart upload; writes Staff.avatar_url. */
export function useUploadPortrait() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadPortrait(file),
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
