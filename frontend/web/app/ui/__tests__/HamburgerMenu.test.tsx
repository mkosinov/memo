import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HamburgerMenu } from "../HamburgerMenu";

describe("HamburgerMenu", () => {
  const menuItems = [
    "Услуги",
    "Студии",
    "Пленэр",
    "Корпоративы",
    "Магазин",
    "О нас",
    "Личный кабинет",
  ];

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <HamburgerMenu isOpen={false} onClose={vi.fn()} />
    );
    expect(container.querySelector('[data-testid="menu-overlay"]')).not.toBeInTheDocument();
  });

  it("renders menu items when open", () => {
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    for (const item of menuItems) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(<HamburgerMenu isOpen onClose={handleClose} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders all items as links", () => {
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    for (const item of menuItems) {
      const link = screen.getByText(item).closest("a");
      expect(link).toBeInTheDocument();
    }
  });

  it("renders backdrop", () => {
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId("menu-overlay")).toBeInTheDocument();
  });
});
