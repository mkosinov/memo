import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PriceDetails } from "../components/PriceDetails";

const mockTariffs = [
  { name: "Взрослый", price: 2500 },
  { name: "Ребёнок", price: 1800, description: "до 12 лет" },
  { name: "Индивидуальное", price: 4000 },
];

describe("PriceDetails", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <PriceDetails isOpen={false} onClose={vi.fn()} tariffs={mockTariffs} />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders title when isOpen is true", () => {
    render(
      <PriceDetails isOpen onClose={vi.fn()} tariffs={mockTariffs} />
    );
    expect(screen.getByText("Стоимость")).toBeInTheDocument();
  });

  it("renders all tariff names", () => {
    render(
      <PriceDetails isOpen onClose={vi.fn()} tariffs={mockTariffs} />
    );
    expect(screen.getByText("Взрослый")).toBeInTheDocument();
    expect(screen.getByText("Ребёнок")).toBeInTheDocument();
    expect(screen.getByText("Индивидуальное")).toBeInTheDocument();
  });

  it("formats prices with Russian locale", () => {
    render(
      <PriceDetails isOpen onClose={vi.fn()} tariffs={mockTariffs} />
    );
    expect(screen.getByText("2 500 ₽")).toBeInTheDocument();
    expect(screen.getByText("1 800 ₽")).toBeInTheDocument();
    expect(screen.getByText("4 000 ₽")).toBeInTheDocument();
  });

  it("renders tariff descriptions when provided", () => {
    render(
      <PriceDetails isOpen onClose={vi.fn()} tariffs={mockTariffs} />
    );
    expect(screen.getByText("до 12 лет")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <PriceDetails isOpen onClose={handleClose} tariffs={mockTariffs} />
    );
    const closeButtons = screen.getAllByRole("button");
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
