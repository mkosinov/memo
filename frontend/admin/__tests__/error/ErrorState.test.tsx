import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '@/app/components/error/ErrorState';

describe('ErrorState', () => {
  it('renders default message and retry button', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error('boom')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /повторить/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders <tr> when variant=table', () => {
    const { container } = render(
      <table>
        <tbody>
          <ErrorState error={new Error('x')} variant="table" />
        </tbody>
      </table>
    );
    expect(container.querySelector('tr')).toBeInTheDocument();
    expect(container.querySelector('tr')?.querySelector('td[colspan]')).toBeInTheDocument();
  });

  it('hides retry button when onRetry not provided', () => {
    render(<ErrorState error={new Error('x')} variant="inline" />);
    expect(screen.queryByRole('button', { name: /повторить/i })).not.toBeInTheDocument();
  });
});
