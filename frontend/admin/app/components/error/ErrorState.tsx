'use client';

import React from 'react';

export type ErrorStateVariant = 'table' | 'card' | 'inline';

export interface ErrorStateProps {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
  variant?: ErrorStateVariant;
  colspan?: number;
}

export function ErrorState({
  error,
  onRetry,
  title = 'Не удалось загрузить данные',
  variant = 'inline',
  colspan,
}: ErrorStateProps) {
  const content = (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 py-8 text-sm text-white/70"
      data-testid="error-state"
    >
      <div className="text-base font-medium text-white">{title}</div>
      {error?.message && (
        <div className="text-xs text-white/50 max-w-md text-center">{error.message}</div>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-4 py-1.5 rounded bg-brand text-white text-sm hover:bg-brand-light transition-colors"
        >
          Повторить
        </button>
      )}
    </div>
  );

  if (variant === 'table') {
    return (
      <tr>
        <td colSpan={colspan ?? 99} className="text-center">
          {content}
        </td>
      </tr>
    );
  }
  return content;
}
