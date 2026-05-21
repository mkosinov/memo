import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarLine } from "../components/CalendarLine";
import type { CalendarDay } from "../hooks/useCalendarDays";

function makeDays(): CalendarDay[] {
  const base = new Date(2026, 4, 20);
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    return {
      date,
      dayName: ["Ср", "Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Пн", "Вт"][i],
      dayNumber: base.getDate() + i,
      isToday: i === 0,
      isSelected: i === 0,
    };
  });
}

describe("CalendarLine", () => {
  const days = makeDays();
  const selectedDate = days[0].date;

  it("renders all day items", () => {
    render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    // Should render 14 day numbers
    const dayNumbers = screen.getAllByText(/\d+/);
    expect(dayNumbers.length).toBeGreaterThanOrEqual(14);
  });

  it("renders Russian day names", () => {
    render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    // Use getAllByText since day names repeat in a 14-day range
    expect(screen.getAllByText("Ср").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Чт").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Пт").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSelectDay when a day is clicked", () => {
    const handleSelect = vi.fn();
    render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={handleSelect}
      />
    );

    // Click the second day (May 21)
    const dayButtons = screen.getAllByRole("button");
    fireEvent.click(dayButtons[1]);

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(days[1].date);
  });

  it("shows selected state on the selected day", () => {
    render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    const dayButtons = screen.getAllByRole("button");
    const selectedButton = dayButtons[0];

    // Selected day should have the selected styling class
    expect(selectedButton).toHaveClass("border-2");
  });

  it("shows today highlight on the current day when not selected", () => {
    // Create days where the second day is selected (not today)
    const base = new Date(2026, 4, 20);
    const daysWithSecondSelected: CalendarDay[] = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      return {
        date,
        dayName: ["Ср", "Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Пн", "Вт"][i],
        dayNumber: base.getDate() + i,
        isToday: i === 0,
        isSelected: i === 1, // Second day selected
      };
    });

    render(
      <CalendarLine
        selectedDate={daysWithSecondSelected[1].date}
        days={daysWithSecondSelected}
        onSelectDay={vi.fn()}
      />
    );

    const dayButtons = screen.getAllByRole("button");
    const todayButton = dayButtons[0];

    // Today (not selected) should have a background highlight
    expect(todayButton).toHaveClass("bg-brand/10");
  });

  it("has a white background container", () => {
    const { container } = render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("bg-white");
  });

  it("has a bottom border", () => {
    const { container } = render(
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("border-b");
  });
});
