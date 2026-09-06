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

  describe('minute-based position (GH #142)', () => {
    it('positions at (nowMinutes - gridStartMinutes) * cellHeight / 30 with defaults', () => {
      // System time 12:00 → nowMinutes = 720; default gridStartMinutes = 540, cellHeight = 60
      // pos = (720 - 540) * 60 / 30 = 360px
      render(<NowLine date={today} />);
      const line = screen.getByTestId('now-line');
      expect(line.style.top).toBe('360px');
    });

    it('honors a custom gridStartMinutes prop', () => {
      // gridStartMinutes = 480 (08:00) → pos = (720 - 480) * 60 / 30 = 480px
      render(<NowLine date={today} gridStartMinutes={480} />);
      const line = screen.getByTestId('now-line');
      expect(line.style.top).toBe('480px');
    });

    it('scales with cellHeight', () => {
      // cellHeight = 30 → pos = (720 - 540) * 30 / 30 = 180px
      render(<NowLine date={today} cellHeight={30} />);
      const line = screen.getByTestId('now-line');
      expect(line.style.top).toBe('180px');
    });

    it('does not render when now is before gridStartMinutes', () => {
      // gridStartMinutes = 780 (13:00) > nowMinutes 720 → pos < 0 → hidden
      const { container } = render(<NowLine date={today} gridStartMinutes={780} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
