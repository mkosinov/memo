import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Page imports ────────────────────────────────────────────
import ServicesPage from "../services/page";
import LocationsPage from "../locations/page";
import PleinairPage from "../pleinair/page";
import CorporatePage from "../corporate/page";
import ShopPage from "../shop/page";
import AboutPage from "../about/page";
import CabinetPage from "../cabinet/page";
import BookingPage from "../booking/page";

// ── Helpers ─────────────────────────────────────────────────

function renderPage(Page: React.ComponentType) {
  return render(<Page />);
}

// ── Simple placeholder pages (1-6) ─────────────────────────

describe("Simple placeholder pages", () => {
  const pages = [
    { Component: ServicesPage, title: "Услуги" },
    { Component: LocationsPage, title: "Студии" },
    { Component: PleinairPage, title: "Пленэр" },
    { Component: CorporatePage, title: "Корпоративы" },
    { Component: ShopPage, title: "Магазин" },
    { Component: AboutPage, title: "О нас" },
  ];

  for (const { Component, title } of pages) {
    describe(title, () => {
      it("renders without errors", () => {
        renderPage(Component);
        expect(screen.getByRole("main")).toBeInTheDocument();
      });

      it("renders Header", () => {
        renderPage(Component);
        expect(screen.getByRole("banner")).toBeInTheDocument();
      });

      it(`renders title "${title}"`, () => {
        renderPage(Component);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
      });

      it("renders description text", () => {
        renderPage(Component);
        expect(screen.getByRole("main")).toHaveTextContent(/в разработке/i);
      });
    });
  }
});

// ── Cabinet page ────────────────────────────────────────────

describe("Cabinet page", () => {
  it("renders without errors", () => {
    renderPage(CabinetPage);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders Header", () => {
    renderPage(CabinetPage);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it('renders title "Личный кабинет"', () => {
    renderPage(CabinetPage);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Личный кабинет");
  });

  it("renders phone input", () => {
    renderPage(CabinetPage);
    expect(screen.getByPlaceholderText("+7 (999) 999-99-99")).toBeInTheDocument();
  });

  it('renders "Войти" button', () => {
    renderPage(CabinetPage);
    expect(screen.getByRole("button", { name: /войти/i })).toBeInTheDocument();
  });
});

// ── Booking page ────────────────────────────────────────────

describe("Booking page", () => {
  it("renders without errors", () => {
    renderPage(BookingPage);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders Header", () => {
    renderPage(BookingPage);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("renders booking form title", () => {
    renderPage(BookingPage);
    expect(screen.getByText("Оформление записи")).toBeInTheDocument();
  });
});
