'use client';

import { useEffect } from 'react';
import { isForcedNavigation } from '@/lib/forcedNavigation';

// Native reload/close guard while dirty (GH #141 spec §5). Attached ONLY
// while dirty: a permanently attached beforeunload listener evicts the page
// from bfcache (MDN). In-app navigation is deliberately NOT intercepted —
// the request keeps flying and data converges via the global queryClient.
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      // #397 §5.3 (С8): a system-forced full navigation (401 → /login) must
      // not raise the leave dialog — refusing would trap the user on a page
      // where every request answers 401. Pending deletions are quietly
      // cancelled (the safe "don't delete" outcome).
      if (isForcedNavigation()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
