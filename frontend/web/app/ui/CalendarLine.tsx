"use client";

import useEmblaCarousel from "embla-carousel-react";
import type { CalendarDay } from "@/app/lib/model/view/calendar";

export interface CalendarLineProps {
  selectedDate: Date;
  days: CalendarDay[];
  onSelectDay: (date: Date) => void;
  disabled?: boolean;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function CalendarLine({
  selectedDate,
  days,
  onSelectDay,
  disabled = false,
}: CalendarLineProps) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const [emblaRef] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: true,
  });

  const todaySelected = isSameDay(selectedDate, today);
  const tomorrowSelected = isSameDay(selectedDate, tomorrow);

  return (
      <div
        className="z-30 w-full bg-white border-b flex-shrink-0"
        style={{ borderColor: "var(--line)" }}
      >
      <div className="overflow-hidden pl-6 pr-4 py-1" ref={emblaRef}>
        <div className="flex gap-3 items-end">
          {/* Сегодня */}
          <button
            type="button"
            onClick={() => onSelectDay(today)}
            disabled={disabled}
            className={[
              "pb-1 text-sm font-medium transition-colors border-b-2",
              todaySelected
                ? "border-[#C8503C] text-ink"
                : "border-transparent text-ink-light",
              disabled ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
          >
            Сегодня
          </button>

          {/* Завтра */}
          <button
            type="button"
            onClick={() => onSelectDay(tomorrow)}
            disabled={disabled}
            className={[
              "pb-1 text-sm font-medium transition-colors border-b-2",
              tomorrowSelected
                ? "border-[#C8503C] text-ink"
                : "border-transparent text-ink-light",
              disabled ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
          >
            Завтра
          </button>

          {/* Numbered days — wall calendar style */}
          {days.map((day) => (
            <button
              key={day.date.toDateString()}
              type="button"
              onClick={() => onSelectDay(day.date)}
              disabled={disabled}
              className={[
                "flex flex-col items-center justify-center rounded-lg transition-colors min-w-[40px] py-1",
                day.isSelected
                  ? "border-2 border-[#C8503C] bg-white"
                  : "border-2 border-transparent",
                disabled ? "opacity-40 cursor-not-allowed" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "text-[9px] uppercase leading-none mb-0.5",
                  day.isSelected ? "text-[#C8503C]" : "text-ink-light",
                ].join(" ")}
              >
                {day.dayName}
              </span>
              <span
                className={[
                  "text-[16px] leading-none font-semibold",
                  day.isSelected ? "text-[#C8503C] font-bold" : "text-ink-mid",
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
