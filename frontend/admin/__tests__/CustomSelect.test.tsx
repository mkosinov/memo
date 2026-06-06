import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CustomSelect } from '../app/components/shared/CustomSelect';

const TEST_OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

const OPTIONS_WITH_ICONS = [
  { value: 'waiting', label: 'Ожидает', color: '#F59E0B', icon: <span data-testid="icon-waiting">⏳</span> },
  { value: 'visited', label: 'Пришла', color: '#10B981', icon: <span data-testid="icon-visited">✓</span> },
  { value: 'missed', label: 'Пропущена', color: '#EF4444', icon: <span data-testid="icon-missed">⚠</span> },
];

describe('CustomSelect', () => {
  it('renders selected option label', () => {
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('opens dropdown on click', () => {
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByText('Option C')).toBeInTheDocument();
  });

  it('calls onChange when option selected', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('closes dropdown after selection', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Option B'));
    // After selection, Option C should no longer be visible (dropdown closed)
    expect(screen.queryByText('Option C')).not.toBeInTheDocument();
  });

  it('highlights selected option', () => {
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button'));
    const optionA = screen.getByTestId('custom-select-option-a');
    expect(optionA.className).toContain('bg-gray-100');
  });

  it('renders icon for selected option', () => {
    render(
      <CustomSelect value="waiting" options={OPTIONS_WITH_ICONS} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('icon-waiting')).toBeInTheDocument();
  });

  it('renders icons in dropdown options', () => {
    render(
      <CustomSelect value="waiting" options={OPTIONS_WITH_ICONS} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('icon-visited')).toBeInTheDocument();
    expect(screen.getByTestId('icon-missed')).toBeInTheDocument();
  });

  it('applies className to trigger button', () => {
    render(
      <CustomSelect
        value="a"
        options={TEST_OPTIONS}
        onChange={vi.fn()}
        className="custom-class"
      />,
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('custom-class');
  });

  it('closes dropdown on outside click', () => {
    render(
      <div data-testid="outside">
        <CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Option B')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Option B')).not.toBeInTheDocument();
  });

  it('toggles dropdown on repeated clicks', () => {
    render(
      <CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByText('Option B')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText('Option B')).not.toBeInTheDocument();
  });

  it('renders colored square in trigger when selected option has color', () => {
    const options = [
      { value: 'x', label: 'Item X', color: '#FF0000' },
    ];
    render(<CustomSelect value="x" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByTestId('custom-select-trigger');
    const colorSquare = trigger.querySelector('span[data-color]');
    expect(colorSquare).toBeTruthy();
    expect(colorSquare?.getAttribute('data-color')).toBe('#FF0000');
  });

  it('renders colored square in dropdown when option has color', () => {
    render(<CustomSelect value="waiting" options={OPTIONS_WITH_ICONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    const option = screen.getByTestId('custom-select-option-visited');
    const colorSquare = option.querySelector('span[data-color]');
    expect(colorSquare).toBeTruthy();
    expect(colorSquare?.getAttribute('data-color')).toBe('#10B981');
  });

  it('does not render colored square when option has no color', () => {
    render(<CustomSelect value="a" options={TEST_OPTIONS} onChange={vi.fn()} />);
    const trigger = screen.getByTestId('custom-select-trigger');
    const colorSquare = trigger.querySelector('span[data-color]');
    expect(colorSquare).toBeFalsy();
  });
});
