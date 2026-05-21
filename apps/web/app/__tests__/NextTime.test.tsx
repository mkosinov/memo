import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextTime } from "../components/NextTime";

const mockOptions = [
  { date: "25 мая", time: "18:00", location: "Альпика" },
  { date: "27 мая", time: "14:00", location: "Гранд Отель Поляна" },
  { date: "30 мая", time: "10:00", location: "Поляна 1389" },
];

describe("NextTime", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <NextTime isOpen={false} onClose={vi.fn()} options={mockOptions} />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders title when isOpen is true", () => {
    render(
      <NextTime isOpen onClose={vi.fn()} options={mockOptions} />
    );
    expect(screen.getByText("В следующий раз")).toBeInTheDocument();
  });

  it("renders all option dates, times, and locations", () => {
    render(
      <NextTime isOpen onClose={vi.fn()} options={mockOptions} />
    );
    expect(screen.getByText("25 мая")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("Альпика")).toBeInTheDocument();
    expect(screen.getByText("27 мая")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByText("Гранд Отель Поляна")).toBeInTheDocument();
  });

  it("renders 'Записаться' button for each option", () => {
    render(
      <NextTime isOpen onClose={vi.fn()} options={mockOptions} />
    );
    const buttons = screen.getAllByRole("button", { name: /записаться/i });
    expect(buttons.length).toBe(3);
  });

  it("calls onBook when 'Записаться' button is clicked", () => {
    const handleBook = vi.fn();
    const optionsWithBook = [{ ...mockOptions[0], onBook: handleBook }];
    render(
      <NextTime isOpen onClose={vi.fn()} options={optionsWithBook} />
    );
    const bookButton = screen.getByRole("button", { name: /записаться/i });
    fireEvent.click(bookButton);
    expect(handleBook).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <NextTime isOpen onClose={handleClose} options={mockOptions} />
    );
    const closeButtons = screen.getAllByRole("button");
    // Close button is the first button (×)
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders options as cards with border and rounded styling", () => {
    render(
      <NextTime isOpen onClose={vi.fn()} options={mockOptions} />
    );
    const cards = screen.getAllByTestId(/next-time-option/);
    expect(cards.length).toBe(3);
  });
});
