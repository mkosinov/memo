import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CalendarPopover } from '../app/components/shared/CalendarPopover';

describe('CalendarPopover', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelectDate: vi.fn(),
    selectedDate: new Date(2026, 5, 11), // June 11, 2026
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<CalendarPopover {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the calendar when isOpen is true', () => {
    render(<CalendarPopover {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays month and year header', () => {
    render(<CalendarPopover {...defaultProps} />);
    // June 2026
    expect(screen.getByText(/Июнь 2026/)).toBeInTheDocument();
  });

  it('displays day-of-week headers (Mon-Sun in Russian)', () => {
    render(<CalendarPopover {...defaultProps} />);
    expect(screen.getByText('ПН')).toBeInTheDocument();
    expect(screen.getByText('ВТ')).toBeInTheDocument();
    expect(screen.getByText('СР')).toBeInTheDocument();
    expect(screen.getByText('ЧТ')).toBeInTheDocument();
    expect(screen.getByText('ПТ')).toBeInTheDocument();
    expect(screen.getByText('СБ')).toBeInTheDocument();
    expect(screen.getByText('ВС')).toBeInTheDocument();
  });

  it('displays days of the current month', () => {
    render(<CalendarPopover {...defaultProps} />);
    // June 2026 has 30 days
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('navigates to previous month when left arrow clicked', () => {
    render(<CalendarPopover {...defaultProps} />);
    const prevBtn = screen.getByRole('button', { name: /предыдущий месяц/i });
    fireEvent.click(prevBtn);
    expect(screen.getByText(/Май 2026/)).toBeInTheDocument();
  });

  it('navigates to next month when right arrow clicked', () => {
    render(<CalendarPopover {...defaultProps} />);
    const nextBtn = screen.getByRole('button', { name: /следующий месяц/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Июль 2026/)).toBeInTheDocument();
  });

  it('calls onSelectDate when a day is clicked', () => {
    const onSelectDate = vi.fn();
    render(<CalendarPopover {...defaultProps} onSelectDate={onSelectDate} />);
    // Click on day 15
    const day15 = screen.getByText('15');
    fireEvent.click(day15);
    expect(onSelectDate).toHaveBeenCalledTimes(1);
    // Should be called with a Date object for June 15, 2026
    const calledDate = onSelectDate.mock.calls[0][0] as Date;
    expect(calledDate.getFullYear()).toBe(2026);
    expect(calledDate.getMonth()).toBe(5); // June
    expect(calledDate.getDate()).toBe(15);
  });

  it('calls onClose after a date is selected', () => {
    const onClose = vi.fn();
    const onSelectDate = vi.fn();
    render(<CalendarPopover {...defaultProps} onClose={onClose} onSelectDate={onSelectDate} />);
    fireEvent.click(screen.getByText('15'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('highlights the selected date', () => {
    render(<CalendarPopover {...defaultProps} />);
    // Day 11 should have a special highlight style
    const day11 = screen.getByText('11');
    expect(day11.closest('[data-selected="true"]')).toBeInTheDocument();
  });

  it('highlights today', () => {
    // Date-agnostic: find today's day number and check for data-today attribute
    const today = new Date();
    const todayDay = today.getDate();
    render(<CalendarPopover {...defaultProps} />);
    const todayEl = screen.getByText(String(todayDay));
    expect(todayEl.closest('[data-today="true"]')).toBeInTheDocument();
  });

  it('calls onClose when escape key is pressed', () => {
    const onClose = vi.fn();
    render(<CalendarPopover {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates multiple months forward and backward', () => {
    render(<CalendarPopover {...defaultProps} />);
    const prevBtn = screen.getByRole('button', { name: /предыдущий месяц/i });
    const nextBtn = screen.getByRole('button', { name: /следующий месяц/i });

    // Go forward 2 months
    fireEvent.click(nextBtn);
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Август 2026/)).toBeInTheDocument();

    // Go back 3 months
    fireEvent.click(prevBtn);
    fireEvent.click(prevBtn);
    fireEvent.click(prevBtn);
    expect(screen.getByText(/Май 2026/)).toBeInTheDocument();
  });
});
