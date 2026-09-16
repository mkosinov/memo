'use client';

import React from 'react';
import { useUI } from '@/contexts/UIContext';
import { CountdownRing } from './CountdownRing';

export function ToastContainer() {
  const { toasts, hideToast } = useUI();

  if (toasts.length === 0) return null;

  const loading = toasts.filter((t) => t.kind === 'loading');
  const visible = [...toasts.filter((t) => t.kind !== 'loading').slice(-5), ...loading];

  const BORDER_BY_KIND: Record<string, string> = {
    info: 'border-transparent',
    success: 'border-l-4 border-l-emerald-400',
    error: 'border-l-4 border-l-red-400',
    loading: 'border-transparent',
  };

  return (
    <div
      data-testid="toast-container"
      className="fixed bottom-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 max-w-sm"
      role="status"
      aria-live="polite"
    >
      {visible.map((toast) => (
        <div
          key={toast.id}
          data-testid={`toast-${toast.kind}`}
          className={`flex items-center gap-3 bg-sidebar text-white px-4 py-3 rounded-lg shadow-lg text-sm animate-slide-up ${BORDER_BY_KIND[toast.kind] ?? BORDER_BY_KIND.info}`}
        >
          {toast.kind === 'loading' && (
            <svg
              className="animate-spin shrink-0"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
              <path d="M10.5 6A4.5 4.5 0 006 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {toast.countdownMs !== undefined && <CountdownRing countdownMs={toast.countdownMs} />}
          <span className="flex-1">{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                hideToast(toast.id);
              }}
              className="text-brand-light font-medium hover:underline whitespace-nowrap"
            >
              Отменить
            </button>
          )}
          {toast.kind !== 'loading' && (
            <button
              onClick={() => hideToast(toast.id)}
              className="text-white/50 hover:text-white ml-1"
              aria-label="Закрыть"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
