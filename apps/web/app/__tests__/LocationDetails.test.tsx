import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocationDetails } from "../components/LocationDetails";

const mockLocation = {
  name: "Альпика",
  photoUrl: "/images/alpika.jpg",
  address: "ул. Альпийская, д. 1",
  hours: "10:00 – 20:00",
  directions: "Вход со двора, 2 этаж",
};

describe("LocationDetails", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <LocationDetails isOpen={false} onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders title when isOpen is true", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.getByText("Локация")).toBeInTheDocument();
  });

  it("renders location name", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.getByText("Альпика")).toBeInTheDocument();
  });

  it("renders address with pin icon", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.getByText("ул. Тестовая, 1")).toBeInTheDocument();
  });

  it("renders photo when photoUrl provided", () => {
    render(
      <LocationDetails
        isOpen
        onClose={vi.fn()}
        name="Альпика"
        address="ул. Тестовая, 1"
        photoUrl="/images/alpika.jpg"
      />
    );
    const img = screen.getByAltText("Альпика");
    expect(img).toBeInTheDocument();
  });

  it("does not render photo when photoUrl not provided", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    const img = screen.queryByAltText("Альпика");
    expect(img).not.toBeInTheDocument();
  });

  it("renders hours when provided", () => {
    render(
      <LocationDetails
        isOpen
        onClose={vi.fn()}
        name="Альпика"
        address="ул. Тестовая, 1"
        hours="10:00 – 20:00"
      />
    );
    expect(screen.getByText("10:00 – 20:00")).toBeInTheDocument();
  });

  it("does not render hours when not provided", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.queryByText("10:00 – 20:00")).not.toBeInTheDocument();
  });

  it("renders map placeholder", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.getByText("Карта")).toBeInTheDocument();
  });

  it("renders directions when provided", () => {
    render(
      <LocationDetails
        isOpen
        onClose={vi.fn()}
        name="Альпика"
        address="ул. Тестовая, 1"
        directions="Вход со двора, 2 этаж"
      />
    );
    expect(screen.getByText("Вход со двора, 2 этаж")).toBeInTheDocument();
  });

  it("does not render directions when not provided", () => {
    render(
      <LocationDetails isOpen onClose={vi.fn()} name="Альпика" address="ул. Тестовая, 1" />
    );
    expect(screen.queryByText("Вход со двора, 2 этаж")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <LocationDetails isOpen onClose={handleClose} name="Альпика" address="ул. Тестовая, 1" />
    );
    const closeButtons = screen.getAllByRole("button");
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
