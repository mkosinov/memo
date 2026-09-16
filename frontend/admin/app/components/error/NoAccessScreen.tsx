'use client';

import React from 'react';

/**
 * NoAccessScreen (GH #263 T9) — full-page «Нет доступа» for an authenticated
 * master who navigates straight to an admin-only section URL (the menu hides
 * the links, but the URL is still reachable — the (main)/layout guard mounts
 * this instead of children). ErrorState-based per the plan: same visual
 * language as data-load failures, but with a fixed title and no retry (a
 * retry cannot grant permissions).
 */
export function NoAccessScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div
        role="alert"
        className="flex flex-col items-center gap-3 py-8 text-sm text-white/70"
        data-testid="no-access"
      >
        <div className="text-base font-medium text-white">
          Нет доступа к разделу
        </div>
      </div>
    </div>
  );
}
