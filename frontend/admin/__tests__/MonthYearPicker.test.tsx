import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthYearPicker } from '../app/components/shared/MonthYearPicker';

describe('MonthYearPicker', () => {
  const defaultProps = {
    selectedMonth: 5, // June
    selectedYear: 2026,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with current year', () => {
    render(<MonthYearPicker {...defaultProps} />);
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('renders all 12 month abbreviations', () => {
    render(<MonthYearPicker {...defaultProps} />);
    expect(screen.getByText('Янв')).toBeInTheDocument();
    expect(screen.getByText('Фев')).toBeInTheDocument();
    expect(screen.getByText('Мар')).toBeInTheDocument();
    expect(screen.getByText('Апр')).toBeInTheDocument();
    expect(screen.getByText('Май')).toBeInTheDocument();
    expect(screen.getByText('Июн')).toBeInTheDocument();
    expect(screen.getByText('Июл')).toBeInTheDocument();
    expect(screen.getByText('Авг')).toBeInTheDocument();
    expect(screen.getByText('Сен')).toBeInTheDocument();
    expect(screen.getByText('Окт')).toBeInTheDocument();
    expect(screen.getByText('Ноя')).toBeInTheDocument();
    expect(screen.getByText('Дек')).toBeInTheDocument();
  });

  it('highlights the selected month', () => {
    render(<MonthYearPicker {...defaultProps} />);
    const june = screen.getByText('Июн');
    expect(june).toHaveClass('bg-[var(--brand)]');
    expect(june).toHaveClass('text-white');
  });

  it('calls onSelect with month and year when a month is clicked', () => {
    render(<MonthYearPicker {...defaultProps} />);
    fireEvent.click(screen.getByText('Сен'));
    expect(defaultProps.onSelect).toHaveBeenCalledWith(8, 2026); // September = index 8
  });

  it('increments year when next year arrow is clicked', () => {
    render(<MonthYearPicker {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Следующий год'));
    expect(screen.getByText('2027')).toBeInTheDocument();
  });

  it('decrements year when prev year arrow is clicked', () => {
    render(<MonthYearPicker {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Предыдущий год'));
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('calls onSelect with updated year after year navigation', () => {
    render(<MonthYearPicker {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Следующий год'));
    fireEvent.click(screen.getByText('Янв'));
    expect(defaultProps.onSelect).toHaveBeenCalledWith(0, 2027);
  });

  it('does not highlight months from a different year', () => {
    // Render with June 2026 selected, then navigate to 2025
    render(<MonthYearPicker {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Предыдущий год'));
    // Now viewing 2025, but selected is still June 2026 — June should NOT be highlighted
    const june = screen.getByText('Июн');
    expect(june).not.toHaveClass('bg-[var(--brand)]');
  });

  it('renders with data-testid', () => {
    render(<MonthYearPicker {...defaultProps} />);
    expect(screen.getByTestId('month-year-picker')).toBeInTheDocument();
  });
});
