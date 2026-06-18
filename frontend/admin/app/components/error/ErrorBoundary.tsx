'use client';

import React from 'react';
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { FullPageError } from './FullPageError';

function defaultFallback({ error, resetErrorBoundary }: FallbackProps) {
  return <FullPageError error={error} onReset={resetErrorBoundary} />;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (props: FallbackProps) => React.ReactNode;
}

export function ErrorBoundary({ children, fallback = defaultFallback }: ErrorBoundaryProps) {
  return <ReactErrorBoundary fallbackRender={fallback}>{children}</ReactErrorBoundary>;
}
