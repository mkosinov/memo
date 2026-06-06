import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MasterPicker } from '../app/components/shared/MasterPicker';

const MASTERS = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A' },
  { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C' },
  { id: 'm3', first_name: 'Дарья', last_name: 'Тюльпина', color: '#7A6E9C' },
];

describe('MasterPicker', () => {
  it('shows "Не выбран" when no value is selected', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    expect(screen.getByText('Не выбран')).toBeInTheDocument();
  });

  it('shows master name when a value is selected', () => {
    render(<MasterPicker masters={MASTERS} value="m1" onChange={vi.fn()} />);
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
  });

  it('opens dropdown on click and shows all masters', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    // The dropdown should contain all master options plus "Не выбран"
    expect(screen.getByTestId('custom-select-dropdown')).toBeInTheDocument();
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
    expect(screen.getByText('Юлия Большакова')).toBeInTheDocument();
    expect(screen.getByText('Дарья Тюльпина')).toBeInTheDocument();
    // "Не выбран" is in the trigger (as selected) AND in the dropdown
    const dropdown = screen.getByTestId('custom-select-dropdown');
    expect(dropdown.textContent).toContain('Не выбран');
  });

  it('renders colored square for each option in the dropdown', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));

    // Each option row should have a colored square span with data-color attribute
    const olgaOption = screen.getByTestId('custom-select-option-m1');
    const square = olgaOption.querySelector('span[data-color]');
    expect(square).toBeTruthy();
    expect(square?.getAttribute('data-color')).toBe('#5B8C7A');
  });

  it('renders colored square in the trigger when a master is selected', () => {
    render(<MasterPicker masters={MASTERS} value="m2" onChange={vi.fn()} />);
    const trigger = screen.getByTestId('custom-select-trigger');
    const square = trigger.querySelector('span[data-color]');
    expect(square).toBeTruthy();
    expect(square?.getAttribute('data-color')).toBe('#6B7E9C');
  });

  it('calls onChange with master id when an option is selected', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={MASTERS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('custom-select-option-m3'));
    expect(onChange).toHaveBeenCalledWith('m3');
  });

  it('calls onChange with empty string when "Не выбран" is selected', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={MASTERS} value="m1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('custom-select-option-'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('handles empty masters array gracefully', () => {
    render(<MasterPicker masters={[]} value="" onChange={vi.fn()} />);
    expect(screen.getByText('Не выбран')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    // Only the "Не выбран" option should be in the dropdown
    expect(screen.getByTestId('custom-select-option-')).toBeInTheDocument();
  });

  it('applies className to the root element', () => {
    const { container } = render(
      <MasterPicker masters={MASTERS} value="" onChange={vi.fn()} className="w-48" />,
    );
    expect(container.querySelector('.w-48')).toBeInTheDocument();
  });
});
