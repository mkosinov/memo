import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';

/** Minimal probe: renders nothing, just exercises the hook. */
function Probe({ isDirty }: { isDirty: boolean }) {
  useUnsavedChangesGuard(isDirty);
  return null;
}

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches a beforeunload listener when dirty and removes it when clean', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { rerender } = render(<Probe isDirty={false} />);
    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

    rerender(<Probe isDirty={true} />);
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(removeSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

    rerender(<Probe isDirty={false} />);
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('calls preventDefault on a cancelable beforeunload event while dirty', () => {
    render(<Probe isDirty={true} />);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept beforeunload when clean', () => {
    render(<Probe isDirty={false} />);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
