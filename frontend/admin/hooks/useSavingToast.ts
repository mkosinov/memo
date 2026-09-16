'use client';

import { useEffect, useRef } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';

const IN_FLIGHT = new Set(['pending']); // v5: paused = state.isPaused=true при status 'pending',
                                        // так что подсчёт 'pending' покрывает и paused (спека D2)

/**
 * «Сохраняем…» indicator (spec 2026-09-14-saving-toast §3 D2): watches the
 * shared schedule-activity mutation key and shows exactly ONE `loading` toast
 * for the whole in-flight batch. Settling the last mutation (success OR error)
 * removes it; unmounting with a live toast removes it too (protection against
 * a stuck indicator). Result feedback comes from the existing result toasts (D4).
 */
export function useSavingToast(): void {
  const { showToast, hideToast } = useUI();
  const statuses = useMutationState({
    filters: { mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY },
    select: (m) => m.state.status,
  });
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const inFlight = statuses.filter((s) => IN_FLIGHT.has(s)).length;
    if (inFlight > 0 && toastIdRef.current === null) {
      toastIdRef.current = showToast('Сохраняем…', 'loading');
    } else if (inFlight === 0 && toastIdRef.current !== null) {
      hideToast(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [statuses, showToast, hideToast]);

  // Cleanup on unmount — the only guard against an «eternal» toast.
  useEffect(() => () => {
    if (toastIdRef.current !== null) hideToast(toastIdRef.current);
  }, [hideToast]);
}
