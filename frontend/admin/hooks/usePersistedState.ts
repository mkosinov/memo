'use client';

import { useCallback, useState } from 'react';

// localStorage-backed state (GH #141, spec §4).
// The hook owns STORAGE MECHANICS only (read/parse/persist/SSR guard);
// value semantics (clamp/validate) stay in the domain hook or component —
// write-side clamping lives in GridSettingsContext, read-side in `decode`.
// SSR mechanics are deliberately identical to the four grid settings today:
// lazy useState initializer + typeof-window guard; no useSyncExternalStore,
// no cross-tab `storage` events (considered and rejected — no requirement).

// Exported for the SSR test: react-dom cannot mount a tree with `window`
// undefined, so the guard is asserted directly on the initializer (GH #141).
export function readPersisted<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | null,
): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const decoded = decode(raw);
    return decoded === null ? fallback : decoded;
  } catch {
    return fallback;
  }
}

export function usePersistedState<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | null,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPersisted(key, fallback, decode));

  const setPersisted = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full/blocked — keep the in-memory value */
      }
    },
    [key],
  );

  return [value, setPersisted];
}
