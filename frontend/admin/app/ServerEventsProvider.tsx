'use client';

/**
 * Server push channel consumer (GH #239, spec §4.2/§4.3).
 *
 * Subscribes to the backend SSE stream (`eventsUrl`), invalidates React
 * Query families through the shared INVALIDATION_MAP on every
 * `event: invalidate` frame, and raises the standard «Данные обновлены»
 * info toast — but ONLY for events not caused by this tab (origin
 * suppression: `!(origin.type === 'tab' && origin.id === getTabId())`).
 *
 * A burst of events collapses into ONE toast: the toast fires only when a
 * new collapse window (1000 ms) opens. Reconnect convergence (connection
 * OPEN again after an error) blanket-invalidates every active query with
 * NO toast — it is convergence, not a change notification. Malformed
 * frames are skipped silently (spec §5). EventSource reconnects on its own
 * (`retry: 5000` from the server); the first `event: ready` frame only
 * carries that retry hint and needs no handler.
 *
 * No new UI: rendering, stacking and auto-dismiss belong to the existing
 * toast system (ToastContainer mounted in providers.tsx).
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eventsUrl, getTabId } from '@memo/api-client';
import { invalidateEntities } from '@/lib/invalidate';
import { useUI } from '@/contexts/UIContext';

/** Burst-collapse window: invalidation frames arriving inside one window
 *  share a single toast (spec §2.4 — a burst of events = one indicator). */
const TOAST_BURST_WINDOW_MS = 1000;

export function ServerEventsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { showToast } = useUI();
  const hadError = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // GH #247 §4.7: the events endpoint is behind the default-deny guard —
    // the session cookie must ride along (EventSource sends cookies only
    // with withCredentials; same-site holds: frontend 127.0.0.1:{port} vs
    // API 127.0.0.1:{BACKEND_PORT}).
    const es = new EventSource(eventsUrl, { withCredentials: true });

    es.onopen = () => {
      if (hadError.current) {
        hadError.current = false;
        // Reconnect convergence — blanket invalidate, NO toast (spec §4.2).
        void qc.invalidateQueries();
      }
    };
    es.onerror = () => {
      hadError.current = true; // EventSource retries natively (retry: 5000)
    };

    es.addEventListener('invalidate', (e: MessageEvent) => {
      try {
        const { entities, origin } = JSON.parse(e.data) as {
          entities: string[];
          origin: { type: string; id: string } | null;
        };
        // Always invalidate — double invalidation with own mutations is
        // harmless (spec §4.2).
        invalidateEntities(qc, entities);
        const ownOrigin = origin?.type === 'tab' && origin?.id === getTabId();
        if (!ownOrigin) {
          // Burst collapses into ONE toast: only fire when opening a new
          // window; frames inside an open window are already covered.
          if (!toastTimer.current) {
            toastTimer.current = setTimeout(() => {
              toastTimer.current = null;
            }, TOAST_BURST_WINDOW_MS);
            showToast('Данные обновлены', 'info');
          }
        }
      } catch {
        /* malformed frame — skip silently (spec §5) */
      }
    });

    return () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
      es.close();
    };
  }, [qc, showToast]);

  return <>{children}</>;
}
