import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { UIProvider, useUI } from '../contexts/UIContext';
import { ToastContainer } from '../app/components/toast/ToastContainer';

// #301: the unmount-cleanup effect must copy `toastTimers.current` to a local
// variable inside the effect (react-hooks/exhaustive-deps ref-in-cleanup rule).
// A toast scheduled right before unmount, then another showToast call AFTER
// unmount (a late resolve), swaps `toastTimers.current` to a NEW Map — if the
// cleanup captured the Map by reference it would clear the wrong (new) one or
// miss timers. The local-copy form guarantees we clear the exact timers that
// existed at unmount time and never touch a later Map.

describe('UIContext — toast timer cleanup uses the Map captured at unmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a pending auto-dismiss timer never fires after the provider unmounts (timer cleared, no leaked timeout)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let showToast: ((...args: Parameters<ReturnType<typeof useUI>['showToast']>) => string) | null = null;

    function Host() {
      const ui = useUI();
      showToast = ui.showToast;
      return null;
    }

    const { unmount } = render(
      <UIProvider>
        <Host />
        <ToastContainer />
      </UIProvider>,
    );

    // Schedule a normal info toast (4500ms auto-dismiss timer).
    act(() => {
      showToast?.('soon-unmounted', 'info');
    });
    expect(screen.queryByText('soon-unmounted')).toBeInTheDocument();
    // The auto-dismiss timer is live.
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    // RED assertion for #301: the unmount cleanup must have cleared the toast
    // timer. If cleanup reads `toastTimers.current` at cleanup time (instead
    // of the Map captured when the effect ran) a swapped Map would leak the
    // timer — it would still be scheduled here.
    expect(vi.getTimerCount()).toBe(0);

    // Advance past the toast lifetime with the provider gone: no callback
    // (and therefore no setState on an unmounted tree) may run.
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringMatching(/Can't perform a React state update on an unmounted component/),
    );
    consoleError.mockRestore();
  });
});
