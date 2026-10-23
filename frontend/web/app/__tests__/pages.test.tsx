import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock the client-branch API (#499): the booking overlay detects the
// session on open — keep these tests hermetic (anonymous by default).
vi.mock("@memo/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    getMyClient: vi.fn().mockRejectedValue(new ApiError(401, "unauthorized")),
    requestOtpCode: vi.fn(),
    verifyOtpCode: vi.fn(),
    createMyRecord: vi.fn(),
    logout: vi.fn(),
  };
});

// ── /cabinet redirects an authenticated client to /cabinet/records
// (#513 Task 7) — the smoke render needs a router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

// ── Page imports ────────────────────────────────────────────
import ServicesPage from "../services/page";
import LocationsPage from "../locations/page";
import PleinairPage from "../pleinair/page";
import CorporatePage from "../corporate/page";
import ShopPage from "../shop/page";
import AboutPage from "../about/page";
import CabinetPage from "../cabinet/page";

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

// ── Cabinet page (behavior covered in depth by cabinet.test.tsx) ──

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
});
