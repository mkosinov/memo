'use client';

import { useEffect } from 'react';

// Native reload/close guard while dirty (GH #141 spec §5). Attached ONLY
// while dirty: a permanently attached beforeunload listener evicts the page
// from bfcache (MDN). In-app navigation is deliberately NOT intercepted —
// the request keeps flying and data converges via the global queryClient.
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
