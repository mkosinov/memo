import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MaterialDetails } from "../components/MaterialDetails";

const mockMaterial = {
  material: "Акрил",
  included: ["Холст 30×40", "Кисти", "Краски", "Фартук"],
  bringYourOwn: ["Хорошее настроение"],
  dryingTime: "2–3 часа",
};

describe("MaterialDetails", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <MaterialDetails isOpen={false} onClose={vi.fn()} material="Акрил" included={[]} />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders title when isOpen is true", () => {
    render(
      <MaterialDetails isOpen onClose={vi.fn()} material="Акрил" included={[]} />
    );
    expect(screen.getByText("Материал")).toBeInTheDocument();
  });

  it("renders material name in large bold text", () => {
    render(
      <MaterialDetails isOpen onClose={vi.fn()} material="Акрил" included={[]} />
    );
    expect(screen.getByText("Акрил")).toBeInTheDocument();
  });

  it("renders 'Что включено' section with bullet list", () => {
    render(
      <MaterialDetails isOpen onClose={vi.fn()} material="Акрил" included={mockMaterial.included} />
    );
    expect(screen.getByText("Что включено")).toBeInTheDocument();
    expect(screen.getByText("Холст 30×40")).toBeInTheDocument();
    expect(screen.getByText("Кисти")).toBeInTheDocument();
    expect(screen.getByText("Краски")).toBeInTheDocument();
    expect(screen.getByText("Фартук")).toBeInTheDocument();
  });

  it("renders 'Что взять с собой' section when bringYourOwn provided", () => {
    render(
      <MaterialDetails
        isOpen
        onClose={vi.fn()}
        material="Акрил"
        included={mockMaterial.included}
        bringYourOwn={mockMaterial.bringYourOwn}
      />
    );
    expect(screen.getByText("Что взять с собой")).toBeInTheDocument();
    expect(screen.getByText("Хорошее настроение")).toBeInTheDocument();
  });

  it("does not render 'Что взять с собой' when bringYourOwn not provided", () => {
    render(
      <MaterialDetails isOpen onClose={vi.fn()} material="Акрил" included={mockMaterial.included} />
    );
    expect(screen.queryByText("Что взять с собой")).not.toBeInTheDocument();
  });

  it("renders 'Время сохнет' when dryingTime provided", () => {
    render(
      <MaterialDetails
        isOpen
        onClose={vi.fn()}
        material="Акрил"
        included={mockMaterial.included}
        dryingTime={mockMaterial.dryingTime}
      />
    );
    expect(screen.getByText(/Время сохнет/i)).toBeInTheDocument();
    expect(screen.getByText("2–3 часа")).toBeInTheDocument();
  });

  it("does not render 'Время сохнет' when dryingTime not provided", () => {
    render(
      <MaterialDetails isOpen onClose={vi.fn()} material="Акрил" included={mockMaterial.included} />
    );
    expect(screen.queryByText(/Время сохнет/i)).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <MaterialDetails isOpen onClose={handleClose} material="Акрил" included={[]} />
    );
    const closeButtons = screen.getAllByRole("button");
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
