import { useState, useMemo, useCallback } from "react";

const RUSSIAN_DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

export type CalendarTab = "today" | "tomorrow";

export interface CalendarDay {
  date: Date;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
  isSelected: boolean;
}

export interface UseCalendarDaysOptions {
  selectedDate?: Date;
  daysCount?: number;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function useCalendarDays(options?: UseCalendarDaysOptions) {
  const daysCount = options?.daysCount ?? 4;
  const [tab, setTab] = useState<CalendarTab>("tomorrow");
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (options?.selectedDate) return options.selectedDate;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow;
  });

  const days = useMemo<CalendarDay[]>(() => {
    const today = new Date();
    const startDate = new Date(today);

    // When tab is 'tomorrow', start from tomorrow
    if (tab === "tomorrow") {
      startDate.setDate(today.getDate() + 1);
    }

    const result: CalendarDay[] = [];

    for (let i = 0; i < daysCount; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);

      result.push({
        date,
        dayName: RUSSIAN_DAY_NAMES[date.getDay()],
        dayNumber: date.getDate(),
        isToday: isSameDay(date, today),
        isSelected: isSameDay(date, selectedDate),
      });
    }

    return result;
  }, [daysCount, selectedDate, tab]);

  const selectDate = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  const handleSetTab = useCallback((newTab: CalendarTab) => {
    setTab(newTab);
    // Update selectedDate to match the tab
    const today = new Date();
    if (newTab === "today") {
      setSelectedDate(today);
    } else {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      setSelectedDate(tomorrow);
    }
  }, []);

  return { days, selectedDate, selectDate, tab, setTab: handleSetTab };
}
