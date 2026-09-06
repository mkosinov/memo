import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';
import { getMonday, toISODate } from '@/lib/datetime';

describe('NavigationContext', () => {
  describe('useNavigation', () => {
    it('throws when used outside NavigationProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useNavigation())).toThrow(
        'useNavigation must be used within NavigationProvider'
      );
      spy.mockRestore();
    });
  });

  describe('NavigationProvider', () => {
    it('initializes dateFrom to Monday of current week in ISO format', () => {
      const { result } = renderHook(() => useNavigation(), {
        wrapper: NavigationProvider,
      });
      const expectedMonday = toISODate(getMonday(new Date()));
      expect(result.current.dateFrom).toBe(expectedMonday);
    });

    it('initializes dateTo to Sunday (6 days after Monday) in ISO format', () => {
      const { result } = renderHook(() => useNavigation(), {
        wrapper: NavigationProvider,
      });
      const monday = getMonday(new Date());
      const expectedSunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      expect(result.current.dateTo).toBe(toISODate(expectedSunday));
    });

    it('selectDateRange updates dateFrom and dateTo', () => {
      const { result } = renderHook(() => useNavigation(), {
        wrapper: NavigationProvider,
      });

      act(() => {
        result.current.selectDateRange('2026-06-01', '2026-06-07');
      });

      expect(result.current.dateFrom).toBe('2026-06-01');
      expect(result.current.dateTo).toBe('2026-06-07');
    });

    it('selectDateRange updates to a different range', () => {
      const { result } = renderHook(() => useNavigation(), {
        wrapper: NavigationProvider,
      });

      act(() => {
        result.current.selectDateRange('2026-06-08', '2026-06-14');
      });

      expect(result.current.dateFrom).toBe('2026-06-08');
      expect(result.current.dateTo).toBe('2026-06-14');
    });
  });
});
