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
import { setChannelDown } from '@/app/lib/connectionHealth';

/** Burst-collapse window: invalidation frames arriving inside one window
 *  share a single toast (spec §2.4 — a burst of events = one indicator). */
const TOAST_BURST_WINDOW_MS = 1000;

/** #330 §5.2: the connection-loss toast fires only after the channel has
 *  been continuously down for this long — flaps shorter than the window
 *  (onerror → onopen) show nothing. */
const LOST_DEBOUNCE_MS = 5000;

export function ServerEventsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { showToast, hideToast } = useUI();
  const hadError = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #330 §5.2: debounce timer for the connection-loss toast + the id of the
  // persistent toast already on screen (strictly one at a time).
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lostToastId = useRef<string | null>(null);

  const clearLostTimer = () => {
    if (lostTimer.current) {
      clearTimeout(lostTimer.current);
      lostTimer.current = null;
    }
  };

  const hideLostToast = () => {
    if (lostToastId.current) {
      hideToast(lostToastId.current);
      lostToastId.current = null;
    }
  };

  useEffect(() => {
    // #330 §5.1: start from «channel is up». A StrictMode remount must not
    // inherit a stale down-flag; a real outage re-asserts it on first onerror.
    setChannelDown(false);

    // GH #247 §4.7: the events endpoint is behind the default-deny guard —
    // the session cookie must ride along (EventSource sends cookies only
    // with withCredentials; same-site holds: frontend 127.0.0.1:{port} vs
    // API 127.0.0.1:{BACKEND_PORT}).
    const es = new EventSource(eventsUrl, { withCredentials: true });

    es.onopen = () => {
      // #330 §5.1: connection is back — cancel the pending debounce and
      // drop the loss toast if it had fired.
      clearLostTimer();
      setChannelDown(false);
      hideLostToast();
      if (hadError.current) {
        hadError.current = false;
        // Reconnect convergence — blanket invalidate, NO toast (spec §4.2).
        void qc.invalidateQueries();
      }
    };
    es.onerror = () => {
      // #330 §5.1: fatal closure (HTTP 401, proxy refusal — readyState
      // CLOSED) means the server is REACHABLE and refused us: this is not
      // a network loss, so no toast and the flag must not stay down. A real
      // outage re-asserts the flag with the next recoverable onerror.
      if (es.readyState === EventSource.CLOSED) {
        clearLostTimer();
        setChannelDown(false);
        hideLostToast();
        return;
      }
      // #330 §5.1: recoverable loss (readyState CONNECTING — the browser
      // retries natively, GH #239). Arm the debounce once; repeated errors
      // while already down (timer armed or toast already up) change nothing
      // and never restart the timer.
      setChannelDown(true);
      if (!lostTimer.current && !lostToastId.current) {
        lostTimer.current = setTimeout(() => {
          lostTimer.current = null;
          if (lostToastId.current) return; // strictly one toast
          // showToast(message, kind, undo, countdownMs, action, persistent):
          // the 6th positional arg (Task 3 signature) keeps the toast on
          // screen — no auto-dismiss timer and no × button (spec §5.3);
          // hidden only via hideToast(id) on reconnect.
          lostToastId.current = showToast(
            'Нет соединения с сервером. Обновления приостановлены.',
            'error',
            undefined,
            undefined,
            undefined,
            true,
          );
        }, LOST_DEBOUNCE_MS);
      }
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
      // #330 §5.2: same hygiene as the burst timer — clear the pending
      // debounce and drop the persistent toast if it is on screen.
      clearLostTimer();
      hideLostToast();
      es.close();
    };
    // showToast/hideToast are stable (useCallback with [] deps in UIContext),
    // so adding hideToast here never re-creates the EventSource.
  }, [qc, showToast, hideToast]);

  return <>{children}</>;
}
