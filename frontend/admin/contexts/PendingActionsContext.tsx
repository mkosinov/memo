'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useUI } from './UIContext';

export type PendingActionKind = 'delete';

export type PendingAction = {
  /** Dedupe/cancel key. Re-enqueueing the same id cancels any prior pending action. */
  id: string;
  kind: PendingActionKind;
  /** Toast text shown to the user. */
  message: string;
  /** How long the undo window stays open before commit() is called. */
  delayMs: number;
  /** Real action executed when the timer fires. */
  commit: () => Promise<void>;
  /** Rollback the optimistic change. Called when the user clicks "Отменить". */
  undo: () => void;
};

interface PendingActionsContextValue {
  enqueuePendingAction: (action: PendingAction) => void;
}

const PendingActionsContext = createContext<PendingActionsContextValue | null>(null);

export function PendingActionsProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useUI();
  // The map survives re-renders AND survives consumer unmount (provider lives at app level).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // App teardown only — clear every pending timer so we don't fire commits after unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const enqueuePendingAction = useCallback(
    (action: PendingAction) => {
      // 1. If a timer for this id already exists, cancel it first.
      const existing = timersRef.current.get(action.id);
      if (existing) {
        clearTimeout(existing);
        timersRef.current.delete(action.id);
      }

      // 2. Show the toast with the undo callback. The undo callback:
      //    - runs the user-supplied rollback
      //    - clears + deletes the pending timer so commit() never fires.
      showToast(action.message, () => {
        action.undo();
        const t = timersRef.current.get(action.id);
        if (t) {
          clearTimeout(t);
          timersRef.current.delete(action.id);
        }
      });

      // 3. Schedule commit after the undo window.
      const timer = setTimeout(async () => {
        await action.commit();
        timersRef.current.delete(action.id);
      }, action.delayMs);
      timersRef.current.set(action.id, timer);
    },
    [showToast],
  );

  return (
    <PendingActionsContext.Provider value={{ enqueuePendingAction }}>
      {children}
    </PendingActionsContext.Provider>
  );
}

export function usePendingActions() {
  const ctx = useContext(PendingActionsContext);
  if (!ctx) {
    throw new Error('usePendingActions must be used within PendingActionsProvider');
  }
  return ctx;
}
