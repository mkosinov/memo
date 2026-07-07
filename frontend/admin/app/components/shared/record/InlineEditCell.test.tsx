import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditCell } from './InlineEditCell';

describe('InlineEditCell', () => {
  it('renders the value', () => {
    render(<InlineEditCell value="Анна" onCommit={vi.fn()} data-testid="inline-edit" />);
    expect(screen.getByTestId('inline-edit')).toHaveValue('Анна');
  });

  it('shows placeholder when value is empty', () => {
    render(
      <InlineEditCell
        value=""
        onCommit={vi.fn()}
        placeholder="Аноним"
        data-testid="inline-edit"
      />,
    );
    expect(screen.getByPlaceholderText('Аноним')).toBeInTheDocument();
  });

  it('commits new value on Enter', () => {
    const onCommit = vi.fn();
    render(<InlineEditCell value="Анна" onCommit={onCommit} data-testid="inline-edit" />);
    const input = screen.getByTestId('inline-edit');

    input.focus();
    fireEvent.change(input, { target: { value: 'Мария' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Мария');
  });

  it('reverts to original value on Escape without committing', () => {
    const onCommit = vi.fn();
    render(<InlineEditCell value="Анна" onCommit={onCommit} data-testid="inline-edit" />);
    const input = screen.getByTestId('inline-edit');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Мария' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('Анна');
  });
});
