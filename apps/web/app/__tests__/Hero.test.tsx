import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "../sections/Hero";

describe("Hero", () => {
  it("renders title 'Цветные Горы'", () => {
    render(<Hero />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Цветные Горы");
  });

  it("renders subtitle 'Студия рисования' in gold", () => {
    render(<Hero />);
    const subtitle = screen.getByText("Студия рисования");
    expect(subtitle).toBeInTheDocument();
    expect(subtitle).toHaveStyle({ color: "#C49A2E" });
  });

  it("renders three pills", () => {
    render(<Hero />);
    expect(screen.getByText("Новичкам подходит")).toBeInTheDocument();
    expect(screen.getByText("Всё включено")).toBeInTheDocument();
    expect(screen.getByText("Рядом с вами")).toBeInTheDocument();
  });

  it("renders Header component", () => {
    render(<Hero />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("passes onMenuToggle to Header", () => {
    const handleToggle = vi.fn();
    render(<Hero onMenuToggle={handleToggle} />);
    const menuButton = screen.getByRole("button", { name: /menu/i });
    menuButton.click();
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("has correct height styles", () => {
    const { container } = render(<Hero />);
    const hero = container.firstChild as HTMLElement;
    expect(hero).toHaveClass("relative");
  });
});
