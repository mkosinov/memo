'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPosition, updatePosition, deletePosition } from '@memo/api-client';
import type { PositionCreate, PositionUpdate } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * Positions dictionary mutations (GH #266 T9, spec D4).
 *
 * Invalidation goes DIRECTLY at the ['positions'] prefix instead of through
 * lib/invalidate.ts INVALIDATION_MAP: `positions` is deliberately absent from
 * that map (spec «SSE-сущности» — the backend emits the entity, the frontend
 * SSE mirror skips it, and the drift guard __tests__/invalidate.test.ts pins
 * the absence). react-query prefix matching then covers BOTH cache
 * granularities in one call: the /all lookup (usePositions → StaffModal
 * checkboxes + StaffTable cells) and the paged table key
 * (['positions', page, perPage, sortBy, sortOrder] — PositionsContext).
 * This is the arrangement hooks/usePositions.ts documents for T9.
 */

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PositionCreate) => createPosition(data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PositionUpdate }) => updatePosition(id, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

/**
 * Delete a user-defined position. Built-ins (is_system) are refused
 * server-side with 422 POSITION_IS_SYSTEM — the mutation rejects and the
 * caller surfaces the explanation as an error toast (D4: the client never
 * second-guesses which rows are protected).
 */
export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePosition(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}
