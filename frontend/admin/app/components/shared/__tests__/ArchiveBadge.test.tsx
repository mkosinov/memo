import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchiveBadge } from '../ArchiveBadge';

describe('ArchiveBadge', () => {
  it('renders pill with label «Архив»', () => {
    render(<ArchiveBadge parts={['мастер']} />);
    expect(screen.getByTestId('archived-badge')).toHaveTextContent('Архив');
  });

  it('has aria-label enumerating a single part', () => {
    render(<ArchiveBadge parts={['мастер']} />);
    expect(screen.getByTestId('archived-badge')).toHaveAttribute(
      'aria-label',
      'Архив: мастер'
    );
  });

  it('has aria-label enumerating multiple parts in order', () => {
    render(<ArchiveBadge parts={['мастер', 'локация']} />);
    expect(screen.getByTestId('archived-badge')).toHaveAttribute(
      'aria-label',
      'Архив: мастер, локация'
    );
  });

  it('aria-label enumerates all three parts', () => {
    render(<ArchiveBadge parts={['мастер', 'локация', 'услуга']} />);
    expect(screen.getByTestId('archived-badge')).toHaveAttribute(
      'aria-label',
      'Архив: мастер, локация, услуга'
    );
  });

  it('matches StatusBadge pill sizing (rounded-full px-2 py-0.5 text-xs)', () => {
    render(<ArchiveBadge parts={['услуга']} />);
    const badge = screen.getByTestId('archived-badge');
    expect(badge).toHaveClass('rounded-full');
    expect(badge).toHaveClass('px-2');
    expect(badge).toHaveClass('py-0.5');
    expect(badge).toHaveClass('text-xs');
  });
});
