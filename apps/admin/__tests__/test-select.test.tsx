import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

function TestSelect() {
  const [value, setValue] = useState('');
  return (
    <div>
      <span data-testid="current">{value || 'empty'}</span>
      <label htmlFor="test-select">Тест</label>
      <select id="test-select" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Выберите</option>
        <option value="a1">Option A</option>
        <option value="b2">Option B</option>
      </select>
    </div>
  );
}

describe('TestSelect', () => {
  it('fireEvent.change updates state', () => {
    render(<TestSelect />);
    const select = screen.getByLabelText(/Тест/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'a1' } });
    expect(screen.getByTestId('current').textContent).toBe('a1');
  });
});
