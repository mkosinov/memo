import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleProvider, useSchedule } from '../contexts/ScheduleContext';
import { NavigationProvider } from '../contexts/NavigationContext';

// ─── Mock api-client ─────────────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn().mockResolvedValue([]),
  getLocations: vi.fn().mockResolvedValue([]),
  getServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  patchActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

// ─── Consumer component ──────────────────────────────────────────────────────

function CellHeightConsumer() {
  const { cellHeight, setCellHeight } = useSchedule();
  return (
    <div>
      <span data-testid="cell-height">{cellHeight}</span>
      <button data-testid="set-height-80" onClick={() => setCellHeight(80)}>
        Set 80
      </button>
      <button data-testid="set-height-40" onClick={() => setCellHeight(40)}>
        Set 40
      </button>
      <button data-testid="set-height-120" onClick={() => setCellHeight(120)}>
        Set 120
      </button>
      <button data-testid="set-height-200" onClick={() => setCellHeight(200)}>
        Set 200 (over max)
      </button>
      <button data-testid="set-height-10" onClick={() => setCellHeight(10)}>
        Set 10 (under min)
      </button>
    </div>
  );
}

function renderWithContext() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ScheduleProvider>
          <CellHeightConsumer />
        </ScheduleProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

// ─── ScheduleContext cellHeight tests ────────────────────────────────────────

describe('ScheduleContext — cellHeight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults cellHeight to 60', () => {
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('60');
  });

  it('provides setCellHeight to change height', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-80').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('80');
  });

  it('clamps cellHeight to min of 40', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-10').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('40');
  });

  it('clamps cellHeight to max of 120', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-200').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('120');
  });

  it('accepts exact min (40)', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-40').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('40');
  });

  it('accepts exact max (120)', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-120').click();
    });
    expect(screen.getByTestId('cell-height').textContent).toBe('120');
  });

  it('persists cellHeight to localStorage', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-height-80').click();
    });
    expect(localStorage.getItem('memo-cell-height')).toBe('80');
  });

  it('restores cellHeight from localStorage on mount', () => {
    localStorage.setItem('memo-cell-height', '90');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('90');
  });

  it('ignores invalid localStorage values and uses default', () => {
    localStorage.setItem('memo-cell-height', 'invalid');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('60');
  });

  it('ignores out-of-range localStorage values and uses default', () => {
    localStorage.setItem('memo-cell-height', '200');
    renderWithContext();
    expect(screen.getByTestId('cell-height').textContent).toBe('60');
  });
});
