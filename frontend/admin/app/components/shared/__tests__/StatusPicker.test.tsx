import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusPicker } from '@/app/components/shared/StatusPicker';

describe('StatusPicker', () => {
  it('renders with default icon-only variant', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    expect(screen.getByTestId('status-picker')).toBeInTheDocument();
    expect(screen.getByTestId('custom-select-trigger')).toBeInTheDocument();
  });

  it('shows all 4 status options when opened', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('custom-select-trigger'));
    expect(screen.getByTestId('custom-select-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('custom-select-option-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('custom-select-option-visited')).toBeInTheDocument();
    expect(screen.getByTestId('custom-select-option-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('custom-select-option-missed')).toBeInTheDocument();
  });

  it('calls onChange with VisitStatus when option is clicked', () => {
    const onChange = vi.fn();
    render(<StatusPicker value="waiting" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('custom-select-trigger'));
    fireEvent.click(screen.getByTestId('custom-select-option-visited'));
    expect(onChange).toHaveBeenCalledWith('visited');
  });

  it('renders full variant with label text', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} variant="full" />);
    expect(screen.getByText('Ожидание')).toBeInTheDocument();
  });

  it('accepts custom testIdPrefix', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} testIdPrefix="my-prefix" />);
    expect(screen.getByTestId('my-prefix')).toBeInTheDocument();
  });

  it('shows placeholder option when placeholder prop is set', () => {
    const onChange = vi.fn();
    render(
      <StatusPicker
        value=""
        onChange={onChange}
        placeholder="Все статусы"
        variant="full"
        testIdPrefix="filter-status"
      />
    );
    fireEvent.click(screen.getByTestId('custom-select-trigger'));
    // "Все статусы" appears in both trigger and dropdown — use getAllByText
    const allStatuses = screen.getAllByText('Все статусы');
    expect(allStatuses.length).toBeGreaterThanOrEqual(2);
    // Click the "all" option in the dropdown
    fireEvent.click(screen.getByTestId('custom-select-option-'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
