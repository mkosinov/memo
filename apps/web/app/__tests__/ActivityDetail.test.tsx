import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityDetail } from "../components/ActivityDetail";

const mockActivity = {
  id: "act-1",
  imageUrl: "/images/activity.jpg",
  guestPhotos: ["/images/guest1.jpg", "/images/guest2.jpg", "/images/guest3.jpg"],
  teacherName: "Анна Иванова",
  teacherAvatar: "/images/teacher.jpg",
  date: "20 мая, понедельник",
  time: "14:00 – 16:00",
  material: "Акрил",
  materialDetails: "Все материалы включены",
  priceMin: 2500,
  priceMax: 3500,
  priceDetails: "Включает материалы и холст",
  nextTime: "25 мая, 18:00",
  nextTimeLocation: "Студия на Арбате",
  location: "Студия на Таганке",
  locationAddress: "ул. Таганская, д. 10",
};

describe("ActivityDetail", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ActivityDetail
        isOpen={false}
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders when isOpen is true", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
  });

  it("displays teacher name", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
  });

  it("displays date and time", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("20 мая, понедельник")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 16:00")).toBeInTheDocument();
  });

  it("displays material section", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Материал")).toBeInTheDocument();
    expect(screen.getByText("Акрил")).toBeInTheDocument();
  });

  it("displays price section", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Стоимость")).toBeInTheDocument();
    expect(screen.getByText("2 500 – 3 500 ₽")).toBeInTheDocument();
  });

  it("displays location section", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Локация")).toBeInTheDocument();
    expect(screen.getByText("Студия на Таганке")).toBeInTheDocument();
  });

  it("displays guest photos strip when guestPhotos provided", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const guestImages = screen.getAllByAltText(/Guest work/);
    expect(guestImages.length).toBe(3);
  });

  it("does not display guest photos strip when guestPhotos not provided", () => {
    const activityWithoutGuestPhotos = { ...mockActivity, guestPhotos: undefined };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={activityWithoutGuestPhotos}
      />
    );
    const guestImages = screen.queryAllByAltText(/Guest work/);
    expect(guestImages.length).toBe(0);
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={handleClose}
        activity={mockActivity}
      />
    );
    const closeButtons = screen.getAllByRole("button");
    // The close button is the × button (first button in the overlay)
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onBook when Участвовать button is clicked", () => {
    const handleBook = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onBook={handleBook}
      />
    );
    const bookButton = screen.getByRole("button", { name: /участвовать/i });
    fireEvent.click(bookButton);
    expect(handleBook).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenMaterialDetails when Подробнее link is clicked in material section", () => {
    const handleMaterialDetails = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onOpenMaterialDetails={handleMaterialDetails}
        onOpenPriceDetails={vi.fn()}
        onOpenNextTime={vi.fn()}
        onOpenLocationDetails={vi.fn()}
      />
    );
    const detailLinks = screen.getAllByText("Подробнее");
    fireEvent.click(detailLinks[0]);
    expect(handleMaterialDetails).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenPriceDetails when Подробнее link is clicked in price section", () => {
    const handlePriceDetails = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onOpenMaterialDetails={vi.fn()}
        onOpenPriceDetails={handlePriceDetails}
        onOpenNextTime={vi.fn()}
        onOpenLocationDetails={vi.fn()}
      />
    );
    const detailLinks = screen.getAllByText("Подробнее");
    fireEvent.click(detailLinks[1]);
    expect(handlePriceDetails).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenLocationDetails when Подробнее link is clicked in location section", () => {
    const handleLocationDetails = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onOpenMaterialDetails={vi.fn()}
        onOpenPriceDetails={vi.fn()}
        onOpenNextTime={vi.fn()}
        onOpenLocationDetails={handleLocationDetails}
      />
    );
    const detailLinks = screen.getAllByText("Подробнее");
    // Location section's "Подробнее" is the last one (index 3)
    fireEvent.click(detailLinks[detailLinks.length - 1]);
    expect(handleLocationDetails).toHaveBeenCalledTimes(1);
  });

  it("displays next time section when nextTime provided", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("В следующий раз")).toBeInTheDocument();
    expect(screen.getByText("25 мая, 18:00")).toBeInTheDocument();
  });

  it("does not display next time section when nextTime not provided", () => {
    const activityWithoutNextTime = { ...mockActivity, nextTime: undefined };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={activityWithoutNextTime}
      />
    );
    expect(screen.queryByText("В следующий раз")).not.toBeInTheDocument();
  });

  it("calls onOpenNextTime when Подробнее link is clicked in next time section", () => {
    const handleNextTime = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onOpenMaterialDetails={vi.fn()}
        onOpenPriceDetails={vi.fn()}
        onOpenNextTime={handleNextTime}
        onOpenLocationDetails={vi.fn()}
      />
    );
    const detailLinks = screen.getAllByText("Подробнее");
    // Next time section's "Подробнее" is at index 2
    fireEvent.click(detailLinks[2]);
    expect(handleNextTime).toHaveBeenCalledTimes(1);
  });
});
