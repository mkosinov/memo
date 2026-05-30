import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MKCard } from "../MKCard";

const defaultProps = {
  id: "1",
  imageUrl: "/test-image.jpg",
  category: "взрослым" as const,
  title: "Акварельный пейзаж",
  time: "14:00",
  duration: "2 часа",
  guestsCount: 3,
  priceMin: 3500,
  priceMax: 5500,
};

describe("MKCard", () => {
  it("renders the card title", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.getByText("Акварельный пейзаж")).toBeInTheDocument();
  });

  it("renders the time and duration", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.getByText(/14:00/)).toBeInTheDocument();
    expect(screen.getByText(/2 часа/)).toBeInTheDocument();
  });

  it("renders the social proof text", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.getByText("Уже 3 гостя")).toBeInTheDocument();
  });

  it("renders 'гостей' when guestsCount > 4", () => {
    render(<MKCard {...defaultProps} guestsCount={5} />);
    expect(screen.getByText("Уже 5 гостей")).toBeInTheDocument();
  });

  it("renders the price range", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.getByText("3500 – 5500 ₽")).toBeInTheDocument();
  });

  it("renders the details button with 'Подробнее' text", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.getByRole("button", { name: /подробнее/i })).toBeInTheDocument();
  });

  it("calls onSignUp when details button is clicked", () => {
    const handleSignUp = vi.fn();
    render(<MKCard {...defaultProps} onSignUp={handleSignUp} />);
    fireEvent.click(screen.getByRole("button", { name: /подробнее/i }));
    expect(handleSignUp).toHaveBeenCalledTimes(1);
  });

  it("calls onTap when card is tapped", () => {
    const handleTap = vi.fn();
    render(<MKCard {...defaultProps} onTap={handleTap} />);
    fireEvent.click(screen.getByText("Акварельный пейзаж"));
    expect(handleTap).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    render(<MKCard {...defaultProps} className="custom-class" />);
    const card = screen.getByText("Акварельный пейзаж").closest("div");
    // Find the outermost card container
    const cardContainer = card?.closest('[class*="rounded-2xl"]');
    expect(cardContainer).toHaveClass("custom-class");
  });

  describe("category pill colors", () => {
    it("shows gold background for 'взрослым' category", () => {
      render(<MKCard {...defaultProps} category="взрослым" />);
      const pill = screen.getByText("взрослым");
      expect(pill).toHaveClass("bg-[#C49A2E]");
    });

    it("shows green background for 'вместе' category", () => {
      render(<MKCard {...defaultProps} category="вместе" />);
      const pill = screen.getByText("вместе");
      expect(pill).toHaveClass("bg-[#5B8C7A]");
    });

    it("shows pink background for 'детям' category", () => {
      render(<MKCard {...defaultProps} category="детям" />);
      const pill = screen.getByText("детям");
      expect(pill).toHaveClass("bg-[#D4789A]");
    });
  });

  it("renders with white background and rounded corners", () => {
    render(<MKCard {...defaultProps} />);
    const card = screen.getByText("Акварельный пейзаж").closest("div");
    const cardContainer = card?.closest('[class*="bg-white"]');
    expect(cardContainer).toHaveClass("bg-white");
    expect(cardContainer).toHaveClass("rounded-2xl");
  });

  it("renders the image", () => {
    render(<MKCard {...defaultProps} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
  });

  it("uses 2/1 aspect ratio for the image container to keep card compact", () => {
    render(<MKCard {...defaultProps} />);
    const img = screen.getByRole("img");
    const imageContainer = img.closest('[class*="aspect-"]');
    expect(imageContainer).toHaveClass("aspect-[2/1]");
  });

  it("does not render location", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.queryByRole("img", { name: /pin/i })).not.toBeInTheDocument();
  });

  it("does not render material info", () => {
    render(<MKCard {...defaultProps} />);
    expect(screen.queryByText(/Акрил/)).not.toBeInTheDocument();
  });

  describe("variant='custom' (last card)", () => {
    const customProps = {
      id: "custom",
      variant: "custom" as const,
      title: "Индивидуальный мастер-класс",
      description: "В удобное для вас время. Материал — на ваш выбор.",
      price: 8200,
      onSignUp: vi.fn(),
    };

    it("renders without image when variant is custom", () => {
      render(<MKCard {...customProps} />);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("renders outlined/dashed border style", () => {
      render(<MKCard {...customProps} />);
      const card = screen.getByText("Индивидуальный мастер-класс").closest('[data-card-id]');
      expect(card).toHaveClass("border-2");
      expect(card).toHaveClass("border-dashed");
    });

    it("renders the description text", () => {
      render(<MKCard {...customProps} />);
      expect(screen.getByText("В удобное для вас время. Материал — на ваш выбор.")).toBeInTheDocument();
    });

    it("renders the single price", () => {
      render(<MKCard {...customProps} />);
      expect(screen.getByText("8 200 ₽")).toBeInTheDocument();
    });

    it("renders a 'Записаться' button instead of 'Подробнее'", () => {
      render(<MKCard {...customProps} />);
      expect(screen.getByRole("button", { name: /записаться/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /подробнее/i })).not.toBeInTheDocument();
    });

    it("calls onSignUp when 'Записаться' button is clicked", () => {
      const handleSignUp = vi.fn();
      render(<MKCard {...customProps} onSignUp={handleSignUp} />);
      fireEvent.click(screen.getByRole("button", { name: /записаться/i }));
      expect(handleSignUp).toHaveBeenCalledTimes(1);
    });

    it("does not render category pill, time, duration, or guests", () => {
      render(<MKCard {...customProps} />);
      expect(screen.queryByText("взрослым")).not.toBeInTheDocument();
      expect(screen.queryByText("вместе")).not.toBeInTheDocument();
      expect(screen.queryByText("детям")).not.toBeInTheDocument();
      expect(screen.queryByText(/Уже \d+/)).not.toBeInTheDocument();
    });
  });
});
