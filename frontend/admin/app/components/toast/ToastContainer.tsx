'use client';

import React from 'react';
import { useUI } from '@/contexts/UIContext';

export function ToastContainer() {
  const { toasts, hideToast } = useUI();

  if (toasts.length === 0) return null;

  const visible = toasts.slice(-5);

  const BORDER_BY_KIND: Record<string, string> = {
    info: 'border-transparent',
    success: 'border-l-4 border-l-emerald-400',
    error: 'border-l-4 border-l-red-400',
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[250] flex flex-col gap-2 max-w-sm"
      role="status"
      aria-live="polite"
    >
      {visible.map((toast) => (
        <div
          key={toast.id}
          data-testid={`toast-${toast.kind}`}
          className={`flex items-center gap-3 bg-sidebar text-white px-4 py-3 rounded-lg shadow-lg text-sm animate-slide-up ${BORDER_BY_KIND[toast.kind] ?? BORDER_BY_KIND.info}`}
        >
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
          <button
            onClick={() => hideToast(toast.id)}
            className="text-white/50 hover:text-white ml-1"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
