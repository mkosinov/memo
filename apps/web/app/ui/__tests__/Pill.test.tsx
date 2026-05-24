import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pill } from "../Pill";

describe("Pill", () => {
  it("renders children text", () => {
    render(<Pill active={false}>All</Pill>);
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("renders in active state with brand styling", () => {
    render(<Pill active>Active</Pill>);
    const pill = screen.getByText("Active");
    expect(pill).toBeInTheDocument();
    expect(pill.closest("button")).toHaveClass("bg-[#004D56]");
  });

  it("renders in inactive state with border styling", () => {
    render(<Pill active={false}>Inactive</Pill>);
    const pill = screen.getByText("Inactive");
    expect(pill).toBeInTheDocument();
    expect(pill.closest("button")).toHaveClass("border");
  });

  it("handles click events", () => {
    const handleClick = vi.fn();
    render(
      <Pill active={false} onClick={handleClick}>
        Clickable
      </Pill>
    );
    fireEvent.click(screen.getByText("Clickable"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    render(
      <Pill active={false} className="extra-class">
        Custom
      </Pill>
    );
    const pill = screen.getByText("Custom");
    expect(pill.closest("button")).toHaveClass("extra-class");
  });

  it("is rounded-full", () => {
    render(<Pill active={false}>Round</Pill>);
    const pill = screen.getByText("Round");
    expect(pill.closest("button")).toHaveClass("rounded-full");
  });
});
