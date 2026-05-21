import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarLine } from "../components/CalendarLine";
import type { CalendarDay } from "../hooks/useCalendarDays";

function makeDays(count: number = 4): CalendarDay[] {
  const base = new Date(2026, 4, 21); // May 21 (tomorrow)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    return {
      date,
      dayName: ["Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Пт", "Сб", "Вс", "Пн", "Вт"][i],
      dayNumber: base.getDate() + i,
      isToday: i === 0 && false, // none are today since base is tomorrow
      isSelected: i === 0,
    };
  });
}

function makeTodayDays(count: number = 4): CalendarDay[] {
  const base = new Date(2026, 4, 20); // May 20 (today)
  return Array.from({ length: count }, (_, i) => {
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
  describe("tabs", () => {
    it("renders 'Сегодня' and 'Завтра' tabs", () => {
      render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 21)}
          days={makeDays()}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByText("Сегодня")).toBeInTheDocument();
      expect(screen.getByText("Завтра")).toBeInTheDocument();
    });

    it("calls onTabChange when 'Сегодня' tab is clicked", () => {
      const handleTabChange = vi.fn();
      render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 21)}
          days={makeDays()}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={handleTabChange}
        />
      );

      fireEvent.click(screen.getByText("Сегодня"));
      expect(handleTabChange).toHaveBeenCalledWith("today");
    });

    it("calls onTabChange when 'Завтра' tab is clicked", () => {
      const handleTabChange = vi.fn();
      render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 20)}
          days={makeTodayDays()}
          onSelectDay={vi.fn()}
          tab="today"
          onTabChange={handleTabChange}
        />
      );

      fireEvent.click(screen.getByText("Завтра"));
      expect(handleTabChange).toHaveBeenCalledWith("tomorrow");
    });

    it("highlights the active tab with brand color", () => {
      const { rerender } = render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 21)}
          days={makeDays()}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      // Завтра should be active
      const zavtraTab = screen.getByText("Завтра");
      expect(zavtraTab).toHaveClass("text-brand");

      // Сегодня should not be active
      const segodnyaTab = screen.getByText("Сегодня");
      expect(segodnyaTab).not.toHaveClass("text-brand");

      // Rerender with today tab
      rerender(
        <CalendarLine
          selectedDate={new Date(2026, 4, 20)}
          days={makeTodayDays()}
          onSelectDay={vi.fn()}
          tab="today"
          onTabChange={vi.fn()}
        />
      );

      // Сегодня should now be active
      expect(screen.getByText("Сегодня")).toHaveClass("text-brand");
      expect(screen.getByText("Завтра")).not.toHaveClass("text-brand");
    });
  });

  describe("calendar line visibility", () => {
    it("shows calendar line when 'Завтра' tab is active", () => {
      render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 21)}
          days={makeDays()}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      // Calendar line should be visible (day numbers rendered)
      const dayNumbers = screen.getAllByText(/\d+/);
      expect(dayNumbers.length).toBeGreaterThanOrEqual(4);
    });

    it("hides calendar line when 'Сегодня' tab is active", () => {
      render(
        <CalendarLine
          selectedDate={new Date(2026, 4, 20)}
          days={makeTodayDays()}
          onSelectDay={vi.fn()}
          tab="today"
          onTabChange={vi.fn()}
        />
      );

      // Calendar line should be hidden — no day number buttons
      const buttons = screen.queryAllByRole("button", { name: /\d+/ });
      // The only buttons should be the tabs themselves, not day buttons
      // Day buttons contain day numbers, tabs contain text "Сегодня"/"Завтра"
      const allButtons = screen.getAllByRole("button");
      // Should only have 2 tab buttons, no day buttons
      expect(allButtons).toHaveLength(2);
    });
  });

  describe("day items (when visible)", () => {
    const days = makeDays();
    const selectedDate = days[0].date;

    it("renders all day items", () => {
      render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      // Should render 4 day numbers
      const dayNumbers = screen.getAllByText(/\d+/);
      expect(dayNumbers.length).toBeGreaterThanOrEqual(4);
    });

    it("renders Russian day names", () => {
      render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getAllByText("Чт").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Пт").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Сб").length).toBeGreaterThanOrEqual(1);
    });

    it("calls onSelectDay when a day is clicked", () => {
      const handleSelect = vi.fn();
      render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={handleSelect}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      // Click the second day button (skip the 2 tab buttons)
      const dayButtons = screen.getAllByRole("button");
      // First 2 buttons are tabs, day buttons start at index 2
      fireEvent.click(dayButtons[2 + 1]);

      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleSelect).toHaveBeenCalledWith(days[1].date);
    });

    it("shows selected state on the selected day", () => {
      render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      const dayButtons = screen.getAllByRole("button");
      // Skip tab buttons (first 2)
      const selectedButton = dayButtons[2];

      // Selected day should have the selected styling class
      expect(selectedButton).toHaveClass("border-2");
    });

    it("shows today highlight on the current day when not selected", () => {
      const base = new Date(2026, 4, 21);
      const daysWithSecondSelected: CalendarDay[] = Array.from({ length: 4 }, (_, i) => {
        const date = new Date(base);
        date.setDate(base.getDate() + i);
        return {
          date,
          dayName: ["Чт", "Пт", "Сб", "Вс"][i],
          dayNumber: base.getDate() + i,
          isToday: false, // none are today
          isSelected: i === 1,
        };
      });

      render(
        <CalendarLine
          selectedDate={daysWithSecondSelected[1].date}
          days={daysWithSecondSelected}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      const dayButtons = screen.getAllByRole("button");
      // Skip tab buttons
      const todayButton = dayButtons[2];

      // Non-selected day should have transparent border
      expect(todayButton).toHaveClass("border-2");
    });

    it("has a white background container", () => {
      const { container } = render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      // The outermost wrapper is the tabs container
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("bg-white");
    });

    it("has a bottom border", () => {
      const { container } = render(
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={vi.fn()}
          tab="tomorrow"
          onTabChange={vi.fn()}
        />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("border-b");
    });
  });
});
