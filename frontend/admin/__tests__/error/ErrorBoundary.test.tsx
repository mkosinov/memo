import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/app/components/error/ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('render exploded');
  return <div>safe</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('safe')).toBeInTheDocument();
  });

  it('renders FullPageError on render throw', () => {
    // Suppress console.error from React's error logging
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('full-page-error')).toBeInTheDocument();
    expect(screen.getByText(/Что-то пошло не так/)).toBeInTheDocument();
  });
});
