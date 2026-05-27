import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryFilter } from "../CategoryFilter";

describe("CategoryFilter", () => {
  it("renders the trigger button with the default label", () => {
    render(
      <CategoryFilter
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /кому угодно/i })).toBeInTheDocument();
  });

  it("renders the active category label when selected", () => {
    render(
      <CategoryFilter
        selectedCategory="вместе"
        onSelectCategory={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /вместе/i })).toBeInTheDocument();
  });

  it("highlights the active trigger button", () => {
    render(
      <CategoryFilter
        selectedCategory="вместе"
        onSelectCategory={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: /вместе/i });
    expect(trigger).toHaveClass("bg-[#004D56]");
  });

  it("opens the overlay and lists options", () => {
    render(
      <CategoryFilter
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: /кому угодно/i });
    fireEvent.click(trigger);

    expect(screen.getByText("Кому подбираем мастер-класс?")).toBeInTheDocument();
    expect(screen.getByText("вместе")).toBeInTheDocument();
    expect(screen.getByText("взрослым")).toBeInTheDocument();
    expect(screen.getByText("детям")).toBeInTheDocument();
    expect(screen.getByText("вдвоём")).toBeInTheDocument();
    expect(screen.getByText("для компаний")).toBeInTheDocument();
    expect(screen.getByText("есть только 1 час")).toBeInTheDocument();
    expect(screen.getByText("в дождливую погоду")).toBeInTheDocument();
    expect(screen.getByText("на свежем воздухе")).toBeInTheDocument();
  });

  it("calls onSelectCategory when an option is clicked", () => {
    const onSelect = vi.fn();
    render(
      <CategoryFilter
        selectedCategory={null}
        onSelectCategory={onSelect}
      />
    );
    const trigger = screen.getByRole("button", { name: /кому угодно/i });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText("вместе"));
    expect(onSelect).toHaveBeenCalledWith("вместе");
  });
});
