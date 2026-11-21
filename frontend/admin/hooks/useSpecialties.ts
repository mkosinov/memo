'use client';
import { useQuery } from '@tanstack/react-query';
import { getAllSpecialties } from '@memo/api-client';
import type { SpecialtyResponse } from '@memo/api-client';
import { qk, DICT_STALE_TIME } from '@/lib/queryKeys';

/**
 * Specialties dictionary lookup (GH #599) — bare GET /api/v1/specialties/all.
 * Consumers: ServiceModal (the «Направление» select), StaffTable → StaffModal
 * (the master-section checkbox list). The ['specialties'] prefix is shared
 * with the paged table (contexts/SpecialtiesContext.tsx, the «Направления»
 * tab), so specialty mutations (hooks/useSpecialtiesMutations.ts) invalidate
 * this lookup too — a freshly created direction appears in the dropdowns on
 * the next render. Same SSE-omission rule as positions (usePositions
 * precedent). `enabled` gates the fetch on permissions (useMaterialsRaw
 * precedent — a query the viewer cannot read never mounts).
 */
export function useSpecialtiesRaw(enabled = true) {
  return useQuery<SpecialtyResponse[]>({
    queryKey: qk.specialties,
    queryFn: () => getAllSpecialties(),
    staleTime: DICT_STALE_TIME,
    enabled,
  });
}
