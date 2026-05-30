import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatBar } from "../ChatBar";

describe("ChatBar", () => {
  it("renders the ask button", () => {
    render(<ChatBar />);
    expect(screen.getByText("Задать вопрос в чате")).toBeInTheDocument();
  });

  it("calls onSend when the ask button is clicked", () => {
    const onSend = vi.fn();
    render(<ChatBar onSend={onSend} />);
    fireEvent.click(screen.getByText("Задать вопрос в чате"));
    expect(onSend).toHaveBeenCalled();
  });

  it("has fixed positioning at the bottom", () => {
    const { container } = render(<ChatBar />);
    const bar = container.firstChild as HTMLElement;
    expect(bar).toHaveClass("fixed");
    expect(bar).toHaveClass("bottom-0");
  });

  it("has backdrop blur styling", () => {
    const { container } = render(<ChatBar />);
    const bar = container.firstChild as HTMLElement;
    expect(bar).toHaveClass("backdrop-blur-md");
  });
});
