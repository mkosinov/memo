import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MKCarousel } from "../components/MKCarousel";
import type { MKCardProps } from "../components/MKCard";

const mockCards: MKCardProps[] = [
  {
    id: "1",
    imageUrl: "/test-1.jpg",
    category: "взрослым",
    title: "Card 1",
    time: "14:00",
    duration: "2 часа",
    guestsCount: 3,
    priceMin: 3500,
    priceMax: 5500,
  },
  {
    id: "2",
    imageUrl: "/test-2.jpg",
    category: "вместе",
    title: "Card 2",
    time: "16:00",
    duration: "1.5 часа",
    guestsCount: 5,
    priceMin: 2500,
    priceMax: 4000,
  },
  {
    id: "3",
    imageUrl: "/test-3.jpg",
    category: "детям",
    title: "Card 3",
    time: "10:00",
    duration: "1 час",
    guestsCount: 2,
    priceMin: 1500,
    priceMax: 2500,
  },
];

describe("MKCarousel", () => {
  it("renders cards from the data array", () => {
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={vi.fn()}
      />
    );

    expect(screen.getByText("Card 1")).toBeInTheDocument();
  });

  it("renders multiple visible cards in the stack", () => {
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={vi.fn()}
      />
    );

    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 2")).toBeInTheDocument();
    expect(screen.getByText("Card 3")).toBeInTheDocument();
  });

  it("calls onSelectCard when top card is tapped", () => {
    const handleSelect = vi.fn();
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={handleSelect}
      />
    );

    // Click on the top card title
    fireEvent.click(screen.getByText("Card 1"));
    expect(handleSelect).toHaveBeenCalledWith(mockCards[0]);
  });

  it("renders MKCard components directly (no renderCard prop)", () => {
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={vi.fn()}
      />
    );

    // MKCard renders the category pill
    expect(screen.getByText("взрослым")).toBeInTheDocument();
    expect(screen.getByText("вместе")).toBeInTheDocument();
    expect(screen.getByText("детям")).toBeInTheDocument();
  });

  it("does not render navigation buttons", () => {
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={vi.fn()}
      />
    );

    expect(screen.queryByLabelText(/предыдущая/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/следующая/i)).not.toBeInTheDocument();
  });

  it("renders images for each card", () => {
    render(
      <MKCarousel
        cards={mockCards}
        onSelectCard={vi.fn()}
      />
    );

    const images = screen.getAllByRole("img");
    expect(images.length).toBeGreaterThanOrEqual(1);
  });
});
