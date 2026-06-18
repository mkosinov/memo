'use client';

import React from 'react';

export interface FullPageErrorProps {
  error: Error;
  onReset?: () => void;
}

export function FullPageError({ error, onReset }: FullPageErrorProps) {
  return (
    <div
      role="alert"
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-main p-8 text-white"
      data-testid="full-page-error"
    >
      <h1 className="text-2xl font-semibold">Что-то пошло не так</h1>
      <p className="text-sm text-white/70 max-w-md text-center">
        Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу.
      </p>
      {error?.message && (
        <pre className="text-xs text-white/50 max-w-2xl overflow-auto bg-sidebar p-3 rounded">
          {error.message}
        </pre>
      )}
      <button
        type="button"
        onClick={() => onReset?.() ?? window.location.reload()}
        className="mt-2 px-5 py-2 rounded bg-brand text-white hover:bg-brand-light transition-colors"
      >
        Перезагрузить
      </button>
    </div>
  );
}
