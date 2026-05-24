import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocationFilter } from "../LocationFilter";

describe("LocationFilter", () => {
  const locations = [
    { id: "1", name: "Альпика" },
    { id: "2", name: "Гранд Отель Поляна" },
    { id: "3", name: "Поляна 1389" },
  ];

  it("renders a select element with location icon", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
  });

  it("shows 'Все локации' as the first option", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options[0].text).toBe("Все локации");
  });

  it("renders all location options", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
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
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    expect(onSelect).toHaveBeenCalledWith("2");
  });

  it("calls onSelectLocation with null when 'Все локации' is selected", () => {
    const onSelect = vi.fn();
    render(
      <LocationFilter
        locations={locations}
        selectedLocation="1"
        onSelectLocation={onSelect}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("has the correct option selected based on selectedLocation prop", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation="2"
        onSelectLocation={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("2");
  });

  it("has 'Все локации' selected when selectedLocation is null", () => {
    render(
      <LocationFilter
        locations={locations}
        selectedLocation={null}
        onSelectLocation={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});
