import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCalendarDays } from "../hooks/useCalendarDays";

const RUSSIAN_DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

describe("useCalendarDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates 14 days by default starting from today", () => {
    const today = new Date(2026, 4, 20); // May 20, 2026
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays());

    expect(result.current.days).toHaveLength(14);
    expect(result.current.days[0].date.toDateString()).toBe(today.toDateString());
  });

  it("generates custom number of days when daysCount is provided", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays({ daysCount: 7 }));

    expect(result.current.days).toHaveLength(7);
  });

  it("marks today as isToday", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays());

    expect(result.current.days[0].isToday).toBe(true);
    expect(result.current.days[1].isToday).toBe(false);
  });

  it("marks the first day as selected by default", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays());

    expect(result.current.days[0].isSelected).toBe(true);
    expect(result.current.days[1].isSelected).toBe(false);
  });

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

  it("allows selecting a different date", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays());

    const tomorrow = result.current.days[1].date;

    act(() => {
      result.current.selectDate(tomorrow);
    });

    expect(result.current.days[0].isSelected).toBe(false);
    expect(result.current.days[1].isSelected).toBe(true);
    expect(result.current.selectedDate.toDateString()).toBe(tomorrow.toDateString());
  });

  it("returns the selected date", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);

    const { result } = renderHook(() => useCalendarDays());

    expect(result.current.selectedDate.toDateString()).toBe(today.toDateString());
  });

  it("respects a custom selectedDate", () => {
    const today = new Date(2026, 4, 20);
    vi.setSystemTime(today);
    const customDate = new Date(2026, 4, 22);

    const { result } = renderHook(() =>
      useCalendarDays({ selectedDate: customDate })
    );

    expect(result.current.selectedDate.toDateString()).toBe(customDate.toDateString());
    // The custom date should be marked as selected
    const selectedDay = result.current.days.find(
      (d) => d.date.toDateString() === customDate.toDateString()
    );
    expect(selectedDay?.isSelected).toBe(true);
  });
});
