import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarLine } from "../CalendarLine";
import type { CalendarDay } from "../../lib/model/view/calendar";

function makeDays(count: number = 14): CalendarDay[] {
  const base = new Date(2026, 4, 21); // May 21
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    return {
      date,
      dayName: ["Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср"][i],
      dayNumber: base.getDate() + i,
      isToday: false,
      isSelected: i === 0,
    };
  });
}

describe("CalendarLine", () => {
  it("renders 'Сегодня' and 'Завтра' buttons", () => {
    render(
      <CalendarLine
        selectedDate={new Date(2026, 4, 21)}
        days={makeDays()}
        onSelectDay={vi.fn()}
      />
    );

    expect(screen.getByText("Сегодня")).toBeInTheDocument();
    expect(screen.getByText("Завтра")).toBeInTheDocument();
  });

  it("renders all day items", () => {
    render(
      <CalendarLine
        selectedDate={new Date(2026, 4, 21)}
        days={makeDays(14)}
        onSelectDay={vi.fn()}
      />
    );

    const dayButtons = screen.getAllByRole("button");
    // 2 (Сегодня/Завтра) + 14 days = 16 buttons
    expect(dayButtons.length).toBeGreaterThanOrEqual(16);
  });

  it("calls onSelectDay when a day is clicked", () => {
    const handleSelect = vi.fn();
    const days = makeDays();
    render(
      <CalendarLine
        selectedDate={days[0].date}
        days={days}
        onSelectDay={handleSelect}
      />
    );

    const dayButtons = screen.getAllByRole("button");
    // Skip "Сегодня" (0) and "Завтра" (1), day buttons start at index 2
    fireEvent.click(dayButtons[2 + 1]);

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(days[1].date);
  });

  it("highlights 'Сегодня' when selectedDate is today", () => {
    const today = new Date();
    const days = makeDays();
    render(
      <CalendarLine
        selectedDate={today}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    const segodnyaBtn = screen.getByText("Сегодня");
    // Highlighted via border color, not background
    expect(segodnyaBtn).toHaveClass("border-[#C8503C]");
  });

  it("highlights 'Завтра' when selectedDate is tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const days = makeDays();
    render(
      <CalendarLine
        selectedDate={tomorrow}
        days={days}
        onSelectDay={vi.fn()}
      />
    );

    const zavtraBtn = screen.getByText("Завтра");
    // Highlighted via border color, not background
    expect(zavtraBtn).toHaveClass("border-[#C8503C]");
  });

  it("has a white background container", () => {
    const { container } = render(
      <CalendarLine
        selectedDate={new Date(2026, 4, 21)}
        days={makeDays()}
        onSelectDay={vi.fn()}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("bg-white");
  });

  it("has a bottom border", () => {
    const { container } = render(
      <CalendarLine
        selectedDate={new Date(2026, 4, 21)}
        days={makeDays()}
        onSelectDay={vi.fn()}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("border-b");
  });
});
