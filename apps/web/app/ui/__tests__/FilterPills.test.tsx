import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterPills } from "../FilterPills";

describe("FilterPills", () => {
  it("renders all category pills", () => {
    render(
      <FilterPills
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );
    expect(screen.getByText("вместе")).toBeInTheDocument();
    expect(screen.getByText("взрослым")).toBeInTheDocument();
    expect(screen.getByText("детям")).toBeInTheDocument();
  });

  it("highlights the selected category pill as active", () => {
    render(
      <FilterPills
        selectedCategory="вместе"
        onSelectCategory={vi.fn()}
      />
    );
    const activePill = screen.getByText("вместе").closest("button");
    expect(activePill).toHaveClass("bg-[#004D56]");
  });

  it("calls onSelectCategory with the category when a pill is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FilterPills
        selectedCategory={null}
        onSelectCategory={onSelect}
      />
    );
    fireEvent.click(screen.getByText("вместе"));
    expect(onSelect).toHaveBeenCalledWith("вместе");
  });

  it("deselects when the active pill is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FilterPills
        selectedCategory="взрослым"
        onSelectCategory={onSelect}
      />
    );
    fireEvent.click(screen.getByText("взрослым"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("allows horizontal scroll with no-scrollbar class", () => {
    const { container } = render(
      <FilterPills
        selectedCategory={null}
        onSelectCategory={vi.fn()}
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("overflow-x-auto");
    expect(wrapper).toHaveClass("no-scrollbar");
  });
});
