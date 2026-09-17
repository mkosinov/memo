'use client';

import React, { useEffect, useRef, useState } from 'react';

// Spinner geometry (ToastContainer.tsx): viewBox 12, r 4.5
const RADIUS = 4.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 28.27

/**
 * Undo-toast countdown ring (#94).
 * One `setInterval(1000)` drives both the digit and the ring step (spec D4):
 * no CSS keyframes, no inline animationDuration. The ring never hides itself —
 * toast lifetime is owned by UIContext; digits never show 0.
 */
export function CountdownRing({ countdownMs }: { countdownMs: number }) {
  const [remainingMs, setRemainingMs] = useState(countdownMs);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [countdownMs]);

  // Window exhausted: stop the interval — no more ticks (toast disappears via UIContext)
  useEffect(() => {
    if (remainingMs <= 0 && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [remainingMs]);

  const fraction = countdownMs > 0 ? remainingMs / countdownMs : 0;
  const digit = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <span
      data-testid="toast-countdown"
      aria-hidden="true"
      className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 12 12"
        fill="none"
        className="absolute inset-0"
      >
        <circle cx="6" cy="6" r={RADIUS} stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
        <circle
          cx="6"
          cy="6"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={(1 - fraction) * CIRCUMFERENCE}
          transform="rotate(-90 6 6)"
        />
      </svg>
      <span className="relative text-[8px] leading-none tabular-nums">{digit}</span>
    </span>
  );
}
