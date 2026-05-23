import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityDetail } from "../components/ActivityDetail";

const mockActivity = {
  id: "act-1",
  title: "Морской пейзаж",
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
  nextTimes: [
    { id: "act-2", date: "17 мая", time: "10:30" },
    { id: "act-3", date: "18 мая", time: "17:00" },
    { id: "act-4", date: "20 мая", time: "14:00" },
  ],
  location: "Студия на Таганке",
  locationAddress: "ул. Таганская, д. 10",
  locationDetails: "Метро Таганская, 5 минут пешком",
  teacherDetails: "Художник-живописец, педагог с 10-летним стажем",
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

  // --- NEW: Hint icon tests (replacing "Подробнее" popup buttons) ---

  it("shows hint icon (i) for material section instead of Подробнее button", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    // Should have info icons, not "Подробнее" text
    expect(screen.queryByText("Подробнее")).not.toBeInTheDocument();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows hint icon (i) for price section", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(2);
  });

  it("shows hint icon (i) for location section", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(3);
  });

  it("shows material details tooltip when hint icon is clicked", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    fireEvent.click(infoIcons[0]);
    expect(screen.getByText("Все материалы включены")).toBeInTheDocument();
  });

  it("shows price details tooltip when hint icon is clicked", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    // Price is the second info icon
    fireEvent.click(infoIcons[1]);
    expect(screen.getByText("Включает материалы и холст")).toBeInTheDocument();
  });

  it("shows location details tooltip when hint icon is clicked", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    // Location is the third info icon
    fireEvent.click(infoIcons[2]);
    expect(screen.getByText("ул. Таганская, д. 10")).toBeInTheDocument();
  });

  // --- NEW: "В следующий раз" with clickable date options ---

  it("displays next time section with clickable date options", () => {
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("В следующий раз")).toBeInTheDocument();
    expect(screen.getByText("17 мая 10:30")).toBeInTheDocument();
    expect(screen.getByText("18 мая 17:00")).toBeInTheDocument();
    expect(screen.getByText("20 мая 14:00")).toBeInTheDocument();
  });

  it("does not display next time section when nextTimes not provided", () => {
    const activityWithoutNextTimes = { ...mockActivity, nextTimes: undefined };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={activityWithoutNextTimes}
      />
    );
    expect(screen.queryByText("В следующий раз")).not.toBeInTheDocument();
  });

  it("calls onNavigateToActivity when a next time date is clicked", () => {
    const handleNavigate = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onNavigateToActivity={handleNavigate}
      />
    );
    const dateOption = screen.getByText("17 мая 10:30");
    fireEvent.click(dateOption);
    expect(handleNavigate).toHaveBeenCalledWith("act-2");
  });

  it("calls onNavigateToActivity with correct activity id for second date", () => {
    const handleNavigate = vi.fn();
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={mockActivity}
        onNavigateToActivity={handleNavigate}
      />
    );
    const dateOption = screen.getByText("18 мая 17:00");
    fireEvent.click(dateOption);
    expect(handleNavigate).toHaveBeenCalledWith("act-3");
  });

  it("limits next times to 3 options maximum", () => {
    const activityWithManyNextTimes = {
      ...mockActivity,
      nextTimes: [
        { id: "act-2", date: "17 мая", time: "10:30" },
        { id: "act-3", date: "18 мая", time: "17:00" },
        { id: "act-4", date: "20 мая", time: "14:00" },
        { id: "act-5", date: "22 мая", time: "19:00" },
      ],
    };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activity={activityWithManyNextTimes}
      />
    );
    expect(screen.getByText("17 мая 10:30")).toBeInTheDocument();
    expect(screen.getByText("18 мая 17:00")).toBeInTheDocument();
    expect(screen.getByText("20 мая 14:00")).toBeInTheDocument();
    expect(screen.queryByText("22 мая 19:00")).not.toBeInTheDocument();
  });
});
