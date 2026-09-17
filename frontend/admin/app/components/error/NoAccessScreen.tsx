'use client';

import React from 'react';
import { ErrorState } from './ErrorState';

/**
 * NoAccessScreen (GH #263 T9) — full-page «Нет доступа» for an authenticated
 * master who navigates straight to an admin-only section URL (the menu hides
 * the links, but the URL is still reachable — the (main)/layout guard mounts
 * this instead of children). COMPOSES ErrorState per the plan («на базе
 * ErrorState»): fixed title, no error detail, no retry (a retry cannot grant
 * permissions). The `data-testid="no-access"` hook lives on the wrapper —
 * ErrorState owns its own `error-state` testid.
 */
export function NoAccessScreen() {
  return (
    <div
      data-testid="no-access"
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <ErrorState error={null} title="Нет доступа к разделу" />
    </div>
  );
}
