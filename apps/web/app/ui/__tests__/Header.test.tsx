import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "../Header";

describe("Header", () => {
  it("renders logo image", () => {
    render(<Header />);
    const logo = screen.getByAltText("Colour Mountains");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/logo_horizontal_color.png");
  });

  it("renders hamburger button", () => {
    render(<Header />);
    const hamburger = screen.getByRole("button", { name: /menu/i });
    expect(hamburger).toBeInTheDocument();
  });

  it("calls onMenuToggle when hamburger is clicked", () => {
    const handleToggle = vi.fn();
    render(<Header onMenuToggle={handleToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("is transparent when not scrolled", () => {
    render(<Header isScrolled={false} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("bg-transparent");
  });

  it("has white background when scrolled", () => {
    render(<Header isScrolled />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("bg-white");
  });

  it("has shadow when scrolled", () => {
    render(<Header isScrolled />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("shadow-sm");
  });

  it("is fixed position by default", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    // Default: no position class added (flows naturally)
    expect(header).not.toHaveClass("absolute");
  });

  it("is absolute when position='absolute'", () => {
    render(<Header position="absolute" />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("absolute");
  });
});
