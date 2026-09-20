'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { ApiError } from '@memo/api-client';
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
  /**
   * #285 D4: consumer-specific commit-failure handler. When present it
   * receives every non-404 commit error and suppresses the default handling
   * (undo + error toast). The 404 quiet-success branch runs before this —
   * the commit goal is already achieved (DELETE is idempotent).
   */
  onError?: (err: unknown) => void;
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
      //    - clears + deletes the pending timer so commit() never fires
      //    - runs the user-supplied rollback (only while the entry exists —
      //      see the #285 D4 rev8 gating note inside).
      // #94 (spec D3): the undo window (delayMs) rides as the toast's
      // `countdownMs` — countdown ring, toast lifetime and the commit timer
      // below all derive from this single value.
      showToast(
        action.message,
        () => {
          // #285 D4 (rev8): undo is gated on the pending entry. Once the
          // commit timer fired, the entry is removed BEFORE the commit runs —
          // a late «Отменить» click would locally resurrect a row the server
          // has already deleted, so it is a no-op.
          const t = timersRef.current.get(action.id);
          if (!t) return;
          clearTimeout(t);
          timersRef.current.delete(action.id);
          action.undo();
        },
        undefined, // kind slot — unused on the kindless undo path
        action.delayMs,
      );

      // 3. Schedule commit after the undo window.
      const timer = setTimeout(async () => {
        // #285 D4 (rev8): drop the pending entry BEFORE the commit starts —
        // from this moment undo() finds no entry and is a no-op. A
        // re-enqueue of the same id creates a fresh entry and is unaffected.
        timersRef.current.delete(action.id);
        try {
          await action.commit();
        } catch (err) {
          // D4 (rev8) default handling, domain-independent:
          // 404 — quiet success: DELETE is idempotent, the target is already
          // deleted by a competitor, the commit goal is achieved. No undo,
          // no toast (the cache entry stays removed).
          if (err instanceof ApiError && err.status === 404) return;
          // Custom consumer handler overrides the default for every other
          // error (e.g. the records 409 stale_dependencies branch).
          if (action.onError) {
            action.onError(err);
            return;
          }
          action.undo();
          // #243 S3 (deletion.md branch 5): an ApiError means the server
          // answered with an error — the deletion is cancelled. A non-ApiError
          // (network failure, abort, timeout) means the server never answered:
          // the deletion outcome is UNKNOWN, so the honest toast must not
          // claim «Изменение отменено».
          if (err instanceof ApiError) {
            showToast('Не удалось удалить. Изменение отменено', 'error');
          } else {
            showToast('Не удалось подтвердить удаление', 'error');
          }
        }
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
