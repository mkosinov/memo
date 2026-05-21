"use client";

import useEmblaCarousel from "embla-carousel-react";
import type { CalendarDay } from "../hooks/useCalendarDays";

export interface CalendarLineProps {
  selectedDate: Date;
  days: CalendarDay[];
  onSelectDay: (date: Date) => void;
}

export function CalendarLine({
  selectedDate: _selectedDate,
  days,
  onSelectDay,
}: CalendarLineProps) {
  const [emblaRef] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: true,
  });

  return (
    <div
      className="sticky top-0 z-30 w-full bg-white border-b py-3 px-4"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-2">
          {days.map((day) => (
            <button
              key={day.date.toDateString()}
              type="button"
              onClick={() => onSelectDay(day.date)}
              className={[
                "flex flex-col items-center justify-center rounded-lg transition-colors min-w-[48px] py-2",
                day.isSelected
                  ? "border-2 border-[#C8503C] bg-white"
                  : day.isToday
                    ? "bg-brand/10 border-2 border-transparent"
                    : "border-2 border-transparent hover:bg-surface",
              ].join(" ")}
            >
              <span
                className={[
                  "text-xs uppercase leading-none mb-1",
                  day.isSelected
                    ? "text-[#C8503C] font-medium"
                    : "text-ink-light",
                ].join(" ")}
              >
                {day.dayName}
              </span>
              <span
                className={[
                  "text-[22px] leading-none",
                  day.isSelected
                    ? "text-[#C8503C] font-bold"
                    : day.isToday
                      ? "text-ink font-semibold"
                      : "text-ink-mid font-light",
                ].join(" ")}
              >
                {day.dayNumber}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CalendarLine;
