import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ActivityView } from "../../lib/model/view/activity";
import { ActivityDetail } from "../ActivityDetail";

const mockActivity: ActivityView = {
  id: "act-1",
  title: "Морской пейзаж",
  imageUrl: "/images/activity.jpg",
  category: "вместе",
  guestPhotos: ["/images/guest1.jpg", "/images/guest2.jpg", "/images/guest3.jpg"],
  teacherName: "Анна Иванова",
  teacherAvatar: "/images/teacher.jpg",
  dateFormatted: "20 мая, понедельник",
  time: "14:00 – 16:00",
  material: "Акрил",
  materialDetails: "Все материалы включены",
  size: "30×40 см",
  priceMin: 2500,
  priceMax: 3500,
  priceDetails: "Включает материалы и холст",
  duration: "2 ч",
  guestsCount: 5,
  date: "2026-05-20",
  priceFormatted: "2 500 – 3 500 ₽",
  categoryColor: "#5B8C7A",
  nextTimes: [
    { id: "act-2", date: "17 мая", time: "10:30" },
    { id: "act-3", date: "18 мая", time: "17:00" },
    { id: "act-4", date: "20 мая", time: "14:00" },
  ],
  location: { id: "loc-1", name: "Студия на Таганке", address: "ул. Таганская, д. 10" },
  locationDetails: "Метро Таганская, 5 минут пешком",
  teacherDetails: "Художник-живописец, педагог с 10-летним стажем",
};

const mockActivities = [mockActivity];

function renderDetail(overrides: Partial<React.ComponentProps<typeof ActivityDetail>> = {}) {
  return render(
    <ActivityDetail
      isOpen={overrides.isOpen ?? true}
      onClose={overrides.onClose ?? vi.fn()}
      activityId="act-1"
      activities={[mockActivity]}
      onBook={overrides.onBook}
      onSelectActivity={overrides.onSelectActivity}
    />,
  );
}

describe("ActivityDetail", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ActivityDetail
        isOpen={false}
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity]}
      />
    );
    expect(container.querySelector('[data-testid="overlay-backdrop"]')).not.toBeInTheDocument();
  });

  it("renders when isOpen is true", () => {
    renderDetail();
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
  });

  it("displays teacher name", () => {
    renderDetail();
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
  });

  it("displays date and time", () => {
    renderDetail();
    expect(screen.getByText("20 мая, понедельник")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 16:00")).toBeInTheDocument();
  });

  it("displays material section", () => {
    renderDetail();
    expect(screen.getByText("Материал")).toBeInTheDocument();
    expect(screen.getByText("Акрил")).toBeInTheDocument();
  });

  it("displays price section", () => {
    renderDetail();
    expect(screen.getByText("Стоимость")).toBeInTheDocument();
    expect(screen.getByText("2 500 – 3 500 ₽")).toBeInTheDocument();
  });

  it("displays location section", () => {
    renderDetail();
    expect(screen.getByText("Локация")).toBeInTheDocument();
    expect(screen.getByText("Студия на Таганке")).toBeInTheDocument();
  });

  it("displays guest photos strip when guestPhotos provided", () => {
    renderDetail();
    const guestImages = screen.getAllByAltText(/Guest work/);
    expect(guestImages.length).toBe(3);
  });

  it("does not display guest photos strip when guestPhotos not provided", () => {
    const vm: ActivityView = { ...mockActivity, guestPhotos: undefined };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[vm]}
      />
    );
    const guestImages = screen.queryAllByAltText(/Guest work/);
    expect(guestImages.length).toBe(0);
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    renderDetail({ onClose: handleClose });
    const closeButtons = screen.getAllByRole("button");
    // The close button is the × button (first button in the overlay)
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onBook when Участвовать button is clicked", () => {
    const handleBook = vi.fn();
    renderDetail({ onBook: handleBook });
    const bookButton = screen.getByRole("button", { name: /участвовать/i });
    fireEvent.click(bookButton);
    expect(handleBook).toHaveBeenCalledTimes(1);
  });

  // --- Hint icon tests ---

  it("shows hint icon (i) for material section instead of Подробнее button", () => {
    renderDetail();
    expect(screen.queryByText("Подробнее")).not.toBeInTheDocument();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows hint icon (i) for price section", () => {
    renderDetail();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(2);
  });

  it("shows hint icon (i) for location section", () => {
    renderDetail();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    expect(infoIcons.length).toBeGreaterThanOrEqual(3);
  });

  it("shows material details tooltip when hint icon is clicked", () => {
    renderDetail();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    fireEvent.click(infoIcons[0]);
    expect(screen.getByText("Все материалы включены")).toBeInTheDocument();
  });

  it("shows price details tooltip when hint icon is clicked", () => {
    renderDetail();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    // Price is the second info icon
    fireEvent.click(infoIcons[1]);
    expect(screen.getByText("Включает материалы и холст")).toBeInTheDocument();
  });

  it("shows location details tooltip when hint icon is clicked", () => {
    renderDetail();
    const infoIcons = screen.getAllByRole("button", { name: /подробнее о/i });
    // Location is the third info icon
    fireEvent.click(infoIcons[2]);
    expect(screen.getByText("ул. Таганская, д. 10")).toBeInTheDocument();
  });

  // --- "В другой раз" with clickable activity pills ---

  it('displays "В другой раз" section with other activities', () => {
    const act2: ActivityView = {
      ...mockActivity,
      id: "act-2",
      title: "Акварельный этюд",
      dateFormatted: "17 мая, суббота",
      time: "10:30 – 12:30",
    };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, act2]}
      />
    );
    expect(screen.getByText("В другой раз")).toBeInTheDocument();
    expect(screen.getByText("17 мая, суббота 10:30 – 12:30")).toBeInTheDocument();
  });

  it("does not display other activities section when only one activity available", () => {
    renderDetail();
    expect(screen.queryByText("В другой раз")).not.toBeInTheDocument();
  });

  it("calls onSelectActivity when an activity pill is clicked", () => {
    const handleSelect = vi.fn();
    const act2: ActivityView = {
      ...mockActivity,
      id: "act-2",
      title: "Акварельный этюд",
      dateFormatted: "17 мая, суббота",
      time: "10:30 – 12:30",
    };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, act2]}
        onSelectActivity={handleSelect}
      />
    );
    const pill = screen.getByText("17 мая, суббота 10:30 – 12:30");
    fireEvent.click(pill);
    expect(handleSelect).toHaveBeenCalledWith(act2);
  });

  it("calls onSelectActivity with correct activity when multiple options exist", () => {
    const handleSelect = vi.fn();
    const act2: ActivityView = {
      ...mockActivity,
      id: "act-2",
      title: "Акварельный этюд",
      dateFormatted: "17 мая, суббота",
      time: "10:30 – 12:30",
    };
    const act3: ActivityView = {
      ...mockActivity,
      id: "act-3",
      title: "Масляная живопись",
      dateFormatted: "18 мая, воскресенье",
      time: "17:00 – 19:00",
    };
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, act2, act3]}
        onSelectActivity={handleSelect}
      />
    );
    const pill = screen.getByText("18 мая, воскресенье 17:00 – 19:00");
    fireEvent.click(pill);
    expect(handleSelect).toHaveBeenCalledWith(act3);
  });

  it("limits other activities to 6 options maximum", () => {
    const extraActivities = Array.from({ length: 8 }, (_, i) => ({
      ...mockActivity,
      id: `act-${i + 2}`,
      title: `Активность ${i + 2}`,
      dateFormatted: `${17 + i} мая, пятница`,
      time: "10:30 – 12:30",
    }));
    render(
      <ActivityDetail
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, ...extraActivities]}
      />
    );
    const pills = screen.getAllByText(/мая, пятница/);
    expect(pills.length).toBe(6);
    const seventh = screen.queryByText("24 мая, пятница 10:30 – 12:30");
    expect(seventh).not.toBeInTheDocument();
  });
});
