import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NowLine } from '../app/components/schedule/NowLine';

describe('NowLine', () => {
  const today = new Date(2024, 0, 15, 12, 0, 0);
  
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  it('does not render when date is not today', () => {
    const { container } = render(<NowLine date={tomorrow} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when date is yesterday', () => {
    const { container } = render(<NowLine date={yesterday} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when date is today', () => {
    render(<NowLine date={today} />);
    const line = screen.getByTestId('now-line');
    expect(line).toBeInTheDocument();
  });

  it('renders with correct test id and brand styling', () => {
    render(<NowLine date={today} />);
    const line = screen.getByTestId('now-line');
    expect(line).toHaveClass('absolute');
    expect(line).toHaveClass('left-0');
    expect(line).toHaveClass('right-0');
  });
});
