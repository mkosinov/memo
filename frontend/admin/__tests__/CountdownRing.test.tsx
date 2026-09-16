import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { CountdownRing } from '../app/components/toast/CountdownRing';

// Spinner geometry: viewBox 12, r 4.5 → circumference 2π·4.5 ≈ 28.27
const CIRC = 2 * Math.PI * 4.5;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ring(): HTMLElement {
  const el = document.querySelector('[data-testid="toast-countdown"]');
  if (!el) throw new Error('toast-countdown ring not found');
  return el as HTMLElement;
}

function progressCircle(): SVGCircleElement {
  // Only the progress circle carries stroke-dasharray (the track does not)
  const el = ring().querySelector('circle[stroke-dasharray]');
  if (!el) throw new Error('progress circle not found');
  return el as SVGCircleElement;
}

describe('CountdownRing', () => {
  it('counts down digits 5→4→3→2→1 by seconds and never shows 0', () => {
    vi.useFakeTimers();
    render(<CountdownRing countdownMs={5000} />);
    expect(ring().textContent).toBe('5');
    for (let s = 1; s <= 4; s++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(ring().textContent).toBe(String(5 - s));
    }
    // At the end of the window (and beyond) the digit stays at 1 — never 0
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ring().textContent).toBe('1');
  });

  it('grows stroke-dashoffset each tick proportionally to elapsed share of the window', () => {
    vi.useFakeTimers();
    render(<CountdownRing countdownMs={5000} />);
    expect(Number(progressCircle().getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    const offsets: number[] = [];
    for (let s = 1; s <= 5; s++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const offset = Number(progressCircle().getAttribute('stroke-dashoffset'));
      // offset = (1 - remaining/window)·C = elapsed share s/5 of the circumference
      expect(offset).toBeCloseTo((s / 5) * CIRC);
      offsets.push(offset);
    }
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
  });

  it('stops ticking after the window expires — render stays stable', () => {
    vi.useFakeTimers();
    render(<CountdownRing countdownMs={3000} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const offsetAfter = progressCircle().getAttribute('stroke-dashoffset');
    const textAfter = ring().textContent;
    expect(textAfter).toBe('1');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(progressCircle().getAttribute('stroke-dashoffset')).toBe(offsetAfter);
    expect(ring().textContent).toBe(textAfter);
  });

  it('marks the whole ring wrapper aria-hidden', () => {
    render(<CountdownRing countdownMs={5000} />);
    expect(ring()).toHaveAttribute('aria-hidden', 'true');
  });

  it('clears the interval on unmount — advancing timers afterwards neither throws nor rerenders', () => {
    vi.useFakeTimers();
    const { unmount } = render(<CountdownRing countdownMs={5000} />);
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }).not.toThrow();
    expect(document.querySelector('[data-testid="toast-countdown"]')).toBeNull();
  });
});
