"use client";

import useEmblaCarousel from "embla-carousel-react";
import type { CalendarDay, CalendarTab } from "../hooks/useCalendarDays";

export interface CalendarLineProps {
  selectedDate: Date;
  days: CalendarDay[];
  onSelectDay: (date: Date) => void;
  tab: CalendarTab;
  onTabChange: (tab: CalendarTab) => void;
}

export function CalendarLine({
  selectedDate: _selectedDate,
  days,
  onSelectDay,
  tab,
  onTabChange,
}: CalendarLineProps) {
  const [emblaRef] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: true,
  });

  const showCalendarLine = tab === "tomorrow";

  return (
    <div
      className="sticky top-0 z-30 w-full bg-white border-b"
      style={{ borderColor: "var(--line)" }}
    >
      {/* Tabs: Сегодня / Завтра */}
      <div className="flex items-center px-4 pt-2">
        <button
          type="button"
          onClick={() => onTabChange("today")}
          className={[
            "pb-2 text-sm font-medium transition-colors border-b-2",
            tab === "today"
              ? "text-brand border-brand"
              : "text-ink-light border-transparent hover:text-ink",
          ].join(" ")}
        >
          Сегодня
        </button>
        <button
          type="button"
          onClick={() => onTabChange("tomorrow")}
          className={[
            "pb-2 text-sm font-medium transition-colors border-b-2 ml-4",
            tab === "tomorrow"
              ? "text-brand border-brand"
              : "text-ink-light border-transparent hover:text-ink",
          ].join(" ")}
        >
          Завтра
        </button>
      </div>

      {/* Calendar line — only visible when "Завтра" tab is active */}
      {showCalendarLine && (
        <div className="overflow-hidden px-4 pb-3" ref={emblaRef}>
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
      )}
    </div>
  );
}

export default CalendarLine;
