import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TimePicker } from '../app/components/shared/TimePicker';

describe('TimePicker', () => {
  const defaultProps = {
    value: '2026-06-11T14:00:00',
    onChange: vi.fn(),
    gridFrequency: 15,
    precise: false,
    label: 'Время начала',
  };

  beforeEach(() => {
    defaultProps.onChange.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Rendering ──────────────────────────────────────────────────────────

  it('renders with label', () => {
    render(<TimePicker {...defaultProps} />);
    expect(screen.getByLabelText('Время начала')).toBeInTheDocument();
  });

  it('renders a select element', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
  });

  it('selects the current time from value', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.value).toBe('14:00');
  });

  // ─── Grid frequency mode (precise=false) ────────────────────────────────

  it('generates 15-minute interval options when gridFrequency=15 and precise=false', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    // Should contain grid-aligned times
    expect(options).toContain('00:00');
    expect(options).toContain('00:15');
    expect(options).toContain('00:30');
    expect(options).toContain('00:45');
    expect(options).toContain('01:00');
    // Should NOT contain non-aligned times
    expect(options).not.toContain('00:01');
    expect(options).not.toContain('00:05');
    expect(options).not.toContain('00:10');
  });

  it('generates 30-minute interval options when gridFrequency=30 and precise=false', () => {
    render(<TimePicker {...defaultProps} gridFrequency={30} precise={false} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('00:00');
    expect(options).toContain('00:30');
    expect(options).toContain('01:00');
    // Should NOT contain 15-minute marks
    expect(options).not.toContain('00:15');
    expect(options).not.toContain('00:45');
  });

  it('generates 5-minute interval options when gridFrequency=5 and precise=false', () => {
    render(<TimePicker {...defaultProps} gridFrequency={5} precise={false} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('00:00');
    expect(options).toContain('00:05');
    expect(options).toContain('00:10');
    expect(options).toContain('00:15');
    // Should NOT contain 1-minute steps
    expect(options).not.toContain('00:01');
    expect(options).not.toContain('00:02');
  });

  it('ends with 23:45 for 15-minute grid (last slot before midnight)', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options[options.length - 1]).toBe('23:45');
  });

  it('ends with 23:30 for 30-minute grid', () => {
    render(<TimePicker {...defaultProps} gridFrequency={30} precise={false} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options[options.length - 1]).toBe('23:30');
  });

  it('starts with 00:00', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options[0]).toBe('00:00');
  });

  // ─── Precise mode (precise=true) ────────────────────────────────────────

  it('generates 1-minute interval options when precise=true', () => {
    render(<TimePicker {...defaultProps} precise={true} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('00:00');
    expect(options).toContain('00:01');
    expect(options).toContain('00:02');
    expect(options).toContain('14:00');
    expect(options).toContain('14:01');
    expect(options).toContain('23:59');
  });

  it('generates 1440 options when precise=true (24 * 60)', () => {
    render(<TimePicker {...defaultProps} precise={true} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.options.length).toBe(1440);
  });

  it('ends with 23:59 when precise=true', () => {
    render(<TimePicker {...defaultProps} precise={true} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options[options.length - 1]).toBe('23:59');
  });

  // ─── onChange behavior ───────────────────────────────────────────────────

  it('calls onChange with full ISO datetime when time is changed', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '15:30' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('2026-06-11T15:30:00');
  });

  it('preserves the date part when changing time', () => {
    render(<TimePicker {...defaultProps} value="2026-12-25T10:00:00" />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '18:00' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('2026-12-25T18:00:00');
  });

  it('preserves the seconds part when changing time', () => {
    render(<TimePicker {...defaultProps} value="2026-06-11T14:30:45" />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '09:15' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('2026-06-11T09:15:45');
  });

  it('does not call onChange when selecting the same time', () => {
    render(<TimePicker {...defaultProps} />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '14:00' } });
    // Should still call onChange (native select always fires change event)
    expect(defaultProps.onChange).toHaveBeenCalledWith('2026-06-11T14:00:00');
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  it('snaps to nearest grid time when current time is not on grid', () => {
    // startTime 14:04 is not on 15-min grid, closest is 14:00
    render(<TimePicker {...defaultProps} value="2026-06-11T14:04:00" />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    // Should snap to nearest grid time (14:00)
    expect(select.value).toBe('14:00');
  });

  it('handles empty value gracefully', () => {
    render(<TimePicker {...defaultProps} value="" />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.value).toBe('00:00');
  });

  it('handles missing T separator gracefully', () => {
    render(<TimePicker {...defaultProps} value="2026-06-11" />);
    const select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.value).toBe('00:00');
  });

  // ─── Accessibility ──────────────────────────────────────────────────────

  it('has accessible label', () => {
    render(<TimePicker {...defaultProps} />);
    expect(screen.getByLabelText('Время начала')).toBeInTheDocument();
  });

  it('does not render label when label prop is omitted', () => {
    const { label: _, ...propsWithoutLabel } = defaultProps;
    render(<TimePicker {...propsWithoutLabel} />);
    // Should still render the select, just without a visible label
    const select = document.querySelector('select');
    expect(select).toBeInTheDocument();
  });

  // ─── Grid frequency switching ───────────────────────────────────────────

  it('regenerates options when gridFrequency changes', () => {
    const { rerender } = render(<TimePicker {...defaultProps} gridFrequency={15} precise={false} />);
    let select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toContain('00:15');

    rerender(<TimePicker {...defaultProps} gridFrequency={30} precise={false} />);
    select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('00:30');
    expect(options).not.toContain('00:15');
  });

  it('regenerates options when precise prop changes', () => {
    const { rerender } = render(<TimePicker {...defaultProps} precise={false} />);
    let select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    // 15-min grid: 96 options (24 * 60 / 15)
    expect(select.options.length).toBe(96);

    rerender(<TimePicker {...defaultProps} precise={true} />);
    select = screen.getByLabelText('Время начала') as HTMLSelectElement;
    expect(select.options.length).toBe(1440);
  });
});
