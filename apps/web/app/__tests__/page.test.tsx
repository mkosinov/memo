import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "../page";

// ── Mock hooks ──────────────────────────────────────────────
// Must use vi.hoisted for variables referenced in vi.mock (which is hoisted)
const mocks = vi.hoisted(() => ({
  selectDate: vi.fn(),
  setTab: vi.fn(),
}));

const mockActivities = [
  {
    id: "act-1",
    title: "Акварельный пейзаж",
    category: "взрослым" as const,
    imageUrl: "/test-activity.jpg",
    time: "14:00",
    duration: "2 часа",
    location: { id: "loc-1", name: "Студия на Арбате" },
    guestsCount: 5,
    material: "Акварель",
    size: "30x40",
    priceMin: 2500,
    priceMax: 3500,
    teacherName: "Анна Иванова",
    teacherAvatar: "/teacher.jpg",
    date: "2026-05-20",
    priceFormatted: "2 500 – 3 500 ₽",
    dateFormatted: "20 мая, среда",
    categoryColor: "#C49A2E",
  },
  {
    id: "act-2",
    title: "Семейное рисование",
    category: "вместе" as const,
    imageUrl: "/test-activity-2.jpg",
    time: "16:00",
    duration: "1.5 часа",
    location: { id: "loc-2", name: "Парк Горького" },
    guestsCount: 3,
    material: "Акрил",
    size: "20x30",
    priceMin: 1500,
    priceMax: 2500,
    teacherName: "Мария Петрова",
    date: "2026-05-21",
    priceFormatted: "1 500 – 2 500 ₽",
    dateFormatted: "21 мая, четверг",
    categoryColor: "#5B8C7A",
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
  date.setDate(mockToday.getDate() + 1 + i); // Start from tomorrow
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

vi.mock("../hooks/useActivities", () => ({
  useActivities: () => ({
    activities: mockActivities,
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

// ── Tests ───────────────────────────────────────────────────

describe("Home (page.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectDate.mockClear();
    mocks.setTab.mockClear();
  });

  describe("section rendering", () => {
    it("renders Hero section with title", () => {
      renderHome();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Цветные Горы");
    });

    it("renders CalendarLine with day names", () => {
      renderHome();
      // With 'tomorrow' tab active, days start from Чт (Thursday)
      expect(screen.getAllByText("Чт").length).toBeGreaterThanOrEqual(1);
    });

    it("renders FilterPills with category options", () => {
      renderHome();
      // "вместе" appears in both FilterPills and card category pills — use getAllByText
      const vsego = screen.getAllByText("вместе");
      expect(vsego.length).toBeGreaterThanOrEqual(1);
      const vzroslym = screen.getAllByText("взрослым");
      expect(vzroslym.length).toBeGreaterThanOrEqual(1);
      const detyam = screen.getAllByText("детям");
      expect(detyam.length).toBeGreaterThanOrEqual(1);
    });

    it("renders LocationFilter with location options", () => {
      renderHome();
      // Location names appear in both LocationFilter <option> and MKCard <p>
      const loc1 = screen.getAllByText("Студия на Арбате");
      expect(loc1.length).toBeGreaterThanOrEqual(1);
      const loc2 = screen.getAllByText("Парк Горького");
      expect(loc2.length).toBeGreaterThanOrEqual(1);
      // Verify the select element exists
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("renders MKCarousel with activity cards", () => {
      renderHome();
      expect(screen.getByText("Акварельный пейзаж")).toBeInTheDocument();
      expect(screen.getByText("Семейное рисование")).toBeInTheDocument();
    });

    it("renders Reviews section", () => {
      renderHome();
      // Reviews renders "Хорошее место 4.9★" and "Посмотреть отзывы"
      expect(screen.getByText(/Хорошее место/)).toBeInTheDocument();
      expect(screen.getByText(/Посмотреть отзывы/)).toBeInTheDocument();
    });

    it("renders GuestGallery section", () => {
      renderHome();
      // GuestGallery renders guest photo images
      const guestImages = screen.getAllByAltText(/Guest photo/);
      expect(guestImages.length).toBeGreaterThanOrEqual(1);
    });

    it("renders ChatBar", () => {
      renderHome();
      // ChatBar renders "Отправить" button and chips
      expect(screen.getByRole("button", { name: /отправить/i })).toBeInTheDocument();
      expect(screen.getByText(/Для ребёнка/)).toBeInTheDocument();
    });
  });

  describe("calendar date selection", () => {
    it("calls selectDate when a calendar day is clicked", () => {
      renderHome();
      // Click the day button that shows "21"
      const dayButton = screen.getByRole("button", { name: /21/ });
      fireEvent.click(dayButton);
      expect(mocks.selectDate).toHaveBeenCalled();
    });
  });

  describe("category filter selection", () => {
    it("has 'вместе' selected by default", () => {
      renderHome();
      const pills = screen.getAllByText("вместе");
      const pillButton = pills[0].closest("button");
      expect(pillButton).toHaveClass("bg-[#004D56]");
    });

    it("calls onSelectCategory when a category pill is clicked", () => {
      renderHome();
      // Find the FilterPills button for "взрослым" (not the card category span)
      const pills = screen.getAllByText("взрослым");
      const pillButton = pills[0].closest("button");
      expect(pillButton).toBeInTheDocument();
      fireEvent.click(pillButton!);
      // After clicking, the pill should be highlighted (active state)
      const activePill = screen.getAllByText("взрослым")[0].closest("button");
      expect(activePill).toHaveClass("bg-[#004D56]");
    });
  });

  describe("location filter selection", () => {
    it("calls onSelectLocation when a location is selected", () => {
      renderHome();
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "loc-1" } });
      expect(select.value).toBe("loc-1");
    });
  });

  describe("activity card tap opens ActivityDetail", () => {
    it("shows ActivityDetail when a card title is tapped", () => {
      renderHome();
      // Tap the card title
      fireEvent.click(screen.getByText("Акварельный пейзаж"));
      // ActivityDetail should render with teacher name
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    });

    it("closes ActivityDetail when close button is clicked", () => {
      renderHome();
      fireEvent.click(screen.getByText("Акварельный пейзаж"));
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
      // Close button has aria-label="Close overlay"
      const closeBtn = screen.getByRole("button", { name: /close overlay/i });
      fireEvent.click(closeBtn);
      expect(screen.queryByText("Анна Иванова")).not.toBeInTheDocument();
    });
  });

  describe("book button transitions to BookingOverlay", () => {
    it("shows BookingOverlay when book button is clicked from ActivityDetail", () => {
      renderHome();
      // Open ActivityDetail
      fireEvent.click(screen.getByText("Акварельный пейзаж"));
      expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
      // Click book button
      const bookButton = screen.getByRole("button", { name: /участвовать/i });
      fireEvent.click(bookButton);
      // BookingOverlay should appear
      expect(screen.getByText("Оформление записи")).toBeInTheDocument();
      // ActivityDetail should be closed
      expect(screen.queryByText("Анна Иванова")).not.toBeInTheDocument();
    });

    it("closes BookingOverlay when back button is clicked", () => {
      renderHome();
      fireEvent.click(screen.getByText("Акварельный пейзаж"));
      fireEvent.click(screen.getByRole("button", { name: /участвовать/i }));
      expect(screen.getByText("Оформление записи")).toBeInTheDocument();
      // Click back
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
      // Framer-motion exit animation keeps element in DOM briefly
      await waitFor(() => {
        expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
      });
    });
  });
});
