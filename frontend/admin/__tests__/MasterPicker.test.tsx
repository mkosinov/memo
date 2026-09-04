import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MasterPicker } from '../app/components/shared/MasterPicker';
import { mockMasters } from './helpers/mockData';

// Raw API shape (MasterResponse): { first_name, last_name }
const MASTERS = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A' },
  { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C' },
  { id: 'm3', first_name: 'Дарья', last_name: 'Тюльпина', color: '#7A6E9C' },
];

describe('MasterPicker (raw masters)', () => {
  it('shows "Не выбран" when no value is selected', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    expect(screen.getByText('Не выбран')).toBeInTheDocument();
  });

  it('shows master name as «Фамилия Имя» when a value is selected', () => {
    render(<MasterPicker masters={MASTERS} value="m1" onChange={vi.fn()} />);
    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
  });

  it('opens dropdown on click and shows all masters', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    // The dropdown should contain all master options plus "Не выбран"
    expect(screen.getByTestId('combobox-dropdown')).toBeInTheDocument();
    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('Тюльпина Дарья')).toBeInTheDocument();
    // "Не выбран" is in the trigger (as selected) AND in the dropdown (clear option)
    const dropdown = screen.getByTestId('combobox-dropdown');
    expect(dropdown.textContent).toContain('Не выбран');
  });

  it('renders colored square for each option in the dropdown', () => {
    render(<MasterPicker masters={MASTERS} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));

    // Each option row should have a colored square span with data-color attribute
    const olgaOption = screen.getByTestId('combobox-option-m1');
    const square = olgaOption.querySelector('span[data-color]');
    expect(square).toBeTruthy();
    expect(square?.getAttribute('data-color')).toBe('#5B8C7A');
  });

  it('renders colored square in the trigger when a master is selected', () => {
    render(<MasterPicker masters={MASTERS} value="m2" onChange={vi.fn()} />);
    const trigger = screen.getByTestId('combobox-trigger');
    const square = trigger.querySelector('span[data-color]');
    expect(square).toBeTruthy();
    expect(square?.getAttribute('data-color')).toBe('#6B7E9C');
  });

  it('calls onChange with master id when an option is selected', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={MASTERS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-m3'));
    expect(onChange).toHaveBeenCalledWith('m3');
  });

  it('calls onChange with empty string when "Не выбран" is selected', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={MASTERS} value="m1" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('handles empty masters array gracefully', () => {
    render(<MasterPicker masters={[]} value="" onChange={vi.fn()} />);
    expect(screen.getByText('Не выбран')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    // Only the "Не выбран" option should be in the dropdown
    expect(screen.getByTestId('combobox-option-clear')).toBeInTheDocument();
  });

  it('applies className to the root element', () => {
    const { container } = render(
      <MasterPicker masters={MASTERS} value="" onChange={vi.fn()} className="w-48" />,
    );
    expect(container.querySelector('.w-48')).toBeInTheDocument();
  });

  it('filters options by a last-name fragment and selects the match', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={MASTERS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'Сере' } });
    expect(screen.getByTestId('combobox-option-m1')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-option-m1'));
    expect(onChange).toHaveBeenCalledWith('m1');
  });
});

describe('MasterPicker (domain masters)', () => {
  it('renders the domain master name as the label', () => {
    render(<MasterPicker masters={mockMasters} value="m1" onChange={vi.fn()} />);
    expect(screen.getByTestId('combobox-trigger')).toHaveTextContent(mockMasters[0].name);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-option-m2')).toHaveTextContent(mockMasters[1].name);
  });

  it('finds a domain master by shortName via search', () => {
    const onChange = vi.fn();
    render(<MasterPicker masters={mockMasters} value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: mockMasters[1].shortName } });
    expect(screen.getByTestId('combobox-option-m2')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-option-m2'));
    expect(onChange).toHaveBeenCalledWith('m2');
  });
});
