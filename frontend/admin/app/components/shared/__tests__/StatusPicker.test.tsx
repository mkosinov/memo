import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusPicker } from '@/app/components/shared/StatusPicker';

describe('StatusPicker', () => {
  // ── icon variant (default) ──────────────────────────────────────────────

  it('renders icon-only button by default', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    const trigger = screen.getByTestId('status-picker-trigger');
    expect(trigger).toBeInTheDocument();
    // Should contain the icon SVG (via WaitingIcon)
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    // Should NOT contain label text
    expect(trigger.textContent).toBe('');
  });

  it('applies custom testIdPrefix', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} testIdPrefix="my-prefix" />);
    expect(screen.getByTestId('my-prefix')).toBeInTheDocument();
    expect(screen.getByTestId('my-prefix-trigger')).toBeInTheDocument();
  });

  // ── icon-with-label variant ─────────────────────────────────────────────

  it('renders icon + label + chevron in icon-with-label variant', () => {
    render(<StatusPicker value="visited" onChange={() => {}} variant="icon-with-label" />);
    const trigger = screen.getByTestId('status-picker-trigger');
    expect(trigger.querySelector('svg')).toBeInTheDocument(); // icon
    expect(trigger.textContent).toContain('Посетил'); // label
    // Chevron SVG (small w-3 h-3)
    const svgs = trigger.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2); // icon + chevron
  });

  // ── popover open/close ──────────────────────────────────────────────────

  it('opens popover on click and shows all 4 options', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));

    const popover = screen.getByTestId('status-picker-popover');
    expect(popover).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-visited')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-cancelled')).toBeInTheDocument();
    expect(screen.getByTestId('status-picker-option-missed')).toBeInTheDocument();
  });

  it('calls onChange with the selected status and closes popover', () => {
    const onChange = vi.fn();
    render(<StatusPicker value="waiting" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    fireEvent.click(screen.getByTestId('status-picker-option-visited'));

    expect(onChange).toHaveBeenCalledWith('visited');
    expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
  });

  it('closes popover on outside click', () => {
    render(
      <div>
        <StatusPicker value="waiting" onChange={() => {}} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
  });

  it('closes popover on Escape key', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));
    expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
  });

  // ── active state ────────────────────────────────────────────────────────

  it('marks the active status with aria-selected', () => {
    render(<StatusPicker value="missed" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('status-picker-trigger'));

    const activeOption = screen.getByTestId('status-picker-option-missed');
    expect(activeOption).toHaveAttribute('aria-selected', 'true');

    const inactiveOption = screen.getByTestId('status-picker-option-waiting');
    expect(inactiveOption).toHaveAttribute('aria-selected', 'false');
  });

  // ── placeholder ─────────────────────────────────────────────────────────

  it('shows placeholder text when value is empty and placeholder is set', () => {
    render(
      <StatusPicker
        value={'' as never}
        onChange={() => {}}
        placeholder="Все статусы"
        variant="icon-with-label"
        testIdPrefix="filter-status"
      />
    );
    const trigger = screen.getByTestId('filter-status-trigger');
    expect(trigger.textContent).toContain('Все статусы');
  });

  it('opens popover from placeholder state and allows selection', () => {
    const onChange = vi.fn();
    render(
      <StatusPicker
        value={'' as never}
        onChange={onChange}
        placeholder="Все статусы"
        variant="icon-with-label"
        testIdPrefix="filter-status"
      />
    );
    fireEvent.click(screen.getByTestId('filter-status-trigger'));
    expect(screen.getByTestId('filter-status-popover')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('filter-status-option-waiting'));
    expect(onChange).toHaveBeenCalledWith('waiting');
  });

  // ── size variants ───────────────────────────────────────────────────────

  it('applies sm size classes by default', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} />);
    const trigger = screen.getByTestId('status-picker-trigger');
    expect(trigger.className).toContain('w-7');
    expect(trigger.className).toContain('h-7');
  });

  it('applies md size classes when size="md"', () => {
    render(<StatusPicker value="waiting" onChange={() => {}} size="md" />);
    const trigger = screen.getByTestId('status-picker-trigger');
    expect(trigger.className).toContain('w-9');
    expect(trigger.className).toContain('h-9');
  });
});
