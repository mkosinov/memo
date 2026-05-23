import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCalendarDays } from "../hooks/useCalendarDays";

describe("useCalendarDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("14-day calendar starting from today", () => {
    it("returns 14 days starting from today", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays());

      expect(result.current.days).toHaveLength(14);
      expect(result.current.days[0].date.getDate()).toBe(20);
      expect(result.current.days[0].date.getMonth()).toBe(4);
      expect(result.current.days[13].date.getDate()).toBe(2);
    });

    it("marks first day as today and selected by default", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays());

      expect(result.current.days[0].isToday).toBe(true);
      expect(result.current.days[0].isSelected).toBe(true);
      expect(result.current.selectedDate.toDateString()).toBe(today.toDateString());
    });
  });

  describe("custom daysCount", () => {
    it("generates custom number of days", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays({ daysCount: 7 }));

      expect(result.current.days).toHaveLength(7);
    });
  });

  describe("day names and numbers", () => {
    it("provides correct Russian day names", () => {
      const today = new Date(2026, 4, 20); // Wednesday
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays({ daysCount: 7 }));

      expect(result.current.days[0].dayName).toBe("Ср");
      expect(result.current.days[1].dayName).toBe("Чт");
      expect(result.current.days[2].dayName).toBe("Пт");
      expect(result.current.days[3].dayName).toBe("Сб");
      expect(result.current.days[4].dayName).toBe("Вс");
      expect(result.current.days[5].dayName).toBe("Пн");
      expect(result.current.days[6].dayName).toBe("Вт");
    });

    it("provides correct day numbers", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays({ daysCount: 5 }));

      expect(result.current.days[0].dayNumber).toBe(20);
      expect(result.current.days[1].dayNumber).toBe(21);
      expect(result.current.days[2].dayNumber).toBe(22);
      expect(result.current.days[3].dayNumber).toBe(23);
      expect(result.current.days[4].dayNumber).toBe(24);
    });
  });

  describe("date selection", () => {
    it("allows selecting a different date", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);

      const { result } = renderHook(() => useCalendarDays());

      const secondDay = result.current.days[1].date;

      act(() => {
        result.current.selectDate(secondDay);
      });

      expect(result.current.days[0].isSelected).toBe(false);
      expect(result.current.days[1].isSelected).toBe(true);
      expect(result.current.selectedDate.toDateString()).toBe(secondDay.toDateString());
    });

    it("respects a custom selectedDate", () => {
      const today = new Date(2026, 4, 20);
      vi.setSystemTime(today);
      const customDate = new Date(2026, 4, 22);

      const { result } = renderHook(() =>
        useCalendarDays({ selectedDate: customDate })
      );

      expect(result.current.selectedDate.toDateString()).toBe(customDate.toDateString());
      const selectedDay = result.current.days.find(
        (d) => d.date.toDateString() === customDate.toDateString()
      );
      expect(selectedDay?.isSelected).toBe(true);
    });
  });
});
