import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useState, useCallback } from 'react';

function TestWithCallback() {
  const [val, setVal] = useState('');
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setVal(e.target.value);
  }, []);
  return (
    <div>
      <span data-testid="val">{val || 'empty'}</span>
      <label htmlFor="s">Select</label>
      <select id="s" value={val} onChange={handleChange}>
        <option value="">None</option>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    </div>
  );
}

describe('TestWithCallback', () => {
  it('fireEvent.change works with useCallback handler', async () => {
    render(<TestWithCallback />);
    const select = screen.getByLabelText(/Select/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'a' } });
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('a'));
  });
});

// Test with value initially set
function TestInitialVal() {
  const [val, setVal] = useState('init');
  return (
    <div>
      <span data-testid="val">{val}</span>
      <label htmlFor="s2">Select2</label>
      <select id="s2" value={val} onChange={(e) => setVal(e.target.value)}>
        <option value="init">Initial</option>
        <option value="changed">Changed</option>
      </select>
    </div>
  );
}

describe('TestInitialVal', () => {
  it('fireEvent.change from initial to changed', async () => {
    render(<TestInitialVal />);
    const select = screen.getByLabelText(/Select2/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'changed' } });
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('changed'));
  });
});
