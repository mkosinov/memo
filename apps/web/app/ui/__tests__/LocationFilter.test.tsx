import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocationFilter } from "../LocationFilter";

describe("LocationFilter", () => {
  const locations = [
    { id: "1", name: "Альпика" },
    { id: "2", name: "Гранд Отель Поляна" },
    { id: "3", name: "Поляна 1389" },
  ];

  it("renders a button trigger with location icon and 'Все локации' text", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: /Все локации/i });
    expect(trigger).toBeInTheDocument();
  });

  it("shows 'Все локации' as the default label when no location is selected", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    expect(screen.getByText("Все локации")).toBeInTheDocument();
  });

  it("shows selected location name in trigger when selected", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation="2"
        onSelectLocation={vi.fn()}
      />
    );
    expect(screen.getByText("Гранд Отель Поляна")).toBeInTheDocument();
    expect(screen.queryByText("Все локации")).not.toBeInTheDocument();
  });

  it("opens overlay with location options when trigger is clicked", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: /Все локации/i });
    fireEvent.click(trigger);
    expect(screen.getByText("Выберите локацию")).toBeInTheDocument();
    // "Все локации" appears twice (trigger + overlay option), use getAllByText
    expect(screen.getAllByText("Все локации").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Альпика")).toBeInTheDocument();
    expect(screen.getByText("Гранд Отель Поляна")).toBeInTheDocument();
    expect(screen.getByText("Поляна 1389")).toBeInTheDocument();
  });

  it("calls onSelectLocation with location id when a location is selected", () => {
    const onSelect = vi.fn();
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={onSelect}
      />
    );
    const trigger = screen.getByRole("button", { name: /Все локации/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Гранд Отель Поляна"));
    expect(onSelect).toHaveBeenCalledWith("2");
  });

  it("calls onSelectLocation with null when 'Все локации' is selected in overlay", () => {
    const onSelect = vi.fn();
    render(
      <LocationFilter
        locations={locations}
        selectedLocation="1"
        onSelectLocation={onSelect}
      />
    );
    // Trigger shows the selected location name
    const trigger = screen.getByRole("button", { name: /Альпика/i });
    fireEvent.click(trigger);
    // Click "Все локации" in the overlay
    fireEvent.click(screen.getByText("Все локации"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
