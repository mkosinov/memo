import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// #397 §5.3 (С8) — forced-navigation suppression of the beforeunload guard.
//
// lib/forcedNavigation is module-scoped and deliberately has NO reset export
// (the flag lives exactly one full navigation). To keep the flag's state from
// leaking between cases we swap the module for a controllable test double at
// the same seam the auth layer uses (markForcedNavigation before
// window.location.assign) — `forcedFlag` resets in beforeEach.
let forcedFlag = false;
vi.mock('@/lib/forcedNavigation', () => ({
  markForcedNavigation: () => {
    forcedFlag = true;
  },
  isForcedNavigation: () => forcedFlag,
}));

import { markForcedNavigation } from '@/lib/forcedNavigation';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useUI } from '../contexts/UIContext';
import {
  PendingActionsProvider,
  usePendingActions,
} from '../contexts/PendingActionsContext';

// Same UIContext mock pattern as PendingActionsContext.test.tsx: capture
// showToast so the undo window opens without the real ToastContainer.
const showToastMock = vi.fn();

vi.mock('../contexts/UIContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/UIContext')>('../contexts/UIContext');
  return {
    ...actual,
    useUI: () => ({
      showToast: showToastMock,
      hideToast: vi.fn(),
    }),
  };
});

/** Minimal probe: renders nothing, just exercises the guard hook directly. */
function GuardProbe({ isDirty }: { isDirty: boolean }) {
  useUnsavedChangesGuard(isDirty);
  return null;
}

interface HarnessProps {
  onReady: (api: ReturnType<typeof usePendingActions>) => void;
}

function Harness({ onReady }: HarnessProps) {
  const api = usePendingActions();
  React.useEffect(() => {
    onReady(api);
  });
  return null;
}

function renderProvider() {
  const ref: { current: ReturnType<typeof usePendingActions> | null } = { current: null };
  const onReady = (a: ReturnType<typeof usePendingActions>) => {
    ref.current = a;
  };
  render(
    <PendingActionsProvider>
      <Harness onReady={onReady} />
    </PendingActionsProvider>,
  );
  if (!ref.current) throw new Error('Hook did not initialise');
  return ref.current;
}

const fireBeforeunload = () => {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
};

/** Enqueue a delete action whose undo window stays open for the whole test. */
function enqueueDelete(api: ReturnType<typeof usePendingActions>) {
  act(() => {
    api.enqueuePendingAction({
      id: 'rec-1',
      kind: 'delete',
      message: 'Удалено. Отменить',
      delayMs: 60_000, // far beyond the test lifetime — window stays open
      commit: vi.fn().mockResolvedValue(undefined),
      undo: vi.fn(),
    });
  });
}

describe('#397 С8 — forced navigation suppresses the beforeunload guard', () => {
  beforeEach(() => {
    forcedFlag = false;
    showToastMock.mockReset();
    showToastMock.mockImplementation(() => {});
  });

  describe('hook level (useUnsavedChangesGuard)', () => {
    it('dirty + flag set → beforeunload is NOT prevented (no leave dialog)', () => {
      render(<GuardProbe isDirty={true} />);
      markForcedNavigation();

      expect(fireBeforeunload().defaultPrevented).toBe(false);
    });

    it('dirty + no flag → beforeunload IS prevented (control, С2)', () => {
      render(<GuardProbe isDirty={true} />);

      expect(fireBeforeunload().defaultPrevented).toBe(true);
    });
  });

  describe('pipeline level (PendingActionsContext)', () => {
    it('unfinished action + flag set → beforeunload is NOT prevented', () => {
      const api = renderProvider();
      enqueueDelete(api);
      markForcedNavigation();

      expect(fireBeforeunload().defaultPrevented).toBe(false);
    });

    it('unfinished action + no flag → beforeunload IS prevented (control, С2)', () => {
      const api = renderProvider();
      enqueueDelete(api);

      expect(fireBeforeunload().defaultPrevented).toBe(true);
    });
  });
});
