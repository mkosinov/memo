import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  GridSettingsProvider,
  useGridSettings,
} from '../../contexts/schedule/GridSettingsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GridSettingsProvider>{children}</GridSettingsProvider>
);

describe('GridSettingsContext', () => {
  beforeEach(() => localStorage.clear());

  it('throws when used outside GridSettingsProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useGridSettings())).toThrow(
      'useGridSettings must be used within GridSettingsProvider',
    );
    spy.mockRestore();
  });

  it('falls back to the default when the stored cell height is invalid', () => {
    localStorage.setItem('memo-cell-height', '9999');
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    expect(result.current.cellHeight).toBe(50);
  });

  it('reads a valid stored cell height', () => {
    // NOTE: 70 is NOT a valid option (CELL_HEIGHT_OPTIONS = 40/50/60) — 60 used instead.
    localStorage.setItem('memo-cell-height', '60');
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    expect(result.current.cellHeight).toBe(60);
  });

  it('falls back to the default when the stored grid frequency is invalid', () => {
    localStorage.setItem('memo-grid-frequency', 'nope');
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    expect(result.current.gridFrequency).toBe(30);
  });

  it('reads valid stored working hours', () => {
    localStorage.setItem('memo-working-hours-start', '7');
    localStorage.setItem('memo-working-hours-end', '23');
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    expect(result.current.workingHoursStart).toBe(7);
    expect(result.current.workingHoursEnd).toBe(23);
  });

  it('setCellHeight rounds and rejects values outside the option set', () => {
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    act(() => result.current.setCellHeight(37.6));
    // 37.6 → 38, which is not in {40,50,60} → default (old ScheduleContext behaviour)
    expect(result.current.cellHeight).toBe(50);
    expect(localStorage.getItem('memo-cell-height')).toBe('50');
  });

  it('setCellHeight rounds to the nearest valid option', () => {
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    act(() => result.current.setCellHeight(59.6));
    expect(result.current.cellHeight).toBe(60);
    expect(localStorage.getItem('memo-cell-height')).toBe('60');
  });

  it('setGridFrequency rejects values outside the option set', () => {
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    act(() => result.current.setGridFrequency(7));
    expect(result.current.gridFrequency).toBe(30);
    expect(localStorage.getItem('memo-grid-frequency')).toBe('30');
  });

  it('setWorkingHoursStart clamps to 0..23', () => {
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    act(() => result.current.setWorkingHoursStart(30));
    expect(result.current.workingHoursStart).toBe(23);
    expect(localStorage.getItem('memo-working-hours-start')).toBe('23');
  });

  it('setWorkingHoursEnd clamps to 0..23', () => {
    const { result } = renderHook(() => useGridSettings(), { wrapper });
    act(() => result.current.setWorkingHoursEnd(-5));
    expect(result.current.workingHoursEnd).toBe(0);
    expect(localStorage.getItem('memo-working-hours-end')).toBe('0');
  });
});
