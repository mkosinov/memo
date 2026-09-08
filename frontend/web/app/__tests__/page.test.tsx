import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "../page";

// ── Mock hooks ──────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  selectDate: vi.fn(),
  setTab: vi.fn(),
  getByDate: vi.fn(),
}));

const mockSchedules = [
  {
    id: "act-1",
    title: "Акварельный пейзаж",
    tags: ["взрослым"],
    imageUrl: "/test-activity.jpg",
    photos: [{ url: "/guest1.jpg", isPublic: true, tags: [] }],
    time: "14:00",
    duration: "2 часа",
    location: { id: "loc-1", name: "Студия на Арбате", address: "ул. Арбат, 1" },
    guestsCount: 5,
    material: "Акварель",
    size: "30x40",
    priceMin: 2500,
    priceMax: 3500,
    masterName: "Анна Иванова",
    masterAvatar: "/teacher.jpg",
    date: "2026-05-20",
    priceFormatted: "2 500 – 3 500 ₽",
    dateFormatted: "20 мая, среда",
    tagColors: ["#C49A2E"],
    nextTimes: [{ id: "act-1b", date: "22 мая", time: "14:00" }],
    priceHint: "Включает материалы",
    materialDetails: "Акварель и бумага",
    locationHint: "5 минут от метро",
  },
  {
    id: "act-2",
    title: "Семейное рисование",
    tags: ["вместе"],
    imageUrl: "/test-activity-2.jpg",
    photos: [],
    time: "16:00",
    duration: "1.5 часа",
    location: { id: "loc-2", name: "Парк Горького", address: "ул. Крымский Вал, 9" },
    guestsCount: 3,
    material: "Акрил",
    size: "20x30",
    priceMin: 1500,
    priceMax: 2500,
    masterName: "Мария Петрова",
    date: "2026-05-21",
    priceFormatted: "1 500 – 2 500 ₽",
    dateFormatted: "21 мая, четверг",
    tagColors: ["#5B8C7A"],
    nextTimes: [{ id: "act-2b", date: "24 мая", time: "16:00" }],
    priceHint: "Цена за участника",
    materialDetails: "Акриловые краски",
    locationHint: "Вход через главный вход",
  },
  {
    id: "act-3",
    title: "Гончарное дело",
    tags: ["вместе"],
    imageUrl: "/test-activity-3.jpg",
    photos: [],
    time: "12:00",
    duration: "2 часа",
    location: { id: "loc-1", name: "Студия на Арбате" },
    guestsCount: 2,
    material: "Глина",
    size: "Горшок",
    priceMin: 3000,
    priceMax: 4000,
    masterName: "Ольга Смирнова",
    date: "2026-05-20",
    priceFormatted: "3 000 – 4 000 ₽",
    dateFormatted: "20 мая, среда",
    tagColors: ["#5B8C7A"],
    nextTimes: [{ id: "act-3b", date: "23 мая", time: "12:00" }],
    priceHint: "Все материалы включены",
    materialDetails: "Глина, краски, глазурь",
    locationHint: "Цокольный этаж",
  },
];

const mockLocations = [
  { id: "loc-1", name: "Студия на Арбате", address: "ул. Арбат, 1" },
  { id: "loc-2", name: "Парк Горького", address: "ул. Крымский Вал, 9" },
];

const mockGalleryPhotos = [
  { id: "g1", url: "/gallery-1.jpg", technique: "Акварель" },
  { id: "g2", url: "/gallery-2.jpg", technique: "Акрил" },
];

const mockToday = new Date(2026, 4, 20);
const mockCalendarDays = Array.from({ length: 4 }, (_, i) => {
  const date = new Date(mockToday);
  date.setDate(mockToday.getDate() + 1 + i);
  return {
    date,
    dayName: ["Чт", "Пт", "Сб", "Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Пт", "Сб", "Вс", "Пн", "Вт"][i],
    dayNumber: mockToday.getDate() + 1 + i,
    isToday: false,
    isSelected: i === 0,
  };
});

vi.mock("../hooks/useCalendarDays", () => ({
  useCalendarDays: () => ({
    days: mockCalendarDays,
    selectedDate: mockToday,
    selectDate: mocks.selectDate,
    tab: "tomorrow" as const,
    setTab: mocks.setTab,
  }),
}));

vi.mock("../hooks/useSchedule", () => ({
  useSchedule: () => ({
    schedules: mockSchedules,
    getByDate: mocks.getByDate,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useLocations", () => ({
  useLocations: () => ({
    locations: mockLocations,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useGallery", () => ({
  useGallery: () => ({
    photos: mockGalleryPhotos,
    isLoading: false,
    error: null,
  }),
}));

// ── Helpers ─────────────────────────────────────────────────

function renderHome() {
  return render(<Home />);
}

/**
 * Tap the visible activity card in MKCarousel.
 */
function tapCardTrigger() {
  fireEvent.click(screen.getByText("Акварельный пейзаж"));
}

// ── Tests ───────────────────────────────────────────────────

describe("Home (page.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectDate.mockClear();
    mocks.setTab.mockClear();
    mocks.getByDate.mockClear();
    mocks.getByDate.mockReturnValue(mockSchedules);
  });

  describe("section rendering", () => {
    it("renders Hero section with title", () => {
      renderHome();
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    it("renders CalendarLine with day names", () => {
      renderHome();
      expect(screen.getAllByText("Чт").length).toBeGreaterThanOrEqual(1);
    });

    it("renders ActivityTagFilter with default option", () => {
      renderHome();
      expect(screen.getByRole("button", { name: /для всех/i })).toBeInTheDocument();
    });

    it("renders LocationFilter trigger button", () => {
      renderHome();
      expect(screen.getByRole("button", { name: /все локации/i })).toBeInTheDocument();
    });

    it("renders MKCarousel with activity cards", () => {
      renderHome();
      expect(screen.getByText("Акварельный пейзаж")).toBeInTheDocument();
    });

    it("renders Reviews section", () => {
      renderHome();
      expect(screen.getByText(/Отзывы/)).toBeInTheDocument();
    });

    it("renders GuestGallery section", () => {
      renderHome();
      const guestImages = screen.getAllByAltText(/Guest photo/);
      expect(guestImages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("calendar date selection", () => {
    it("calls selectDate when a calendar day is clicked", () => {
      renderHome();
      const dayButton = screen.getByRole("button", { name: /21/ });
      fireEvent.click(dayButton);
      expect(mocks.selectDate).toHaveBeenCalled();
    });
  });

  describe("category filter selection", () => {
    it("has 'Для всех' selected by default", () => {
      renderHome();
      const trigger = screen.getByRole("button", { name: /для всех/i });
      expect(trigger).not.toHaveClass("bg-[#004D56]");
    });

    it("calls onSelectCategory when a category is clicked inside overlay", () => {
      renderHome();
      const trigger = screen.getByRole("button", { name: /для всех/i });
      fireEvent.click(trigger);

      const options = screen.getAllByText("взрослым");
      const optionButton = options.find(el => el.closest("button") && !el.closest('[class*="bg-white rounded-2xl"]'));
      expect(optionButton).toBeDefined();
      fireEvent.click(optionButton!);

      const triggers = screen.getAllByRole("button", { name: /взрослым/i });
      expect(triggers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("location filter selection", () => {
    it("has LocationFilter trigger button", () => {
      renderHome();
      const trigger = screen.getByRole("button", { name: /все локации/i });
      expect(trigger).toBeInTheDocument();
    });
  });

  describe("activity card tap opens ActivityDetail", () => {
    it("shows ActivityDetail when a card title is tapped", () => {
      renderHome();
      tapCardTrigger();
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    });

    it("renders the materials block when materialDetails is present", () => {
      renderHome();
      tapCardTrigger();
      expect(screen.getByTestId("material-block")).toBeInTheDocument();
      expect(screen.getByText("Материал", { exact: true })).toBeInTheDocument();
    });

    it("renders NO materials block for a service without materials (block-omission guard)", () => {
      mocks.getByDate.mockReturnValue([
        {
          ...mockSchedules[0],
          material: "",
          materialDetails: undefined,
        },
      ]);
      renderHome();
      tapCardTrigger();
      expect(screen.queryByTestId("material-block")).not.toBeInTheDocument();
      expect(screen.queryByText("Материал", { exact: true })).not.toBeInTheDocument();
    });

    it("closes ActivityDetail when close button is clicked", () => {
      renderHome();
      tapCardTrigger();
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
      const closeBtn = screen.getByRole("button", { name: /close overlay/i });
      fireEvent.click(closeBtn);
      expect(screen.queryByText("Анна Иванова")).not.toBeInTheDocument();
    });
  });

  describe("book button transitions to BookingOverlay", () => {
    it("shows BookingOverlay when book button is clicked from ActivityDetail", () => {
      renderHome();
      tapCardTrigger();
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
      const bookButton = screen.getByRole("button", { name: /участвовать/i });
      fireEvent.click(bookButton);
      expect(screen.getByText("Оформление записи")).toBeInTheDocument();
      expect(screen.queryByText("Анна Иванова")).not.toBeInTheDocument();
    });

    it("closes BookingOverlay when back button is clicked", () => {
      renderHome();
      tapCardTrigger();
      fireEvent.click(screen.getByRole("button", { name: /участвовать/i }));
      expect(screen.getByText("Оформление записи")).toBeInTheDocument();
      const backBtn = screen.getByRole("button", { name: /назад/i });
      fireEvent.click(backBtn);
      expect(screen.queryByText("Оформление записи")).not.toBeInTheDocument();
    });
  });

  describe("menu toggle opens HamburgerMenu", () => {
    it("shows HamburgerMenu when menu button is clicked", () => {
      renderHome();
      const menuButton = screen.getByRole("button", { name: /menu/i });
      fireEvent.click(menuButton);
      expect(screen.getByTestId("menu-overlay")).toBeInTheDocument();
    });

    it("closes HamburgerMenu when close button is clicked", async () => {
      renderHome();
      const menuButton = screen.getByRole("button", { name: /menu/i });
      fireEvent.click(menuButton);
      expect(screen.getByTestId("menu-overlay")).toBeInTheDocument();
      const closeBtn = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
      });
    });
  });
});
