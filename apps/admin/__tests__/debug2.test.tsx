import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

function SimpleStamp() {
  const [state, setState] = useState({ masterId: null as string | null, ready: false });
  return (
    <div>
      <span data-testid="val">{state.masterId || 'null'}</span>
      <span data-testid="ready">{state.ready.toString()}</span>
      <label htmlFor="s">Мастер</label>
      <select id="s" value={state.masterId || ''} onChange={(e) => {
        setState({ ...state, masterId: e.target.value || null });
      }}>
        <option value="">Выберите</option>
        <option value="m1">Ольга</option>
      </select>
      <button data-testid="btn" onClick={() => setState({ ...state, ready: true })}>Ready</button>
    </div>
  );
}

describe('SimpleStamp', () => {
  it('fireEvent.change works with non-functional updater', () => {
    render(<SimpleStamp />);
    const select = screen.getByLabelText(/Мастер/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm1' } });
    expect(screen.getByTestId('val').textContent).toBe('m1');
  });

  it('button click works', () => {
    render(<SimpleStamp />);
    fireEvent.click(screen.getByTestId('btn'));
    expect(screen.getByTestId('ready').textContent).toBe('true');
  });
});
