import { useState, useMemo, useCallback } from "react";
import type { CalendarDay } from "@/app/lib/model/view/calendar";

const RUSSIAN_DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

export type CalendarTab = "today" | "tomorrow";

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
  const daysCount = options?.daysCount ?? 14;
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (options?.selectedDate) return options.selectedDate;
    return new Date();
  });

  const days = useMemo<CalendarDay[]>(() => {
    const today = new Date();
    const result: CalendarDay[] = [];

    for (let i = 0; i < daysCount; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      result.push({
        date,
        dayName: RUSSIAN_DAY_NAMES[date.getDay()],
        dayNumber: date.getDate(),
        isToday: i === 0,
        isSelected: isSameDay(date, selectedDate),
      });
    }

    return result;
  }, [daysCount, selectedDate]);

  const selectDate = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  return { days, selectedDate, selectDate };
}
