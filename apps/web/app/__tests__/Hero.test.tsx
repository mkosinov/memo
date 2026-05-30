import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "../sections/Hero";

describe("Hero", () => {
  it("renders heading text", () => {
    render(<Hero />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/Рисуйте в горах/);
  });

  it("renders 'эмоции' in gold style", () => {
    render(<Hero />);
    const emotionsEl = screen.getByText("эмоции");
    expect(emotionsEl).toBeInTheDocument();
    expect(emotionsEl).toHaveStyle({ color: "#C49A2E" });
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
