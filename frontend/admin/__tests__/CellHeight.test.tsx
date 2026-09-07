import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { GridSettingsProvider, useGridSettings } from '../contexts/schedule/GridSettingsContext';

// GH #141: cellHeight moved out of ScheduleContext into GridSettingsContext
// (Task 3) — this suite follows it to the real provider/hook pair.

// ─── Consumer component ──────────────────────────────────────────────────────

function CellHeightConsumer() {
  const { cellHeight, setCellHeight } = useGridSettings();
  return (
    <div>
      <span data-testid="cell-height">{cellHeight}</span>
      <button data-testid="set-height-60" onClick={() => setCellHeight(60)}>
        Set 60
      </button>
      <button data-testid="set-height-40" onClick={() => setCellHeight(40)}>
        Set 40
      </button>
      <button data-testid="set-height-50" onClick={() => setCellHeight(50)}>
        Set 50
      </button>
      <button data-testid="set-height-200" onClick={() => setCellHeight(200)}>
        Set 200 (invalid preset)
      </button>
      <button data-testid="set-height-10" onClick={() => setCellHeight(10)}>
        Set 10 (invalid preset)
      </button>
    </div>
  );
}

function renderWithContext() {
  return render(
    <GridSettingsProvider>
      <CellHeightConsumer />
    </GridSettingsProvider>,
  );
}

// ─── GridSettingsContext cellHeight tests ────────────────────────────────────

describe('GridSettingsContext — cellHeight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults cellHeight to 50', () => {
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('50');
  });

  it('provides setCellHeight to change height to valid preset', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-60').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('60');
  });

  it('clamps invalid cellHeight to default (50)', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-10').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('50');
  });

  it('clamps invalid cellHeight to default (50) for out-of-preset values', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-200').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('50');
  });

  it('accepts exact min (40)', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-40').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('40');
  });

  it('accepts exact max preset (60)', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-60').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('60');
  });

  it('persists cellHeight to localStorage', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-60').click();
    });
    expect(localStorage.getItem('memo-cell-height')).toBe('60');
  });

  it('restores valid cellHeight from localStorage on mount', () => {
    localStorage.setItem('memo-cell-height', '40');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('40');
  });

  it('ignores invalid preset localStorage values and uses default', () => {
    localStorage.setItem('memo-cell-height', '90');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('50');
  });

  it('ignores invalid localStorage values and uses default', () => {
    localStorage.setItem('memo-cell-height', 'invalid');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('50');
  });
});
