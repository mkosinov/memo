import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatBar } from "../components/ChatBar";

describe("ChatBar", () => {
  it("renders all chat chips", () => {
    render(<ChatBar />);
    expect(screen.getByText("👶 Для ребёнка 8 лет")).toBeInTheDocument();
    expect(screen.getByText("❤️ Для двоих")).toBeInTheDocument();
    expect(screen.getByText("🌧 Чем заняться в дождь")).toBeInTheDocument();
    expect(screen.getByText("⏱ Есть только 1 час")).toBeInTheDocument();
  });

  it("renders the send button", () => {
    render(<ChatBar />);
    expect(screen.getByText("Отправить")).toBeInTheDocument();
  });

  it("calls onChipClick when a chip is clicked", () => {
    const onChipClick = vi.fn();
    render(<ChatBar onChipClick={onChipClick} />);
    fireEvent.click(screen.getByText("👶 Для ребёнка 8 лет"));
    expect(onChipClick).toHaveBeenCalledWith("👶 Для ребёнка 8 лет");
  });

  it("calls onSend when the send button is clicked", () => {
    const onSend = vi.fn();
    render(<ChatBar onSend={onSend} />);
    fireEvent.click(screen.getByText("Отправить"));
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
