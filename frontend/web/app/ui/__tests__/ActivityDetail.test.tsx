import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ActivityView } from "../../lib/model/view/activity";
import type { GalleryPhotoView } from "../../lib/model/view/gallery";
import { ActivityDetail } from "../ActivityDetail";

// ── Mock the service-photos hook (GH #576): the strip unit tests stay
// hermetic — the real hook needs a QueryClient and fires getPublicPhotos.
vi.mock("../../hooks/useServicePhotos", () => ({
  useServicePhotos: vi.fn(),
}));

import { useServicePhotos } from "../../hooks/useServicePhotos";

const useServicePhotosMock = vi.mocked(useServicePhotos);

// Default: no service photos — the strip must not interfere with any
// pre-existing behaviour test.
beforeEach(() => {
  useServicePhotosMock.mockReturnValue({ photos: [], isLoading: false, error: null });
});

const mockActivity: ActivityView = {
  id: "act-1",
  serviceId: "service-1",
  title: "Морской пейзаж",
  imageUrl: "/images/activity.jpg",
  category: "вместе",
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
  location: { id: "loc-1", title: "Студия на Таганке", address: "ул. Таганская, д. 10" },
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
    expect(screen.getByText(/2 500.*3 500.*₽/)).toBeInTheDocument();
  });

  it("displays location section", () => {
    renderDetail();
    expect(screen.getByText("Локация")).toBeInTheDocument();
    expect(screen.getByText("Студия на Таганке")).toBeInTheDocument();
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
    // Find the material hint by its text "Акрил" and click the adjacent info icon
    const materialSpan = screen.getByText("Акрил");
    const hintContainer = materialSpan.closest('[role="button"]') ?? materialSpan.parentElement?.parentElement;
    expect(hintContainer).toBeTruthy();
    fireEvent.click(hintContainer!);
    expect(screen.getByText(/Все материалы включены/)).toBeInTheDocument();
  });

  it("shows price details tooltip when hint icon is clicked", () => {
    renderDetail();
    // Find the price hint by its text "2 500" and click the adjacent info icon
    const priceSpan = screen.getByText(/2 500/);
    const hintContainer = priceSpan.closest('[role="button"]') ?? priceSpan.parentElement?.parentElement;
    expect(hintContainer).toBeTruthy();
    fireEvent.click(hintContainer!);
    expect(screen.getByText(/Включает материалы и холст/)).toBeInTheDocument();
  });

  it("shows location details tooltip when hint icon is clicked", () => {
    renderDetail();
    // Find the location hint by its text "Студия на Таганке" and click the adjacent info icon
    const locationSpan = screen.getByText("Студия на Таганке");
    const hintContainer = locationSpan.closest('[role="button"]') ?? locationSpan.parentElement?.parentElement;
    expect(hintContainer).toBeTruthy();
    fireEvent.click(hintContainer!);
    expect(screen.getByText(/ул\. Таганская/)).toBeInTheDocument();
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

  // ── Photo strip (GH #576, spec §6.5): cover + service photos ──

  describe("photo strip", () => {
    const stripPhotos: GalleryPhotoView[] = [
      { id: "p1", url: "/img/p1.jpg", caption: "Процесс" },
      { id: "p2", url: "/img/p2.jpg", caption: "" },
    ];

    function mockPhotos(photos: GalleryPhotoView[]) {
      useServicePhotosMock.mockReturnValue({ photos, isLoading: false, error: null });
    }

    it("renders the strip: cover first, then service photos in API order", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      const strip = screen.getByTestId("activity-photo-strip");
      expect(strip).toBeInTheDocument();
      const thumbs = screen.getAllByTestId("activity-photo-thumb");
      expect(thumbs).toHaveLength(3);
      const srcs = thumbs.map((t) => t.querySelector("img")!.getAttribute("src"));
      expect(srcs).toEqual(["/images/activity.jpg", "/img/p1.jpg", "/img/p2.jpg"]);
    });

    it("defaults the main image to the cover", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      const main = screen.getByTestId("activity-photo-main");
      expect(main.tagName).toBe("IMG");
      expect(main.getAttribute("src")).toBe("/images/activity.jpg");
    });

    it("swaps the main image on thumbnail click and returns to the cover", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      const thumbs = screen.getAllByTestId("activity-photo-thumb");
      fireEvent.click(thumbs[2]);
      expect(screen.getByTestId("activity-photo-main").getAttribute("src")).toBe("/img/p2.jpg");
      fireEvent.click(thumbs[0]);
      expect(screen.getByTestId("activity-photo-main").getAttribute("src")).toBe("/images/activity.jpg");
    });

    it("marks the active thumbnail with aria-current", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      const thumbs = screen.getAllByTestId("activity-photo-thumb");
      expect(thumbs[0].getAttribute("aria-current")).toBe("true");
      expect(thumbs[1].getAttribute("aria-current")).toBeNull();
      fireEvent.click(thumbs[1]);
      expect(thumbs[0].getAttribute("aria-current")).toBeNull();
      expect(thumbs[1].getAttribute("aria-current")).toBe("true");
    });

    it("without a cover: main defaults to the first photo, strip skips the cover thumbnail", () => {
      mockPhotos(stripPhotos);
      render(
        <ActivityDetail
          isOpen
          onClose={vi.fn()}
          activityId="act-1"
          activities={[{ ...mockActivity, imageUrl: "" }]}
        />
      );
      expect(screen.getByTestId("activity-photo-main").getAttribute("src")).toBe("/img/p1.jpg");
      const thumbs = screen.getAllByTestId("activity-photo-thumb");
      expect(thumbs).toHaveLength(2);
      const srcs = thumbs.map((t) => t.querySelector("img")!.getAttribute("src"));
      expect(srcs).toEqual(["/img/p1.jpg", "/img/p2.jpg"]);
    });

    it("empty photo set: no strip, main image block keeps today's behaviour", () => {
      mockPhotos([]);
      renderDetail();
      expect(screen.queryByTestId("activity-photo-strip")).not.toBeInTheDocument();
      expect(screen.getByTestId("activity-photo-main").getAttribute("src")).toBe("/images/activity.jpg");
    });

    it("a11y: labelled keyboard-scrollable group, native button thumbs with lazy imgs", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      const strip = screen.getByTestId("activity-photo-strip");
      expect(strip.getAttribute("role")).toBe("group");
      expect(strip.getAttribute("aria-label")).toBeTruthy();
      expect(strip.getAttribute("tabindex")).toBe("0");
      // jsdom applies no Tailwind: pin the scroll-container contract on the class list
      expect(strip.className).toContain("overflow-x-auto");
      expect(strip.className).toContain("no-scrollbar");
      expect(strip.className).toContain("flex");

      const thumbs = screen.getAllByTestId("activity-photo-thumb");
      thumbs.forEach((thumb) => {
        expect(thumb.tagName).toBe("BUTTON");
        expect(thumb.getAttribute("aria-label")).toBeTruthy();
        const img = thumb.querySelector("img")!;
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.getAttribute("decoding")).toBe("async");
        expect(img.getAttribute("width")).toBeTruthy();
        expect(img.getAttribute("height")).toBeTruthy();
      });
      // Descriptive labels: cover named as cover, photos via caption / index
      expect(thumbs[0].getAttribute("aria-label")).toBe("Обложка занятия");
      expect(thumbs[1].getAttribute("aria-label")).toBe("Фото: Процесс");
      expect(thumbs[2].getAttribute("aria-label")).toBe("Фото 2");
    });

    it("main image is eager — no lazy loading on it", () => {
      mockPhotos(stripPhotos);
      renderDetail();
      expect(screen.getByTestId("activity-photo-main").getAttribute("loading")).toBeNull();
    });
  });
});
