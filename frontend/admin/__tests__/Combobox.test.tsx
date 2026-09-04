import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from '../app/components/shared/Combobox';

const MASTERS = [
  { value: 'm1', label: 'Иванова Анна', color: '#FF6B6B' },
  { value: 'm2', label: 'Петров Пётр', color: '#4ECDC4' },
  { value: 'm3', label: 'Сидорова Мария', searchText: 'Сидорова Мария Марья', color: '#45B7D1' },
];

function renderCombobox(props = {}) {
  return render(
    <Combobox value="m1" options={MASTERS} onChange={vi.fn()} clearLabel="Не выбран" {...props} />,
  );
}

describe('Combobox', () => {
  it('1. renders trigger with selected label; clearLabel when value=""; — when value not in options; ariaLabel names the trigger', () => {
    renderCombobox();
    expect(screen.getByTestId('combobox-trigger')).toHaveTextContent('Иванова Анна');
    renderCombobox({ value: '' });
    expect(screen.getAllByTestId('combobox-trigger')[1]).toHaveTextContent('Не выбран');
    renderCombobox({ value: 'ghost' });
    expect(screen.getAllByTestId('combobox-trigger')[2]).toHaveTextContent('—');
    renderCombobox({ value: '', ariaLabel: 'Мастер' });
    expect(screen.getByLabelText('Мастер')).toBe(screen.getAllByTestId('combobox-trigger')[3]);
  });

  it('2. renders color swatch with data-color on trigger and options', () => {
    renderCombobox();
    const swatch = screen.getByTestId('combobox-trigger').querySelector('[data-color="#FF6B6B"]');
    expect(swatch).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-option-m2').querySelector('[data-color="#4ECDC4"]')).toBeInTheDocument();
  });

  it('3. opens on click listing all options + pinned clear first; closes on outside mousedown and on select', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-search')).toBeInTheDocument();
    expect(screen.getByTestId('combobox-search')).toHaveFocus();
    const clear = screen.getByTestId('combobox-option-clear');
    expect(clear).toBeInTheDocument();
    expect(clear.compareDocumentPosition(screen.getByTestId('combobox-option-m1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-m2'));
    expect(onChange).toHaveBeenCalledWith('m2');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByRole('listbox').className).toContain('max-h-60');
    expect(screen.getByRole('listbox').className).toContain('overflow-y-auto');
  });

  it('4. filters instantly case-insensitive substring; searchText wins; whitespace-only = no filter; query resets on close+reopen', () => {
    renderCombobox();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'ИВА' } });
    expect(screen.getByTestId('combobox-option-m1')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'марья' } });
    expect(screen.getByTestId('combobox-option-m3')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: '   ' } });
    expect(screen.getByTestId('combobox-option-m1')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    expect(screen.getByTestId('combobox-search')).toHaveValue('');
    expect(screen.getByTestId('combobox-option-m2')).toBeInTheDocument();
  });

  it('5. empty result shows combobox-empty and keeps the clear option', () => {
    renderCombobox();
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('combobox-empty')).toHaveTextContent('Ничего не найдено');
    expect(screen.getByTestId('combobox-option-clear')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-option-m1')).not.toBeInTheDocument();
  });

  it('6. selecting the clear option emits onChange("") and closes', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-clear'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
  });

  it('7. keyboard: arrows wrap incl. clear; Home/End; Enter selects; Tab commits; Esc closes, focuses trigger, value unchanged, no propagation', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    const trigger = screen.getByTestId('combobox-trigger');

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('m2');

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Home' });
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'ArrowUp' }); // m1 → clear (0)
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'ArrowUp' }); // clear → wraps to last (m3)
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'End' }); // End also = m3
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('m3');

    fireEvent.click(trigger);
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'пет' } });
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('m2');

    const escSpy = vi.fn();
    window.addEventListener('keydown', escSpy);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByTestId('combobox-search'), { key: 'Escape' });
    expect(escSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('m2');
    expect(screen.queryByTestId('combobox-dropdown')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('8. works as a plain dropdown without typing (click-only path)', () => {
    const onChange = vi.fn();
    renderCombobox({ value: '', onChange });
    fireEvent.click(screen.getByTestId('combobox-trigger'));
    fireEvent.click(screen.getByTestId('combobox-option-m3'));
    expect(onChange).toHaveBeenCalledWith('m3');
  });
});
