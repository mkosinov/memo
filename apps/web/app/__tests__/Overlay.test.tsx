import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Overlay } from "../components/Overlay";

describe("Overlay", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <Overlay isOpen={false} onClose={vi.fn()}>
        Content
      </Overlay>
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders when isOpen is true", () => {
    render(
      <Overlay isOpen onClose={vi.fn()}>
        Overlay Content
      </Overlay>
    );
    expect(screen.getByText("Overlay Content")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <Overlay isOpen onClose={handleClose}>
        Close Me
      </Overlay>
    );
    const closeBtn = screen.getByRole("button");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders backdrop", () => {
    render(
      <Overlay isOpen onClose={vi.fn()}>
        Content
      </Overlay>
    );
    const backdrop = screen.getByTestId("overlay-backdrop");
    expect(backdrop).toBeInTheDocument();
  });

  it("applies half size class", () => {
    render(
      <Overlay isOpen onClose={vi.fn()} size="half">
        Half
      </Overlay>
    );
    const panel = screen.getByTestId("overlay-panel");
    expect(panel).toHaveClass("h-1/2");
  });

  it("applies full size class", () => {
    render(
      <Overlay isOpen onClose={vi.fn()} size="full">
        Full
      </Overlay>
    );
    const panel = screen.getByTestId("overlay-panel");
    expect(panel).toHaveClass("h-full");
  });

  it("applies three-quarters size class", () => {
    render(
      <Overlay isOpen onClose={vi.fn()} size="three-quarters">
        Three Quarters
      </Overlay>
    );
    const panel = screen.getByTestId("overlay-panel");
    expect(panel).toHaveClass("h-3/4");
  });
});
