import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusPicker } from '@/app/components/modal/ActivityDetailsModal/StatusPicker';

const STATUS_CONFIG = {
  waiting: { label: 'Ожидание', color: '#F59E0B' },
  visited: { label: 'Посетил', color: '#10B981' },
  cancelled: { label: 'Отменён', color: '#EF4444' },
  missed: { label: 'Неявка', color: '#6B7280' },
} as const;

const iconFor = (status: keyof typeof STATUS_CONFIG) => (
  <svg data-testid={`icon-${status}`} viewBox="0 0 24 24" />
);

describe('StatusPicker', () => {
  it('renders the current status as an icon', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
    expect(screen.getByTestId('status-picker-trigger')).toBeInTheDocument();
    expect(screen.getByLabelText('Статус: Ожидание')).toBeInTheDocument();
  });

  it('opens popover on click and shows all 4 options', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-visited')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-missed')).toBeInTheDocument();
  });

  it('calls onChange and closes popover when option is clicked', () => {
    const onChange = vi.fn();
    render(<StatusPicker value="waiting" onChange={onChange} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    fireEvent.click(screen.getByTestId('status-picker-option-visited'));
    expect(onChange).toHaveBeenCalledWith('visited');
    expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
  });

  it('closes popover on outside click', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <StatusPicker value="waiting" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />
      </div>
    );
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
  });
});
